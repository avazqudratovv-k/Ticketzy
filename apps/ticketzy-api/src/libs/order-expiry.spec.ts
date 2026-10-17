import { ObjectId } from 'bson';
import { FakeModel } from '../../test/fake-model';
import { expireStaleOrders, releaseExpiredSeatHolds } from './order-expiry';
import { TicketTypeService } from '../components/ticket-type/ticket-type.service';
import { OrderService } from '../components/order/order.service';
import { OrderStatus, TicketTypeStatus } from './enums/ticket.enum';
import { SeatStatus } from './enums/event.enum';

const oid = (): any => new ObjectId();
const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 60_000);

/** ticket types with the two conditional updates the stock code uses (reserve and release), nothing else */
class StockModel {
	constructor(public docs: any[]) {}
	private chain<R>(run: () => R) {
		const q: any = { lean: () => q, select: () => q, exec: () => Promise.resolve(run()) };
		return q;
	}
	public findById(id: any) { return this.chain(() => this.docs.find((d) => String(d._id) === String(id)) ?? null); }
	public find(filter: any) { return this.chain(() => this.docs.filter((d) => String(d.eventId) === String(filter.eventId))); }
	public findOneAndUpdate(filter: any, update: any) {
		return this.chain(() => {
			const doc = this.docs.find((d) => String(d._id) === String(filter._id));
			if (!doc) return null;
			if (filter.$expr) {
				// reserve
				const quantity = filter.$expr.$lte[0].$add[1];
				if (doc.ticketTypeStatus !== TicketTypeStatus.ACTIVE || doc.maxPerOrder < quantity || doc.soldQuantity + quantity > doc.totalQuantity) return null;
			} else if (!(doc.soldQuantity >= filter.soldQuantity.$gte)) {
				return null; // release below zero
			}
			doc.soldQuantity += update.$inc.soldQuantity;
			return { ...doc };
		});
	}
	public updateOne(filter: any, update: any) {
		return this.chain(() => {
			const doc = this.docs.find((d) => String(d._id) === String(filter._id));
			if (!doc || doc.ticketTypeStatus !== filter.ticketTypeStatus) return { modifiedCount: 0 };
			const wantsActive = update.ticketTypeStatus === TicketTypeStatus.ACTIVE;
			if (wantsActive && doc.soldQuantity >= doc.totalQuantity) return { modifiedCount: 0 };
			if (!wantsActive && doc.soldQuantity < doc.totalQuantity) return { modifiedCount: 0 };
			doc.ticketTypeStatus = update.ticketTypeStatus;
			return { modifiedCount: 1 };
		});
	}
}

const setup = () => {
	const eventId = oid();
	const ticketTypeId = oid();
	const buyer = oid();
	const ticketTypes = new StockModel([{ _id: ticketTypeId, eventId, ticketTypeStatus: TicketTypeStatus.SOLD_OUT, totalQuantity: 10, soldQuantity: 10, maxPerOrder: 8 }]);
	const orders = new FakeModel();
	const seats = new FakeModel();
	const stale = { _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, eventId, expiresAt: past(), seatIds: [], items: [{ ticketTypeId, quantity: 4 }] };
	orders.docs.push(stale);
	return { eventId, ticketTypeId, buyer, ticketTypes, orders, seats, stale, models: { orderModel: orders as any, ticketTypeModel: ticketTypes as any, eventSeatModel: seats as any } };
};

describe('expireStaleOrders (shared by the batch job and the API)', () => {
	it('expires a stale order once and gives its stock back; a second run changes nothing (idempotent)', async () => {
		const { models, ticketTypes, orders } = setup();
		expect(await expireStaleOrders(models)).toBe(1);
		expect(orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(ticketTypes.docs[0].soldQuantity).toBe(6);
		expect(ticketTypes.docs[0].ticketTypeStatus).toBe(TicketTypeStatus.ACTIVE); // lifted from SOLD_OUT

		expect(await expireStaleOrders(models)).toBe(0);
		expect(ticketTypes.docs[0].soldQuantity).toBe(6);
	});

	it('two sweeps at the same moment release the stock exactly once', async () => {
		const { models, ticketTypes } = setup();
		const counts = await Promise.all([expireStaleOrders(models), expireStaleOrders(models)]);
		expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
		expect(ticketTypes.docs[0].soldQuantity).toBe(6);
	});

	it('leaves live, paid and other-scope orders alone', async () => {
		const { models, orders, eventId, buyer, ticketTypeId, stale } = setup();
		orders.docs.push(
			{ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, eventId, expiresAt: future(), seatIds: [], items: [{ ticketTypeId, quantity: 1 }] },
			{ _id: oid(), orderStatus: OrderStatus.PAID, buyerId: buyer, eventId, expiresAt: past(), seatIds: [], items: [{ ticketTypeId, quantity: 1 }] },
		);
		expect(await expireStaleOrders(models, { eventId: oid() })).toBe(0); // another event
		expect(await expireStaleOrders(models, { ticketTypeId: oid() })).toBe(0); // another ticket type
		expect(await expireStaleOrders(models, { buyerId: oid() })).toBe(0); // another buyer
		expect(await expireStaleOrders(models, { ticketTypeId })).toBe(1);
		expect(orders.docs.map((o) => o.orderStatus)).toEqual([OrderStatus.EXPIRED, OrderStatus.PENDING_PAYMENT, OrderStatus.PAID]);
		expect(stale._id).toBeDefined();
	});

	it('frees the held seats of a reserved order, but not a newer hold', async () => {
		const { models, orders, seats, eventId, buyer } = setup();
		const own = { _id: oid(), seatStatus: SeatStatus.HELD, heldBy: buyer, heldUntil: past() };
		const renewed = { _id: oid(), seatStatus: SeatStatus.HELD, heldBy: buyer, heldUntil: future() };
		seats.docs.push(own, renewed);
		orders.docs.length = 0;
		orders.docs.push({ _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT, buyerId: buyer, eventId, expiresAt: past(), seatIds: [own._id, renewed._id], items: [] });
		await expireStaleOrders(models);
		expect(own.seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(renewed.seatStatus).toBe(SeatStatus.HELD);
	});
});

describe('releaseExpiredSeatHolds', () => {
	it('frees holds that ran out, scoped to an event when asked', async () => {
		const seats = new FakeModel();
		const eventId = oid();
		const mine = { _id: oid(), eventId, seatStatus: SeatStatus.HELD, heldBy: oid(), heldUntil: past() };
		const other = { _id: oid(), eventId: oid(), seatStatus: SeatStatus.HELD, heldBy: oid(), heldUntil: past() };
		seats.docs.push(mine, other);
		const models = { orderModel: {} as any, ticketTypeModel: {} as any, eventSeatModel: seats as any };
		expect(await releaseExpiredSeatHolds(models, { eventId })).toBe(1);
		expect(mine.seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(other.seatStatus).toBe(SeatStatus.HELD);
	});
});

describe('lazy expiry in the API when the batch app is asleep (C3-50)', () => {
	const makeTicketTypeService = (fixture: ReturnType<typeof setup>) =>
		new TicketTypeService(fixture.ticketTypes as any, {} as any, { exists: jest.fn().mockReturnValue({ exec: async () => ({ _id: 1 }) }) } as any, {} as any, fixture.seats as any, fixture.orders as any);

	it('reserve: a sold-out ticket type becomes available again when an abandoned order held the stock', async () => {
		const fixture = setup();
		const service = makeTicketTypeService(fixture);
		const reserved = await service.reserve(fixture.ticketTypeId as any, 3);
		expect(reserved).not.toBeNull();
		expect(fixture.orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(fixture.ticketTypes.docs[0].soldQuantity).toBe(9); // 10 - 4 freed + 3 reserved
	});

	it('reserve: still refuses when the stock really is gone (live holds are not touched)', async () => {
		const fixture = setup();
		fixture.orders.docs[0].expiresAt = future();
		const service = makeTicketTypeService(fixture);
		expect(await service.reserve(fixture.ticketTypeId as any, 1)).toBeNull();
		expect(fixture.orders.docs[0].orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('getTicketTypes: reading the ticket types frees abandoned stock first', async () => {
		const fixture = setup();
		const events = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ organizerId: oid(), eventStatus: 'APPROVED', endAt: new Date(Date.now() + 86400000) }) }) }) }) };
		const service = new TicketTypeService(fixture.ticketTypes as any, events as any, { exists: jest.fn().mockReturnValue({ exec: async () => ({ _id: 1 }) }) } as any, {} as any, fixture.seats as any, fixture.orders as any);
		// getTicketTypes sorts the list; the stock model above answers find() with an array, so give it a sort
		(fixture.ticketTypes as any).find = (filter: any) => ({ sort: () => ({ exec: async () => fixture.ticketTypes.docs.filter((d) => String(d.eventId) === String(filter.eventId)) }) });
		const list = await service.getTicketTypes(fixture.eventId as any);
		expect(list[0].soldQuantity).toBe(6);
		expect(list[0].ticketTypeStatus).toBe(TicketTypeStatus.ACTIVE);
	});

	it('a failing sweep never fails the purchase or the read', async () => {
		const fixture = setup();
		const broken = { find: () => { throw new Error('db down'); } };
		const service = new TicketTypeService(fixture.ticketTypes as any, {} as any, {} as any, {} as any, fixture.seats as any, broken as any);
		expect(await service.reserve(fixture.ticketTypeId as any, 3)).toBeNull();
	});

	it('getMyOrders: the buyer\'s own stale checkout is expired when they look at their orders', async () => {
		const fixture = setup();
		const expireOrder = jest.fn();
		const orderModel = Object.assign(fixture.orders, {
			aggregate: () => ({ exec: async () => [{ list: [], metaCounter: [] }] }),
		});
		const service: any = new OrderService(orderModel as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
		const releaseResources = jest.spyOn(service, 'releaseResources').mockImplementation(expireOrder);
		await service.getMyOrders(fixture.buyer as any, { page: 1, limit: 20 } as any);
		expect(fixture.orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(releaseResources).toHaveBeenCalledTimes(1);

		// reading again changes nothing
		await service.getMyOrders(fixture.buyer as any, { page: 1, limit: 20 } as any);
		expect(releaseResources).toHaveBeenCalledTimes(1);
	});
});
