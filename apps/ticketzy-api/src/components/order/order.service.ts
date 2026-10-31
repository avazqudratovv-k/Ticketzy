import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { GraphQLError } from 'graphql';
import { Model, ObjectId, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import * as moment from 'moment';
import { AdminOrders, Order, Orders, OrganizerOrders } from '../../libs/dto/order/order';
import { AdminOrdersInquiry, CheckoutInput, OrdersInquiry, OrganizerOrdersInquiry } from '../../libs/dto/order/order.input';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus } from '../../libs/enums/member.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { RefundPolicyType, SeatingType, publicEventStatus } from '../../libs/enums/event.enum';
import { readRefundPolicy } from '../../libs/refund-policy';
import { OrderStatus, PaymentSimulation, TicketStatus } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { escapeRegExp, lookupEvent, lookupEventWithVenue, shapeIntoMongoObjectId } from '../../libs/config';
import { calculateOrderAmounts, getCommissionRate } from '../../libs/commission';
import { getPaymentMode, getSeatHoldSeconds } from '../../libs/env.validation';
import { assertBuyerAccount, assertVerifiedEmail } from '../../libs/buyer';
import { buildQrToken } from '../../libs/qr-token';
import { TicketTypeService } from '../ticket-type/ticket-type.service';
import { NotificationService } from '../notification/notification.service';
import { SeatService } from '../seat/seat.service';
import { PaymentService } from '../payment/payment.service';
import { ChargeResult } from '../payment/payment.provider';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';

interface OrderLine {
	ticketTypeId: ObjectId;
	quantity: number;
	unitPrice: number;
}

import { getPurchaseWindowError } from '../../libs/sales-window';
import { isEventEnded } from '../../libs/event-visibility';

@Injectable()
export class OrderService {
	private readonly logger = new Logger(OrderService.name);

	constructor(
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		private readonly ticketTypeService: TicketTypeService,
		private readonly seatService: SeatService,
		private readonly paymentService: PaymentService,
		private readonly notificationService: NotificationService,
	) {}

	/**
	 * Creates a PENDING_PAYMENT order. RESERVED events: the buyer's held seats (priced from their ticket types).
	 * GENERAL events: ticket quantities, reserved with the conditional stock update. Prices, commission and the total are
	 * always computed here; nothing numeric comes from the client.
	 */
	public async createCheckout(memberId: ObjectId, input: CheckoutInput): Promise<Order> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		const now = new Date();

		const buyer = await this.memberModel.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE }).select('memberType emailVerifiedAt').lean().exec();
		if (!buyer) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		assertBuyerAccount(buyer.memberType);
		assertVerifiedEmail(buyer);

		const event = await this.eventModel.findOne({ _id: eventId, eventStatus: publicEventStatus }).lean().exec();
		if (!event) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		// tickets of an event whose organizer is not ACTIVE cannot be bought
		const organizer = await this.memberModel
			.findOne({ _id: event.organizerId, memberStatus: MemberStatus.ACTIVE })
			.select('completedEvents commissionOverride')
			.lean()
			.exec();
		if (!organizer) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		const windowError = getPurchaseWindowError(event, now);
		if (windowError) throw new BadRequestException(windowError);

		// a non-refundable event needs the buyer's explicit confirmation, checked here and not only in the UI (#129)
		const policy = readRefundPolicy(event);
		if (policy.policyType === RefundPolicyType.NON_REFUNDABLE && input.acknowledgeNonRefundable !== true) {
			throw new BadRequestException(Message.NON_REFUNDABLE_ACK_REQUIRED);
		}

		const commissionRate = getCommissionRate(organizer, now);
		return event.seatingType === SeatingType.RESERVED
			? await this.checkoutSeats(memberId, event, input, commissionRate)
			: await this.checkoutQuantities(memberId, event, input, commissionRate);
	}

	private async checkoutSeats(memberId: ObjectId, event: Event, input: CheckoutInput, commissionRate: number): Promise<Order> {
		if (input.items?.length || !input.seatIds?.length) throw new BadRequestException(Message.CHECKOUT_RESERVED_NEEDS_SEATS);
		if (moment(event.startAt).isBefore(new Date())) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		const seatIds = this.seatService.normalizeSeatIds(input.seatIds);
		const seats = await this.seatService.findHeldSeats(memberId, event._id, seatIds);
		if (!seats) throw new BadRequestException(Message.HOLD_EXPIRED);

		const typeIds = [...new Set(seats.map((seat) => String(seat.ticketTypeId)))].map((id) => shapeIntoMongoObjectId(id));
		const ticketTypes = await this.ticketTypeService.findSellable(typeIds);
		if (ticketTypes.length !== typeIds.length) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		const lines: OrderLine[] = [];
		let currency: string = null;
		for (const ticketType of ticketTypes) {
			if (String(ticketType.eventId) !== String(event._id)) throw new BadRequestException(Message.BAD_REQUEST);
			if (currency && currency !== ticketType.ticketCurrency) throw new BadRequestException(Message.BAD_REQUEST);
			currency = ticketType.ticketCurrency;
			const quantity = seats.filter((seat) => String(seat.ticketTypeId) === String(ticketType._id)).length;
			lines.push({ ticketTypeId: ticketType._id, quantity, unitPrice: ticketType.ticketPrice });
		}

		// the order lives exactly as long as the shortest hold
		const expiresAt = new Date(Math.min(...seats.map((seat) => new Date(seat.heldUntil).getTime())));
		try {
			return await this.createOrderDocument(memberId, event, lines, commissionRate, currency, expiresAt, seatIds);
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	private async checkoutQuantities(memberId: ObjectId, event: Event, input: CheckoutInput, commissionRate: number): Promise<Order> {
		if (input.seatIds?.length || !input.items?.length) throw new BadRequestException(Message.CHECKOUT_GENERAL_NEEDS_ITEMS);

		const ids = input.items.map((item) => String(item.ticketTypeId));
		if (new Set(ids).size !== ids.length) throw new BadRequestException(Message.BAD_REQUEST);

		const reserved: OrderLine[] = [];
		let currency: string = null;
		try {
			for (const item of input.items) {
				const ticketTypeId = shapeIntoMongoObjectId(item.ticketTypeId);
				const ticketType = await this.ticketTypeService.reserve(ticketTypeId, item.quantity);
				if (!ticketType) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
				reserved.push({ ticketTypeId, quantity: item.quantity, unitPrice: ticketType.ticketPrice });

				if (String(ticketType.eventId) !== String(event._id)) throw new BadRequestException(Message.BAD_REQUEST);
				if (currency && currency !== ticketType.ticketCurrency) throw new BadRequestException(Message.BAD_REQUEST);
				currency = ticketType.ticketCurrency;
			}

			const expiresAt = moment().add(getSeatHoldSeconds(), 'seconds').toDate();
			return await this.createOrderDocument(memberId, event, reserved, commissionRate, currency, expiresAt, []);
		} catch (err) {
			// give every reservation made so far back
			await Promise.all(reserved.map((item) => this.ticketTypeService.release(item.ticketTypeId, item.quantity)));
			if (err instanceof BadRequestException) throw err;
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	private async createOrderDocument(
		memberId: ObjectId,
		event: Event,
		items: OrderLine[],
		commissionRate: number,
		currency: string,
		expiresAt: Date,
		seatIds: ObjectId[],
	): Promise<Order> {
		const policy = readRefundPolicy(event);
		const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
		const amounts = calculateOrderAmounts(subtotal, commissionRate);
		return await this.orderModel.create({
			orderNumber: this.generateOrderNumber(),
			buyerId: memberId,
			eventId: event._id,
			items: items,
			seatIds: seatIds,
			currency: currency,
			subtotal: amounts.subtotal,
			commissionRate: amounts.commissionRate,
			commissionAmount: amounts.commissionAmount,
			totalAmount: amounts.total,
			// the policy of the moment is kept on the order, so a later edit of the event cannot take a refund away
			refundPolicy: policy,
			...(policy.policyType === RefundPolicyType.NON_REFUNDABLE ? { nonRefundableAcknowledgedAt: new Date() } : {}),
			expiresAt: expiresAt,
		});
	}

	/**
	 * Pays through the PaymentProvider (the mock decides by `simulate`). Idempotent: a PAID order is returned as it is.
	 * SUCCESS: seats become SOLD (all or nothing), the order PAID, the Payment recorded, one Ticket issued per seat or quantity.
	 * FAILURE: seats or stock are released and the order is FAILED.
	 */
	public async payOrder(memberId: ObjectId, orderId: ObjectId, simulate: PaymentSimulation): Promise<Order> {
		// PAYMENT_MODE=disabled turns every payment off; `simulated` is the mock below (DECISIONS #92)
		if (getPaymentMode() === 'disabled') {
			throw new GraphQLError(Message.PAYMENTS_DISABLED, { extensions: { code: 'SERVICE_UNAVAILABLE' } });
		}
		const payer = await this.memberModel.findOne({ _id: memberId }).select('memberType emailVerifiedAt').lean().exec();
		assertBuyerAccount(payer?.memberType);
		assertVerifiedEmail(payer);
		const order = await this.orderModel.findOne({ _id: orderId, buyerId: memberId }).lean().exec();
		if (!order) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (order.orderStatus === OrderStatus.PAID) return order;
		if (order.orderStatus !== OrderStatus.PENDING_PAYMENT) throw new BadRequestException(Message.ORDER_NOT_PAYABLE);
		if (new Date(order.expiresAt) <= new Date()) {
			await this.expireOrder(order);
			throw new BadRequestException(Message.HOLD_EXPIRED);
		}
		// an order started before the event ended cannot be paid after it (#121); the batch job releases its stock
		const orderEvent = await this.eventModel.findOne({ _id: order.eventId }).select('eventStatus endAt').lean().exec();
		if (orderEvent && isEventEnded(orderEvent)) throw new BadRequestException(Message.EVENT_ENDED_NO_SALES);

		const charge = await this.paymentService.charge(order, simulate);
		if (!charge.success) return await this.failOrder(order, charge);

		// seats first: the conditional updates decide who really gets them
		let soldSeats: { _id: ObjectId; ticketTypeId: ObjectId }[] = [];
		if (order.seatIds?.length) {
			try {
				soldSeats = await this.seatService.markSold(memberId, order._id, order.seatIds);
			} catch (err) {
				await this.refundQuietly(charge);
				// a parallel payOrder of the same order may have won: that is the idempotent answer
				const current = await this.orderModel.findOne({ _id: orderId, buyerId: memberId }).lean().exec();
				if (current?.orderStatus === OrderStatus.PAID) return current;
				throw err;
			}
		}

		const paid = await this.orderModel
			.findOneAndUpdate(
				{ _id: order._id, buyerId: memberId, orderStatus: OrderStatus.PENDING_PAYMENT },
				{ orderStatus: OrderStatus.PAID, paidAt: new Date() },
				{ new: true },
			)
			.exec();
		if (!paid) {
			// cancelled or expired while the payment ran
			await this.seatService.revertSold(order._id, order.seatIds ?? []);
			await this.refundQuietly(charge);
			const current = await this.orderModel.findOne({ _id: orderId, buyerId: memberId }).lean().exec();
			if (current?.orderStatus === OrderStatus.PAID) return current;
			throw new BadRequestException(Message.HOLD_EXPIRED);
		}

		// reserved seats count in soldQuantity once they are sold (holds never do)
		let counted: { ticketTypeId: ObjectId; quantity: number }[] = [];
		try {
			counted = await this.ticketTypeService.addSold(this.countByTicketType(soldSeats));
			await this.paymentService.record(paid, charge);
			await this.ticketModel.insertMany(this.buildTickets(paid, soldSeats));
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			// undo so the buyer can retry while the hold is still valid
			await Promise.all(counted.map((count) => this.ticketTypeService.release(count.ticketTypeId, count.quantity)));
			await this.ticketModel.deleteMany({ orderId: paid._id }).exec();
			await this.paymentService.deleteRecords(paid);
			await this.orderModel
				.updateOne({ _id: paid._id, orderStatus: OrderStatus.PAID }, { orderStatus: OrderStatus.PENDING_PAYMENT, paidAt: null })
				.exec();
			await this.seatService.revertSold(paid._id, paid.seatIds ?? []);
			await this.refundQuietly(charge);
			throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		}

		// outside the try above: a notification problem must never undo a payment
		await this.notifyOrderPaid(paid);
		return paid;
	}

	private countByTicketType(seats: { ticketTypeId: ObjectId }[]): { ticketTypeId: ObjectId; quantity: number }[] {
		const counts = new Map<string, { ticketTypeId: ObjectId; quantity: number }>();
		for (const seat of seats) {
			const key = String(seat.ticketTypeId);
			const count = counts.get(key) ?? { ticketTypeId: seat.ticketTypeId, quantity: 0 };
			count.quantity += 1;
			counts.set(key, count);
		}
		return [...counts.values()];
	}

	/** one Ticket per seat (RESERVED) or per purchased quantity (GENERAL), each with its own signed QR token */
	private buildTickets(order: Order, seats: { _id: ObjectId; ticketTypeId: ObjectId }[]): any[] {
		const base = { ticketStatus: TicketStatus.VALID, orderId: order._id, eventId: order.eventId, ownerId: order.buyerId };
		const make = (ticketTypeId: ObjectId, seatId?: ObjectId) => {
			const _id = new Types.ObjectId();
			return { ...base, _id, ticketTypeId, seatId, ticketCode: this.generateTicketCode(), qrToken: buildQrToken(_id) };
		};
		if (seats.length) return seats.map((seat) => make(seat.ticketTypeId, seat._id));
		return order.items.flatMap((item) => Array.from({ length: item.quantity }, () => make(item.ticketTypeId)));
	}

	/** the provider declined: the hold or stock goes back and the order is FAILED */
	private async failOrder(order: Order, charge: ChargeResult): Promise<Order> {
		const failed = await this.orderModel
			.findOneAndUpdate({ _id: order._id, orderStatus: OrderStatus.PENDING_PAYMENT }, { orderStatus: OrderStatus.FAILED }, { new: true })
			.exec();
		if (!failed) throw new BadRequestException(Message.ORDER_NOT_PAYABLE);
		await this.releaseResources(failed);
		try {
			await this.paymentService.record(failed, charge);
		} catch (err) {
			this.logger.error(`Failed payment of ${failed.orderNumber} was not recorded: ${err.message}`);
		}
		return failed;
	}

	/** PENDING_PAYMENT past its expiry becomes EXPIRED, once, and gives its seats or stock back */
	private async expireOrder(order: Order): Promise<void> {
		const expired = await this.orderModel
			.findOneAndUpdate(
				{ _id: order._id, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: { $lte: new Date() } },
				{ orderStatus: OrderStatus.EXPIRED },
				{ new: true },
			)
			.exec();
		if (expired) await this.releaseResources(expired);
	}

	/** reserved orders hold seats, general orders hold stock; the order says which */
	private async releaseResources(order: Order): Promise<void> {
		if (order.seatIds?.length) {
			await this.seatService.releaseOrderSeats(order.buyerId, order.seatIds);
			return;
		}
		await Promise.all(order.items.map((item) => this.ticketTypeService.release(item.ticketTypeId, item.quantity)));
	}

	private async refundQuietly(charge: ChargeResult): Promise<void> {
		try {
			await this.paymentService.refund(charge.providerRef);
		} catch (err) {
			this.logger.error(`REFUND NEEDED for ${charge.providerRef}: ${err.message}`);
		}
	}

	/** buyer gets a receipt, the event's organizer hears about the sale */
	private async notifyOrderPaid(order: Order): Promise<void> {
		const common = {
			notificationType: NotificationType.ORDER_PAID,
			notificationGroup: NotificationGroup.ORDER,
			orderId: order._id,
			eventId: order.eventId,
		};
		await this.notificationService.createNotification({
			...common,
			notificationTitle: 'Payment received',
			notificationDesc: order.orderNumber,
			authorId: order.buyerId,
			receiverId: order.buyerId,
		});

		const event = await this.eventModel.findOne({ _id: order.eventId }).lean().exec();
		if (event) {
			await this.notificationService.createNotification({
				...common,
				notificationTitle: 'New ticket sale',
				notificationDesc: order.orderNumber,
				authorId: order.buyerId,
				receiverId: event.organizerId,
			});
		}
	}

	public async cancelPendingOrder(memberId: ObjectId, orderId: ObjectId): Promise<Order> {
		const order = await this.orderModel
			.findOneAndUpdate(
				{ _id: orderId, buyerId: memberId, orderStatus: OrderStatus.PENDING_PAYMENT },
				{ orderStatus: OrderStatus.CANCELLED },
				{ new: true },
			)
			.exec();
		if (!order) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		await this.releaseResources(order);
		return order;
	}

	/**
	 * Account deletion (#123): every unpaid order of the buyer becomes CANCELLED and gives its seats or stock back. Paid orders
	 * are not touched. Each order is one conditional update (PENDING_PAYMENT only), so a payment that wins the race keeps its
	 * order; an order that fails to release is logged and left for the expiry job, which frees it within the hold time.
	 */
	public async cancelAllPendingOrdersOf(memberId: ObjectId): Promise<number> {
		const pending = await this.orderModel.find({ buyerId: memberId, orderStatus: OrderStatus.PENDING_PAYMENT }).lean().exec();
		let cancelled = 0;
		for (const candidate of pending) {
			const order = await this.orderModel
				.findOneAndUpdate({ _id: candidate._id, buyerId: memberId, orderStatus: OrderStatus.PENDING_PAYMENT }, { orderStatus: OrderStatus.CANCELLED }, { new: true })
				.exec();
			if (!order) continue;
			cancelled++;
			try {
				await this.releaseResources(order);
			} catch (err) {
				this.logger.error(`Resources of cancelled order ${order._id} not released: ${(err as Error)?.message ?? 'error'}`);
			}
		}
		return cancelled;
	}

	/**
	 * The buyer's own abandoned checkouts become EXPIRED (and give their seats or stock back) when the buyer looks at their
	 * orders, so an old PENDING_PAYMENT never shows up after its time even when the batch app is asleep (DECISIONS #102).
	 * Same conditional update as `payOrder` uses, so repeating it is harmless; a failure here never fails the read.
	 */
	private async expireStaleOrdersOf(memberId: ObjectId): Promise<void> {
		try {
			const stale = await this.orderModel
				.find({ buyerId: memberId, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: { $lte: new Date() } })
				.limit(20)
				.lean()
				.exec();
			for (const order of stale) await this.expireOrder(order);
		} catch (err) {
			this.logger.warn(`Stale order sweep failed: ${(err as Error)?.message ?? 'error'}`);
		}
	}

	public async getOrder(memberId: ObjectId, orderId: ObjectId): Promise<Order> {
		await this.expireStaleOrdersOf(memberId);
		const result = await this.orderModel
			.aggregate([
				{ $match: { _id: shapeIntoMongoObjectId(orderId), buyerId: shapeIntoMongoObjectId(memberId) } },
				lookupEventWithVenue,
				{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	public async getMyOrders(memberId: ObjectId, input: OrdersInquiry): Promise<Orders> {
		await this.expireStaleOrdersOf(memberId);
		const match: T = { buyerId: shapeIntoMongoObjectId(memberId) };
		if (input.orderStatus) match.orderStatus = input.orderStatus;
		return await this.listOrders(match, input);
	}

	/** ADMIN */

	/**
	 * Filters: event, status, buyer text (nickname, full name or email) and a createdAt range. The buyer text is turned
	 * into buyer ids first, so the order match stays one indexed $match. Each order carries the buyer's nickname and email
	 * and the event title; pagination is the same facet as the other order lists.
	 */
	public async getAllOrdersByAdmin(input: AdminOrdersInquiry): Promise<AdminOrders> {
		if (input.dateFrom && input.dateTo && input.dateFrom.getTime() > input.dateTo.getTime()) {
			throw new BadRequestException(Message.INVALID_ORDER_DATE_RANGE);
		}

		const match: T = {};
		if (input.orderStatus) match.orderStatus = input.orderStatus;
		if (input.eventId) match.eventId = shapeIntoMongoObjectId(input.eventId);
		if (input.dateFrom || input.dateTo) {
			match.createdAt = {};
			if (input.dateFrom) match.createdAt.$gte = input.dateFrom;
			if (input.dateTo) match.createdAt.$lte = input.dateTo;
		}
		const text = input.text?.trim();
		if (text) {
			const regex = { $regex: new RegExp(escapeRegExp(text), 'i') };
			const buyers = await this.memberModel
				.find({ $or: [{ memberNick: regex }, { memberFullName: regex }, { memberEmail: regex }] })
				.select('_id')
				.lean()
				.exec();
			match.buyerId = { $in: buyers.map((buyer) => buyer._id) };
		}

		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC, _id: -1 };
		const result = await this.orderModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupEventWithVenue,
							{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
							{
								$lookup: {
									from: 'members',
									let: { buyerId: '$buyerId' },
									pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$buyerId'] } } }, { $project: { memberNick: 1, memberEmail: 1 } }],
									as: 'buyer',
								},
							},
							{
								$addFields: {
									buyerNick: { $arrayElemAt: ['$buyer.memberNick', 0] },
									buyerEmail: { $arrayElemAt: ['$buyer.memberEmail', 0] },
									eventTitle: '$eventData.eventTitle',
								},
							},
							{ $project: { buyer: 0 } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	/**
	 * Orders on the organizer's own events only. A foreign or unknown eventId is refused, so the filter cannot be used
	 * to probe other organizers' events. The buyer is reduced to a nickname in the pipeline itself.
	 */
	public async getMyEventOrders(organizerId: ObjectId, input: OrganizerOrdersInquiry): Promise<OrganizerOrders> {
		const match: T = {};
		if (input.eventId) {
			const eventId = shapeIntoMongoObjectId(input.eventId);
			const owned = await this.eventModel.exists({ _id: eventId, organizerId: organizerId });
			if (!owned) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
			match.eventId = eventId;
		} else {
			const own = await this.eventModel.find({ organizerId: organizerId }).select('_id').lean().exec();
			match.eventId = { $in: own.map((event) => event._id) };
		}
		if (input.orderStatus) match.orderStatus = input.orderStatus;

		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC, _id: -1 };
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
							{
								$lookup: {
									from: 'members',
									let: { buyerId: '$buyerId' },
									pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$buyerId'] } } }, { $project: { memberNick: 1 } }],
									as: 'buyer',
								},
							},
							{
								$lookup: {
									from: 'eventSeats',
									let: { seatIds: '$seatIds' },
									pipeline: [
										{ $match: { $expr: { $in: ['$_id', { $ifNull: ['$$seatIds', []] }] } } },
										{ $sort: { sectionKey: 1, row: 1, number: 1 } },
										{ $project: { _id: 0, sectionKey: 1, row: 1, number: 1 } },
									],
									as: 'seats',
								},
							},
							{
								$addFields: {
									buyerNick: { $arrayElemAt: ['$buyer.memberNick', 0] },
									ticketCount: { $sum: '$items.quantity' },
								},
							},
							{ $project: { buyer: 0, buyerId: 0, seatIds: 0 } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
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
							lookupEventWithVenue,
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
