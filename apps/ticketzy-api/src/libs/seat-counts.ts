import { Model, ObjectId } from 'mongoose';
import { OrderStatus } from './enums/ticket.enum';

export interface SeatCounts {
	eventTotalSeats: number;
	eventSoldSeats: number;
}

/**
 * Seats of a page of events in two aggregations, whatever the page size (no query per event).
 * - total: everything the event can sell, the sum of `totalQuantity` over its ticket types. A reserved-seating event's
 *   ticket types already hold the seats of their tier, a general event's hold the admission stock (standing included).
 *   A standing section of a reserved venue has no ticket type, so it is not on sale and does not count.
 * - sold: tickets in PAID orders. Held seats and unpaid orders are not sold; refunded orders have left PAID.
 */
export const getSeatCounts = async (
	eventIds: ObjectId[],
	ticketTypeModel: Model<any>,
	orderModel: Model<any>,
): Promise<Map<string, SeatCounts>> => {
	const counts = new Map<string, SeatCounts>();
	if (!eventIds.length) return counts;
	for (const id of eventIds) counts.set(String(id), { eventTotalSeats: 0, eventSoldSeats: 0 });

	const [totals, sold] = await Promise.all([
		ticketTypeModel
			.aggregate([{ $match: { eventId: { $in: eventIds } } }, { $group: { _id: '$eventId', total: { $sum: '$totalQuantity' } } }])
			.exec(),
		orderModel
			.aggregate([
				{ $match: { eventId: { $in: eventIds }, orderStatus: OrderStatus.PAID } },
				{ $group: { _id: '$eventId', sold: { $sum: { $sum: '$items.quantity' } } } },
			])
			.exec(),
	]);
	for (const row of totals) if (counts.has(String(row._id))) counts.get(String(row._id)).eventTotalSeats = row.total;
	for (const row of sold) if (counts.has(String(row._id))) counts.get(String(row._id)).eventSoldSeats = row.sold;
	return counts;
};

/** adds eventTotalSeats and eventSoldSeats to every event of a list, in place */
export const attachSeatCounts = async <E extends { _id: ObjectId }>(
	events: E[],
	ticketTypeModel: Model<any>,
	orderModel: Model<any>,
): Promise<E[]> => {
	const counts = await getSeatCounts(events.map((event) => event._id), ticketTypeModel, orderModel);
	for (const event of events) Object.assign(event, counts.get(String(event._id)));
	return events;
};
