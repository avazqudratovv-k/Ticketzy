import { Logger } from '@nestjs/common';
import { Model, ObjectId } from 'mongoose';
import { SeatStatus } from './enums/event.enum';
import { OrderStatus, TicketTypeStatus } from './enums/ticket.enum';

/**
 * Expiry of abandoned orders and seat holds, shared by the batch job and by the API (DECISIONS #102).
 * The batch app may be asleep (free tier), so the API runs the same code lazily: when stock is short, when ticket types
 * are read and when a buyer reads their own orders. Every step is a conditional update, so running it twice, or in the
 * API and the batch app at the same moment, releases an order exactly once.
 */
export interface ExpiryModels {
	orderModel: Model<any>;
	ticketTypeModel: Model<any>;
	eventSeatModel: Model<any>;
}

/** narrows which stale orders are looked at; no scope means all of them (the batch job) */
export interface ExpiryScope {
	eventId?: ObjectId;
	ticketTypeId?: ObjectId;
	buyerId?: ObjectId;
}

const logger = new Logger('OrderExpiry');

/** a seat whose hold ran out is AVAILABLE again; an unexpired hold, a SOLD seat and another buyer's hold are left alone */
const releaseSeatsOfOrder = async (models: ExpiryModels, order: any): Promise<void> => {
	// only the buyer's own holds that have run out: a newer hold of the same seats is left alone
	await models.eventSeatModel
		.updateMany(
			{ _id: { $in: order.seatIds }, heldBy: order.buyerId, seatStatus: SeatStatus.HELD, heldUntil: { $lte: new Date() } },
			{ seatStatus: SeatStatus.AVAILABLE, $unset: { heldBy: 1, heldUntil: 1 } },
		)
		.exec();
};

const releaseStockOfOrder = async (models: ExpiryModels, order: any): Promise<void> => {
	for (const item of order.items) {
		const ticketType = await models.ticketTypeModel
			.findOneAndUpdate({ _id: item.ticketTypeId, soldQuantity: { $gte: item.quantity } }, { $inc: { soldQuantity: -item.quantity } }, { new: true })
			.exec();
		if (!ticketType) continue;

		await models.ticketTypeModel
			.updateOne(
				{ _id: ticketType._id, ticketTypeStatus: TicketTypeStatus.SOLD_OUT, $expr: { $lt: ['$soldQuantity', '$totalQuantity'] } },
				{ ticketTypeStatus: TicketTypeStatus.ACTIVE },
			)
			.exec();
	}
};

/**
 * PENDING_PAYMENT orders past expiresAt become EXPIRED and give their seats or stock back. The status flip is the lock:
 * only the caller whose update matched releases anything. Returns how many orders this call expired.
 */
export const expireStaleOrders = async (models: ExpiryModels, scope: ExpiryScope = {}, limit = 200): Promise<number> => {
	const filter: Record<string, any> = { orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: { $lte: new Date() } };
	if (scope.eventId) filter.eventId = scope.eventId;
	if (scope.buyerId) filter.buyerId = scope.buyerId;
	if (scope.ticketTypeId) filter['items.ticketTypeId'] = scope.ticketTypeId;

	const stale = await models.orderModel.find(filter).limit(limit).lean().exec();

	let expired = 0;
	for (const candidate of stale) {
		const order = await models.orderModel
			.findOneAndUpdate(
				{ _id: candidate._id, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: { $lte: new Date() } },
				{ orderStatus: OrderStatus.EXPIRED },
				{ new: true },
			)
			.exec();
		if (!order) continue;
		expired++;

		if (order.seatIds?.length) await releaseSeatsOfOrder(models, order);
		else await releaseStockOfOrder(models, order);
	}
	if (stale.length) logger.debug(`Checked ${stale.length} expired order(s)`);
	return expired;
};

/** seats whose hold ran out without becoming an order (the buyer left, or the order lived shorter than the hold) */
export const releaseExpiredSeatHolds = async (models: ExpiryModels, scope: { eventId?: ObjectId } = {}): Promise<number> => {
	const filter: Record<string, any> = { seatStatus: SeatStatus.HELD, heldUntil: { $lte: new Date() } };
	if (scope.eventId) filter.eventId = scope.eventId;
	const released = await models.eventSeatModel
		.updateMany(filter, { seatStatus: SeatStatus.AVAILABLE, $unset: { heldBy: 1, heldUntil: 1 } })
		.exec();
	if (released.modifiedCount) logger.debug(`Released ${released.modifiedCount} expired seat hold(s)`);
	return released.modifiedCount;
};
