import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Order } from '../../libs/dto/order/order';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { Venue } from '../../libs/dto/venue/venue';
import { Refund, RefundQuote, RefundSummary } from '../../libs/dto/refund/refund';
import { AdminRefundInput } from '../../libs/dto/refund/refund.input';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { OrderStatus, RefundSource, RefundStatus, TicketStatus } from '../../libs/enums/ticket.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { getRefundDeadline } from '../../libs/refund-policy';
import { PaymentService } from '../payment/payment.service';
import { SeatService } from '../seat/seat.service';
import { TicketTypeService } from '../ticket-type/ticket-type.service';
import { NotificationService } from '../notification/notification.service';
import { AuditLogService } from '../audit-log/audit-log.service';

export const REFUND_BATCH_SIZE = 50;
/** a PENDING refund whose run has been silent this long is taken to be dead and may be resumed */
export const REFUND_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_TIMEZONE = 'Asia/Seoul';

interface Assessment {
	refundable: boolean;
	reason?: Message;
	deadline: Date;
	venueTimezone: string;
	/** the event was cancelled: every ticket is refunded and nothing goes back on sale */
	cancelled: boolean;
	pastDeadline: boolean;
}

interface RefundRun {
	source: RefundSource;
	actorId: ObjectId;
	reason?: string;
	/** the organizer is told once per cancelled event, not once per order */
	notifyOrganizer: boolean;
}

/**
 * Refunds. The unit is the whole order. Every step is conditional or idempotent, and the Refund record (one per order,
 * unique) says who owns the run, so a double click, a parallel request or a re-run after a crash cannot refund twice.
 */
@Injectable()
export class RefundService {
	private readonly logger = new Logger(RefundService.name);

	constructor(
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Venue') private readonly venueModel: Model<Venue>,
		@InjectModel('Refund') private readonly refundModel: Model<Refund>,
		private readonly paymentService: PaymentService,
		private readonly seatService: SeatService,
		private readonly ticketTypeService: TicketTypeService,
		private readonly notificationService: NotificationService,
		private readonly auditLogService: AuditLogService,
	) {}

	/** BUYER */

	public async getRefundQuote(buyerId: ObjectId, orderId: ObjectId): Promise<RefundQuote> {
		const order = await this.orderModel.findOne({ _id: orderId, buyerId: buyerId }).lean().exec();
		if (!order) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const { event, venue } = await this.loadEventAndVenue(order);
		const tickets = await this.ticketModel.find({ orderId: order._id }).lean().exec();
		const assessment = this.assess(order, event, venue, tickets, new Date(), false);
		return {
			orderId: order._id,
			refundable: assessment.refundable,
			deadline: assessment.deadline,
			venueTimezone: assessment.venueTimezone,
			refundableAmount: assessment.refundable ? order.totalAmount : 0,
			currency: order.currency,
			reason: assessment.reason,
		};
	}

	/** Refunding a refunded order returns it unchanged. */
	public async requestRefund(buyerId: ObjectId, orderId: ObjectId, reason?: string): Promise<Order> {
		const order = await this.orderModel.findOne({ _id: orderId, buyerId: buyerId }).lean().exec();
		if (!order) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (order.orderStatus === OrderStatus.REFUNDED) return order;

		const { event, venue } = await this.loadEventAndVenue(order);
		const tickets = await this.ticketModel.find({ orderId: order._id }).lean().exec();
		const assessment = this.assess(order, event, venue, tickets, new Date(), false);
		if (!assessment.refundable) throw new BadRequestException(assessment.reason);

		return await this.processRefund(order, tickets, assessment, {
			source: RefundSource.BUYER,
			actorId: buyerId,
			reason: reason?.trim() || undefined,
			notifyOrganizer: true,
		});
	}

	/** ADMIN */

	/** An admin may refund after the deadline, but never an order with a checked-in ticket. Always audited. */
	public async refundOrderByAdmin(adminId: ObjectId, input: AdminRefundInput): Promise<Order> {
		const reason = input.reason?.trim();
		if (!reason) throw new BadRequestException(Message.REFUND_REASON_REQUIRED);

		const order = await this.orderModel.findOne({ _id: input.orderId }).lean().exec();
		if (!order) throw new BadRequestException(Message.NO_DATA_FOUND);
		if (order.orderStatus === OrderStatus.REFUNDED) return order;

		const { event, venue } = await this.loadEventAndVenue(order);
		const tickets = await this.ticketModel.find({ orderId: order._id }).lean().exec();
		const assessment = this.assess(order, event, venue, tickets, new Date(), true);
		if (!assessment.refundable) throw new BadRequestException(assessment.reason);

		const result = await this.processRefund(order, tickets, assessment, {
			source: RefundSource.ADMIN,
			actorId: adminId,
			reason: reason,
			notifyOrganizer: true,
		});
		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.ORDER_REFUNDED_BY_ADMIN,
			targetType: AuditTargetType.ORDER,
			targetId: order._id,
			meta: { reason: reason, amount: order.totalAmount, afterDeadline: assessment.pastDeadline },
		});
		return result;
	}

	/**
	 * Refunds every PAID order of a cancelled event, in batches, and goes on past a single failure.
	 * Nothing goes back on sale. Safe to run again: refunded orders are no longer PAID, and a failed or abandoned
	 * refund is picked up again. Never throws for an order; a problem with one order is counted and logged.
	 */
	public async refundOrdersForCancelledEvent(adminId: ObjectId, event: Event): Promise<RefundSummary> {
		const summary: RefundSummary = { eventId: event._id, refundedCount: 0, failedCount: 0, totalCount: 0, failedOrderIds: [] };
		const assessment: Assessment = {
			refundable: true,
			deadline: new Date(),
			venueTimezone: DEFAULT_TIMEZONE,
			cancelled: true,
			pastDeadline: false,
		};

		let after: ObjectId | null = null;
		for (;;) {
			const filter: Record<string, any> = { eventId: event._id, orderStatus: OrderStatus.PAID };
			if (after) filter._id = { $gt: after };
			const batch = await this.orderModel.find(filter).sort({ _id: 1 }).limit(REFUND_BATCH_SIZE).lean().exec();
			if (!batch.length) break;

			for (const order of batch) {
				summary.totalCount += 1;
				try {
					const tickets = await this.ticketModel.find({ orderId: order._id }).lean().exec();
					await this.processRefund(order, tickets, assessment, {
						source: RefundSource.EVENT_CANCELLED,
						actorId: adminId,
						reason: event.cancelReason,
						notifyOrganizer: false,
					});
					summary.refundedCount += 1;
				} catch (err) {
					summary.failedCount += 1;
					summary.failedOrderIds.push(String(order._id));
					this.logger.error(`Refund of order ${order._id} (event ${event._id}) failed: ${err.message}`);
				}
			}
			after = batch[batch.length - 1]._id;
		}

		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.EVENT_REFUNDS_PROCESSED,
			targetType: AuditTargetType.EVENT,
			targetId: event._id,
			meta: { refundedCount: summary.refundedCount, failedCount: summary.failedCount, totalCount: summary.totalCount },
		});
		await this.notificationService.createNotification({
			notificationType: NotificationType.ORDER_REFUNDED,
			notificationGroup: NotificationGroup.EVENT,
			notificationTitle: 'Refunds for your cancelled event',
			notificationDesc: `${summary.refundedCount} order(s) refunded, ${summary.failedCount} failed`,
			authorId: adminId,
			receiverId: event.organizerId,
			eventId: event._id,
		});
		return summary;
	}

	/** the same run again, for an event that is already CANCELLED: finishes the orders that are still PAID */
	public async retryEventRefundsByAdmin(adminId: ObjectId, eventId: ObjectId): Promise<RefundSummary> {
		const event = await this.eventModel.findOne({ _id: eventId, eventStatus: EventStatus.CANCELLED }).lean().exec();
		if (!event) throw new BadRequestException(Message.EVENT_NOT_CANCELLED);
		return await this.refundOrdersForCancelledEvent(adminId, event);
	}

	/** the rules */

	/**
	 * Pure: can this order be refunded now, and until when. A cancelled event refunds everything. Otherwise all tickets
	 * must be unused; a buyer is also bound to the deadline, an admin is not. Tickets already REFUNDED by a run that
	 * stopped half way do not block the run that finishes it.
	 */
	private assess(order: Order, event: Event, venue: Venue | null, tickets: Ticket[], now: Date, admin: boolean): Assessment {
		const venueTimezone = venue?.venueTimezone || DEFAULT_TIMEZONE;
		const deadline = getRefundDeadline(event.startAt, venueTimezone);
		const cancelled = event.eventStatus === EventStatus.CANCELLED;
		const pastDeadline = now.getTime() > deadline.getTime();
		const base = { deadline, venueTimezone, cancelled, pastDeadline };

		if (order.orderStatus !== OrderStatus.PAID) return { ...base, refundable: false, reason: Message.ORDER_NOT_REFUNDABLE };
		if (cancelled) return { ...base, refundable: true };

		if (tickets.some((ticket) => ticket.ticketStatus === TicketStatus.USED)) {
			return { ...base, refundable: false, reason: Message.REFUND_TICKET_CHECKED_IN };
		}
		if (tickets.some((ticket) => ![TicketStatus.VALID, TicketStatus.REFUNDED].includes(ticket.ticketStatus))) {
			return { ...base, refundable: false, reason: Message.ORDER_NOT_REFUNDABLE };
		}
		if (pastDeadline && !admin) return { ...base, refundable: false, reason: Message.REFUND_DEADLINE_PASSED };
		return { ...base, refundable: true };
	}

	/** the work */

	private async processRefund(order: Order, tickets: Ticket[], assessment: Assessment, run: RefundRun): Promise<Order> {
		const refund = await this.claimRefund(order, run);
		if (!refund) {
			// somebody else owns this refund: if they are done, that is our answer
			const current = await this.orderModel.findOne({ _id: order._id }).lean().exec();
			if (current?.orderStatus === OrderStatus.REFUNDED) return current;
			throw new BadRequestException(Message.REFUND_IN_PROGRESS);
		}

		const flippableFrom = assessment.cancelled ? [TicketStatus.VALID, TicketStatus.USED] : [TicketStatus.VALID];
		const flipped = tickets.filter((ticket) => flippableFrom.includes(ticket.ticketStatus));
		let paymentRefunded = false;
		try {
			await this.markTicketsRefunded(order, flipped, assessment.cancelled);
			await this.paymentService.refundOrder(order._id);
			paymentRefunded = true;
			if (!assessment.cancelled) await this.releaseStock(order, refund);

			const done = await this.orderModel
				.findOneAndUpdate(
					{ _id: order._id, orderStatus: OrderStatus.PAID },
					{ orderStatus: OrderStatus.REFUNDED, refundedAt: new Date() },
					{ new: true },
				)
				.exec();
			const result = done ?? (await this.orderModel.findOne({ _id: order._id }).lean().exec());
			await this.refundModel
				.updateOne({ _id: refund._id }, { refundStatus: RefundStatus.COMPLETED, completedAt: new Date(), $unset: { lockedAt: 1, failureReason: 1 } })
				.exec();
			await this.notifyRefunded(result, run);
			return result;
		} catch (err) {
			// before the money moved nothing is left half done; after it, a re-run finishes the rest without paying twice
			if (!paymentRefunded) await this.restoreTickets(flipped);
			await this.refundModel
				.updateOne({ _id: refund._id }, { refundStatus: RefundStatus.FAILED, failureReason: err.message, $unset: { lockedAt: 1 } })
				.exec();
			if (err instanceof BadRequestException) throw err;
			this.logger.error(`Refund of order ${order._id} failed: ${err.message}`);
			throw new InternalServerErrorException(Message.REFUND_FAILED);
		}
	}

	/**
	 * Creates the Refund record, or takes over a FAILED one or a PENDING one whose run died. The unique index on
	 * orderId decides a race: only one create wins. Returns null when someone else is running it or it is done.
	 */
	private async claimRefund(order: Order, run: RefundRun): Promise<Refund | null> {
		const now = new Date();
		try {
			return await this.refundModel.create({
				orderId: order._id,
				eventId: order.eventId,
				buyerId: order.buyerId,
				amount: order.totalAmount,
				currency: order.currency,
				refundStatus: RefundStatus.PENDING,
				refundSource: run.source,
				reason: run.reason,
				requestedBy: run.actorId,
				requestedAt: now,
				lockedAt: now,
			});
		} catch (err) {
			if (err?.code !== 11000) throw err;
		}

		return await this.refundModel
			.findOneAndUpdate(
				{
					orderId: order._id,
					$or: [
						{ refundStatus: RefundStatus.FAILED },
						{ refundStatus: RefundStatus.PENDING, lockedAt: { $lte: new Date(now.getTime() - REFUND_LOCK_MS) } },
					],
				},
				{ refundStatus: RefundStatus.PENDING, lockedAt: now, $unset: { failureReason: 1 } },
				{ new: true },
			)
			.exec();
	}

	/**
	 * VALID (and, for a cancelled event, USED) tickets become REFUNDED in one conditional update. A scan that slipped in
	 * after the check wins: the tickets flipped so far go back and the refund is refused.
	 */
	private async markTicketsRefunded(order: Order, flipped: Ticket[], cancelled: boolean): Promise<void> {
		if (!flipped.length) return;
		const ids = flipped.map((ticket) => ticket._id);
		const from = cancelled ? [TicketStatus.VALID, TicketStatus.USED] : [TicketStatus.VALID];
		await this.ticketModel.updateMany({ _id: { $in: ids }, ticketStatus: { $in: from } }, { ticketStatus: TicketStatus.REFUNDED }).exec();

		const stale = await this.ticketModel.find({ _id: { $in: ids }, ticketStatus: { $nin: [TicketStatus.REFUNDED] } }).lean().exec();
		if (stale.length) {
			await this.restoreTickets(flipped.filter((ticket) => !stale.some((other) => String(other._id) === String(ticket._id))));
			throw new BadRequestException(Message.REFUND_TICKET_CHECKED_IN);
		}
	}

	/** puts tickets this run flipped back to the status they had */
	private async restoreTickets(flipped: Ticket[]): Promise<void> {
		for (const status of [TicketStatus.VALID, TicketStatus.USED]) {
			const ids = flipped.filter((ticket) => ticket.ticketStatus === status).map((ticket) => ticket._id);
			if (ids.length) {
				await this.ticketModel.updateMany({ _id: { $in: ids }, ticketStatus: TicketStatus.REFUNDED }, { ticketStatus: status }).exec();
			}
		}
	}

	/**
	 * Seats go back to AVAILABLE and soldQuantity drops (which also lifts SOLD_OUT), once per refund: the flag on the
	 * Refund is claimed in one conditional update first, and given back if releasing fails.
	 */
	private async releaseStock(order: Order, refund: Refund): Promise<void> {
		const claimed = await this.refundModel
			.findOneAndUpdate({ _id: refund._id, stockReleased: { $ne: true } }, { stockReleased: true }, { new: true })
			.exec();
		if (!claimed) return;

		try {
			await this.seatService.releaseSoldSeats(order._id, order.seatIds ?? []);
			await Promise.all(order.items.map((item) => this.ticketTypeService.release(item.ticketTypeId, item.quantity)));
		} catch (err) {
			await this.refundModel.updateOne({ _id: refund._id }, { stockReleased: false }).exec();
			throw err;
		}
	}

	/** buyer gets a receipt; the organizer hears about it too, unless a whole event is being refunded */
	private async notifyRefunded(order: Order, run: RefundRun): Promise<void> {
		const common = { notificationGroup: NotificationGroup.ORDER, orderId: order._id, eventId: order.eventId };
		await this.notificationService.createNotification({
			...common,
			notificationType: NotificationType.REFUND_COMPLETED,
			notificationTitle: 'Your order was refunded',
			notificationDesc: order.orderNumber,
			authorId: run.actorId,
			receiverId: order.buyerId,
		});
		if (!run.notifyOrganizer) return;

		const event = await this.eventModel.findOne({ _id: order.eventId }).lean().exec();
		if (event) {
			await this.notificationService.createNotification({
				...common,
				notificationType: NotificationType.ORDER_REFUNDED,
				notificationTitle: 'An order was refunded',
				notificationDesc: order.orderNumber,
				authorId: run.actorId,
				receiverId: event.organizerId,
			});
		}
	}

	private async loadEventAndVenue(order: Order): Promise<{ event: Event; venue: Venue | null }> {
		const event = await this.eventModel.findOne({ _id: order.eventId }).lean().exec();
		if (!event) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		const venue = await this.venueModel.findOne({ _id: event.venueId }).lean().exec();
		return { event, venue };
	}
}
