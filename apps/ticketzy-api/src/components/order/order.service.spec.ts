import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { OrderService } from './order.service';
import { OrderResolver } from './order.resolver';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus } from '../../libs/enums/ticket.enum';

const oid = () => new ObjectId();
const BUYER = oid();
const ORG = oid();
const E = oid();
const A = oid();
const B = oid();
const day = 86400000;

describe('OrderService.createCheckout (general admission)', () => {
	let members: FakeModel;
	let events: FakeModel;
	let orders: FakeModel;
	let ticketTypeService: any;
	let service: OrderService;

	beforeEach(() => {
		members = new FakeModel([
			{ _id: BUYER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER },
			{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, completedEvents: 0 },
		]);
		events = new FakeModel([
			{ _id: E, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: new Date(Date.now() + day), endAt: new Date(Date.now() + 2 * day) },
		]);
		orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
		ticketTypeService = { reserve: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
		service = new OrderService(orders as any, events as any, new FakeModel() as any, members as any, ticketTypeService, {} as any, {} as any, {} as any);
	});

	const input = (items: { ticketTypeId: ObjectId; quantity: number }[]) => ({ eventId: E, items }) as any;
	const reserved = (id: ObjectId, price: number) => ({ _id: id, eventId: E, ticketPrice: price, ticketCurrency: 'USD' });

	it('snapshots unit prices, totals the order and holds it as PENDING_PAYMENT', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(reserved(B, 120));

		const order: any = await service.createCheckout(BUYER as any, input([
			{ ticketTypeId: A, quantity: 2 },
			{ ticketTypeId: B, quantity: 1 },
		]));

		expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		expect(order.totalAmount).toBe(220);
		expect(order.subtotal).toBe(220);
		expect(order.commissionRate).toBe(10);
		expect(order.commissionAmount).toBe(22);
		expect(order.items.map((i) => i.unitPrice)).toEqual([50, 120]);
		expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now());
		expect(ticketTypeService.release).not.toHaveBeenCalled();
	});

	it('refuses an event whose organizer is not ACTIVE, before anything is reserved', async () => {
		members.docs[1].memberStatus = MemberStatus.SUSPENDED;
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
		expect(orders.docs).toHaveLength(0);
	});

	it('refuses a buyer who is not ACTIVE', async () => {
		members.docs[0].memberStatus = MemberStatus.SUSPENDED;
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});

	it('releases earlier reservations when a later item cannot be reserved', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(null);
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 2 }, { ticketTypeId: B, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledTimes(1);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 2);
		expect(orders.docs).toHaveLength(0);
	});

	it('releases stock when saving the order fails', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50));
		orders.create = jest.fn().mockRejectedValue(new Error('db down'));
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 3 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 3);
	});

	it('rejects a ticket type of another event, and releases it', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce({ ...reserved(A, 50), eventId: oid() });
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 1);
	});

	it('rejects mixed currencies in one order', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce({ ...reserved(B, 10), ticketCurrency: 'EUR' });
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }, { ticketTypeId: B, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledTimes(2);
	});

	it('rejects duplicate ticket types before reserving anything', async () => {
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }, { ticketTypeId: A, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});

	it('rejects events that are not APPROVED, already over, or outside their sale window', async () => {
		const attempt = () => service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]));

		events.docs[0].eventStatus = EventStatus.PENDING;
		await expect(attempt()).rejects.toBeInstanceOf(BadRequestException);

		events.docs[0].eventStatus = EventStatus.APPROVED;
		events.docs[0].endAt = new Date(Date.now() - 1000);
		await expect(attempt()).rejects.toThrow(Message.EVENT_ENDED_NO_SALES);

		// an ended event is refused even when its sales window is still open
		events.docs[0].saleStartAt = new Date(Date.now() - 2 * day);
		events.docs[0].saleEndAt = new Date(Date.now() + day);
		await expect(attempt()).rejects.toThrow(Message.EVENT_ENDED_NO_SALES);

		events.docs[0].endAt = new Date(Date.now() + 2 * day);
		events.docs[0].saleStartAt = new Date(Date.now() + day);
		events.docs[0].saleEndAt = undefined;
		await expect(attempt()).rejects.toThrow(Message.SALES_NOT_STARTED);

		events.docs[0].saleStartAt = new Date(Date.now() - 2 * day);
		events.docs[0].saleEndAt = new Date(Date.now() - day);
		await expect(attempt()).rejects.toThrow(Message.SALES_CLOSED);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});
});

describe('OrderService order queries (event and venue)', () => {
	const query = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
	let orders: any;
	let service: OrderService;

	beforeEach(() => {
		orders = { aggregate: jest.fn().mockReturnValue(query([{ list: [], metaCounter: [] }])) };
		service = new OrderService(orders, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
	});

	const eventLookup = (pipeline: any[]) => pipeline.find((s) => s.$lookup && s.$lookup.from === 'events').$lookup;
	const expectVenueNested = (pipeline: any[]) => {
		const lookup = eventLookup(pipeline);
		expect(lookup.as).toBe('eventData');
		expect(lookup.pipeline.find((s) => s.$lookup).$lookup).toMatchObject({ from: 'venues', localField: 'venueId', as: 'venueData' });
	};

	it('getOrder matches order and buyer, and returns the order with its event and venue in one query', async () => {
		orders.aggregate.mockReturnValue(query([{ _id: A, eventData: { venueData: { venueName: 'Hall' } } }]));
		const order: any = await service.getOrder(BUYER as any, A as any);

		const pipeline = orders.aggregate.mock.calls[0][0];
		expect(String(pipeline[0].$match._id)).toBe(String(A));
		expect(String(pipeline[0].$match.buyerId)).toBe(String(BUYER));
		expectVenueNested(pipeline);
		expect(orders.aggregate).toHaveBeenCalledTimes(1);
		expect(order.eventData.venueData.venueName).toBe('Hall');
	});

	it('getOrder answers NO_DATA_FOUND for another buyer\'s or a missing order', async () => {
		orders.aggregate.mockReturnValue(query([]));
		await expect(service.getOrder(BUYER as any, A as any)).rejects.toBeInstanceOf(InternalServerErrorException);
	});

	it('getMyOrders joins event and venue for the page only, in one aggregation', async () => {
		await service.getMyOrders(BUYER as any, { page: 2, limit: 5 } as any);

		const pipeline = orders.aggregate.mock.calls[0][0];
		const list = pipeline.find((s) => s.$facet).$facet.list;
		expect(list.find((s) => s.$skip !== undefined).$skip).toBe(5);
		expectVenueNested(list);
		expect(orders.aggregate).toHaveBeenCalledTimes(1);
	});
});

describe('OrderService.getMyEventOrders (organizer)', () => {
	const query = (value: any): any => ({
		exec: jest.fn().mockResolvedValue(value),
		select: () => ({ lean: () => query(value) }),
		then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
	});
	const OTHER = oid();
	let orders: any;
	let events: any;
	let service: OrderService;

	beforeEach(() => {
		orders = { aggregate: jest.fn().mockReturnValue(query([{ list: [], metaCounter: [] }])) };
		events = {
			exists: jest.fn().mockImplementation((filter) => query(String(filter.organizerId) === String(ORG) ? { _id: E } : null)),
			find: jest.fn().mockReturnValue(query([{ _id: E }, { _id: A }])),
		};
		service = new OrderService(orders, events, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
	});

	const pipeline = () => orders.aggregate.mock.calls[0][0];

	it("without an eventId it matches only orders on the organizer's own events", async () => {
		await service.getMyEventOrders(ORG as any, { page: 1, limit: 10 } as any);

		expect(events.find).toHaveBeenCalledWith({ organizerId: ORG });
		expect(pipeline()[0].$match.eventId.$in.map(String)).toEqual([String(E), String(A)]);
	});

	it('an organizer without events matches nothing', async () => {
		events.find.mockReturnValue(query([]));
		await service.getMyEventOrders(ORG as any, { page: 1, limit: 10 } as any);
		expect(pipeline()[0].$match.eventId).toEqual({ $in: [] });
	});

	it('filters by own event and status, and paginates', async () => {
		await service.getMyEventOrders(ORG as any, { page: 3, limit: 5, eventId: String(E), orderStatus: OrderStatus.PAID } as any);

		expect(events.exists).toHaveBeenCalledWith({ _id: expect.anything(), organizerId: ORG });
		const match = pipeline()[0].$match;
		expect(String(match.eventId)).toBe(String(E));
		expect(match.orderStatus).toBe(OrderStatus.PAID);
		expect(pipeline().find((s) => s.$facet).$facet.list.find((s) => s.$skip !== undefined).$skip).toBe(10);
	});

	it("refuses another organizer's event and an unknown one, before any order is read", async () => {
		await expect(service.getMyEventOrders(OTHER as any, { page: 1, limit: 10, eventId: String(E) } as any)).rejects.toThrow(
			Message.NOT_ALLOWED_REQUEST,
		);
		expect(orders.aggregate).not.toHaveBeenCalled();
	});

	it('the buyer is reduced to a nickname: no email or phone in the pipeline', async () => {
		await service.getMyEventOrders(ORG as any, { page: 1, limit: 10 } as any);
		const list = pipeline().find((s) => s.$facet).$facet.list;

		const buyer = list.find((s) => s.$lookup?.from === 'members').$lookup;
		expect(buyer.pipeline.find((s) => s.$project).$project).toEqual({ memberNick: 1 });
		const stripped = list.find((s) => s.$project && s.$project.buyer === 0).$project;
		expect(stripped).toMatchObject({ buyer: 0, buyerId: 0 });
		expect(JSON.stringify(list)).not.toMatch(/memberEmail|memberPhone/);
	});

	it('is for active organizers only', () => {
		expect(Reflect.getMetadata('roles', OrderResolver.prototype.getMyEventOrders)).toEqual(['ORGANIZER']);
		const guards = (Reflect.getMetadata('__guards__', OrderResolver.prototype.getMyEventOrders) ?? []).map((g: any) => g.name);
		expect(guards).toEqual(['RolesGuard', 'ActiveOrganizerGuard']);
	});
});

describe('OrderService.getAllOrdersByAdmin', () => {
	const query = (value: any): any => ({
		exec: jest.fn().mockResolvedValue(value),
		select: () => ({ lean: () => query(value) }),
	});
	let orders: any;
	let members: any;
	let service: OrderService;

	beforeEach(() => {
		orders = { aggregate: jest.fn().mockReturnValue(query([{ list: [], metaCounter: [] }])) };
		members = { find: jest.fn().mockReturnValue(query([{ _id: BUYER }, { _id: ORG }])) };
		service = new OrderService(orders, {} as any, {} as any, members, {} as any, {} as any, {} as any, {} as any);
	});

	const pipeline = () => orders.aggregate.mock.calls[0][0];
	const list = () => pipeline().find((s) => s.$facet).$facet.list;
	const base = { page: 1, limit: 10 } as any;

	it('without filters it matches everything, newest first, with a stable tie-break', async () => {
		await service.getAllOrdersByAdmin(base);

		expect(pipeline()[0].$match).toEqual({});
		expect(pipeline()[1].$sort).toEqual({ createdAt: -1, _id: -1 });
		expect(members.find).not.toHaveBeenCalled();
	});

	it('filters by event id and order status', async () => {
		await service.getAllOrdersByAdmin({ ...base, eventId: String(E), orderStatus: OrderStatus.PAID });

		const match = pipeline()[0].$match;
		expect(String(match.eventId)).toBe(String(E));
		expect(match.orderStatus).toBe(OrderStatus.PAID);
	});

	it('filters by a date range on createdAt, from and to together or alone', async () => {
		const from = new Date('2026-01-01T00:00:00Z');
		const to = new Date('2026-02-01T00:00:00Z');

		await service.getAllOrdersByAdmin({ ...base, dateFrom: from, dateTo: to });
		expect(pipeline()[0].$match.createdAt).toEqual({ $gte: from, $lte: to });

		orders.aggregate.mockClear();
		await service.getAllOrdersByAdmin({ ...base, dateTo: to });
		expect(pipeline()[0].$match.createdAt).toEqual({ $lte: to });
	});

	it('refuses a range whose start is after its end, before any query', async () => {
		await expect(
			service.getAllOrdersByAdmin({ ...base, dateFrom: new Date('2026-03-01'), dateTo: new Date('2026-01-01') }),
		).rejects.toThrow(Message.INVALID_ORDER_DATE_RANGE);
		expect(orders.aggregate).not.toHaveBeenCalled();
		expect(members.find).not.toHaveBeenCalled();
	});

	it('buyer text searches nick, full name and email case-insensitively, with regex characters escaped', async () => {
		await service.getAllOrdersByAdmin({ ...base, text: ' a.b+c ' });

		const [filter] = members.find.mock.calls[0];
		expect(filter.$or.map((c) => Object.keys(c)[0])).toEqual(['memberNick', 'memberFullName', 'memberEmail']);
		const regex: RegExp = filter.$or[0].memberNick.$regex;
		expect(regex.flags).toBe('i');
		expect(regex.test('a.b+c')).toBe(true);
		expect(regex.test('aXb+c')).toBe(false);
		expect(pipeline()[0].$match.buyerId).toEqual({ $in: [BUYER, ORG] });
	});

	it('buyer text with no matching member matches no order', async () => {
		members.find.mockReturnValue(query([]));
		await service.getAllOrdersByAdmin({ ...base, text: 'nobody' });
		expect(pipeline()[0].$match.buyerId).toEqual({ $in: [] });
	});

	it('all filters combine', async () => {
		await service.getAllOrdersByAdmin({ ...base, text: 'kim', eventId: String(E), orderStatus: OrderStatus.REFUNDED, dateFrom: new Date(0) });
		expect(Object.keys(pipeline()[0].$match).sort()).toEqual(['buyerId', 'createdAt', 'eventId', 'orderStatus']);
	});

	it('paginates and returns the buyer nickname and email and the event title in the same aggregation', async () => {
		await service.getAllOrdersByAdmin({ page: 3, limit: 5 } as any);

		expect(list().find((s) => s.$skip !== undefined).$skip).toBe(10);
		expect(list().find((s) => s.$limit !== undefined).$limit).toBe(5);
		const buyer = list().find((s) => s.$lookup?.from === 'members').$lookup;
		expect(buyer.pipeline.find((s) => s.$project).$project).toEqual({ memberNick: 1, memberEmail: 1 });
		expect(list().find((s) => s.$addFields).$addFields).toEqual({
			buyerNick: { $arrayElemAt: ['$buyer.memberNick', 0] },
			buyerEmail: { $arrayElemAt: ['$buyer.memberEmail', 0] },
			eventTitle: '$eventData.eventTitle',
		});
		expect(list().find((s) => s.$project)?.$project).toEqual({ buyer: 0 });
		expect(pipeline().find((s) => s.$facet).$facet.metaCounter).toEqual([{ $count: 'total' }]);
		expect(orders.aggregate).toHaveBeenCalledTimes(1);
	});

	it('is ADMIN only', () => {
		expect(Reflect.getMetadata('roles', OrderResolver.prototype.getAllOrdersByAdmin)).toEqual(['ADMIN']);
	});
});
