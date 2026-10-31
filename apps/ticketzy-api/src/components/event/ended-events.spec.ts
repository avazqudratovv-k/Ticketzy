import { InternalServerErrorException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { CodedException } from '../../libs/coded-exception';
import { formatGraphQLError } from '../../libs/error-mapping';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus } from '../../libs/enums/ticket.enum';
import { eventEndedException, getPublicEventState, isEventEnded, publicEventFilter, publicEventFilterAt } from '../../libs/event-visibility';
import { EventService } from './event.service';
import { LikeService } from '../like/like.service';
import { ViewService } from '../view/view.service';
import { MemberService } from '../member/member.service';
import { AiToolsService } from '../ai/ai-tools.service';
import { TicketTypeService } from '../ticket-type/ticket-type.service';
import { CommentService } from '../comment/comment.service';
import { OrderService } from '../order/order.service';
import { TicketService } from '../ticket/ticket.service';
import { RefundService } from '../refund/refund.service';

// DECISIONS #121: an event whose endAt has passed is not public, even while the batch job has not set ENDED yet
const hour = 3600000;
const ago = (h: number) => new Date(Date.now() - h * hour);
const ahead = (h: number) => new Date(Date.now() + h * hour);
const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const lean = (value: any) => ({ lean: () => exec(value) });
const select = (value: any) => ({ select: () => lean(value) });
/** find().select().sort().limit().lean().exec() */
const chain = (value: any): any => {
	const c: any = { exec: jest.fn().mockResolvedValue(value) };
	for (const name of ['sort', 'limit', 'select', 'lean']) c[name] = jest.fn().mockReturnValue(c);
	return c;
};

const GUEST = null;
const STRANGER: any = { _id: 'stranger', memberType: MemberType.USER };
const OWNER: any = { _id: 'org1', memberType: MemberType.ORGANIZER };
const ADMIN: any = { _id: 'admin1', memberType: MemberType.ADMIN };

/** the two ways an event is over: APPROVED with a past end (batch job has not run) and ENDED */
const OVER: Array<[string, any]> = [
	['APPROVED with a past endAt', { eventStatus: EventStatus.APPROVED, endAt: ago(1) }],
	['ENDED', { eventStatus: EventStatus.ENDED, endAt: ago(30) }],
];
const event = (over: any = {}) => ({
	_id: 'e1',
	organizerId: 'org1',
	eventTitle: 'Rock Night',
	venueId: 'v1',
	startAt: ago(3),
	endAt: ago(1),
	eventStatus: EventStatus.APPROVED,
	eventViews: 0,
	...over,
});

const expectEnded = async (promise: Promise<any>) => {
	const err = await promise.then(
		() => undefined,
		(e) => e,
	);
	expect(err).toBeInstanceOf(CodedException);
	expect(err).toMatchObject({ code: 'EVENT_ENDED', message: Message.EVENT_ENDED });
};

describe('event-visibility helpers', () => {
	it('isEventEnded: ENDED, or an end time that is not ahead; a missing end time is not ended', () => {
		expect(isEventEnded({ eventStatus: EventStatus.ENDED, endAt: ahead(5) })).toBe(true);
		expect(isEventEnded({ eventStatus: EventStatus.APPROVED, endAt: ago(1) })).toBe(true);
		expect(isEventEnded({ eventStatus: EventStatus.APPROVED, endAt: ahead(1) })).toBe(false);
		expect(isEventEnded({ eventStatus: EventStatus.APPROVED })).toBe(false);
	});

	it('getPublicEventState: only APPROVED and ENDED can be answered as ended; every other status stays hidden', () => {
		expect(getPublicEventState(event({ endAt: ahead(1) }))).toBe('PUBLIC');
		expect(getPublicEventState(event({ endAt: ago(1) }))).toBe('ENDED');
		expect(getPublicEventState(event({ eventStatus: EventStatus.ENDED }))).toBe('ENDED');
		for (const status of [EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED, EventStatus.CANCELLED]) {
			expect(getPublicEventState(event({ eventStatus: status, endAt: ago(1) }))).toBe('HIDDEN');
			expect(getPublicEventState(event({ eventStatus: status, endAt: ahead(1) }))).toBe('HIDDEN');
		}
	});

	it('the filters compare endAt with the clock', () => {
		expect(publicEventFilter()).toEqual({ eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
		expect(publicEventFilterAt('favoriteEvent')).toEqual({
			'favoriteEvent.eventStatus': EventStatus.APPROVED,
			'favoriteEvent.endAt': { $gt: expect.any(Date) },
		});
	});

	it('the error reaches the client as { code: EVENT_ENDED, message } and nothing else', () => {
		const logger = { warn: jest.fn(), error: jest.fn() };
		expect(formatGraphQLError({ extensions: {}, originalError: eventEndedException() } as any, eventEndedException(), logger)).toEqual({
			code: 'EVENT_ENDED',
			message: 'This event has ended!',
		});
	});
});

describe('ended events on the public side (#121)', () => {
	let eventModel: any;
	let memberService: any;
	let viewService: any;
	let likeService: any;
	let service: EventService;

	beforeEach(() => {
		eventModel = { findOne: jest.fn(), find: jest.fn().mockReturnValue(chain([])), aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])), findById: jest.fn() };
		memberService = { getMember: jest.fn().mockResolvedValue({ _id: 'org1' }), memberStatsEditor: jest.fn() };
		viewService = { recordView: jest.fn().mockResolvedValue({}) };
		likeService = { checkLikeExistence: jest.fn().mockResolvedValue([]), toggleLike: jest.fn().mockResolvedValue(1) };
		const memberModel: any = { findById: jest.fn().mockReturnValue(lean({ _id: 'org1' })), distinct: jest.fn().mockResolvedValue([]) };
		const venueModel: any = { findById: jest.fn().mockReturnValue(lean({ _id: 'v1' })), distinct: jest.fn().mockResolvedValue([]), find: jest.fn().mockReturnValue(chain([])) };
		const ticketTypeModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
		const orderModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
		service = new EventService(
			eventModel,
			venueModel,
			ticketTypeModel,
			memberModel,
			memberService,
			viewService,
			likeService,
			{ createNotification: jest.fn() } as any,
			{ record: jest.fn() } as any,
			{} as any,
			{} as any,
			{} as any,
			orderModel,
		);
	});

	describe('getEvents (and with it the home rails and the organizer page lists, which are getEvents with a filter)', () => {
		it('matches APPROVED events whose endAt is still ahead, before sorting and paging, whatever the filters', async () => {
			await service.getEvents(GUEST as any, { page: 1, limit: 10, search: { organizerId: 'a'.repeat(24), text: 'rock' } } as any);
			const pipeline = eventModel.aggregate.mock.calls[0][0];
			expect(pipeline[0].$match).toMatchObject({ eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
			expect(pipeline.findIndex((s: any) => s.$facet)).toBeGreaterThan(0);
		});

		it('a period filter does not replace the end-time rule (it filters startAt)', async () => {
			await service.getEvents(GUEST as any, { page: 1, limit: 10, search: { periodsRange: { start: ago(100), end: ahead(100) } } } as any);
			expect(eventModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ endAt: { $gt: expect.any(Date) }, startAt: expect.anything() });
		});
	});

	describe.each(OVER)('getEvent of an event that is %s', (_name, over) => {
		beforeEach(() => eventModel.findOne.mockReturnValue(lean(event(over))));

		it.each([
			['a guest', GUEST],
			['another member', STRANGER],
		])('answers EVENT_ENDED to %s: no details, no view counted, no organizer lookup', async (_who, caller) => {
			await expectEnded(service.getEvent(caller as any, 'e1' as any));
			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(memberService.getMember).not.toHaveBeenCalled();
		});

		it('gives the owner the full event, without a view', async () => {
			const result = await service.getEvent(OWNER, 'e1' as any);
			expect(result).toMatchObject({ _id: 'e1', eventTitle: 'Rock Night' });
			expect(result.venueData).toBeTruthy();
			expect(viewService.recordView).not.toHaveBeenCalled();
		});

		it('gives an admin the full event', async () => {
			const result = await service.getEvent(ADMIN, 'e1' as any);
			expect(result).toMatchObject({ _id: 'e1', eventTitle: 'Rock Night' });
			expect(result.venueData).toBeTruthy();
		});
	});

	it('getEvent keeps the not-found answer for hidden and missing events, ended or not', async () => {
		for (const status of [EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED, EventStatus.CANCELLED]) {
			eventModel.findOne.mockReturnValue(lean(event({ eventStatus: status, endAt: ago(1) })));
			await expect(service.getEvent(GUEST, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		}
		eventModel.findOne.mockReturnValue(lean(null));
		await expect(service.getEvent(GUEST, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
	});

	it('getEvent still shows a running event (started, not ended) and counts the view', async () => {
		eventModel.findOne.mockReturnValue(lean(event({ startAt: ago(1), endAt: ahead(2) })));
		eventModel.findByIdAndUpdate = jest.fn().mockReturnValue(exec({}));
		const result = await service.getEvent(STRANGER, 'e1' as any);
		expect(result._id).toBe('e1');
		expect(viewService.recordView).toHaveBeenCalled();
	});

	describe('writes', () => {
		it('likeTargetEvent only finds public events: an ended one is not found and nothing is toggled', async () => {
			eventModel.findOne.mockReturnValue(exec(null)); // what the database answers to the filter below for an ended event
			await expect(service.likeTargetEvent('m1' as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
			expect(likeService.toggleLike).not.toHaveBeenCalled();
		});

		it('assertPublicEvent (used by createComment) filters on the end time too', async () => {
			eventModel.findOne.mockReturnValue(lean(null));
			await expect(service.assertPublicEvent('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
		});

		it('createComment on an ended event writes nothing', async () => {
			const commentModel: any = { create: jest.fn() };
			const comments = new CommentService(commentModel, { assertPublicEvent: jest.fn().mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND)) } as any, {} as any, {} as any);
			await expect(comments.createComment('u1' as any, { commentContent: 'hi', commentRefId: 'e1' } as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(commentModel.create).not.toHaveBeenCalled();
		});

		it('the seat map of an ended event is "no seat map" (filter includes the end time)', async () => {
			eventModel.findOne.mockReturnValue(lean(null));
			await expect(service.getEventSeatMap('e1' as any)).rejects.toMatchObject({ code: 'NO_DATA_FOUND' });
			expect(eventModel.findOne.mock.calls[0][0]).toEqual({ _id: 'e1', eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
		});
	});

	describe('assertEventReadable (comments list)', () => {
		it.each(OVER)('an event that is %s: EVENT_ENDED for the public, open for the owner and admins', async (_name, over) => {
			eventModel.findOne.mockReturnValue(select(event(over)));
			await expectEnded(service.assertEventReadable(GUEST, 'e1' as any));
			await expectEnded(service.assertEventReadable(STRANGER, 'e1' as any));
			await expect(service.assertEventReadable(OWNER, 'e1' as any)).resolves.toBeUndefined();
			await expect(service.assertEventReadable(ADMIN, 'e1' as any)).resolves.toBeUndefined();
		});

		it('hidden (draft) and missing events are not found for the public, open for owner and admin; public events pass', async () => {
			eventModel.findOne.mockReturnValue(select(event({ eventStatus: EventStatus.DRAFT, endAt: ahead(5) })));
			await expect(service.assertEventReadable(GUEST, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
			await expect(service.assertEventReadable(OWNER, 'e1' as any)).resolves.toBeUndefined();
			await expect(service.assertEventReadable(ADMIN, 'e1' as any)).resolves.toBeUndefined();

			eventModel.findOne.mockReturnValue(select(null));
			await expect(service.assertEventReadable(ADMIN, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);

			eventModel.findOne.mockReturnValue(select(event({ endAt: ahead(5) })));
			await expect(service.assertEventReadable(GUEST, 'e1' as any)).resolves.toBeUndefined();
		});

		it('getComments asks before it reads any comment', async () => {
			const commentModel: any = { aggregate: jest.fn() };
			const eventService: any = { assertEventReadable: jest.fn().mockRejectedValue(eventEndedException()) };
			const comments = new CommentService(commentModel, eventService, {} as any, {} as any);
			await expectEnded(comments.getComments(STRANGER, { page: 1, limit: 5, search: { commentRefId: 'e1' as any } }));
			expect(eventService.assertEventReadable).toHaveBeenCalledWith(STRANGER, 'e1');
			expect(commentModel.aggregate).not.toHaveBeenCalled();
		});
	});
});

describe('ended events: likes, views, organizer counts, AI search (#121)', () => {
	it('getFavorites drops ended events in the pipeline, before paging', async () => {
		const likeModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])) };
		await new LikeService(likeModel).getFavoriteEvents('m1' as any, { page: 1, limit: 5 } as any);
		const pipeline = likeModel.aggregate.mock.calls[0][0];
		const index = pipeline.findIndex((s: any) => s.$match?.['favoriteEvent.endAt']);
		expect(pipeline[index].$match).toEqual(publicEventFilterAt('favoriteEvent'));
		expect(index).toBeLessThan(pipeline.findIndex((s: any) => s.$facet));
	});

	it('getVisited drops ended events in the pipeline, before paging', async () => {
		const viewModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])) };
		await new ViewService(viewModel).getVisitedEvents('m1' as any, { page: 1, limit: 5 } as any);
		const pipeline = viewModel.aggregate.mock.calls[0][0];
		const index = pipeline.findIndex((s: any) => s.$match?.['visitedEvent.endAt']);
		expect(pipeline[index].$match).toEqual(publicEventFilterAt('visitedEvent'));
		expect(index).toBeLessThan(pipeline.findIndex((s: any) => s.$facet));
	});

	it('the public event count of an organizer page counts live events only', async () => {
		const eventModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ _id: 'o1', total: 2 }])) };
		const members: any[] = [{ _id: 'o1', memberType: MemberType.ORGANIZER, memberEvents: 9 }];
		await (MemberService.prototype as any).useVisibleEventCount.call({ eventModel }, members);
		expect(eventModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
		expect(members[0].memberEvents).toBe(2);
	});

	describe('AI assistant tools', () => {
		const tools = (eventModel: any) => Object.assign(Object.create(AiToolsService.prototype), { eventModel, venueModel: { distinct: jest.fn() }, ticketTypeModel: { find: jest.fn() } });

		it('searchEvents only matches events that have not ended', async () => {
			const eventModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
			await (AiToolsService.prototype as any).searchEvents.call(tools(eventModel), {});
			expect(eventModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
		});

		it('getEvent answers not found for an ended event and never reads its ticket types', async () => {
			const eventModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
			const self = tools(eventModel);
			const outcome = await (AiToolsService.prototype as any).getEvent.call(self, { eventId: 'a'.repeat(24) });
			expect(eventModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ eventStatus: EventStatus.APPROVED, endAt: { $gt: expect.any(Date) } });
			expect(outcome.isError).toBe(true);
			expect(self.ticketTypeModel.find).not.toHaveBeenCalled();
		});
	});
});

describe('getTicketTypes on an ended event (#121)', () => {
	const make = (doc: any) => {
		const ticketTypes: any = { find: jest.fn().mockReturnValue({ sort: () => ({ exec: jest.fn().mockResolvedValue([{ _id: 't1' }]) }) }) };
		const eventModel: any = { findById: jest.fn().mockReturnValue(select(doc)) };
		const memberModel: any = { exists: jest.fn().mockResolvedValue({ _id: 'org1' }) };
		return { ticketTypes, service: new TicketTypeService(ticketTypes, eventModel, memberModel, {} as any, {} as any) };
	};

	it.each(OVER)('an event that is %s: EVENT_ENDED for guests and members, the list for the owner and admins', async (_name, over) => {
		const { service, ticketTypes } = make(event(over));
		await expectEnded(service.getTicketTypes('e1' as any, GUEST));
		await expectEnded(service.getTicketTypes('e1' as any, STRANGER));
		expect(ticketTypes.find).not.toHaveBeenCalled();
		expect(await service.getTicketTypes('e1' as any, OWNER)).toEqual([{ _id: 't1' }]);
		expect(await service.getTicketTypes('e1' as any, ADMIN)).toEqual([{ _id: 't1' }]);
	});

	it('a draft is hidden from the public (it used to be readable by anyone) but open for its owner', async () => {
		const { service } = make(event({ eventStatus: EventStatus.DRAFT, endAt: ahead(5) }));
		await expect(service.getTicketTypes('e1' as any, GUEST)).rejects.toThrow(Message.NO_DATA_FOUND);
		expect(await service.getTicketTypes('e1' as any, OWNER)).toEqual([{ _id: 't1' }]);
	});

	it('a live event still gives its ticket types to everyone', async () => {
		const { service } = make(event({ endAt: ahead(5) }));
		expect(await service.getTicketTypes('e1' as any, GUEST)).toEqual([{ _id: 't1' }]);
	});
});

describe('payOrder after the event ended (#121)', () => {
	it.each(OVER)('refuses to take payment for an event that is %s', async (_name, over) => {
		const BUYER = new ObjectId();
		const E = new ObjectId();
		const orders = new FakeModel([{ _id: new ObjectId(), buyerId: BUYER, eventId: E, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: ahead(1) }]);
		const events = new FakeModel([{ _id: E, ...over }]);
		const members = new FakeModel([{ _id: BUYER, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, emailVerifiedAt: new Date('2026-01-01') }]);
		const paymentService: any = { charge: jest.fn() };
		const service = new OrderService(orders as any, events as any, new FakeModel() as any, members as any, {} as any, {} as any, paymentService, {} as any);
		await expect(service.payOrder(BUYER as any, orders.docs[0]._id as any, {} as any)).rejects.toThrow(Message.EVENT_ENDED_NO_SALES);
		expect(paymentService.charge).not.toHaveBeenCalled();
	});
});

describe('the buyer keeps their own orders and tickets after the event ended (#121)', () => {
	const noEventFilter = (pipeline: any[]) => {
		const text = JSON.stringify(pipeline);
		// the only place an event's end time may appear is the explicit UPCOMING/PAST ticket filter the buyer asked for
		expect(text).not.toContain('eventStatus');
		return text;
	};

	it('getOrder, getMyOrders, getTicket and getMyTickets join the event and venue without any status or end-time filter', async () => {
		const orderModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ _id: 'o1', list: [], metaCounter: [] }])), find: jest.fn().mockReturnValue({ select: () => lean([]) }), updateMany: jest.fn().mockReturnValue(exec({})) };
		const orders = new OrderService(orderModel, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
		jest.spyOn(orders as any, 'expireStaleOrdersOf').mockResolvedValue(undefined);
		await orders.getOrder(new ObjectId() as any, new ObjectId() as any);
		await orders.getMyOrders(new ObjectId() as any, { page: 1, limit: 5 } as any);
		for (const call of orderModel.aggregate.mock.calls) {
			const text = noEventFilter(call[0]);
			expect(text).toContain('venueData'); // lookupEventWithVenue: event and venue are attached
			expect(text).not.toContain('endAt');
		}

		const ticketModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ _id: 't1', list: [], metaCounter: [] }])) };
		const tickets = new TicketService(ticketModel, {} as any, {} as any, {} as any, {} as any);
		await tickets.getTicket(new ObjectId() as any, new ObjectId() as any);
		await tickets.getMyTickets(new ObjectId() as any, { page: 1, limit: 5 } as any);
		for (const call of ticketModel.aggregate.mock.calls) {
			const text = noEventFilter(call[0]);
			expect(text).toContain('venueData');
			expect(text).not.toContain('endAt');
		}
	});

	it('the buyer keeps the event and venue fields of an ended event as the lookup returns them (eventData with venueData)', async () => {
		const row = { _id: 'o1', eventData: { eventTitle: 'Rock Night', startAt: ago(3), endAt: ago(1), venueData: { venueName: 'Arena' } } };
		const orderModel: any = { aggregate: jest.fn().mockReturnValue(exec([row])) };
		const orders = new OrderService(orderModel, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
		jest.spyOn(orders as any, 'expireStaleOrdersOf').mockResolvedValue(undefined);
		expect(await orders.getOrder(new ObjectId() as any, new ObjectId() as any)).toBe(row);
	});

	it.each([EventStatus.ENDED, EventStatus.APPROVED])('the refund quote of an order of a %s event past its end answers (not refundable), it does not fail', async (status) => {
		const BUYER = new ObjectId();
		const E = new ObjectId();
		const V = new ObjectId();
		const order = { _id: new ObjectId(), buyerId: BUYER, eventId: E, orderStatus: OrderStatus.PAID, totalAmount: 100, currency: 'KRW' };
		const events = new FakeModel([{ _id: E, venueId: V, eventStatus: status, startAt: ago(3), endAt: ago(1) }]);
		const service = new RefundService(new FakeModel([order]) as any, new FakeModel() as any, events as any, new FakeModel([{ _id: V, venueTimezone: 'Asia/Seoul' }]) as any, new FakeModel() as any, {} as any, {} as any, {} as any, {} as any, {} as any);
		const quote = await service.getRefundQuote(BUYER as any, order._id as any);
		expect(quote).toMatchObject({ orderId: order._id, refundable: false, refundableAmount: 0 });
	});
});
