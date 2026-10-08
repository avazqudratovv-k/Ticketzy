import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { RefundService } from './refund.service';
import { SeatService } from '../seat/seat.service';
import { PaymentService } from '../payment/payment.service';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { TicketTypeService } from '../ticket-type/ticket-type.service';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatStatus, SeatingType } from '../../libs/enums/event.enum';
import { OrderStatus, PaymentStatus, RefundSource, RefundStatus, TicketStatus } from '../../libs/enums/ticket.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationType } from '../../libs/enums/notification.enum';

const oid = () => new ObjectId();
const BUYER = oid();
const OTHER_BUYER = oid();
const ORG = oid();
const ADMIN = oid();
const EVENT = oid();
const VENUE = oid();
const TT = oid();

/** FakeModel with the unique index on orderId that the real Refund collection has */
class UniqueOrderModel extends FakeModel {
	public async create(doc: any) {
		if (this.docs.some((existing) => String(existing.orderId) === String(doc.orderId))) throw Object.assign(new Error('E11000'), { code: 11000 });
		return super.create(doc);
	}
}

interface Options {
	timezone?: string;
	startAt?: Date;
	eventStatus?: EventStatus;
	seating?: SeatingType;
}

const build = (options: Options = {}) => {
	const startAt = options.startAt ?? new Date(Date.now() + 10 * 86400000);
	const orders = new FakeModel();
	const tickets = new FakeModel();
	const payments = new FakeModel();
	const seats = new FakeModel();
	const refunds = new UniqueOrderModel();
	const events = new FakeModel([
		{
			_id: EVENT,
			organizerId: ORG,
			venueId: VENUE,
			eventStatus: options.eventStatus ?? EventStatus.APPROVED,
			seatingType: options.seating ?? SeatingType.RESERVED,
			startAt,
			eventTitle: 'Rock Night',
			cancelReason: 'Artist is ill',
		},
	]);
	const venues = new FakeModel([{ _id: VENUE, venueTimezone: options.timezone ?? 'Asia/Seoul' }]);
	const ticketTypes = new FakeModel([{ _id: TT, eventId: EVENT, totalQuantity: 100, soldQuantity: 0 }]);

	const provider = new MockPaymentProvider();
	const providerRefund = jest.spyOn(provider, 'refund');
	const paymentService = new PaymentService(payments as any, provider);
	const seatService = new SeatService(seats as any, events as any, new FakeModel() as any);
	const ticketTypeService = new TicketTypeService(ticketTypes as any, events as any, new FakeModel() as any, venues as any, seats as any);
	const notificationService: any = { createNotification: jest.fn().mockResolvedValue(undefined) };
	const auditLogService: any = { record: jest.fn().mockResolvedValue(undefined) };
	const service = new RefundService(
		orders as any,
		tickets as any,
		events as any,
		venues as any,
		refunds as any,
		paymentService,
		seatService,
		ticketTypeService,
		notificationService,
		auditLogService,
	);

	/** a PAID order of `quantity` tickets of TT, with seats (RESERVED), tickets, a captured payment and the sold count */
	const addPaidOrder = async (quantity = 2, buyerId: ObjectId = BUYER) => {
		const _id = oid();
		const reserved = (options.seating ?? SeatingType.RESERVED) === SeatingType.RESERVED;
		const seatIds = reserved
			? seats.docs
					.concat(
						await seats.insertMany(
							Array.from({ length: quantity }, (_, i) => ({
								eventId: EVENT,
								ticketTypeId: TT,
								sectionKey: 'A',
								row: 1,
								number: seats.docs.length + i + 1,
								seatStatus: SeatStatus.SOLD,
								orderId: _id,
								heldBy: buyerId,
							})),
						),
					)
					.filter((seat) => String(seat.orderId) === String(_id))
					.map((seat) => seat._id)
			: [];
		const order = await orders.create({
			_id,
			orderNumber: `TZ-${String(_id).slice(-6)}`,
			orderStatus: OrderStatus.PAID,
			buyerId,
			eventId: EVENT,
			items: [{ ticketTypeId: TT, quantity, unitPrice: 50 }],
			seatIds,
			currency: 'USD',
			subtotal: quantity * 50,
			commissionRate: 10,
			commissionAmount: quantity * 5,
			totalAmount: quantity * 50,
			paidAt: new Date(),
		});
		await tickets.insertMany(
			Array.from({ length: quantity }, (_, i) => ({
				orderId: _id,
				eventId: EVENT,
				ownerId: buyerId,
				ticketTypeId: TT,
				seatId: seatIds[i],
				ticketCode: `C-${String(_id)}-${i}`,
				ticketStatus: TicketStatus.VALID,
			})),
		);
		await payments.create({ orderId: _id, providerRef: `MOCK-${_id}`, paymentStatus: PaymentStatus.CAPTURED, amount: quantity * 50 });
		ticketTypes.docs[0].soldQuantity += quantity;
		return order;
	};

	const ordersTickets = (orderId: any) => tickets.docs.filter((ticket) => String(ticket.orderId) === String(orderId));
	const orderOf = (orderId: any) => orders.docs.find((order) => String(order._id) === String(orderId));
	return {
		service,
		orders,
		tickets,
		payments,
		seats,
		refunds,
		events,
		ticketTypes,
		providerRefund,
		notificationService,
		auditLogService,
		ticketTypeService,
		addPaidOrder,
		ordersTickets,
		orderOf,
		sold: () => ticketTypes.docs[0].soldQuantity,
	};
};

/**
 * Every test runs on a fixed clock: 2026-12-01T12:00:00Z, which is 21:00 in Seoul, so "starts in an hour" is the same
 * Seoul day and the buyer deadline has passed. Without it those tests depended on the time of day they were run at.
 */
const FIXED_NOW = '2026-12-01T12:00:00Z';
const freezeClock = (iso: string) =>
	jest.useFakeTimers({
		now: new Date(iso),
		doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask'],
	});

describe('RefundService', () => {
	beforeEach(() => freezeClock(FIXED_NOW));
	afterEach(() => jest.useRealTimers());

	describe('getRefundQuote', () => {
		it('gives the deadline in the venue timezone, that it is refundable and the amount', async () => {
			const startAt = new Date(Date.now() + 10 * 86400000);
			const ctx = build({ startAt, timezone: 'Asia/Seoul' });
			const order = await ctx.addPaidOrder(3);

			const quote = await ctx.service.getRefundQuote(BUYER as any, order._id);

			expect(quote).toMatchObject({ refundable: true, refundableAmount: 150, currency: 'USD', venueTimezone: 'Asia/Seoul' });
			expect(quote.deadline.getTime()).toBeLessThan(startAt.getTime());
			expect(quote.deadline.getTime()).toBeGreaterThan(startAt.getTime() - 2 * 86400000);
			expect(quote.reason).toBeUndefined();
		});

		it('says why not: after the deadline, after a check-in, for an order that is not PAID, and for someone else\'s order', async () => {
			const ctx = build({ startAt: new Date(Date.now() + 3600000) }); // starts in an hour: the deadline was last night
			const late = await ctx.addPaidOrder();
			expect(await ctx.service.getRefundQuote(BUYER as any, late._id)).toMatchObject({
				refundable: false,
				refundableAmount: 0,
				reason: Message.REFUND_DEADLINE_PASSED,
			});

			const ctx2 = build();
			const used = await ctx2.addPaidOrder();
			ctx2.tickets.docs[0].ticketStatus = TicketStatus.USED;
			expect((await ctx2.service.getRefundQuote(BUYER as any, used._id)).reason).toBe(Message.REFUND_TICKET_CHECKED_IN);

			const ctx3 = build();
			const pending = await ctx3.addPaidOrder();
			ctx3.orders.docs[0].orderStatus = OrderStatus.PENDING_PAYMENT;
			expect((await ctx3.service.getRefundQuote(BUYER as any, pending._id)).reason).toBe(Message.ORDER_NOT_REFUNDABLE);
			await expect(ctx3.service.getRefundQuote(OTHER_BUYER as any, pending._id)).rejects.toThrow(Message.NO_DATA_FOUND);
		});
	});

	describe('requestRefund', () => {
		it('refunds the whole order: Refund record, tickets, order, seats, stock and the provider', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);
			expect(ctx.sold()).toBe(2);

			const result: any = await ctx.service.requestRefund(BUYER as any, order._id, ' Cannot come ');

			expect(result.orderStatus).toBe(OrderStatus.REFUNDED);
			expect(result.refundedAt).toBeInstanceOf(Date);
			expect(ctx.refunds.docs).toHaveLength(1);
			expect(ctx.refunds.docs[0]).toMatchObject({
				refundStatus: RefundStatus.COMPLETED,
				refundSource: RefundSource.BUYER,
				amount: 100,
				reason: 'Cannot come',
				stockReleased: true,
			});
			expect(ctx.refunds.docs[0].requestedAt).toBeInstanceOf(Date);
			expect(ctx.refunds.docs[0].completedAt).toBeInstanceOf(Date);
			expect(String(ctx.refunds.docs[0].orderId)).toBe(String(order._id));

			expect(ctx.ordersTickets(order._id).map((t) => t.ticketStatus)).toEqual([TicketStatus.REFUNDED, TicketStatus.REFUNDED]);
			expect(ctx.seats.docs.map((s) => s.seatStatus)).toEqual([SeatStatus.AVAILABLE, SeatStatus.AVAILABLE]);
			expect(ctx.seats.docs.every((s) => s.orderId === undefined && s.heldBy === undefined)).toBe(true);
			expect(ctx.sold()).toBe(0);
			expect(ctx.payments.docs[0].paymentStatus).toBe(PaymentStatus.REFUNDED);
			expect(ctx.providerRefund).toHaveBeenCalledTimes(1);
			expect(ctx.providerRefund).toHaveBeenCalledWith(`MOCK-${order._id}`);

			const types = ctx.notificationService.createNotification.mock.calls.map(([n]) => [n.notificationType, String(n.receiverId)]);
			expect(types).toEqual([
				[NotificationType.REFUND_COMPLETED, String(BUYER)],
				[NotificationType.ORDER_REFUNDED, String(ORG)],
			]);
		});

		it('restores the stock of a general-admission order (no seats)', async () => {
			const ctx = build({ seating: SeatingType.GENERAL });
			const order = await ctx.addPaidOrder(4);
			expect(ctx.sold()).toBe(4);

			await ctx.service.requestRefund(BUYER as any, order._id);

			expect(ctx.sold()).toBe(0);
			expect(ctx.seats.docs).toHaveLength(0);
		});

		it('is idempotent: refunding a refunded order returns it unchanged and changes nothing again', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);
			const second = await ctx.addPaidOrder(1); // another order's stock must not move
			const first: any = await ctx.service.requestRefund(BUYER as any, order._id);
			const soldAfterFirst = ctx.sold();
			expect(soldAfterFirst).toBe(1);

			const again: any = await ctx.service.requestRefund(BUYER as any, order._id);

			expect(again).toEqual(first);
			expect(ctx.refunds.docs).toHaveLength(1);
			expect(ctx.providerRefund).toHaveBeenCalledTimes(1);
			expect(ctx.sold()).toBe(soldAfterFirst);
			expect(ctx.orderOf(second._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.notificationService.createNotification).toHaveBeenCalledTimes(2);
		});

		it('two requests at the same moment refund once', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);

			const results = await Promise.allSettled([ctx.service.requestRefund(BUYER as any, order._id), ctx.service.requestRefund(BUYER as any, order._id)]);

			expect(ctx.refunds.docs).toHaveLength(1);
			expect(ctx.providerRefund).toHaveBeenCalledTimes(1);
			expect(ctx.sold()).toBe(0);
			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.REFUNDED);
			// the loser either got the finished order or was told a refund is running; never a second refund
			for (const result of results) {
				if (result.status === 'rejected') expect(result.reason.message).toBe(Message.REFUND_IN_PROGRESS);
			}
		});

		it('only the buyer can refund, and only a PAID order', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder();
			await expect(ctx.service.requestRefund(OTHER_BUYER as any, order._id)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);

			ctx.orders.docs[0].orderStatus = OrderStatus.EXPIRED;
			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.ORDER_NOT_REFUNDABLE);
			expect(ctx.refunds.docs).toHaveLength(0);
			expect(ctx.providerRefund).not.toHaveBeenCalled();
		});

		it('is rejected after a ticket was checked in, and nothing is touched', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);
			ctx.tickets.docs[1].ticketStatus = TicketStatus.USED;

			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.REFUND_TICKET_CHECKED_IN);

			expect(ctx.refunds.docs).toHaveLength(0);
			expect(ctx.providerRefund).not.toHaveBeenCalled();
			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.tickets.docs.map((t) => t.ticketStatus)).toEqual([TicketStatus.VALID, TicketStatus.USED]);
			expect(ctx.seats.docs.every((s) => s.seatStatus === SeatStatus.SOLD)).toBe(true);
			expect(ctx.sold()).toBe(2);
		});

		it('a scan that slips in between the check and the refund wins: the flipped tickets go back', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);
			const realUpdateMany = ctx.tickets.updateMany.bind(ctx.tickets);
			// the gate scans the second ticket right before the refund flips the tickets
			jest.spyOn(ctx.tickets, 'updateMany').mockImplementationOnce((filter: any, update: any) => {
				ctx.tickets.docs[1].ticketStatus = TicketStatus.USED;
				return realUpdateMany(filter, update);
			});

			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.REFUND_TICKET_CHECKED_IN);

			expect(ctx.tickets.docs.map((t) => t.ticketStatus)).toEqual([TicketStatus.VALID, TicketStatus.USED]);
			expect(ctx.providerRefund).not.toHaveBeenCalled();
			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.refunds.docs[0].refundStatus).toBe(RefundStatus.FAILED);
		});

		it('a provider failure changes nothing and the buyer can try again', async () => {
			const ctx = build();
			const order = await ctx.addPaidOrder(2);
			ctx.providerRefund.mockRejectedValueOnce(new Error('provider down'));

			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.REFUND_FAILED);

			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.ordersTickets(order._id).every((t) => t.ticketStatus === TicketStatus.VALID)).toBe(true);
			expect(ctx.payments.docs[0].paymentStatus).toBe(PaymentStatus.CAPTURED);
			expect(ctx.seats.docs.every((s) => s.seatStatus === SeatStatus.SOLD)).toBe(true);
			expect(ctx.sold()).toBe(2);
			expect(ctx.refunds.docs[0]).toMatchObject({ refundStatus: RefundStatus.FAILED, failureReason: 'provider down' });

			const retry: any = await ctx.service.requestRefund(BUYER as any, order._id);
			expect(retry.orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.refunds.docs).toHaveLength(1);
			expect(ctx.refunds.docs[0].refundStatus).toBe(RefundStatus.COMPLETED);
			expect(ctx.sold()).toBe(0);
		});
	});

	describe('refund deadline in the venue timezone', () => {
		// 2026-12-25 10:00 UTC = 19:00 in Seoul and 02:00 in Los Angeles, both on Dec 25
		const startAt = new Date('2026-12-25T10:00:00Z');
		afterEach(() => jest.useRealTimers());
		const at = (iso: string) =>
			jest.useFakeTimers({
				now: new Date(iso),
				doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask'],
			});

		it('Seoul: refundable up to 23:59 KST the day before, not a millisecond later', async () => {
			const ctx = build({ startAt, timezone: 'Asia/Seoul' });
			const order = await ctx.addPaidOrder();

			at('2026-12-24T14:59:59.999Z');
			expect((await ctx.service.getRefundQuote(BUYER as any, order._id)).refundable).toBe(true);

			at('2026-12-24T15:00:00.000Z');
			const late = await ctx.service.getRefundQuote(BUYER as any, order._id);
			expect(late).toMatchObject({ refundable: false, reason: Message.REFUND_DEADLINE_PASSED, refundableAmount: 0 });
			expect(late.deadline.toISOString()).toBe('2026-12-24T14:59:59.999Z');
			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.REFUND_DEADLINE_PASSED);
			expect(ctx.refunds.docs).toHaveLength(0);
		});

		it('Los Angeles: the same moment is still before the deadline', async () => {
			const ctx = build({ startAt, timezone: 'America/Los_Angeles' });
			const order = await ctx.addPaidOrder();

			at('2026-12-24T20:00:00Z'); // after the Seoul deadline, before the Los Angeles one (2026-12-25T07:59:59.999Z)
			const quote = await ctx.service.getRefundQuote(BUYER as any, order._id);
			expect(quote.refundable).toBe(true);
			expect(quote.deadline.toISOString()).toBe('2026-12-25T07:59:59.999Z');
			expect(quote.venueTimezone).toBe('America/Los_Angeles');
			await expect(ctx.service.requestRefund(BUYER as any, order._id)).resolves.toMatchObject({ orderStatus: OrderStatus.REFUNDED });

			at('2026-12-25T08:00:00Z');
			const ctx2 = build({ startAt, timezone: 'America/Los_Angeles' });
			const order2 = await ctx2.addPaidOrder();
			await expect(ctx2.service.requestRefund(BUYER as any, order2._id)).rejects.toThrow(Message.REFUND_DEADLINE_PASSED);
		});

		it('a venue without a timezone falls back to Asia/Seoul', async () => {
			const ctx = build({ startAt });
			ctx.events.docs[0].venueId = oid(); // venue not found
			const order = await ctx.addPaidOrder();
			at('2026-12-24T10:00:00Z');
			expect((await ctx.service.getRefundQuote(BUYER as any, order._id)).venueTimezone).toBe('Asia/Seoul');
		});
	});

	describe('quote for an event that starts one hour from now, at every time of day (regression)', () => {
		// The old tests assumed this event is always past the deadline. It is only so when the hour does not cross midnight
		// in the venue: at 23:30 Seoul the event starts at 00:30 tomorrow and the buyer may refund until the end of today.
		const seoulDay = (at: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(at);
		const clocks = ['00:00:00.000', '00:30:00.000', '10:00:00.000', '14:59:59.999', '15:00:00.000', '20:00:00.000', '22:59:59.999', '23:00:00.000', '23:59:59.999'];

		it.each(clocks)('Seoul wall clock %s', async (time) => {
			// the Seoul wall time is `time`: subtract the 9 hours to get the UTC instant
			const wall = new Date(`2026-12-10T${time}Z`);
			const now = new Date(wall.getTime() - 9 * 3600000);
			freezeClock(now.toISOString());
			const startAt = new Date(now.getTime() + 3600000);

			const ctx = build({ startAt, timezone: 'Asia/Seoul' });
			const order = await ctx.addPaidOrder();
			const quote = await ctx.service.getRefundQuote(BUYER as any, order._id);

			const sameDay = seoulDay(now) === seoulDay(startAt);
			expect(quote.refundable).toBe(!sameDay);
			if (sameDay) expect(quote.reason).toBe(Message.REFUND_DEADLINE_PASSED);
			expect(quote.deadline.getTime()).toBeLessThan(startAt.getTime());
		});
	});

	describe('refundOrderByAdmin', () => {
		const late = () => build({ startAt: new Date(Date.now() + 3600000) }); // the buyer deadline has passed

		it('refunds after the deadline, writes the audit log and tells buyer and organizer', async () => {
			const ctx = late();
			const order = await ctx.addPaidOrder(2);
			await expect(ctx.service.requestRefund(BUYER as any, order._id)).rejects.toThrow(Message.REFUND_DEADLINE_PASSED);

			const result: any = await ctx.service.refundOrderByAdmin(ADMIN as any, { orderId: order._id, reason: ' Buyer was in hospital ' });

			expect(result.orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.refunds.docs[0]).toMatchObject({ refundSource: RefundSource.ADMIN, reason: 'Buyer was in hospital', refundStatus: RefundStatus.COMPLETED });
			expect(String(ctx.refunds.docs[0].requestedBy)).toBe(String(ADMIN));
			expect(ctx.sold()).toBe(0);
			expect(ctx.auditLogService.record).toHaveBeenCalledWith({
				actorId: ADMIN,
				action: AuditAction.ORDER_REFUNDED_BY_ADMIN,
				targetType: AuditTargetType.ORDER,
				targetId: order._id,
				meta: { reason: 'Buyer was in hospital', amount: 100, afterDeadline: true },
			});
			expect(ctx.notificationService.createNotification).toHaveBeenCalledTimes(2);
		});

		it('needs a reason', async () => {
			const ctx = late();
			const order = await ctx.addPaidOrder();
			await expect(ctx.service.refundOrderByAdmin(ADMIN as any, { orderId: order._id, reason: '  ' })).rejects.toThrow(Message.REFUND_REASON_REQUIRED);
			expect(ctx.refunds.docs).toHaveLength(0);
		});

		it('cannot refund a checked-in ticket, and does not audit a refund that did not happen', async () => {
			const ctx = late();
			const order = await ctx.addPaidOrder(2);
			ctx.tickets.docs[0].ticketStatus = TicketStatus.USED;

			await expect(ctx.service.refundOrderByAdmin(ADMIN as any, { orderId: order._id, reason: 'please' })).rejects.toThrow(Message.REFUND_TICKET_CHECKED_IN);

			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.providerRefund).not.toHaveBeenCalled();
			expect(ctx.auditLogService.record).not.toHaveBeenCalled();
		});

		it('is idempotent for an already refunded order', async () => {
			const ctx = late();
			const order = await ctx.addPaidOrder();
			await ctx.service.refundOrderByAdmin(ADMIN as any, { orderId: order._id, reason: 'x' });
			const again: any = await ctx.service.refundOrderByAdmin(ADMIN as any, { orderId: order._id, reason: 'x' });

			expect(again.orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.providerRefund).toHaveBeenCalledTimes(1);
			expect(ctx.auditLogService.record).toHaveBeenCalledTimes(1);
		});
	});

	describe('refundOrdersForCancelledEvent', () => {
		const cancelled = () => build({ eventStatus: EventStatus.CANCELLED });
		const eventOf = (ctx: ReturnType<typeof build>) => ctx.events.docs[0] as any;

		it('refunds every PAID order, leaves seats and stock alone, notifies buyers and organizer, and audits', async () => {
			const ctx = cancelled();
			const a = await ctx.addPaidOrder(2);
			const b = await ctx.addPaidOrder(1, OTHER_BUYER);
			ctx.tickets.docs[0].ticketStatus = TicketStatus.USED; // even a checked-in ticket is refunded when the event is cancelled
			const pending = await ctx.orders.create({ ...ctx.orderOf(a._id), _id: oid(), orderStatus: OrderStatus.PENDING_PAYMENT });
			const soldBefore = ctx.sold();

			const summary = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(summary).toMatchObject({ refundedCount: 2, failedCount: 0, totalCount: 2, failedOrderIds: [] });
			expect(ctx.orderOf(a._id).orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.orderOf(b._id).orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.orderOf(pending._id).orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
			expect(ctx.tickets.docs.every((t) => t.ticketStatus === TicketStatus.REFUNDED)).toBe(true);
			expect(ctx.refunds.docs.map((r) => r.refundSource)).toEqual([RefundSource.EVENT_CANCELLED, RefundSource.EVENT_CANCELLED]);
			expect(ctx.refunds.docs[0].reason).toBe('Artist is ill');
			expect(ctx.providerRefund).toHaveBeenCalledTimes(2);

			// nothing goes back on sale
			expect(ctx.seats.docs.every((s) => s.seatStatus === SeatStatus.SOLD)).toBe(true);
			expect(ctx.sold()).toBe(soldBefore);
			expect(ctx.refunds.docs.every((r) => !r.stockReleased)).toBe(true);

			const calls = ctx.notificationService.createNotification.mock.calls.map(([n]) => n);
			const buyers = calls.filter((n) => n.notificationType === NotificationType.REFUND_COMPLETED).map((n) => String(n.receiverId));
			expect(buyers.sort()).toEqual([String(BUYER), String(OTHER_BUYER)].sort());
			const organizerNotes = calls.filter((n) => String(n.receiverId) === String(ORG));
			expect(organizerNotes).toHaveLength(1);
			expect(organizerNotes[0].notificationDesc).toBe('2 order(s) refunded, 0 failed');

			expect(ctx.auditLogService.record).toHaveBeenCalledWith({
				actorId: ADMIN,
				action: AuditAction.EVENT_REFUNDS_PROCESSED,
				targetType: AuditTargetType.EVENT,
				targetId: EVENT,
				meta: { refundedCount: 2, failedCount: 0, totalCount: 2 },
			});
		});

		it('continues past a failure, reports it, and a re-run finishes only the remaining order', async () => {
			const ctx = cancelled();
			const a = await ctx.addPaidOrder(1);
			const b = await ctx.addPaidOrder(1, OTHER_BUYER);
			const c = await ctx.addPaidOrder(1);
			ctx.providerRefund.mockImplementation(async (ref: string) => {
				if (ref === `MOCK-${b._id}`) throw new Error('provider down');
			});

			const first = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(first).toMatchObject({ refundedCount: 2, failedCount: 1, totalCount: 3, failedOrderIds: [String(b._id)] });
			expect(ctx.orderOf(a._id).orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.orderOf(c._id).orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.orderOf(b._id).orderStatus).toBe(OrderStatus.PAID);
			expect(ctx.ordersTickets(b._id).every((t) => t.ticketStatus === TicketStatus.VALID)).toBe(true);
			expect(ctx.refunds.docs.find((r) => String(r.orderId) === String(b._id)).refundStatus).toBe(RefundStatus.FAILED);
			expect(ctx.auditLogService.record).toHaveBeenLastCalledWith(
				expect.objectContaining({ meta: { refundedCount: 2, failedCount: 1, totalCount: 3 } }),
			);

			// the provider is back: the re-run only touches the order that is still PAID
			ctx.providerRefund.mockReset();
			ctx.providerRefund.mockResolvedValue(undefined);
			const second = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(second).toMatchObject({ refundedCount: 1, failedCount: 0, totalCount: 1, failedOrderIds: [] });
			expect(ctx.providerRefund).toHaveBeenCalledTimes(1);
			expect(ctx.providerRefund).toHaveBeenCalledWith(`MOCK-${b._id}`);
			expect(ctx.orders.docs.every((o) => o.orderStatus === OrderStatus.REFUNDED)).toBe(true);
			expect(ctx.refunds.docs).toHaveLength(3);
			expect(ctx.refunds.docs.every((r) => r.refundStatus === RefundStatus.COMPLETED)).toBe(true);

			// and a third run has nothing left to do
			const third = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));
			expect(third).toMatchObject({ refundedCount: 0, failedCount: 0, totalCount: 0 });
		});

		it('works through more orders than one batch', async () => {
			const ctx = build({ eventStatus: EventStatus.CANCELLED, seating: SeatingType.GENERAL });
			for (let i = 0; i < 120; i++) await ctx.addPaidOrder(1, i % 2 ? BUYER : OTHER_BUYER);

			const summary = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(summary).toMatchObject({ refundedCount: 120, failedCount: 0, totalCount: 120 });
			expect(ctx.orders.docs.every((o) => o.orderStatus === OrderStatus.REFUNDED)).toBe(true);
			expect(ctx.providerRefund).toHaveBeenCalledTimes(120);
		});

		it('a failed order that keeps failing does not stop the loop from ending', async () => {
			const ctx = cancelled();
			for (let i = 0; i < 3; i++) await ctx.addPaidOrder(1);
			ctx.providerRefund.mockRejectedValue(new Error('provider down'));

			const summary = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(summary).toMatchObject({ refundedCount: 0, failedCount: 3, totalCount: 3 });
			expect(ctx.orders.docs.every((o) => o.orderStatus === OrderStatus.PAID)).toBe(true);
		});

		it('resumes a refund whose run died after the money moved, without paying twice', async () => {
			const ctx = cancelled();
			const order = await ctx.addPaidOrder(2);
			// the dead run: refund PENDING and silent for an hour, tickets REFUNDED, payment REFUNDED, order still PAID
			await ctx.refunds.create({
				orderId: order._id,
				eventId: EVENT,
				buyerId: BUYER,
				amount: 100,
				refundStatus: RefundStatus.PENDING,
				refundSource: RefundSource.EVENT_CANCELLED,
				requestedAt: new Date(Date.now() - 7200000),
				lockedAt: new Date(Date.now() - 3600000),
			});
			ctx.tickets.docs.forEach((t) => (t.ticketStatus = TicketStatus.REFUNDED));
			ctx.payments.docs[0].paymentStatus = PaymentStatus.REFUNDED;

			const summary = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(summary).toMatchObject({ refundedCount: 1, failedCount: 0 });
			expect(ctx.providerRefund).not.toHaveBeenCalled();
			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.REFUNDED);
			expect(ctx.refunds.docs).toHaveLength(1);
			expect(ctx.refunds.docs[0].refundStatus).toBe(RefundStatus.COMPLETED);
		});

		it('leaves an order alone while another run still owns its refund', async () => {
			const ctx = cancelled();
			const order = await ctx.addPaidOrder(1);
			await ctx.refunds.create({
				orderId: order._id,
				eventId: EVENT,
				buyerId: BUYER,
				amount: 50,
				refundStatus: RefundStatus.PENDING,
				refundSource: RefundSource.EVENT_CANCELLED,
				requestedAt: new Date(),
				lockedAt: new Date(),
			});

			const summary = await ctx.service.refundOrdersForCancelledEvent(ADMIN as any, eventOf(ctx));

			expect(summary).toMatchObject({ refundedCount: 0, failedCount: 1 });
			expect(ctx.providerRefund).not.toHaveBeenCalled();
			expect(ctx.orderOf(order._id).orderStatus).toBe(OrderStatus.PAID);
		});

		it('a buyer can also finish their own refund on a cancelled event, past any deadline, without releasing seats', async () => {
			const ctx = build({ eventStatus: EventStatus.CANCELLED, startAt: new Date(Date.now() - 86400000) });
			const order = await ctx.addPaidOrder(1);
			await expect(ctx.service.requestRefund(BUYER as any, order._id)).resolves.toMatchObject({ orderStatus: OrderStatus.REFUNDED });
			expect(ctx.seats.docs[0].seatStatus).toBe(SeatStatus.SOLD);
		});
	});

	describe('retryEventRefundsByAdmin', () => {
		it('only works for a CANCELLED event', async () => {
			const ctx = build();
			await expect(ctx.service.retryEventRefundsByAdmin(ADMIN as any, EVENT as any)).rejects.toBeInstanceOf(BadRequestException);
			await expect(ctx.service.retryEventRefundsByAdmin(ADMIN as any, EVENT as any)).rejects.toThrow(Message.EVENT_NOT_CANCELLED);
			expect(ctx.auditLogService.record).not.toHaveBeenCalled();
		});

		it('runs the refunds of a cancelled event', async () => {
			const ctx = build({ eventStatus: EventStatus.CANCELLED });
			await ctx.addPaidOrder(1);
			const summary = await ctx.service.retryEventRefundsByAdmin(ADMIN as any, EVENT as any);
			expect(summary).toMatchObject({ refundedCount: 1, failedCount: 0 });
		});
	});

	describe('soldQuantity (N20)', () => {
		it('sold seats are counted per ticket type, refunds take them back, and a failed count is rolled back', async () => {
			const ctx = build();
			const other = oid();
			ctx.ticketTypes.docs.push({ _id: other, eventId: EVENT, totalQuantity: 10, soldQuantity: 0 });

			const added = await ctx.ticketTypeService.addSold([
				{ ticketTypeId: TT as any, quantity: 2 },
				{ ticketTypeId: other as any, quantity: 1 },
			]);
			expect(added).toHaveLength(2);
			expect(ctx.ticketTypes.docs.map((t) => t.soldQuantity)).toEqual([2, 1]);

			// the second update fails: the first count is taken back and the error reaches the caller
			const real = ctx.ticketTypes.findOneAndUpdate.bind(ctx.ticketTypes);
			let call = 0;
			jest.spyOn(ctx.ticketTypes, 'findOneAndUpdate').mockImplementation((filter: any, update: any, options: any) => {
				call += 1;
				if (call === 2) throw new Error('db down');
				return real(filter, update, options);
			});
			await expect(
				ctx.ticketTypeService.addSold([
					{ ticketTypeId: TT as any, quantity: 3 },
					{ ticketTypeId: other as any, quantity: 1 },
				]),
			).rejects.toThrow('db down');
			expect(ctx.ticketTypes.docs.map((t) => t.soldQuantity)).toEqual([2, 1]);
		});

		it('a refund releases exactly the order\'s quantity per ticket type, and only once', async () => {
			const ctx = build();
			const a = await ctx.addPaidOrder(2);
			await ctx.addPaidOrder(3);
			expect(ctx.sold()).toBe(5);

			await ctx.service.requestRefund(BUYER as any, a._id);
			await ctx.service.requestRefund(BUYER as any, a._id);

			expect(ctx.sold()).toBe(3);
		});
	});
});
