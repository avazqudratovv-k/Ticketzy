import { InternalServerErrorException } from '@nestjs/common';
import { EventService, getEventSubmitError } from './event.service';
import { EventResolver } from './event.resolver';
import { LikeService } from '../like/like.service';
import { ViewService } from '../view/view.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { EventStatus, eventTransitions } from '../../libs/enums/event.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationType } from '../../libs/enums/notification.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const lean = (value: any) => ({ lean: () => exec(value) });

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
	let service: EventService;

	beforeEach(() => {
		eventModel = {
			findOne: jest.fn(),
			findById: jest.fn(),
			findOneAndUpdate: jest.fn(),
			findOneAndDelete: jest.fn(),
			aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])),
		};
		venueModel = { exists: jest.fn().mockResolvedValue({ _id: 'v1' }), findById: jest.fn().mockReturnValue(lean(null)), findOne: jest.fn().mockReturnValue(lean({ _id: 'v1' })) };
		ticketTypeModel = { countDocuments: jest.fn().mockReturnValue(exec(1)), deleteMany: jest.fn().mockReturnValue(exec({})) };
		memberModel = { findById: jest.fn().mockReturnValue(lean({ _id: 'org1', memberStatus: MemberStatus.SUSPENDED })) };
		memberService = { getMember: jest.fn().mockResolvedValue({ _id: 'org1' }), memberStatsEditor: jest.fn().mockResolvedValue({}) };
		viewService = { recordView: jest.fn().mockResolvedValue(null) };
		notificationService = { createNotification: jest.fn().mockResolvedValue(undefined) };
		auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
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
		);
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

		it('admin content edit never changes the status of an APPROVED event', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.APPROVED })));
			eventModel.findOneAndUpdate.mockReturnValue(exec(draft()));
			await service.updateEventByAdmin({ _id: 'e1', eventTitle: 'Fixed typo' } as any);
			expect(eventModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ eventTitle: 'Fixed typo' });
		});

		it('admin cannot edit a CANCELLED event', async () => {
			eventModel.findOne.mockReturnValue(lean(draft({ eventStatus: EventStatus.CANCELLED })));
			await expect(service.updateEventByAdmin({ _id: 'e1' } as any)).rejects.toThrow(Message.EVENT_NOT_EDITABLE);
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

			expect(hook).toHaveBeenCalledWith(expect.objectContaining({ _id: 'e1', eventStatus: EventStatus.CANCELLED }));
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

	it.each(['createEvent', 'updateEvent', 'submitEventForApproval'] as (keyof EventResolver)[])(
		'%s is for active organizers',
		(name) => {
			expect(rolesOf(name)).toEqual([MemberType.ORGANIZER]);
			expect(guardsOf(name)).toEqual(['RolesGuard', 'ActiveOrganizerGuard']);
		},
	);
});
