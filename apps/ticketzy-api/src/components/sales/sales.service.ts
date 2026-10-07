import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Order } from '../../libs/dto/order/order';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { Attendees, EventSales, MyEarnings } from '../../libs/dto/sales/sales';
import { AttendeesInquiry } from '../../libs/dto/sales/sales.input';
import { Message } from '../../libs/enums/common.enum';
import { OrderStatus, TicketStatus } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { shapeIntoMongoObjectId } from '../../libs/config';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Read-only sales numbers for the organizer who owns the event. Only PAID orders count; refunded ones are shown apart. */
@Injectable()
export class SalesService {
	constructor(
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
	) {}

	/** tickets sold, revenue, commission and net payout per ticket type; the commission rate is the one stored on each order */
	public async getEventSales(organizerId: ObjectId, eventId: ObjectId): Promise<EventSales> {
		await this.assertOwner(organizerId, eventId);

		const rows = await this.orderModel
			.aggregate([
				{ $match: { eventId: eventId, orderStatus: OrderStatus.PAID } },
				{ $unwind: '$items' },
				{
					$group: {
						_id: { ticketTypeId: '$items.ticketTypeId', commissionRate: '$commissionRate', currency: '$currency' },
						ticketsSold: { $sum: '$items.quantity' },
						revenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
					},
				},
				{ $lookup: { from: 'ticketTypes', localField: '_id.ticketTypeId', foreignField: '_id', as: 'ticketTypeData' } },
				{ $unwind: { path: '$ticketTypeData', preserveNullAndEmptyArrays: true } },
			])
			.exec();

		// rows of one ticket type that were sold under different commission rates are merged here, where the rounding is done
		const byType = new Map<string, EventSales['ticketTypes'][number]>();
		// every ticket type is listed, also the ones that sold nothing
		const ticketTypes = await this.ticketTypeModel.find({ eventId: eventId }).sort({ ticketPrice: 1 }).lean().exec();
		for (const ticketType of ticketTypes) {
			byType.set(String(ticketType._id), {
				ticketTypeId: ticketType._id,
				ticketTypeName: ticketType.ticketTypeName,
				currency: ticketType.ticketCurrency,
				ticketsSold: 0,
				revenue: 0,
				commission: 0,
				netPayout: 0,
			});
		}
		for (const row of rows) {
			const key = String(row._id.ticketTypeId);
			const entry = byType.get(key) ?? {
				ticketTypeId: row._id.ticketTypeId,
				ticketTypeName: row.ticketTypeData?.ticketTypeName,
				currency: row._id.currency,
				ticketsSold: 0,
				revenue: 0,
				commission: 0,
				netPayout: 0,
			};
			entry.ticketsSold += row.ticketsSold;
			entry.revenue = roundMoney(entry.revenue + row.revenue);
			entry.commission = roundMoney(entry.commission + (row.revenue * row._id.commissionRate) / 100);
			entry.netPayout = roundMoney(entry.revenue - entry.commission);
			byType.set(key, entry);
		}
		return { eventId: eventId, ticketTypes: [...byType.values()] };
	}

	/** who bought what, paged; refunded tickets are left out unless asked for */
	public async getEventAttendees(organizerId: ObjectId, input: AttendeesInquiry): Promise<Attendees> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		await this.assertOwner(organizerId, eventId);

		const match: T = { eventId: eventId };
		match.ticketStatus = input.ticketStatus ?? { $in: [TicketStatus.VALID, TicketStatus.USED] };

		const result = await this.ticketModel
			.aggregate([
				{ $match: match },
				{ $sort: { createdAt: 1, _id: 1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $lookup: { from: 'members', localField: 'ownerId', foreignField: '_id', as: 'buyer' } },
							{ $lookup: { from: 'ticketTypes', localField: 'ticketTypeId', foreignField: '_id', as: 'ticketType' } },
							{ $lookup: { from: 'eventSeats', localField: 'seatId', foreignField: '_id', as: 'seatData' } },
							{ $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
							{
								$project: {
									_id: 0,
									ticketId: '$_id',
									ticketCode: 1,
									ticketStatus: 1,
									checkedInAt: 1,
									buyerName: { $ifNull: [{ $arrayElemAt: ['$buyer.memberFullName', 0] }, { $arrayElemAt: ['$buyer.memberNick', 0] }] },
									ticketTypeName: { $arrayElemAt: ['$ticketType.ticketTypeName', 0] },
									seat: { $arrayElemAt: ['$seatData', 0] },
									orderNumber: { $arrayElemAt: ['$order.orderNumber', 0] },
								},
							},
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		const page = result[0] ?? { list: [], metaCounter: [] };
		page.list = page.list.map((row: any) => ({ ...row, buyerName: row.buyerName ?? '' }));
		return page;
	}

	/** the organizer's totals over all their events, one entry per currency */
	public async getMyEarnings(organizerId: ObjectId): Promise<MyEarnings> {
		const events = await this.eventModel.find({ organizerId: organizerId }).select('_id').lean().exec();
		const eventIds = events.map((event) => event._id);
		if (!eventIds.length) return { earnings: [] };

		const rows = await this.orderModel
			.aggregate([
				{ $match: { eventId: { $in: eventIds }, orderStatus: { $in: [OrderStatus.PAID, OrderStatus.REFUNDED] } } },
				{
					$group: {
						_id: { currency: '$currency', commissionRate: '$commissionRate', orderStatus: '$orderStatus' },
						ordersCount: { $sum: 1 },
						amount: { $sum: '$totalAmount' },
						ticketsSold: { $sum: { $sum: '$items.quantity' } },
					},
				},
			])
			.exec();

		const byCurrency = new Map<string, MyEarnings['earnings'][number]>();
		for (const row of rows) {
			const key = String(row._id.currency ?? '');
			const entry = byCurrency.get(key) ?? {
				currency: row._id.currency,
				ordersCount: 0,
				ticketsSold: 0,
				revenue: 0,
				commission: 0,
				netPayout: 0,
				refundedAmount: 0,
			};
			if (row._id.orderStatus === OrderStatus.REFUNDED) {
				entry.refundedAmount = roundMoney(entry.refundedAmount + row.amount);
			} else {
				entry.ordersCount += row.ordersCount;
				entry.ticketsSold += row.ticketsSold;
				entry.revenue = roundMoney(entry.revenue + row.amount);
				entry.commission = roundMoney(entry.commission + (row.amount * row._id.commissionRate) / 100);
				entry.netPayout = roundMoney(entry.revenue - entry.commission);
			}
			byCurrency.set(key, entry);
		}
		return { earnings: [...byCurrency.values()] };
	}

	/** only the organizer who owns the event; anyone else gets the same answer as for an event that does not exist */
	private async assertOwner(organizerId: ObjectId, eventId: ObjectId): Promise<void> {
		const owned = await this.eventModel.exists({ _id: eventId, organizerId: organizerId });
		if (!owned) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
	}
}
