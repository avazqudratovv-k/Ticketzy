import { InternalServerErrorException } from '@nestjs/common';
import { CodedException } from '../../libs/coded-exception';
import { EventService, getEventSubmitError } from './event.service';
import { EventResolver } from './event.resolver';
import { LikeService } from '../like/like.service';
import { ViewService } from '../view/view.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { EventStatus, SeatStatus, SeatingType, SectionKind, SectionSpacing, eventTransitions } from '../../libs/enums/event.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationType } from '../../libs/enums/notification.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const lean = (value: any) => ({ lean: () => exec(value) });
/** find().sort().limit().select().lean().exec() */
const chain = (value: any): any => {
	const c: any = { exec: jest.fn().mockResolvedValue(value) };
	for (const name of ['sort', 'limit', 'select', 'lean']) c[name] = jest.fn().mockReturnValue(c);
	return c;
};

const seatedSection = (over: any = {}) => ({
	key: 'A',
	name: 'Floor A',
	kind: SectionKind.SEATED,
	rows: 2,
	seatsPerRow: 3,
	x: 0,
	y: 0,
	rotation: 0,
	spacing: SectionSpacing.NORMAL,
	tierKey: 'vip',
	...over,
});
const standingSection = (over: any = {}) => seatedSection({ key: 'S', kind: SectionKind.STANDING, capacity: 50, tierKey: undefined, ...over });
/** 6 vip seats (A), 4 regular seats (B), one standing section */
const layout = () => ({
	sections: [seatedSection(), seatedSection({ key: 'B', rows: 1, seatsPerRow: 4, tierKey: 'regular' }), standingSection()],
});

const future = (days = 7) => new Date(Date.now() + days * 86400000);
const draft = (over: any = {}) => ({
	_id: 'e1',
	organizerId: 'org1',
	eventTitle: 'Rock Night',
	eventImages: ['uploads/event/a.png'],
	venueId: 'v1',
	startAt: future(7),
	endAt: future(8),
	eventStatus: EventStatus.DRAFT,
	eventViews: 0,
	...over,
});

describe('event transition rules', () => {
	const statuses = Object.values(EventStatus);
	const allowed = (action: keyof typeof eventTransitions) =>
		statuses.filter((status) => eventTransitions[action].from.includes(status));

	it('submit starts from DRAFT or REJECTED only and goes to PENDING', () => {
		expect(allowed('submit')).toEqual([EventStatus.DRAFT, EventStatus.REJECTED]);
		expect(eventTransitions.submit.to).toBe(EventStatus.PENDING);
	});

	it('approve and reject start from PENDING only', () => {
		expect(allowed('approve')).toEqual([EventStatus.PENDING]);
		expect(eventTransitions.approve.to).toBe(EventStatus.APPROVED);
		expect(allowed('reject')).toEqual([EventStatus.PENDING]);
		expect(eventTransitions.reject.to).toBe(EventStatus.REJECTED);
	});

	it('cancel and end start from APPROVED only', () => {
		expect(allowed('cancel')).toEqual([EventStatus.APPROVED]);
		expect(eventTransitions.cancel.to).toBe(EventStatus.CANCELLED);
		expect(allowed('end')).toEqual([EventStatus.APPROVED]);
		expect(eventTransitions.end.to).toBe(EventStatus.ENDED);
	});

	it('nothing leaves CANCELLED or ENDED', () => {
		for (const action of Object.keys(eventTransitions) as (keyof typeof eventTransitions)[]) {
			expect(allowed(action)).not.toContain(EventStatus.CANCELLED);
			expect(allowed(action)).not.toContain(EventStatus.ENDED);
		}
	});
});

describe('getEventSubmitError', () => {
	it('accepts a complete event', () => {
		expect(getEventSubmitError(draft(), true, 1)).toBeNull();
	});

	it('requires a title', () => {
		expect(getEventSubmitError(draft({ eventTitle: '   ' }), true, 1)).toBe(Message.EVENT_SUBMIT_TITLE_REQUIRED);
	});

	it('requires at least one image', () => {
		expect(getEventSubmitError(draft({ eventImages: [] }), true, 1)).toBe(Message.EVENT_SUBMIT_IMAGE_REQUIRED);
	});

	it('requires start and end dates in the future', () => {
		expect(getEventSubmitError(draft({ startAt: future(-1) }), true, 1)).toBe(Message.EVENT_SUBMIT_DATES_IN_PAST);
		expect(getEventSubmitError(draft({ endAt: future(-1) }), true, 1)).toBe(Message.EVENT_SUBMIT_DATES_IN_PAST);
	});

	it('requires a usable venue', () => {
		expect(getEventSubmitError(draft(), false, 1)).toBe(Message.EVENT_SUBMIT_VENUE_REQUIRED);
	});

	it('requires at least one ticket type', () => {
		expect(getEventSubmitError(draft(), true, 0)).toBe(Message.EVENT_SUBMIT_TICKET_TYPE_REQUIRED);
	});

	describe('seated sections of a RESERVED event', () => {
		const reserved = draft({ seatingType: SeatingType.RESERVED });
		const check = (event: any, venueLayout: any, tierKeys: string[]) =>
			getEventSubmitError(event, true, tierKeys.length || 1, new Date(), { venueLayout, tierKeys });

		it('needs a layout with a seated section', () => {
			expect(check(reserved, undefined, ['vip'])).toBe(Message.EVENT_SUBMIT_LAYOUT_REQUIRED);
			expect(check(reserved, { sections: [standingSection()] }, ['vip'])).toBe(Message.EVENT_SUBMIT_LAYOUT_REQUIRED);
		});

		it('needs a ticket type for every seated tier', () => {
			expect(check(reserved, layout(), ['vip'])).toBe(Message.SEAT_TIER_MISSING);
			expect(check(reserved, layout(), [])).toBe(Message.SEAT_TIER_MISSING);
		});

		it('passes when every seated tier has a ticket type, standing sections need none', () => {
			expect(check(reserved, layout(), ['vip', 'regular'])).toBeNull();
		});

		it('does not look at the layout of a GENERAL event', () => {
			expect(getEventSubmitError(draft({ seatingType: SeatingType.GENERAL }), true, 1)).toBeNull();
		});
	});
});

describe('EventService', () => {
	let eventModel: any;
	let venueModel: any;
	let ticketTypeModel: any;
	let memberModel: any;
	let memberService: any;
	let viewService: any;
	let notificationService: any;
	let auditLogService: any;
	let eventSeatModel: any;
	let refundService: any;
	let aiModerationService: any;
	let orderModel: any;
	let service: EventService;

	beforeEach(() => {
		eventModel = {
			findOne: jest.fn(),
			find: jest.fn().mockReturnValue(chain([])), // venue clash check: no clash unless a test says so
			findById: jest.fn().mockReturnValue(lean(null)),
			findOneAndUpdate: jest.fn(),
			findOneAndDelete: jest.fn(),
			aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])),
		};
		venueModel = { distinct: jest.fn().mockResolvedValue(['v9']), exists: jest.fn().mockResolvedValue({ _id: 'v1' }), findById: jest.fn().mockReturnValue(lean(null)), findOne: jest.fn().mockReturnValue(lean({ _id: 'v1' })) };
		eventSeatModel = { bulkWrite: jest.fn().mockResolvedValue({}), find: jest.fn(), findOne: jest.fn().mockReturnValue({ select: () => lean(null) }) };
		ticketTypeModel = { find: jest.fn(), aggregate: jest.fn().mockReturnValue(exec([])), bulkWrite: jest.fn().mockResolvedValue({}), countDocuments: jest.fn().mockReturnValue(exec(1)), deleteMany: jest.fn().mockReturnValue(exec({})) };
		memberModel = { distinct: jest.fn().mockResolvedValue(['o9']), findById: jest.fn().mockReturnValue(lean({ _id: 'org1', memberStatus: MemberStatus.SUSPENDED })) };
		memberService = { getMember: jest.fn().mockResolvedValue({ _id: 'org1' }), memberStatsEditor: jest.fn().mockResolvedValue({}) };
		viewService = { recordView: jest.fn().mockResolvedValue(null) };
		notificationService = { createNotification: jest.fn().mockResolvedValue(undefined) };
		auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
		refundService = {
			refundOrdersForCancelledEvent: jest.fn().mockResolvedValue({ refundedCount: 2, failedCount: 0, totalCount: 2, failedOrderIds: [] }),
		};
		orderModel = { aggregate: jest.fn().mockReturnValue(exec([])) };
		aiModerationService = { moderateEvent: jest.fn().mockResolvedValue({ checked: true, flags: [] }) };
		service = new EventService(
			eventModel,
			venueModel,
			ticketTypeModel,
			memberModel,
			memberService,
			viewService,
			{ checkLikeExistence: jest.fn().mockResolvedValue([]) } as any,
			notificationService,
			auditLogService,
			eventSeatModel,
			refundService,
			aiModerationService,
			orderModel,
		);
	});

	describe('sales window rules', () => {
		const h = (hours: number) => new Date(Date.now() + hours * 3600000);
		const input = (over: any = {}) => ({ organizerId: 'org1', venueId: 'a'.repeat(24), startAt: h(24), endAt: h(27), ...over });

		describe('createEvent', () => {
			it.each([
				['sales start not before sales end', { saleStartAt: h(10), saleEndAt: h(5) }, Message.SALES_START_NOT_BEFORE_SALES_END],
				['sales end after the event end', { saleStartAt: h(1), saleEndAt: h(28) }, Message.SALES_END_AFTER_EVENT_END],
				['sales start at or after the event end', { saleStartAt: h(28) }, Message.SALES_START_NOT_BEFORE_EVENT_END],
			])('refuses %s', async (_name, over, message) => {
				eventModel.create = jest.fn();
				await expect(service.createEvent(input(over) as any)).rejects.toThrow(message);
				expect(eventModel.create).not.toHaveBeenCalled();
			});

			it('accepts a valid window, sales ending exactly at the event end', async () => {
				eventModel.create = jest.fn().mockResolvedValue({ _id: 'e1', organizerId: 'org1' });
				await service.createEvent(input({ saleStartAt: h(1), saleEndAt: h(27) }) as any);
				expect(eventModel.create).toHaveBeenCalled();
			});
		});

		describe('updateEvent', () => {
			const update = (stored: any, patch: any) => {
				eventModel.findOne.mockReturnValue(lean(draft(stored)));
				eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
				return service.updateEvent('org1' as any, { _id: 'e1', ...patch } as any);
			};

			it('re-checks the stored window when the event end moves earlier', async () => {
				await expect(update({ startAt: h(24), endAt: h(30), saleStartAt: h(1), saleEndAt: h(29) }, { endAt: h(26) })).rejects.toThrow(
					Message.SALES_END_AFTER_EVENT_END,
				);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('re-checks the stored sales start when the event end moves earlier', async () => {
				await expect(update({ startAt: h(24), endAt: h(30), saleStartAt: h(28) }, { endAt: h(26) })).rejects.toThrow(
					Message.SALES_START_NOT_BEFORE_EVENT_END,
				);
			});

			it('re-checks against the stored event end when only the sales window changes', async () => {
				await expect(update({ startAt: h(24), endAt: h(27) }, { saleEndAt: h(40) })).rejects.toThrow(Message.SALES_END_AFTER_EVENT_END);
				await expect(update({ startAt: h(24), endAt: h(27), saleStartAt: h(5) }, { saleEndAt: h(2) })).rejects.toThrow(
					Message.SALES_START_NOT_BEFORE_SALES_END,
				);
			});

			it('accepts moving the event later together with the window', async () => {
				await update({ startAt: h(24), endAt: h(27), saleStartAt: h(1), saleEndAt: h(27) }, { startAt: h(48), endAt: h(51), saleEndAt: h(51) });
				expect(eventModel.findOneAndUpdate).toHaveBeenCalled();
			});

			it('also applies to the admin edit', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ startAt: h(24), endAt: h(27), saleEndAt: h(40) })));
				await expect(service.updateEventByAdmin('admin-1' as any, { _id: 'e1', eventTitle: 'x' } as any)).rejects.toThrow(Message.SALES_END_AFTER_EVENT_END);
			});
		});

		describe('submitEventForApproval', () => {
			it.each([
				['sales start not before sales end', { saleStartAt: future(5), saleEndAt: future(2) }, Message.SALES_START_NOT_BEFORE_SALES_END],
				['sales end after the event end', { saleStartAt: future(1), saleEndAt: future(9) }, Message.SALES_END_AFTER_EVENT_END],
				['sales start after the event end', { saleStartAt: future(9) }, Message.SALES_START_NOT_BEFORE_EVENT_END],
			])('refuses a stored event with %s', async (_name, over, message) => {
				eventModel.findOne.mockReturnValue(lean(draft(over)));
				await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(message);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('accepts a valid window', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ saleStartAt: future(1), saleEndAt: future(8) })));
				eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.PENDING })));
				await service.submitEventForApproval('org1' as any, 'e1' as any);
				expect(eventModel.findOneAndUpdate).toHaveBeenCalled();
			});
		});
	});

	describe('venue double-booking (decision #83)', () => {
		const at = (hour: number, day = 1) => new Date(Date.UTC(2031, 0, day, hour));
		const stored = (over: any) => ({
			_id: 'other',
			organizerId: 'org2',
			venueId: 'v1',
			eventTitle: 'Jazz Night',
			eventStatus: EventStatus.APPROVED,
			startAt: at(10),
			endAt: at(12),
			...over,
		});

		/** `find` evaluates the clash filter against these events, so the real overlap rules are exercised */
		const store = (events: any[]) =>
			eventModel.find.mockImplementation((filter: any) =>
				chain(
					events.filter(
						(event) =>
							String(event.venueId) === String(filter.venueId) &&
							filter.eventStatus.$in.includes(event.eventStatus) &&
							event.startAt < filter.startAt.$lt &&
							event.endAt > filter.endAt.$gt &&
							(!filter._id || String(event._id) !== String(filter._id.$ne)),
					),
				),
			);
		const create = (over: any = {}) => {
			eventModel.create = jest.fn().mockResolvedValue({ _id: 'new', organizerId: 'org1' });
			return service.createEvent({ organizerId: 'org1', venueId: 'a'.repeat(24), startAt: at(11), endAt: at(13), ...over } as any);
		};
		beforeEach(() => {
			venueModel.findOne.mockReturnValue(lean({ _id: 'v1' }));
			venueModel.findById.mockReturnValue(chain({ venueTimezone: 'Asia/Seoul' }));
		});

		it.each([
			['exact overlap', 10, 12],
			['partial overlap at the start', 9, 11],
			['partial overlap at the end', 11, 13],
			['contained in the other event', 10.5 as any, 11],
			['containing the other event', 9, 13],
		])('refuses %s', async (_name, start, end) => {
			store([stored({ venueId: 'a'.repeat(24) })]);
			const toDate = (hour: number) => new Date(Date.UTC(2031, 0, 1, Math.floor(hour), (hour % 1) * 60));
			await expect(create({ startAt: toDate(start), endAt: toDate(end) })).rejects.toThrow(
				'This venue is already booked for Jazz Night from 2031-01-01 19:00 to 2031-01-01 21:00.',
			);
			expect(eventModel.create).not.toHaveBeenCalled();
		});

		it('names the clash with the venue wall clock (Asia/Seoul is UTC+9)', async () => {
			store([stored({ venueId: 'a'.repeat(24) })]);
			await expect(create()).rejects.toThrow(/from 2031-01-01 19:00 to 2031-01-01 21:00\.$/);
			expect(Message.VENUE_ALREADY_BOOKED).toContain('{title}');
		});

		it('uses the timezone of the venue', async () => {
			venueModel.findById.mockReturnValue(chain({ venueTimezone: 'UTC' }));
			store([stored({ venueId: 'a'.repeat(24) })]);
			await expect(create()).rejects.toThrow('from 2031-01-01 10:00 to 2031-01-01 12:00.');
		});

		it('allows an event that starts exactly when the other one ends, and one that ends exactly when it starts', async () => {
			store([stored({ venueId: 'a'.repeat(24) })]);
			await expect(create({ startAt: at(12), endAt: at(14) })).resolves.toBeDefined();
			await expect(create({ startAt: at(8), endAt: at(10) })).resolves.toBeDefined();
		});

		it('allows the same time at another venue record', async () => {
			store([stored({ venueId: 'b'.repeat(24) })]);
			await expect(create()).resolves.toBeDefined();
		});

		it.each([EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.CANCELLED])('a %s event does not block', async (status) => {
			store([stored({ venueId: 'a'.repeat(24), eventStatus: status })]);
			await expect(create()).resolves.toBeDefined();
		});

		it.each([EventStatus.PENDING, EventStatus.APPROVED, EventStatus.ENDED])('a %s event blocks', async (status) => {
			store([stored({ venueId: 'a'.repeat(24), eventStatus: status })]);
			await expect(create()).rejects.toThrow(/already booked/);
		});

		it('blocks another organizer too (the venue record is shared)', async () => {
			store([stored({ venueId: 'a'.repeat(24), organizerId: 'someone-else' })]);
			await expect(create()).rejects.toThrow(/already booked/);
		});

		describe('submit', () => {
			it('refuses a submit that clashes and leaves the status alone', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ _id: 'e1', venueId: 'a'.repeat(24), startAt: future(7), endAt: future(8) })));
				store([stored({ venueId: 'a'.repeat(24), startAt: future(7), endAt: future(8) })]);
				await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(/already booked for Jazz Night/);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('does not clash with itself', async () => {
				const me = draft({ _id: 'e1', venueId: 'a'.repeat(24), eventStatus: EventStatus.REJECTED });
				eventModel.findOne.mockReturnValue(lean(me));
				eventModel.findOneAndUpdate.mockReturnValue(exec({ ...me, eventStatus: EventStatus.PENDING }));
				store([{ ...me, eventStatus: EventStatus.PENDING }]); // the stored copy of the very same event
				await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).resolves.toBeDefined();
			});
		});

		describe('update', () => {
			const update = (stored_: any, patch: any) => {
				eventModel.findOne.mockReturnValue(lean(draft({ _id: 'e1', venueId: 'a'.repeat(24), startAt: at(14), endAt: at(16), ...stored_ })));
				eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
				return service.updateEvent('org1' as any, { _id: 'e1', ...patch } as any);
			};

			it('refuses a date change into a clash', async () => {
				store([stored({ venueId: 'a'.repeat(24) })]);
				await expect(update({}, { startAt: at(11), endAt: at(15) })).rejects.toThrow(/already booked for Jazz Night/);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('checks the stored dates when only the venue changes, and the stored venue when only the dates change', async () => {
				store([stored({ venueId: 'c'.repeat(24), startAt: at(15), endAt: at(17) })]);
				await expect(update({}, { venueId: 'c'.repeat(24) })).rejects.toThrow(/already booked/);
				store([stored({ venueId: 'a'.repeat(24), startAt: at(18), endAt: at(20) })]);
				await expect(update({}, { endAt: at(19) })).rejects.toThrow(/already booked/);
			});

			it('does not clash with itself when its own dates are edited', async () => {
				store([stored({ _id: 'e1', venueId: 'a'.repeat(24), eventStatus: EventStatus.APPROVED, startAt: at(14), endAt: at(16) })]);
				await expect(update({ eventStatus: EventStatus.APPROVED }, { startAt: at(13), endAt: at(17) })).resolves.toBeDefined();
			});

			it('does not run the check for an edit that leaves venue and dates alone', async () => {
				store([stored({ venueId: 'a'.repeat(24), startAt: at(14), endAt: at(16) })]); // old data that already overlaps
				await expect(update({}, { eventTitle: 'New title' })).resolves.toBeDefined();
				expect(eventModel.find).not.toHaveBeenCalled();
			});

			it('also applies to the admin edit', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ _id: 'e1', venueId: 'a'.repeat(24), startAt: at(14), endAt: at(16) })));
				store([stored({ venueId: 'a'.repeat(24) })]);
				await expect(service.updateEventByAdmin('admin-1' as any, { _id: 'e1', startAt: at(9), endAt: at(11) } as any)).rejects.toThrow(/already booked/);
			});
		});

		describe('approve', () => {
			it('refuses when another event took the slot while this one waited, and changes nothing', async () => {
				const waiting = draft({ _id: 'e1', venueId: 'a'.repeat(24), eventStatus: EventStatus.PENDING, startAt: at(10), endAt: at(12) });
				eventModel.findById.mockReturnValue(lean(waiting));
				store([stored({ venueId: 'a'.repeat(24), startAt: at(11), endAt: at(13) })]);
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(/already booked for Jazz Night/);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
				expect(eventSeatModel.bulkWrite).not.toHaveBeenCalled();
			});

			it('approves when the slot is free', async () => {
				const waiting = draft({ _id: 'e1', venueId: 'a'.repeat(24), eventStatus: EventStatus.PENDING, seatingType: SeatingType.GENERAL });
				eventModel.findById.mockReturnValue(lean(waiting));
				eventModel.findOneAndUpdate.mockReturnValue(exec({ ...waiting, eventStatus: EventStatus.APPROVED }));
				store([]);
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).resolves.toBeDefined();
			});
		});

		describe('multi-day events use first-day start to last-day end', () => {
			it('a one-day show inside the span of a multi-day event is refused, even outside the daily hours', async () => {
				// festival: Jan 1 10:00 to Jan 3 22:00 (daily 10:00-22:00); a show on Jan 2 at 23:00-24:00 is outside its hours
				store([stored({ venueId: 'a'.repeat(24), startAt: at(10, 1), endAt: at(22, 3), eventTitle: 'Three Day Festival' })]);
				await expect(create({ startAt: at(23, 2), endAt: at(24, 2) })).rejects.toThrow(/already booked for Three Day Festival/);
			});
		});
	});

	describe('possibleVenueConflicts for admins (decision #84)', () => {
		const at = (hour: number) => new Date(Date.UTC(2031, 0, 1, hour));
		const venue = (over: any) => ({ _id: 'v1', venueName: 'Olympic Hall', venueCity: 'Seoul', venueCoordinates: [], ...over });
		const mine = (over: any = {}) =>
			draft({ _id: 'e1', eventStatus: EventStatus.PENDING, venueId: 'v1', startAt: at(10), endAt: at(12), venueData: venue({}), ...over });
		const other = (over: any = {}) => ({
			_id: 'e2',
			venueId: 'v2',
			eventTitle: 'Jazz Night',
			eventStatus: EventStatus.APPROVED,
			startAt: at(11),
			endAt: at(13),
			organizerNick: 'jazzbros',
			...over,
		});
		/** first aggregate = the page, second = the conflict candidates; venueModel.find = the same-place venues */
		const setup = (page: any[], venues: any[], candidates: any[]) => {
			eventModel.aggregate
				.mockReturnValueOnce(exec([{ list: page, metaCounter: [{ total: page.length }] }]))
				.mockReturnValueOnce(exec(candidates));
			venueModel.find = jest.fn().mockReturnValue(chain(venues));
		};
		const input = { page: 1, limit: 20, search: {} } as any;

		it('lists an event of another organizer at a same-named venue record in the same city', async () => {
			setup([mine()], [venue({ _id: 'v2', venueName: '  OLYMPIC   hall! ' })], [other()]);
			const result = await service.getEventsByAdmin(input);
			expect(result.list[0].possibleVenueConflicts).toEqual([
				{ eventId: 'e2', eventTitle: 'Jazz Night', eventStatus: EventStatus.APPROVED, organizerNick: 'jazzbros', venueName: '  OLYMPIC   hall! ', startAt: at(11), endAt: at(13) },
			]);
		});

		it('matches by coordinates when the names differ', async () => {
			setup(
				[mine({ venueData: venue({ venueCoordinates: [127.1, 37.5] }) })],
				[venue({ _id: 'v2', venueName: 'Another name', venueCity: 'Elsewhere', venueCoordinates: [127.1, 37.5] })],
				[other()],
			);
			const result = await service.getEventsByAdmin(input);
			expect(result.list[0].possibleVenueConflicts).toHaveLength(1);
		});

		it('is empty for another city or another venue name', async () => {
			setup([mine()], [venue({ _id: 'v2', venueName: 'Olympic Hall', venueCity: 'Busan' }), venue({ _id: 'v3', venueName: 'Sejong Center' })], [other(), other({ _id: 'e3', venueId: 'v3' })]);
			const result = await service.getEventsByAdmin(input);
			expect(result.list[0].possibleVenueConflicts).toEqual([]);
		});

		it('ignores events whose time only touches or does not reach, and the event itself', async () => {
			setup(
				[mine()],
				[venue({ _id: 'v2' })],
				[other({ _id: 'e4', startAt: at(12), endAt: at(14) }), other({ _id: 'e5', startAt: at(8), endAt: at(10) }), other({ _id: 'e1' })],
			);
			const result = await service.getEventsByAdmin(input);
			expect(result.list[0].possibleVenueConflicts).toEqual([]);
		});

		it('asks the database only for PENDING / APPROVED / ENDED events (no draft, rejected, cancelled)', async () => {
			setup([mine()], [venue({ _id: 'v2' })], [other()]);
			await service.getEventsByAdmin(input);
			const candidatePipeline = eventModel.aggregate.mock.calls[1][0];
			expect(candidatePipeline[0].$match.eventStatus.$in).toEqual([EventStatus.PENDING, EventStatus.APPROVED, EventStatus.ENDED]);
		});

		it('costs two queries for a whole page, however many events it has', async () => {
			const page = [mine({ _id: 'p1' }), mine({ _id: 'p2', startAt: at(20), endAt: at(21) }), mine({ _id: 'p3', eventStatus: EventStatus.APPROVED }), mine({ _id: 'p4', eventStatus: EventStatus.DRAFT })];
			setup(page, [venue({ _id: 'v2' })], [other()]);
			const result = await service.getEventsByAdmin(input);
			expect(venueModel.find).toHaveBeenCalledTimes(1);
			expect(eventModel.aggregate).toHaveBeenCalledTimes(2); // the page itself + one candidate query
			expect(result.list.map((event) => event.possibleVenueConflicts?.length)).toEqual([1, 0, 1, undefined]); // a DRAFT is not looked at
		});

		it('does no extra query when nothing on the page is PENDING or APPROVED', async () => {
			setup([mine({ eventStatus: EventStatus.DRAFT })], [], []);
			await service.getEventsByAdmin(input);
			expect(venueModel.find).not.toHaveBeenCalled();
			expect(eventModel.aggregate).toHaveBeenCalledTimes(1);
		});

		it('stops after the venue query when no venue looks like the same place', async () => {
			setup([mine()], [], []);
			const result = await service.getEventsByAdmin(input);
			expect(eventModel.aggregate).toHaveBeenCalledTimes(1);
			expect(result.list[0].possibleVenueConflicts).toEqual([]);
		});

		it('getEvent fills it for an admin (and costs the same two queries)', async () => {
			eventModel.findOne.mockReturnValue(lean(mine({ venueData: undefined })));
			venueModel.findById.mockReturnValue(lean(venue({})));
			memberModel.findById.mockReturnValue(lean({ _id: 'org1' }));
			eventModel.aggregate.mockReturnValueOnce(exec([other()]));
			venueModel.find = jest.fn().mockReturnValue(chain([venue({ _id: 'v2' })]));
			const event = await service.getEvent({ _id: 'admin1', memberType: MemberType.ADMIN } as any, 'e1' as any);
			expect(event.possibleVenueConflicts).toHaveLength(1);
		});

		it('getEvent does not compute it for the owner or a buyer', async () => {
			eventModel.findOne.mockReturnValue(lean(mine({ venueData: undefined, eventStatus: EventStatus.APPROVED })));
			venueModel.findById.mockReturnValue(lean(venue({})));
			venueModel.find = jest.fn();
			const event = await service.getEvent({ _id: 'org1', memberType: MemberType.ORGANIZER } as any, 'e1' as any);
			expect(event.possibleVenueConflicts).toBeUndefined();
			expect(venueModel.find).not.toHaveBeenCalled();
		});

		describe('field resolver', () => {
			const resolver = () => new EventResolver({} as any);
			const parent = { possibleVenueConflicts: [{ eventId: 'e2' }] } as any;
			const ctx = (authMember: any) => ({ req: { body: { authMember } } });

			it('returns it to an admin only', () => {
				expect(resolver().possibleVenueConflicts(parent, ctx({ _id: 'a', memberType: MemberType.ADMIN }))).toHaveLength(1);
				expect(resolver().possibleVenueConflicts(parent, ctx({ _id: 'org1', memberType: MemberType.ORGANIZER }))).toBeNull();
				expect(resolver().possibleVenueConflicts(parent, ctx({ _id: 'u', memberType: MemberType.USER }))).toBeNull();
				expect(resolver().possibleVenueConflicts(parent, ctx(undefined))).toBeNull();
			});

			it('returns null for the owning organizer even when the value is on the parent', () => {
				expect(resolver().possibleVenueConflicts({ ...parent, organizerId: 'org1' }, ctx({ _id: 'org1', memberType: MemberType.ORGANIZER }))).toBeNull();
			});
		});
	});

	describe('submitEventForApproval', () => {
		it.each([EventStatus.DRAFT, EventStatus.REJECTED])('moves %s to PENDING with one conditional update', async (status) => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: status })));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.PENDING })));

			const result = await service.submitEventForApproval('org1' as any, 'e1' as any);

			expect(result.eventStatus).toBe(EventStatus.PENDING);
			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toEqual({ _id: 'e1', organizerId: 'org1', eventStatus: status });
			expect(update.$set.eventStatus).toBe(EventStatus.PENDING);
		});

		it.each([EventStatus.PENDING, EventStatus.APPROVED, EventStatus.CANCELLED, EventStatus.ENDED])(
			'refuses to submit a %s event',
			async (status) => {
				eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: status })));
				await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(Message.INVALID_EVENT_TRANSITION);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			},
		);

		it('starts the AI check once and still submits when it rejects', async () => {
			eventModel.findOne.mockReturnValue(lean(draft()));
			ticketTypeModel.countDocuments.mockReturnValue(exec(1));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.PENDING })));
			aiModerationService.moderateEvent.mockRejectedValue(new Error('boom'));

			const result = await service.submitEventForApproval('org1' as any, 'e1' as any);

			expect(result.eventStatus).toBe(EventStatus.PENDING);
			expect(aiModerationService.moderateEvent).toHaveBeenCalledTimes(1);
		});

		it("answers NO_DATA_FOUND for another organizer's event", async () => {
			eventModel.findOne.mockReturnValue(lean(null));
			await expect(service.submitEventForApproval('other' as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', organizerId: 'other' });
		});

		it('refuses an event without a ticket type and changes nothing', async () => {
			eventModel.findOne.mockReturnValue(lean(draft()));
			ticketTypeModel.countDocuments.mockReturnValue(exec(0));
			await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(Message.EVENT_SUBMIT_TICKET_TYPE_REQUIRED);
			expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('refuses an event whose venue is not usable', async () => {
			eventModel.findOne.mockReturnValue(lean(draft()));
			venueModel.exists.mockResolvedValue(null);
			await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(Message.EVENT_SUBMIT_VENUE_REQUIRED);
		});

		it('fails when the status changed between the check and the update', async () => {
			eventModel.findOne.mockReturnValue(lean(draft()));
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(Message.INVALID_EVENT_TRANSITION);
		});
	});

	describe('updateEvent', () => {
		const run = (status: EventStatus) => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: status })));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: status })));
			return service.updateEvent('org1' as any, { _id: 'e1', eventTitle: 'New title' } as any);
		};

		it.each([EventStatus.DRAFT, EventStatus.REJECTED])('keeps a %s event in its status', async (status) => {
			await run(status);
			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toEqual({ _id: 'e1', organizerId: 'org1', eventStatus: status });
			expect(update).toEqual({ eventTitle: 'New title' });
		});

		it('sends an APPROVED event back to PENDING', async () => {
			await run(EventStatus.APPROVED);
			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter.eventStatus).toBe(EventStatus.APPROVED);
			expect(update.eventStatus).toBe(EventStatus.PENDING);
		});

		it.each([EventStatus.PENDING, EventStatus.CANCELLED, EventStatus.ENDED])('refuses to edit a %s event', async (status) => {
			await expect(run(status)).rejects.toThrow(Message.EVENT_NOT_EDITABLE);
			expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('only finds the organizer\'s own event', async () => {
			await run(EventStatus.DRAFT);
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', organizerId: 'org1' });
		});

		describe('seat layout lock (#117)', () => {
			const OLD_VENUE = 'a'.repeat(24);
			const NEW_VENUE = 'b'.repeat(24);
			const edit = (status: EventStatus, patch: any, admin = false) => {
				eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: status, venueId: OLD_VENUE, seatingType: SeatingType.RESERVED })));
				eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
				return admin ? service.updateEventByAdmin('admin-1' as any, { _id: 'e1', ...patch } as any) : service.updateEvent('org1' as any, { _id: 'e1', ...patch } as any);
			};

			it('refuses a venue change on an APPROVED event, for the organizer and for an admin', async () => {
				await expect(edit(EventStatus.APPROVED, { venueId: NEW_VENUE })).rejects.toThrow(Message.EVENT_LAYOUT_LOCKED);
				await expect(edit(EventStatus.APPROVED, { venueId: NEW_VENUE }, true)).rejects.toThrow(Message.EVENT_LAYOUT_LOCKED);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('refuses a seating type change on an APPROVED event', async () => {
				await expect(edit(EventStatus.APPROVED, { seatingType: SeatingType.GENERAL })).rejects.toThrow(Message.EVENT_LAYOUT_LOCKED);
			});

			it('still allows other edits of an APPROVED event, and resending the same venue and seating type', async () => {
				await expect(edit(EventStatus.APPROVED, { eventTitle: 'x', venueId: OLD_VENUE, seatingType: SeatingType.RESERVED })).resolves.toBeDefined();
			});

			it.each([EventStatus.DRAFT, EventStatus.REJECTED])('allows a venue change on a %s event without seats', async (status) => {
				await expect(edit(status, { venueId: NEW_VENUE })).resolves.toBeDefined();
				expect(eventSeatModel.findOne.mock.calls[0][0]).toEqual({ eventId: 'e1' });
			});

			it('refuses a venue change on a REJECTED event that still has seats from an earlier approval', async () => {
				eventSeatModel.findOne.mockReturnValue({ select: () => lean({ _id: 's1' }) });
				await expect(edit(EventStatus.REJECTED, { venueId: NEW_VENUE })).rejects.toThrow(Message.EVENT_LAYOUT_LOCKED);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('does not look for seats when the layout is not touched', async () => {
				await edit(EventStatus.REJECTED, { eventTitle: 'x' });
				expect(eventSeatModel.findOne).not.toHaveBeenCalled();
			});
		});

		it('admin content edit never changes the status of an APPROVED event', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
			await service.updateEventByAdmin('admin-1' as any, { _id: 'e1', eventTitle: 'Fixed typo' } as any);
			expect(eventModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ eventTitle: 'Fixed typo' });
		});

		it('admin content edit writes an audit entry with the field names only, not the values', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
			await service.updateEventByAdmin('admin-1' as any, { _id: 'e1', eventTitle: 'Secret new title', eventDesc: undefined } as any);
			expect(auditLogService.record).toHaveBeenCalledTimes(1);
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					actorId: 'admin-1',
					action: AuditAction.EVENT_UPDATED_BY_ADMIN,
					targetType: AuditTargetType.EVENT,
					meta: { changedFields: ['eventTitle'] },
				}),
			);
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('Secret new title');
		});

		it('a refused admin edit writes no audit entry', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.CANCELLED })));
			await expect(service.updateEventByAdmin('admin-1' as any, { _id: 'e1' } as any)).rejects.toThrow(Message.EVENT_NOT_EDITABLE);
			expect(auditLogService.record).not.toHaveBeenCalled();
		});

		it('removeEventByAdmin deletes only a DRAFT and writes an audit entry', async () => {
			eventModel.findOneAndDelete.mockReturnValue(exec(draft({ _id: 'e1', organizerId: 'org1', eventTitle: 'Gone' })));
			await service.removeEventByAdmin('admin-1' as any, 'e1' as any);
			expect(eventModel.findOneAndDelete.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.DRAFT });
			expect(auditLogService.record).toHaveBeenCalledWith({
				actorId: 'admin-1',
				action: AuditAction.EVENT_REMOVED_BY_ADMIN,
				targetType: AuditTargetType.EVENT,
				targetId: 'e1',
				meta: { organizerId: 'org1', eventTitle: 'Gone' },
			});
		});

		it('removeEventByAdmin writes no audit entry when no DRAFT was deleted', async () => {
			eventModel.findOneAndDelete.mockReturnValue(exec(null));
			await expect(service.removeEventByAdmin('admin-1' as any, 'e1' as any)).rejects.toThrow(Message.REMOVE_FAILED);
			expect(auditLogService.record).not.toHaveBeenCalled();
		});

		it('admin cannot edit a CANCELLED event', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.CANCELLED })));
			await expect(service.updateEventByAdmin('admin-1' as any, { _id: 'e1' } as any)).rejects.toThrow(Message.EVENT_NOT_EDITABLE);
		});
	});

	describe('admin status changes', () => {
		it('approve is one conditional update from PENDING, writes an audit entry and notifies the organizer', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.APPROVED })));

			await service.approveEventByAdmin('admin1' as any, 'e1' as any);

			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toEqual({ _id: 'e1', eventStatus: { $in: [EventStatus.PENDING] }, organizerId: { $ne: 'admin1' } });
			expect(update.$set.eventStatus).toBe(EventStatus.APPROVED);
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					actorId: 'admin1',
					action: AuditAction.EVENT_APPROVED,
					targetType: AuditTargetType.EVENT,
					targetId: 'e1',
					meta: { fromEventStatus: EventStatus.PENDING, toEventStatus: EventStatus.APPROVED },
				}),
			);
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: NotificationType.EVENT_APPROVED, receiverId: 'org1', authorId: 'admin1', eventId: 'e1' }),
			);
		});

		it('the second of two admins gets an invalid transition and writes nothing', async () => {
			eventModel.findOneAndUpdate.mockReturnValueOnce(exec(draft({ eventStatus: EventStatus.APPROVED }))).mockReturnValueOnce(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));

			await service.approveEventByAdmin('admin1' as any, 'e1' as any);
			await expect(service.approveEventByAdmin('admin2' as any, 'e1' as any)).rejects.toThrow(Message.INVALID_EVENT_TRANSITION);

			expect(auditLogService.record).toHaveBeenCalledTimes(1);
			expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
		});

		it('nobody approves their own event', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: EventStatus.PENDING, organizerId: 'admin1' })));
			await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(Message.CANNOT_APPROVE_OWN_EVENT);
		});

		it('answers NO_DATA_FOUND for an unknown event', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(null));
			await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		});

		it('reject needs a reason, saves it, and goes from PENDING to REJECTED', async () => {
			await expect(service.rejectEventByAdmin('admin1' as any, { eventId: 'e1', reason: '   ' } as any)).rejects.toThrow(
				Message.EVENT_REJECT_REASON_REQUIRED,
			);
			expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();

			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.REJECTED })));
			await service.rejectEventByAdmin('admin1' as any, { eventId: 'e1', reason: ' Blurry images ' } as any);

			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter.eventStatus).toEqual({ $in: [EventStatus.PENDING] });
			expect(update.$set).toEqual({ eventStatus: EventStatus.REJECTED, rejectReason: 'Blurry images' });
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: AuditAction.EVENT_REJECTED, meta: expect.objectContaining({ reason: 'Blurry images' }) }),
			);
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: NotificationType.EVENT_REJECTED, notificationDesc: 'Blurry images' }),
			);
		});

		it('cancel needs a reason and only starts from APPROVED', async () => {
			await expect(service.cancelEventByAdmin('admin1' as any, { eventId: 'e1', reason: '' } as any)).rejects.toThrow(
				Message.EVENT_CANCEL_REASON_REQUIRED,
			);

			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			await service.cancelEventByAdmin('admin1' as any, { eventId: 'e1', reason: 'Artist is ill' } as any);

			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter.eventStatus).toEqual({ $in: [EventStatus.APPROVED] });
			expect(update.$set).toEqual({ eventStatus: EventStatus.CANCELLED, cancelReason: 'Artist is ill' });
			expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.EVENT_CANCELLED }));
			expect(memberService.memberStatsEditor).toHaveBeenCalledWith({ _id: 'org1', targetKey: 'memberEvents', modifier: -1 });
		});

		it('cancel calls the refund hook after the status change', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			const hook = jest.spyOn(service as any, 'refundOrdersForCancelledEvent');

			await service.cancelEventByAdmin('admin1' as any, { eventId: 'e1', reason: 'Venue closed' } as any);

			expect(hook).toHaveBeenCalledWith(expect.objectContaining({ _id: 'e1', eventStatus: EventStatus.CANCELLED }), 'admin1');
			expect(refundService.refundOrdersForCancelledEvent).toHaveBeenCalledWith('admin1', expect.objectContaining({ _id: 'e1' }));
		});

		it('a refund run that throws never fails the cancellation', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			refundService.refundOrdersForCancelledEvent.mockRejectedValue(new Error('db down'));

			const result = await service.cancelEventByAdmin('admin1' as any, { eventId: 'e1', reason: 'Venue closed' } as any);

			expect(result.eventStatus).toBe(EventStatus.CANCELLED);
		});

		it('a PENDING event cannot be cancelled', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: EventStatus.PENDING })));
			await expect(service.cancelEventByAdmin('admin1' as any, { eventId: 'e1', reason: 'x' } as any)).rejects.toThrow(
				Message.INVALID_EVENT_TRANSITION,
			);
			expect(auditLogService.record).not.toHaveBeenCalled();
		});
	});

	describe('cancelMyEvent (organizer)', () => {
		const input = (reason = 'Artist is ill') => ({ eventId: 'e1', reason }) as any;

		it('needs a reason and never touches the event without one', async () => {
			await expect(service.cancelMyEvent('org1' as any, input('  '))).rejects.toThrow(Message.EVENT_CANCEL_REASON_REQUIRED);
			expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('filters by owner and APPROVED, then audits, notifies and refunds like the admin path', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			const result = await service.cancelMyEvent('org1' as any, input());

			const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toEqual({ _id: 'e1', eventStatus: { $in: [EventStatus.APPROVED] }, organizerId: 'org1' });
			expect(update.$set).toEqual({ eventStatus: EventStatus.CANCELLED, cancelReason: 'Artist is ill' });
			expect(result.eventStatus).toBe(EventStatus.CANCELLED);
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ actorId: 'org1', action: AuditAction.EVENT_CANCELLED, meta: expect.objectContaining({ reason: 'Artist is ill' }) }),
			);
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: NotificationType.EVENT_CANCELLED }),
			);
			expect(memberService.memberStatsEditor).toHaveBeenCalledWith({ _id: 'org1', targetKey: 'memberEvents', modifier: -1 });
			expect(refundService.refundOrdersForCancelledEvent).toHaveBeenCalledWith('org1', expect.objectContaining({ _id: 'e1' }));
		});

		it("refuses another organizer's event and a missing one the same way, without side effects", async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED, organizerId: 'someoneElse' })));
			await expect(service.cancelMyEvent('org1' as any, input())).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);

			eventModel.findById.mockReturnValue(lean(null));
			await expect(service.cancelMyEvent('org1' as any, input())).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);

			expect(auditLogService.record).not.toHaveBeenCalled();
			expect(refundService.refundOrdersForCancelledEvent).not.toHaveBeenCalled();
		});

		it.each([EventStatus.CANCELLED, EventStatus.ENDED])('refuses an event that is already %s', async (status) => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: status })));
			await expect(service.cancelMyEvent('org1' as any, input())).rejects.toThrow(Message.EVENT_ALREADY_CLOSED);
			expect(auditLogService.record).not.toHaveBeenCalled();
			expect(refundService.refundOrdersForCancelledEvent).not.toHaveBeenCalled();
		});

		it.each([EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED])('refuses a %s event with the transition error', async (status) => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(null));
			eventModel.findById.mockReturnValue(lean(draft({ eventStatus: status })));
			await expect(service.cancelMyEvent('org1' as any, input())).rejects.toThrow(Message.INVALID_EVENT_TRANSITION);
		});

		it('a refund run that throws never fails the cancellation', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			refundService.refundOrdersForCancelledEvent.mockRejectedValue(new Error('db down'));
			const result = await service.cancelMyEvent('org1' as any, input());
			expect(result.eventStatus).toBe(EventStatus.CANCELLED);
		});

		it('the admin path is unchanged: no owner filter', async () => {
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.CANCELLED })));
			await service.cancelEventByAdmin('admin1' as any, input());
			expect(eventModel.findOneAndUpdate.mock.calls[0][0].organizerId).toBeUndefined();
		});
	});

	describe('getEventsByAdmin', () => {
		it('filters by status, category, organizer and escaped text', async () => {
			eventModel.aggregate.mockReturnValue(exec([{ list: [{}], metaCounter: [] }]));
			await service.getEventsByAdmin({
				page: 1,
				limit: 10,
				search: { eventStatus: EventStatus.PENDING, eventCategoryList: ['CONCERT'], organizerId: 'a'.repeat(24), text: 'rock.*' },
			} as any);

			const match = eventModel.aggregate.mock.calls[0][0][0].$match;
			expect(match.eventStatus).toBe(EventStatus.PENDING);
			expect(match.eventCategory).toEqual({ $in: ['CONCERT'] });
			expect(String(match.organizerId)).toBe('a'.repeat(24));
			expect(match.$or[0].eventTitle.$regex.source).toBe('rock\\.\\*');
		});
	});

	describe('getEventsByAdmin with no events (DECISIONS #101)', () => {
		it('returns an empty list instead of NO_DATA_FOUND, also for a page past the end', async () => {
			eventModel.aggregate.mockReturnValue(exec([{ list: [], metaCounter: [] }]));
			await expect(service.getEventsByAdmin({ page: 3, limit: 20, search: {} } as any)).resolves.toEqual({ list: [], metaCounter: [] });
			eventModel.aggregate.mockReturnValue(exec([]));
			await expect(service.getEventsByAdmin({ page: 1, limit: 20, search: {} } as any)).resolves.toEqual({ list: [], metaCounter: [] });
		});

		it('does not look up seat counts or venue conflicts for an empty page', async () => {
			eventModel.aggregate.mockReturnValue(exec([{ list: [], metaCounter: [] }]));
			ticketTypeModel.aggregate = jest.fn();
			await service.getEventsByAdmin({ page: 1, limit: 20, search: {} } as any);
			expect(ticketTypeModel.aggregate).not.toHaveBeenCalled();
		});
	});

	describe('seat totals on event lists and details', () => {
		const ids = Array.from({ length: 25 }, (_, i) => `e${i}`);
		const page = () => ids.map((_id) => ({ _id, eventTitle: _id }));
		const seatQueries = () => ({ ticketTypes: ticketTypeModel.aggregate.mock.calls.length, orders: orderModel.aggregate.mock.calls.length });

		beforeEach(() => {
			ticketTypeModel.aggregate = jest.fn().mockReturnValue(exec([{ _id: 'e0', total: 300 }, { _id: 'e1', total: 50 }]));
			orderModel.aggregate.mockReturnValue(exec([{ _id: 'e0', sold: 120 }]));
			eventModel.aggregate.mockReturnValue(exec([{ list: page(), metaCounter: [{ total: 25 }] }]));
		});

		it('getEvents: a page of 25 events costs one ticket type query and one order query, not one per event', async () => {
			const result = await service.getEvents(null as any, { page: 1, limit: 25, search: {} } as any);
			expect(seatQueries()).toEqual({ ticketTypes: 1, orders: 1 });
			expect(result.list[0]).toMatchObject({ eventTotalSeats: 300, eventSoldSeats: 120 });
			expect(result.list[1]).toMatchObject({ eventTotalSeats: 50, eventSoldSeats: 0 });
			expect(result.list[24]).toMatchObject({ eventTotalSeats: 0, eventSoldSeats: 0 });
		});

		it('getMyEvents and getEventsByAdmin use the same two queries for the whole page', async () => {
			await service.getMyEvents('a'.repeat(24) as any, { page: 1, limit: 25, search: {} } as any);
			expect(seatQueries()).toEqual({ ticketTypes: 1, orders: 1 });
			await service.getEventsByAdmin({ page: 1, limit: 25, search: {} } as any);
			expect(seatQueries()).toEqual({ ticketTypes: 2, orders: 2 });
		});

		it('only PAID orders are counted as sold (holds, unpaid and refunded orders are not)', async () => {
			await service.getEvents(null as any, { page: 1, limit: 25, search: {} } as any);
			const [match] = orderModel.aggregate.mock.calls[0][0];
			expect(match.$match.orderStatus).toBe('PAID');
		});

		it('getFavorites and getVisited get the totals too', async () => {
			const likeService = (service as any).likeService;
			likeService.getFavoriteEvents = jest.fn().mockResolvedValue({ list: page(), metaCounter: [] });
			(service as any).viewService.getVisitedEvents = jest.fn().mockResolvedValue({ list: page(), metaCounter: [] });
			const favorites = await service.getFavorites('m1' as any, { page: 1, limit: 25 } as any);
			const visited = await service.getVisited('m1' as any, { page: 1, limit: 25 } as any);
			expect(favorites.list[0].eventTotalSeats).toBe(300);
			expect(visited.list[0].eventSoldSeats).toBe(120);
		});

		it('getEvent adds the totals of that one event', async () => {
			eventModel.findOne.mockReturnValue(lean({ _id: 'e0', organizerId: 'org1', venueId: 'v1', eventStatus: EventStatus.APPROVED, eventViews: 0 }));
			memberModel.findById.mockReturnValue(lean({ _id: 'org1' }));
			const result = await service.getEvent({ _id: 'admin1', memberType: MemberType.ADMIN } as any, 'e0' as any);
			expect(result).toMatchObject({ eventTotalSeats: 300, eventSoldSeats: 120 });
		});

		it('an empty page runs no seat query', async () => {
			eventModel.aggregate.mockReturnValue(exec([{ list: [], metaCounter: [] }]));
			await service.getEvents(null as any, { page: 1, limit: 25, search: {} } as any);
			expect(seatQueries()).toEqual({ ticketTypes: 0, orders: 0 });
		});
	});

	describe('RESERVED events: submit, seat generation and seat map', () => {
		const selectLean = (value: any) => ({ select: () => lean(value) });
		const reservedEvent = (over: any = {}) =>
			draft({ seatingType: SeatingType.RESERVED, eventStatus: EventStatus.PENDING, venueId: 'v1', ...over });
		const tickets = (...tierKeys: string[]) => tierKeys.map((tierKey) => ({ _id: `tt-${tierKey}`, tierKey }));

		beforeEach(() => {
			venueModel.findById.mockReturnValue(lean({ _id: 'v1', venueTimezone: 'Asia/Seoul', venueLayout: layout() }));
			venueModel.findOne.mockReturnValue(selectLean({ venueLayout: layout() }));
			ticketTypeModel.find.mockReturnValue(selectLean(tickets('vip', 'regular')));
			eventModel.findById.mockReturnValue(lean(reservedEvent()));
			eventModel.findOneAndUpdate.mockReturnValue(exec(reservedEvent({ eventStatus: EventStatus.APPROVED })));
		});

		describe('submitEventForApproval', () => {
			beforeEach(() => eventModel.findOne.mockReturnValue(lean(reservedEvent({ eventStatus: EventStatus.DRAFT }))));

			it('moves a RESERVED event whose seated tiers are all covered to PENDING', async () => {
				eventModel.findOneAndUpdate.mockReturnValue(exec(reservedEvent()));
				const result = await service.submitEventForApproval('org1' as any, 'e1' as any);
				expect(result.eventStatus).toBe(EventStatus.PENDING);
			});

			it('refuses a RESERVED event with a seated section that has no ticket type', async () => {
				ticketTypeModel.find.mockReturnValue(selectLean(tickets('vip')));
				await expect(service.submitEventForApproval('org1' as any, 'e1' as any)).rejects.toThrow(Message.SEAT_TIER_MISSING);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('does not load the layout of a GENERAL event', async () => {
				eventModel.findOne.mockReturnValue(lean(draft()));
				eventModel.findOneAndUpdate.mockReturnValue(exec(draft({ eventStatus: EventStatus.PENDING })));
				await service.submitEventForApproval('org1' as any, 'e1' as any);
				expect(ticketTypeModel.find).not.toHaveBeenCalled();
			});
		});

		describe('approveEventByAdmin seat generation', () => {
			const allOps = () => eventSeatModel.bulkWrite.mock.calls.flatMap(([ops]: any) => ops);

			it('creates one seat per seated seat (10), linked to the ticket type of its tier, standing sections get none', async () => {
				await service.approveEventByAdmin('admin1' as any, 'e1' as any);

				const ops = allOps();
				expect(ops).toHaveLength(10);
				const byTier = (tt: string) => ops.filter((op: any) => op.updateOne.update.$setOnInsert.ticketTypeId === tt);
				expect(byTier('tt-vip')).toHaveLength(6);
				expect(byTier('tt-regular')).toHaveLength(4);
				expect(ops.some((op: any) => op.updateOne.filter.sectionKey === 'S')).toBe(false);
				expect(ops[0].updateOne).toEqual({
					filter: { eventId: 'e1', sectionKey: 'A', row: 1, number: 1 },
					update: { $setOnInsert: { ticketTypeId: 'tt-vip', seatStatus: SeatStatus.AVAILABLE } },
					upsert: true,
				});
				expect(eventSeatModel.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
			});

			it('brings the ticket type quantities in line with the seats', async () => {
				await service.approveEventByAdmin('admin1' as any, 'e1' as any);

				const ops = ticketTypeModel.bulkWrite.mock.calls[0][0];
				expect(ops.map((op: any) => [op.updateOne.filter._id, op.updateOne.update.$set.totalQuantity])).toEqual([
					['tt-vip', 6],
					['tt-regular', 4],
				]);
			});

			it('generates the seats before the status changes', async () => {
				await service.approveEventByAdmin('admin1' as any, 'e1' as any);
				expect(eventSeatModel.bulkWrite.mock.invocationCallOrder[0]).toBeLessThan(eventModel.findOneAndUpdate.mock.invocationCallOrder[0]);
			});

			it('is idempotent: a retry upserts the same seats and creates no duplicates', async () => {
				const stored = new Map<string, any>();
				eventSeatModel.bulkWrite.mockImplementation(async (ops: any[]) => {
					for (const { updateOne } of ops) {
						const { eventId, sectionKey, row, number } = updateOne.filter;
						const key = [eventId, sectionKey, row, number].join('|');
						if (!stored.has(key)) stored.set(key, { ...updateOne.filter, ...updateOne.update.$setOnInsert });
					}
				});

				await service.approveEventByAdmin('admin1' as any, 'e1' as any);
				stored.get('e1|A|1|1').seatStatus = SeatStatus.SOLD; // sold between the two attempts
				await service.approveEventByAdmin('admin1' as any, 'e1' as any);

				expect(stored.size).toBe(10);
				expect(stored.get('e1|A|1|1').seatStatus).toBe(SeatStatus.SOLD); // never reset to AVAILABLE
			});

			it('fails with a clear message when a seated section has no ticket type, and changes nothing', async () => {
				ticketTypeModel.find.mockReturnValue(selectLean(tickets('vip')));

				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(
					`${Message.SEAT_TIER_MISSING} Missing: regular`,
				);
				expect(eventSeatModel.bulkWrite).not.toHaveBeenCalled();
				expect(ticketTypeModel.bulkWrite).not.toHaveBeenCalled();
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
				expect(auditLogService.record).not.toHaveBeenCalled();
				expect(notificationService.createNotification).not.toHaveBeenCalled();
			});

			it('fails when two ticket types share a tier key', async () => {
				ticketTypeModel.find.mockReturnValue(selectLean([...tickets('vip', 'regular'), { _id: 'tt-dup', tierKey: 'vip' }]));
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(Message.SEAT_TIER_DUPLICATE);
				expect(eventSeatModel.bulkWrite).not.toHaveBeenCalled();
			});

			it('fails when the venue has no seated section', async () => {
				venueModel.findById.mockReturnValue(lean({ _id: 'v1', venueLayout: { sections: [standingSection()] } }));
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(Message.EVENT_SUBMIT_LAYOUT_REQUIRED);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it('answers SEAT_GENERATION_FAILED and leaves the event status alone when the bulk write fails', async () => {
				eventSeatModel.bulkWrite.mockRejectedValue(new Error('boom'));
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow(Message.SEAT_GENERATION_FAILED);
				expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it.each([
				['a GENERAL event', { seatingType: SeatingType.GENERAL }],
				['an event that is not PENDING', { eventStatus: EventStatus.DRAFT }],
				["the admin's own event", { organizerId: 'admin1' }],
			])('does not generate seats for %s', async (_name, over) => {
				eventModel.findById.mockReturnValue(lean(reservedEvent(over)));
				eventModel.findOneAndUpdate.mockReturnValue(exec(null));
				await expect(service.approveEventByAdmin('admin1' as any, 'e1' as any)).rejects.toThrow();
				expect(eventSeatModel.bulkWrite).not.toHaveBeenCalled();
			});

			it('does not touch seats for a GENERAL event that is approved normally', async () => {
				eventModel.findById.mockReturnValue(lean(reservedEvent({ seatingType: SeatingType.GENERAL })));
				await service.approveEventByAdmin('admin1' as any, 'e1' as any);
				expect(eventSeatModel.bulkWrite).not.toHaveBeenCalled();
				expect(eventModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
			});
		});

		describe('getEventSeatMap', () => {
			let seatQuery: any;
			beforeEach(() => {
				eventModel.findOne.mockReturnValue(lean(reservedEvent({ eventStatus: EventStatus.APPROVED })));
				seatQuery = {
					select: jest.fn().mockReturnThis(),
					lean: jest.fn().mockReturnThis(),
					exec: jest.fn().mockResolvedValue([
						{ sectionKey: 'A', row: 1, number: 2, seatStatus: SeatStatus.SOLD, heldBy: 'secret', orderId: 'o1' },
						{ sectionKey: 'A', row: 1, number: 3, seatStatus: SeatStatus.HELD, heldBy: 'secret', heldUntil: future(1) },
					]),
				};
				eventSeatModel.find.mockReturnValue(seatQuery);
			});

			it('looks up APPROVED events only', async () => {
				await service.getEventSeatMap('e1' as any);
				expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED });
			});

			it.each(['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED', 'ENDED'])('hides a %s event (it is not found)', async () => {
				eventModel.findOne.mockReturnValue(lean(null));
				await expect(service.getEventSeatMap('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
				expect(eventSeatModel.find).not.toHaveBeenCalled();
			});

			it('answers "no seat map" with a coded 404, never a 500 (#114)', async () => {
				const noMap = async (): Promise<any> => service.getEventSeatMap('e1' as any).catch((err) => err);
				eventModel.findOne.mockReturnValue(lean(null));
				const hidden = await noMap();
				expect(hidden).toBeInstanceOf(CodedException);
				expect(hidden).not.toBeInstanceOf(InternalServerErrorException);
				expect(hidden).toMatchObject({ code: 'NO_DATA_FOUND', message: Message.NO_DATA_FOUND });
				expect(hidden.getStatus()).toBe(404);

				eventModel.findOne.mockReturnValue(lean(reservedEvent({ seatingType: SeatingType.GENERAL })));
				expect(await noMap()).toMatchObject({ code: 'NO_DATA_FOUND' });

				eventModel.findOne.mockReturnValue(lean(reservedEvent({ eventStatus: EventStatus.APPROVED })));
				venueModel.findById.mockReturnValue(lean({ _id: 'v1' }));
				expect(await noMap()).toMatchObject({ code: 'NO_DATA_FOUND' });
			});

			it('has no seat map for a GENERAL event or a venue without a layout', async () => {
				eventModel.findOne.mockReturnValue(lean(reservedEvent({ seatingType: SeatingType.GENERAL })));
				await expect(service.getEventSeatMap('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);

				eventModel.findOne.mockReturnValue(lean(reservedEvent({ eventStatus: EventStatus.APPROVED })));
				venueModel.findById.mockReturnValue(lean({ _id: 'v1' }));
				await expect(service.getEventSeatMap('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			});

			it('is hidden when the organizer is not ACTIVE', async () => {
				memberService.getMember.mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND));
				await expect(service.getEventSeatMap('e1' as any)).rejects.toMatchObject({ code: 'NO_DATA_FOUND' });
				// any other failure of the lookup is not turned into "no seat map"
				memberService.getMember.mockRejectedValue(new Error('db down'));
				await expect(service.getEventSeatMap('e1' as any)).rejects.toThrow('db down');
			});

			it('asks only for SOLD seats and for HELD seats whose hold is in the future', async () => {
				const before = Date.now();
				await service.getEventSeatMap('e1' as any);

				const filter = eventSeatModel.find.mock.calls[0][0];
				expect(filter.eventId).toBe('e1');
				expect(filter.$or).toHaveLength(2);
				expect(filter.$or[0]).toEqual({ seatStatus: SeatStatus.SOLD });
				expect(filter.$or[1].seatStatus).toBe(SeatStatus.HELD);
				expect(filter.$or[1].heldUntil.$gt.getTime()).toBeGreaterThanOrEqual(before);
				expect(JSON.stringify(filter)).not.toContain(SeatStatus.AVAILABLE);
			});

			it('marks the caller\'s own active holds with mine and holdExpiresAt, and nobody else\'s', async () => {
				const until = future(1);
				seatQuery.exec.mockResolvedValue([
					{ sectionKey: 'A', row: 1, number: 1, seatStatus: SeatStatus.HELD, heldBy: 'm1', heldUntil: until },
					{ sectionKey: 'A', row: 1, number: 2, seatStatus: SeatStatus.HELD, heldBy: 'other', heldUntil: future(1) },
					{ sectionKey: 'A', row: 1, number: 3, seatStatus: SeatStatus.SOLD, heldBy: 'm1' },
				]);

				const result = await service.getEventSeatMap('e1' as any, 'm1' as any);
				expect(result.seats).toEqual([
					{ sectionKey: 'A', row: 1, number: 1, seatStatus: SeatStatus.HELD, mine: true, holdExpiresAt: until },
					{ sectionKey: 'A', row: 1, number: 2, seatStatus: SeatStatus.HELD },
					{ sectionKey: 'A', row: 1, number: 3, seatStatus: SeatStatus.SOLD },
				]);
				expect(JSON.stringify(result)).not.toContain('heldBy');

				const guest = await service.getEventSeatMap('e1' as any, null);
				expect(guest.seats.some((seat: any) => seat.mine)).toBe(false);
			});

			it('returns the layout, the timezone and a compact seat list without heldBy', async () => {
				const result = await service.getEventSeatMap('e1' as any);

				expect(result.venueLayout).toEqual(layout());
				expect(result.venueTimezone).toBe('Asia/Seoul');
				expect(result.seats).toEqual([
					{ sectionKey: 'A', row: 1, number: 2, seatStatus: SeatStatus.SOLD },
					{ sectionKey: 'A', row: 1, number: 3, seatStatus: SeatStatus.HELD },
				]);
				expect(JSON.stringify(result)).not.toContain('secret');
							});
		});
	});

	describe('public text search', () => {
		const search = async (text: string) => {
			await service.getEvents(null as any, { page: 1, limit: 10, search: { text } } as any);
			return eventModel.aggregate.mock.calls[0][0][0].$match;
		};

		it('matches title, translated titles, category, venue and organizer', async () => {
			const match = await search('Comedy');

			expect(match.eventStatus).toBe(EventStatus.APPROVED);
			const [title, translated, category, venue, organizer] = match.$or;
			expect(title.eventTitle.test('big COMEDY night')).toBe(true);
			expect(translated['eventTranslations.title'].test('comedy')).toBe(true);
			expect(category).toEqual({ eventCategory: { $in: ['COMEDY'] } });
			expect(venue).toEqual({ venueId: { $in: ['v9'] } });
			expect(organizer).toEqual({ organizerId: { $in: ['o9'] } });
		});

		it.each([['concert', 'CONCERT'], ['football', 'FOOTBALL'], ['SPORT', 'SPORT']])('"%s" finds the %s category', async (text, category) => {
			const match = await search(text);
			expect(match.$or[2].eventCategory.$in).toContain(category);
		});

		it('looks venues up by name or city and organizers by nick or full name', async () => {
			await search('seoul');

			const [venueFilter] = venueModel.distinct.mock.calls[0].slice(1);
			expect(venueFilter.$or.map((f: any) => Object.keys(f)[0])).toEqual(['venueName', 'venueCity']);
			const [, memberFilter] = memberModel.distinct.mock.calls[0];
			expect(memberFilter.memberType).toBe(MemberType.ORGANIZER);
			expect(memberFilter.$or.map((f: any) => Object.keys(f)[0])).toEqual(['memberNick', 'memberFullName']);
		});

		it('escapes the text in every regex and leaves other filters alone', async () => {
			const match = await service
				.getEvents(null as any, { page: 1, limit: 10, search: { text: 'a.*(b', venueId: 'a'.repeat(24) } } as any)
				.then(() => eventModel.aggregate.mock.calls[0][0][0].$match);

			expect(match.$or[0].eventTitle.source).toBe('a\\.\\*\\(b');
			expect(match.$or[1]['eventTranslations.title'].source).toBe('a\\.\\*\\(b');
			expect(venueModel.distinct.mock.calls[0][1].$or[0].venueName.source).toBe('a\\.\\*\\(b');
			expect(String(match.venueId)).toBe('a'.repeat(24));
			expect(match.eventTitle).toBeUndefined();
		});

		it('adds no text conditions when there is no text', async () => {
			await service.getEvents(null as any, { page: 1, limit: 10, search: {} } as any);
			expect(eventModel.aggregate.mock.calls[0][0][0].$match.$or).toBeUndefined();
			expect(venueModel.distinct).not.toHaveBeenCalled();
		});
	});

	describe('visibility', () => {
		it('getEvents matches APPROVED only and drops non-ACTIVE organizers before pagination', async () => {
			await service.getEvents(null as any, { page: 1, limit: 10, search: {} } as any);

			const pipeline = eventModel.aggregate.mock.calls[0][0];
			expect(pipeline[0].$match.eventStatus).toBe(EventStatus.APPROVED);
			const matchIndex = pipeline.findIndex((s: any) => s.$match?.['memberData.memberStatus'] === MemberStatus.ACTIVE);
			expect(matchIndex).toBeGreaterThan(-1);
			expect(matchIndex).toBeLessThan(pipeline.findIndex((s: any) => s.$facet));
		});

		it.each([EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED, EventStatus.CANCELLED, EventStatus.ENDED])(
			'getEvent hides a %s event from guests and other members',
			async (status) => {
				eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: status })));

				await expect(service.getEvent(null, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
				await expect(service.getEvent({ _id: 'stranger', memberType: MemberType.USER } as any, 'e1' as any)).rejects.toThrow(
					Message.NO_DATA_FOUND,
				);
				expect(viewService.recordView).not.toHaveBeenCalled();
			},
		);

		it('getEvent lets the owner open their own event in any status, even when suspended, without recording a view', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.DRAFT })));
			const result = await service.getEvent({ _id: 'org1', memberType: MemberType.ORGANIZER } as any, 'e1' as any);
			expect(result._id).toBe('e1');
			expect(result.memberData.memberStatus).toBe(MemberStatus.SUSPENDED);
			expect(viewService.recordView).not.toHaveBeenCalled();
		});

		it('getEvent lets an admin open any event', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.PENDING })));
			const result = await service.getEvent({ _id: 'admin1', memberType: MemberType.ADMIN } as any, 'e1' as any);
			expect(result._id).toBe('e1');
		});

		it('getEvent shows an APPROVED event to everyone and records the view', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));
			viewService.recordView.mockResolvedValue({});
			eventModel.findOneAndUpdate.mockReturnValue(exec({}));
			(service as any).eventModel.findByIdAndUpdate = jest.fn().mockReturnValue(exec({}));

			const result = await service.getEvent({ _id: 'viewer', memberType: MemberType.USER } as any, 'e1' as any);
			expect(result._id).toBe('e1');
			expect(viewService.recordView).toHaveBeenCalled();
		});

		it('getEvent answers NO_DATA_FOUND and records no view when the organizer of an APPROVED event is not ACTIVE', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));
			memberService.getMember.mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND));

			await expect(service.getEvent({ _id: 'viewer', memberType: MemberType.USER } as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(viewService.recordView).not.toHaveBeenCalled();
		});

		it('likeTargetEvent only finds APPROVED events', async () => {
			eventModel.findOne.mockReturnValue(exec(null));
			await expect(service.likeTargetEvent('m1' as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED });
		});

		describe('assertPublicEvent (comments)', () => {
			it('only looks for APPROVED events and returns the event of an ACTIVE organizer', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED, organizerId: 'org1' })));
				await expect(service.assertPublicEvent('e1' as any)).resolves.toMatchObject({ organizerId: 'org1' });
				expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED });
			});

			it('answers NO_DATA_FOUND for a missing or non-APPROVED event', async () => {
				eventModel.findOne.mockReturnValue(lean(null));
				await expect(service.assertPublicEvent('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
				expect(memberService.getMember).not.toHaveBeenCalled();
			});

			it('answers NO_DATA_FOUND when the organizer is not ACTIVE', async () => {
				eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED, organizerId: 'org1' })));
				memberService.getMember.mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND));
				await expect(service.assertPublicEvent('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			});
		});

		it('getMyEvents lists every status of the organizer, or the one asked for', async () => {
			await service.getMyEvents('a'.repeat(24) as any, { page: 1, limit: 10, search: {} } as any);
			expect(eventModel.aggregate.mock.calls[0][0][0].$match.eventStatus).toBeUndefined();

			await service.getMyEvents('a'.repeat(24) as any, { page: 1, limit: 10, search: { eventStatus: EventStatus.REJECTED } } as any);
			expect(eventModel.aggregate.mock.calls[1][0][0].$match.eventStatus).toBe(EventStatus.REJECTED);
		});
	});
});

describe('favorites and visited only return APPROVED events', () => {
	const inspect = (pipeline: any[], key: string) => {
		const matchIndex = pipeline.findIndex((s: any) => s.$match?.[key] === EventStatus.APPROVED);
		expect(matchIndex).toBeGreaterThan(-1);
		expect(matchIndex).toBeLessThan(pipeline.findIndex((s: any) => s.$facet));
	};

	it('getFavorites', async () => {
		const likeModel = { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])) };
		await new LikeService(likeModel as any).getFavoriteEvents('m1' as any, { page: 1, limit: 5 } as any);
		inspect(likeModel.aggregate.mock.calls[0][0], 'favoriteEvent.eventStatus');
	});

	it('getVisited', async () => {
		const viewModel = { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])) };
		await new ViewService(viewModel as any).getVisitedEvents('m1' as any, { page: 1, limit: 5 } as any);
		inspect(viewModel.aggregate.mock.calls[0][0], 'visitedEvent.eventStatus');
	});
});

describe('EventResolver access', () => {
	const rolesOf = (name: keyof EventResolver) => Reflect.getMetadata('roles', EventResolver.prototype[name]);
	const guardsOf = (name: keyof EventResolver) =>
		(Reflect.getMetadata('__guards__', EventResolver.prototype[name]) ?? []).map((g: any) => g.name);

	it.each(['approveEventByAdmin', 'rejectEventByAdmin', 'cancelEventByAdmin', 'getEventsByAdmin'] as (keyof EventResolver)[])(
		'%s is ADMIN only',
		(name) => {
			expect(rolesOf(name)).toEqual([MemberType.ADMIN]);
			expect(guardsOf(name)).toContain('RolesGuard');
		},
	);

	it.each(['createEvent', 'updateEvent', 'submitEventForApproval', 'getMyEvents', 'cancelMyEvent'] as (keyof EventResolver)[])(
		'%s is for active organizers',
		(name) => {
			expect(rolesOf(name)).toEqual([MemberType.ORGANIZER]);
			expect(guardsOf(name)).toEqual(['RolesGuard', 'ActiveOrganizerGuard']);
		},
	);
});
