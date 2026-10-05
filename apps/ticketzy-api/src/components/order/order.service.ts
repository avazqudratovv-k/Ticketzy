import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { randomBytes } from 'crypto';
import * as moment from 'moment';
import { Order, Orders } from '../../libs/dto/order/order';
import { OrderInput, OrdersInquiry } from '../../libs/dto/order/order.input';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { Direction, Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { OrderStatus, PaymentProvider, PaymentStatus, TicketStatus } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { lookupEvent, shapeIntoMongoObjectId } from '../../libs/config';
import { TicketTypeService } from '../ticket-type/ticket-type.service';

/** how long a PENDING order holds its stock before the batch releases it */
export const ORDER_HOLD_MINUTES = 15;

@Injectable()
export class OrderService {
	constructor(
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Payment') private readonly paymentModel: Model<any>,
		private readonly ticketTypeService: TicketTypeService,
	) {}

	public async createOrder(memberId: ObjectId, input: OrderInput): Promise<Order> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		const now = new Date();

		const event = await this.eventModel.findOne({ _id: eventId, eventStatus: EventStatus.ON_SALE }).lean().exec();
		if (!event) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (moment(event.endAt).isBefore(now)) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (event.saleStartAt && moment(event.saleStartAt).isAfter(now)) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (event.saleEndAt && moment(event.saleEndAt).isBefore(now)) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		const ids = input.items.map((item) => String(item.ticketTypeId));
		if (new Set(ids).size !== ids.length) throw new BadRequestException(Message.BAD_REQUEST);

		const reserved: { ticketTypeId: ObjectId; quantity: number; unitPrice: number }[] = [];
		let currency: string = null;
		try {
			for (const item of input.items) {
				const ticketTypeId = shapeIntoMongoObjectId(item.ticketTypeId);
				const ticketType = await this.ticketTypeService.reserve(ticketTypeId, item.quantity);
				if (!ticketType) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
				reserved.push({ ticketTypeId, quantity: item.quantity, unitPrice: ticketType.ticketPrice });

				if (String(ticketType.eventId) !== String(eventId)) throw new BadRequestException(Message.BAD_REQUEST);
				if (currency && currency !== ticketType.ticketCurrency) throw new BadRequestException(Message.BAD_REQUEST);
				currency = ticketType.ticketCurrency;
			}

			const totalAmount = reserved.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
			return await this.orderModel.create({
				orderNumber: this.generateOrderNumber(),
				buyerId: memberId,
				eventId: eventId,
				items: reserved,
				totalAmount: totalAmount,
				expiresAt: moment().add(ORDER_HOLD_MINUTES, 'minutes').toDate(),
			});
		} catch (err) {
			// give every reservation made so far back
			await Promise.all(reserved.map((item) => this.ticketTypeService.release(item.ticketTypeId, item.quantity)));
			if (err instanceof BadRequestException) throw err;
			console.log('Error, Service.model:', err.message);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	/** Manual/stub payment: flips PENDING to PAID in one conditional update, then issues the tickets. */
	public async payOrder(memberId: ObjectId, orderId: ObjectId): Promise<Order> {
		const order = await this.orderModel
			.findOneAndUpdate(
				{ _id: orderId, buyerId: memberId, orderStatus: OrderStatus.PENDING, expiresAt: { $gt: new Date() } },
				{ orderStatus: OrderStatus.PAID, paidAt: new Date() },
				{ new: true },
			)
			.exec();
		if (!order) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		try {
			await this.paymentModel.create({
				orderId: order._id,
				paymentProvider: PaymentProvider.MANUAL,
				providerRef: `MANUAL-${order.orderNumber}`,
				paymentStatus: PaymentStatus.CAPTURED,
				amount: order.totalAmount,
			});

			const tickets = [];
			for (const item of order.items) {
				for (let i = 0; i < item.quantity; i++) {
					tickets.push({
						ticketCode: this.generateTicketCode(),
						ticketStatus: TicketStatus.VALID,
						orderId: order._id,
						ticketTypeId: item.ticketTypeId,
						eventId: order.eventId,
						ownerId: order.buyerId,
					});
				}
			}
			await this.ticketModel.insertMany(tickets);
			return order;
		} catch (err) {
			console.log('Error, Service.model:', err.message);
			// undo so the buyer can retry while the hold is still valid
			await this.ticketModel.deleteMany({ orderId: order._id }).exec();
			await this.paymentModel.deleteMany({ orderId: order._id }).exec();
			await this.orderModel
				.updateOne({ _id: order._id, orderStatus: OrderStatus.PAID }, { orderStatus: OrderStatus.PENDING, paidAt: null })
				.exec();
			throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		}
	}

	public async cancelOrder(memberId: ObjectId, orderId: ObjectId): Promise<Order> {
		const order = await this.orderModel
			.findOneAndUpdate(
				{ _id: orderId, buyerId: memberId, orderStatus: OrderStatus.PENDING },
				{ orderStatus: OrderStatus.CANCELLED },
				{ new: true },
			)
			.exec();
		if (!order) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		await Promise.all(order.items.map((item) => this.ticketTypeService.release(item.ticketTypeId, item.quantity)));
		return order;
	}

	public async getOrder(memberId: ObjectId, orderId: ObjectId): Promise<Order> {
		const result = await this.orderModel.findOne({ _id: orderId, buyerId: memberId }).exec();
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result;
	}

	public async getMyOrders(memberId: ObjectId, input: OrdersInquiry): Promise<Orders> {
		const match: T = { buyerId: shapeIntoMongoObjectId(memberId) };
		if (input.orderStatus) match.orderStatus = input.orderStatus;
		return await this.listOrders(match, input);
	}

	/** ADMIN */

	public async getAllOrdersByAdmin(input: OrdersInquiry): Promise<Orders> {
		const match: T = {};
		if (input.orderStatus) match.orderStatus = input.orderStatus;
		return await this.listOrders(match, input);
	}

	private async listOrders(match: T, input: OrdersInquiry): Promise<Orders> {
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		const result = await this.orderModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupEvent,
							{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	private generateOrderNumber(): string {
		return `TZ-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`.toUpperCase();
	}

	/** random, not sequential, so codes cannot be guessed */
	private generateTicketCode(): string {
		return randomBytes(10).toString('hex').toUpperCase();
	}
}
