import { BatchService } from './batch.service';
import { ObjectId } from 'bson';
import { FakeModel } from 'apps/ticketzy-api/test/fake-model';
import { EventStatus, SeatStatus } from 'apps/ticketzy-api/src/libs/enums/event.enum';
import { OrderStatus } from 'apps/ticketzy-api/src/libs/enums/ticket.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const finder = (value: any) => {
	const chain: any = {};
	chain.select = () => chain;
	chain.limit = () => chain;
	chain.lean = () => chain;
	chain.exec = jest.fn().mockResolvedValue(value);
	return chain;
};

describe('BatchService.batchEndEvents', () => {
	let eventModel: any;
	let memberModel: any;
	let service: BatchService;

	beforeEach(() => {
		eventModel = { find: jest.fn(), findOneAndUpdate: jest.fn() };
		memberModel = { updateOne: jest.fn().mockReturnValue(exec({})) };
		service = new BatchService(eventModel, memberModel, {} as any, {} as any, {} as any);
	});

	it('looks only at APPROVED events whose endAt has passed', async () => {
		eventModel.find.mockReturnValue(finder([]));
		await service.batchEndEvents();
		const filter = eventModel.find.mock.calls[0][0];
		expect(filter.eventStatus).toEqual({ $in: [EventStatus.APPROVED] });
		expect(filter.endAt.$lte).toBeInstanceOf(Date);
	});

	it('moves each due event to ENDED with a conditional update and counts it for the organizer', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }, { _id: 'e2' }]));
		eventModel.findOneAndUpdate
			.mockReturnValueOnce(exec({ _id: 'e1', organizerId: 'org1' }))
			.mockReturnValueOnce(exec({ _id: 'e2', organizerId: 'org1' }));

		await service.batchEndEvents();

		const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
		expect(filter).toMatchObject({ _id: 'e1', eventStatus: { $in: [EventStatus.APPROVED] } });
		expect(update).toEqual({ eventStatus: EventStatus.ENDED });
		expect(memberModel.updateOne).toHaveBeenCalledTimes(2);
		expect(memberModel.updateOne).toHaveBeenCalledWith({ _id: 'org1' }, { $inc: { completedEvents: 1 } });
	});

	it('does not count an event another run (or a cancellation) already changed', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }]));
		eventModel.findOneAndUpdate.mockReturnValue(exec(null));

		await service.batchEndEvents();

		expect(memberModel.updateOne).not.toHaveBeenCalled();
	});

	it('keeps going when the counter update fails', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }, { _id: 'e2' }]));
		eventModel.findOneAndUpdate
			.mockReturnValueOnce(exec({ _id: 'e1', organizerId: 'org1' }))
			.mockReturnValueOnce(exec({ _id: 'e2', organizerId: 'org2' }));
		memberModel.updateOne.mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(new Error('db')) }).mockReturnValueOnce(exec({}));

		await expect(service.batchEndEvents()).resolves.toBeUndefined();
		expect(memberModel.updateOne).toHaveBeenCalledTimes(2);
	});
});

describe('BatchService.batchExpireOrders', () => {
	const oid = () => new ObjectId();
	const buyer = oid();
	const past = () => new Date(Date.now() - 5000);
	const future = () => new Date(Date.now() + 60000);
	let orders: FakeModel;
	let seats: FakeModel;
	let ticketTypeModel: any;
	let service: BatchService;

	const seat = (over: any = {}) => ({ _id: oid(), seatStatus: SeatStatus.AVAILABLE, ...over });
	const held = (over: any = {}) => seat({ seatStatus: SeatStatus.HELD, heldBy: buyer, heldUntil: past(), ...over });

	beforeEach(() => {
		orders = new FakeModel();
		seats = new FakeModel();
		ticketTypeModel = { findOneAndUpdate: jest.fn().mockReturnValue(exec({ _id: 'tt' })), updateOne: jest.fn().mockReturnValue(exec({})) };
		service = new BatchService({} as any, {} as any, orders as any, ticketTypeModel, seats as any);
	});

	it('expires PENDING_PAYMENT orders past expiresAt and releases their held seats', async () => {
		const s1 = held();
		const s2 = held();
		seats.docs.push(s1, s2);
		orders.docs.push({ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, expiresAt: past(), seatIds: [s1._id, s2._id], items: [] });

		await service.batchExpireOrders();

		expect(orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(seats.docs.every((d) => d.seatStatus === SeatStatus.AVAILABLE && d.heldBy === undefined && d.heldUntil === undefined)).toBe(true);
		expect(ticketTypeModel.findOneAndUpdate).not.toHaveBeenCalled(); // reserved orders hold seats, not stock
	});

	it('gives the stock of an expired general order back', async () => {
		const ticketTypeId = oid();
		orders.docs.push({ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, expiresAt: past(), seatIds: [], items: [{ ticketTypeId, quantity: 3 }] });

		await service.batchExpireOrders();

		expect(orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(ticketTypeModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: ticketTypeId, soldQuantity: { $gte: 3 } },
			{ $inc: { soldQuantity: -3 } },
			{ new: true },
		);
	});

	it('leaves live orders, paid orders and sold seats alone', async () => {
		const live = held({ heldUntil: future() });
		const sold = seat({ seatStatus: SeatStatus.SOLD, heldBy: buyer, heldUntil: past(), orderId: oid() });
		seats.docs.push(live, sold);
		orders.docs.push(
			{ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, expiresAt: future(), seatIds: [live._id], items: [] },
			{ _id: oid(), orderStatus: OrderStatus.PAID, buyerId: buyer, expiresAt: past(), seatIds: [sold._id], items: [] },
		);

		await service.batchExpireOrders();

		expect(orders.docs.map((o) => o.orderStatus)).toEqual([OrderStatus.PENDING_PAYMENT, OrderStatus.PAID]);
		expect(live.seatStatus).toBe(SeatStatus.HELD);
		expect(sold.seatStatus).toBe(SeatStatus.SOLD);
	});

	it('does not release a newer hold of the same buyer on an expired order\'s seat', async () => {
		const renewed = held({ heldUntil: future() });
		seats.docs.push(renewed);
		orders.docs.push({ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, expiresAt: past(), seatIds: [renewed._id], items: [] });

		await service.batchExpireOrders();

		expect(orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(renewed.seatStatus).toBe(SeatStatus.HELD);
	});

	it('resets every seat whose hold has passed to AVAILABLE, even without an order', async () => {
		const stale = held();
		const fresh = held({ heldUntil: future() });
		seats.docs.push(stale, fresh);

		await service.batchExpireOrders();

		expect(stale.seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(stale.heldBy).toBeUndefined();
		expect(fresh.seatStatus).toBe(SeatStatus.HELD);
	});
});
