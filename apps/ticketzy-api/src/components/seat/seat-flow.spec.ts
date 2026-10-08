import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { SeatService } from './seat.service';
import { OrderService } from '../order/order.service';
import { PaymentService } from '../payment/payment.service';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus, PaymentSimulation, PaymentStatus, TicketStatus } from '../../libs/enums/ticket.enum';
import { parseQrToken } from '../../libs/qr-token';

const oid = () => new ObjectId();
const M1 = oid();
const M2 = oid();
const ORG = oid();
const EVENT = oid();
const GENERAL_EVENT = oid();
const TT = oid();
const GENERAL_TT = oid();
const inHours = (hours: number) => new Date(Date.now() + hours * 3600000);

const build = (seatCount = 5) => {
	const members = new FakeModel([
		{ _id: M1, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER },
		{ _id: M2, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER },
		{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, completedEvents: 0 },
	]);
	const events = new FakeModel([
		{ _id: EVENT, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.RESERVED, organizerId: ORG, startAt: inHours(24), endAt: inHours(27) },
		{ _id: GENERAL_EVENT, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: inHours(24), endAt: inHours(27) },
	]);
	const seats = new FakeModel(
		Array.from({ length: seatCount }, (_, i) => ({
			_id: oid(),
			eventId: EVENT,
			ticketTypeId: TT,
			sectionKey: 'A',
			row: 1,
			number: i + 1,
			seatStatus: SeatStatus.AVAILABLE,
		})),
	);
	const orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
	const tickets = new FakeModel();
	const payments = new FakeModel();

	const ticketTypeService: any = {
		findSellable: jest.fn(async () => [{ _id: TT, eventId: EVENT, ticketPrice: 50, ticketCurrency: 'USD' }]),
		reserve: jest.fn(async () => ({ _id: GENERAL_TT, eventId: GENERAL_EVENT, ticketPrice: 20, ticketCurrency: 'USD' })),
		release: jest.fn().mockResolvedValue(undefined),
		addSold: jest.fn(async (counts: any[]) => counts),
	};
	const notificationService: any = { createNotification: jest.fn().mockResolvedValue(undefined) };
	const provider = new MockPaymentProvider();
	const refund = jest.spyOn(provider, 'refund');

	const seatService = new SeatService(seats as any, events as any, members as any);
	const paymentService = new PaymentService(payments as any, provider);
	const orderService = new OrderService(
		orders as any,
		events as any,
		tickets as any,
		members as any,
		ticketTypeService,
		seatService,
		paymentService,
		notificationService,
	);
	const seatOf = (n: number) => seats.docs[n - 1];
	return { members, events, seats, orders, tickets, payments, ticketTypeService, seatService, orderService, refund, seatOf };
};

beforeAll(() => {
	process.env.QR_SECRET = 'test-qr-secret';
});
afterEach(() => {
	delete process.env.SEAT_HOLD_SECONDS;
});

describe('seat holds', () => {
	it('lets exactly one of two members win a seat they request at the same time', async () => {
		const { seatService, seatOf } = build();
		const seatId = seatOf(1)._id;

		const results = await Promise.allSettled([
			seatService.holdSeats(M1 as any, EVENT as any, [seatId]),
			seatService.holdSeats(M2 as any, EVENT as any, [seatId]),
		]);

		const won = results.filter((r) => r.status === 'fulfilled');
		const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(lost[0].reason).toBeInstanceOf(BadRequestException);
		expect(lost[0].reason.message).toBe(Message.SEAT_JUST_TAKEN);
		expect(seatOf(1).seatStatus).toBe(SeatStatus.HELD);
	});

	it('holds for SEAT_HOLD_SECONDS and returns the seats, heldUntil and the server time', async () => {
		process.env.SEAT_HOLD_SECONDS = '45';
		const { seatService, seatOf } = build();

		const hold = await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(2)._id]);

		expect(hold.seats.map((s) => s.number)).toEqual([1, 2]);
		expect(hold.heldUntil.getTime() - hold.serverTime.getTime()).toBeGreaterThan(44000);
		expect(hold.heldUntil.getTime() - hold.serverTime.getTime()).toBeLessThanOrEqual(45000);
		expect(String(seatOf(1).heldBy)).toBe(String(M1));
		expect(seatOf(1).heldUntil).toEqual(hold.heldUntil);
	});

	it('defaults to a 30 second hold', async () => {
		const { seatService, seatOf } = build();
		const hold = await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id]);
		const seconds = (hold.heldUntil.getTime() - Date.now()) / 1000;
		expect(seconds).toBeGreaterThan(28);
		expect(seconds).toBeLessThanOrEqual(30);
	});

	it('releases the seats claimed in the call when a later seat is taken, and leaves the other member\'s seat alone', async () => {
		const { seatService, seatOf } = build();
		await seatService.holdSeats(M2 as any, EVENT as any, [seatOf(3)._id]);

		await expect(
			seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(2)._id, seatOf(3)._id]),
		).rejects.toThrow(Message.SEAT_JUST_TAKEN);

		expect(seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(seatOf(1).heldBy).toBeUndefined();
		expect(seatOf(2).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(seatOf(3).seatStatus).toBe(SeatStatus.HELD);
		expect(String(seatOf(3).heldBy)).toBe(String(M2));
	});

	it('refuses a seat that is SOLD', async () => {
		const { seatService, seatOf } = build();
		seatOf(1).seatStatus = SeatStatus.SOLD;
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(Message.SEAT_JUST_TAKEN);
	});

	it('gives an expired hold to the next member, and a live hold to nobody else', async () => {
		const { seatService, seatOf } = build();
		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(2)._id]);

		await expect(seatService.holdSeats(M2 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(Message.SEAT_JUST_TAKEN);

		seatOf(1).heldUntil = new Date(Date.now() - 1000); // the hold of seat 1 runs out
		await seatService.holdSeats(M2 as any, EVENT as any, [seatOf(1)._id]);

		expect(String(seatOf(1).heldBy)).toBe(String(M2));
		expect(String(seatOf(2).heldBy)).toBe(String(M1));
	});

	it('lets the same member hold their own seat again, which restarts the clock', async () => {
		const { seatService, seatOf } = build();
		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id]);
		const first = seatOf(1).heldUntil;
		seatOf(1).heldUntil = new Date(first.getTime() - 20000);

		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id]);
		expect(seatOf(1).heldUntil.getTime()).toBeGreaterThan(first.getTime() - 1000);
	});

	it('releases the member\'s earlier holds on the event before holding new seats', async () => {
		const { seatService, seatOf } = build();
		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(2)._id]);

		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(2)._id, seatOf(3)._id]);

		expect(seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(seatOf(2).seatStatus).toBe(SeatStatus.HELD);
		expect(seatOf(3).seatStatus).toBe(SeatStatus.HELD);
	});

	it('refuses more than 8 seats, duplicates and no seats', async () => {
		const { seatService, seatOf } = build(10);
		const ids = Array.from({ length: 9 }, (_, i) => seatOf(i + 1)._id);
		await expect(seatService.holdSeats(M1 as any, EVENT as any, ids)).rejects.toThrow(Message.SEAT_HOLD_LIMIT);
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(1)._id])).rejects.toThrow(Message.BAD_REQUEST);
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [])).rejects.toThrow(Message.BAD_REQUEST);
		await seatService.holdSeats(M1 as any, EVENT as any, ids.slice(0, 8)); // 8 is fine
	});

	it('refuses members who are not ACTIVE and events that are not open for seats', async () => {
		const { seatService, seatOf, members, events } = build();
		members.docs.find((m) => String(m._id) === String(M2)).memberStatus = MemberStatus.SUSPENDED;
		await expect(seatService.holdSeats(M2 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);

		await expect(seatService.holdSeats(M1 as any, GENERAL_EVENT as any, [seatOf(1)._id])).rejects.toThrow(
			Message.SEATS_NOT_AVAILABLE_FOR_EVENT,
		);

		events.docs[0].startAt = new Date(Date.now() - 1000);
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(
			Message.SEATS_NOT_AVAILABLE_FOR_EVENT,
		);

		events.docs[0].startAt = inHours(24);
		events.docs[0].eventStatus = EventStatus.PENDING;
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(
			Message.SEATS_NOT_AVAILABLE_FOR_EVENT,
		);

		events.docs[0].eventStatus = EventStatus.APPROVED;
		members.docs.find((m) => String(m._id) === String(ORG)).memberStatus = MemberStatus.SUSPENDED;
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(
			Message.SEATS_NOT_AVAILABLE_FOR_EVENT,
		);
	});

	it('does not accept seat ids of another event', async () => {
		const { seatService, seatOf } = build();
		seatOf(1).eventId = oid();
		await expect(seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id])).rejects.toThrow(Message.SEAT_JUST_TAKEN);
	});

	describe('seat references', () => {
		const at = (n: number) => ({ sectionKey: 'A', row: 1, number: n });

		it('holds seats given as { sectionKey, row, number }, resolved inside the event, with the same atomic conflict', async () => {
			const { seatService, seatOf } = build();
			const ids = await seatService.resolveSeatInput(EVENT as any, null, [at(2), at(1)]);
			expect(ids.map(String)).toEqual([String(seatOf(2)._id), String(seatOf(1)._id)]);

			const hold = await seatService.holdSeats(M1 as any, EVENT as any, ids);
			expect(hold.seats.map((s) => s.number)).toEqual([2, 1]);
			expect(hold.holdSeconds).toBe(30);

			const again = await seatService.resolveSeatInput(EVENT as any, null, [at(1)]);
			await expect(seatService.holdSeats(M2 as any, EVENT as any, again)).rejects.toThrow(Message.SEAT_JUST_TAKEN);
		});

		it('accepts the { _id } form and plain seatIds', async () => {
			const { seatService, seatOf } = build();
			const byRef = await seatService.resolveSeatInput(EVENT as any, null, [{ _id: String(seatOf(1)._id) }]);
			expect(String(byRef[0])).toBe(String(seatOf(1)._id));
			const byIds = await seatService.resolveSeatInput(EVENT as any, [String(seatOf(2)._id)], null);
			expect(String(byIds[0])).toBe(String(seatOf(2)._id));
		});

		it('rejects mixed, incomplete and malformed seats with a validation error', async () => {
			const { seatService, seatOf } = build();
			const id = String(seatOf(1)._id);
			const bad = (seats: any[]) => expect(seatService.resolveSeatInput(EVENT as any, null, seats)).rejects.toThrow(Message.SEAT_REF_INVALID);
			await bad([{ _id: id, sectionKey: 'A', row: 1, number: 1 }]);
			await bad([{ _id: id, row: 1 }]);
			await bad([{ sectionKey: 'A', row: 1 }]);
			await bad([{}]);
			await bad([{ sectionKey: 'A', row: 0, number: 1 }]);
			await bad([{ sectionKey: ' ', row: 1, number: 1 }]);
			await expect(seatService.resolveSeatInput(EVENT as any, [id], [at(1)])).rejects.toThrow(Message.SEAT_INPUT_INVALID);
			await expect(seatService.resolveSeatInput(EVENT as any, null, null)).rejects.toThrow(Message.BAD_REQUEST);
			await expect(seatService.resolveSeatInput(EVENT as any, null, [])).rejects.toThrow(Message.BAD_REQUEST);
		});

		it('reports unknown places and other events\' seats as not found, enforces the limit and refuses duplicates', async () => {
			const { seatService, seatOf } = build(10);
			await expect(seatService.resolveSeatInput(EVENT as any, null, [{ sectionKey: 'Z', row: 1, number: 1 }])).rejects.toThrow(Message.SEAT_NOT_FOUND);
			seatOf(1).eventId = oid();
			await expect(seatService.resolveSeatInput(EVENT as any, null, [at(1)])).rejects.toThrow(Message.SEAT_NOT_FOUND);

			const nine = Array.from({ length: 9 }, (_, i) => at(i + 1));
			await expect(seatService.resolveSeatInput(EVENT as any, null, nine)).rejects.toThrow(Message.SEAT_HOLD_LIMIT);

			const dup = await seatService.resolveSeatInput(EVENT as any, null, [at(2), at(2)]);
			await expect(seatService.holdSeats(M1 as any, EVENT as any, dup)).rejects.toThrow(Message.BAD_REQUEST);
		});

		it('exposes the hold duration and the seat limit', () => {
			process.env.SEAT_HOLD_SECONDS = '45';
			expect(build().seatService.getSeatConfig()).toEqual({ seatHoldSeconds: 45, maxSeatsPerOrder: 8 });
		});
	});

	it('releaseSeats frees only the caller\'s own holds', async () => {
		const { seatService, seatOf } = build();
		await seatService.holdSeats(M1 as any, EVENT as any, [seatOf(1)._id, seatOf(2)._id]);
		await seatService.holdSeats(M2 as any, EVENT as any, [seatOf(3)._id]);

		const released = await seatService.releaseSeats(M1 as any, EVENT as any);

		expect(released).toBe(2);
		expect(seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(seatOf(2).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(seatOf(3).seatStatus).toBe(SeatStatus.HELD);
	});
});

describe('checkout and payment of reserved seats', () => {
	const checkout = async (ctx: ReturnType<typeof build>, seatNumbers = [1, 2]) => {
		const ids = seatNumbers.map((n) => ctx.seatOf(n)._id);
		await ctx.seatService.holdSeats(M1 as any, EVENT as any, ids);
		return await ctx.orderService.createCheckout(M1 as any, { eventId: EVENT, seatIds: ids } as any);
	};

	it('prices the order on the server: subtotal, commission and total, expiring with the earliest hold', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);

		expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		expect(order.subtotal).toBe(100);
		expect(order.commissionRate).toBe(10);
		expect(order.commissionAmount).toBe(10);
		expect(order.totalAmount).toBe(100);
		expect(order.currency).toBe('USD');
		expect(order.seatIds).toHaveLength(2);
		expect(order.items).toEqual([{ ticketTypeId: TT, quantity: 2, unitPrice: 50 }]);
		expect(order.expiresAt).toEqual(ctx.seatOf(1).heldUntil);
	});

	it('uses the organizer\'s commission override, then the tier, and stores the rate on the order', async () => {
		const ctx = build();
		const organizer = ctx.members.docs.find((m) => String(m._id) === String(ORG));
		organizer.completedEvents = 6;
		organizer.commissionOverride = { rate: 2, reason: 'launch partner' };

		const order: any = await checkout(ctx);
		expect(order.commissionRate).toBe(2);
		expect(order.commissionAmount).toBe(2);

		await ctx.seatService.releaseSeats(M1 as any, EVENT as any);
		organizer.commissionOverride = { rate: 2, reason: 'ended', endsAt: new Date(Date.now() - 1000) };
		const next: any = await checkout(ctx, [3]);
		expect(next.commissionRate).toBe(7);
	});

	it('refuses seats the buyer does not hold, held by someone else, or whose hold ran out', async () => {
		const ctx = build();
		await ctx.seatService.holdSeats(M2 as any, EVENT as any, [ctx.seatOf(1)._id]);
		await expect(
			ctx.orderService.createCheckout(M1 as any, { eventId: EVENT, seatIds: [ctx.seatOf(1)._id] } as any),
		).rejects.toThrow(Message.HOLD_EXPIRED);

		await ctx.seatService.holdSeats(M1 as any, EVENT as any, [ctx.seatOf(2)._id]);
		ctx.seatOf(2).heldUntil = new Date(Date.now() - 1000);
		await expect(
			ctx.orderService.createCheckout(M1 as any, { eventId: EVENT, seatIds: [ctx.seatOf(2)._id] } as any),
		).rejects.toThrow(Message.HOLD_EXPIRED);
		expect(ctx.orders.docs).toHaveLength(0);
	});

	it('refuses quantities for a reserved event and seat ids for a general one', async () => {
		const ctx = build();
		await expect(
			ctx.orderService.createCheckout(M1 as any, { eventId: EVENT, items: [{ ticketTypeId: TT, quantity: 1 }] } as any),
		).rejects.toThrow(Message.CHECKOUT_RESERVED_NEEDS_SEATS);
		await expect(
			ctx.orderService.createCheckout(M1 as any, { eventId: GENERAL_EVENT, seatIds: [ctx.seatOf(1)._id] } as any),
		).rejects.toThrow(Message.CHECKOUT_GENERAL_NEEDS_ITEMS);
	});

	it('SUCCESS: seats become SOLD, the order PAID, a payment is recorded and one signed ticket is issued per seat', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);

		const paid: any = await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS);

		expect(paid.orderStatus).toBe(OrderStatus.PAID);
		expect(paid.paidAt).toBeInstanceOf(Date);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.SOLD);
		expect(ctx.seatOf(2).seatStatus).toBe(SeatStatus.SOLD);
		expect(String(ctx.seatOf(1).orderId)).toBe(String(order._id));

		expect(ctx.payments.docs).toHaveLength(1);
		expect(ctx.payments.docs[0]).toMatchObject({ paymentStatus: PaymentStatus.CAPTURED, amount: 100 });

		// N20: the sold seats are counted on their ticket type
		expect(ctx.ticketTypeService.addSold).toHaveBeenCalledWith([{ ticketTypeId: TT, quantity: 2 }]);

		expect(ctx.tickets.docs).toHaveLength(2);
		expect(new Set(ctx.tickets.docs.map((t) => t.ticketCode)).size).toBe(2);
		for (const ticket of ctx.tickets.docs) {
			expect(ticket.ticketStatus).toBe(TicketStatus.VALID);
			expect(String(ticket.ownerId)).toBe(String(M1));
			expect(parseQrToken(ticket.qrToken)).toBe(String(ticket._id));
			expect(parseQrToken(ticket.qrToken.replace(String(ticket._id), String(oid())))).toBeNull();
		}
		expect(ctx.tickets.docs.map((t) => t.seatId).map(String).sort()).toEqual([ctx.seatOf(1)._id, ctx.seatOf(2)._id].map(String).sort());
	});

	it('is idempotent: paying a PAID order returns it unchanged and issues nothing twice', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);
		const first: any = await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS);

		const again: any = await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS);
		const afterFailure: any = await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.FAILURE);

		expect(again).toEqual(first);
		expect(afterFailure.orderStatus).toBe(OrderStatus.PAID);
		expect(ctx.tickets.docs).toHaveLength(2);
		expect(ctx.payments.docs).toHaveLength(1);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.SOLD);
	});

	it('FAILURE: releases the seats, marks the order FAILED and issues no tickets', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);

		const failed: any = await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.FAILURE);

		expect(failed.orderStatus).toBe(OrderStatus.FAILED);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.seatOf(2).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.tickets.docs).toHaveLength(0);
		expect(ctx.payments.docs).toHaveLength(1);
		expect(ctx.payments.docs[0].paymentStatus).toBe(PaymentStatus.FAILED);
		await expect(ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow(Message.ORDER_NOT_PAYABLE);
	});

	it('rolls back the seats it sold when a later seat\'s hold is gone: HOLD_EXPIRED, no tickets, no payment, charge refunded', async () => {
		const ctx = build();
		const order: any = await checkout(ctx, [1, 2, 3]);
		// seat 3's hold ran out and another member took it before the payment finished
		ctx.seatOf(3).heldBy = M2;

		await expect(ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow(Message.HOLD_EXPIRED);

		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.HELD);
		expect(ctx.seatOf(1).orderId).toBeUndefined();
		expect(ctx.seatOf(2).seatStatus).toBe(SeatStatus.HELD);
		expect(String(ctx.seatOf(3).heldBy)).toBe(String(M2));
		expect(ctx.tickets.docs).toHaveLength(0);
		expect(ctx.payments.docs).toHaveLength(0);
		expect(ctx.refund).toHaveBeenCalledTimes(1);
		expect(ctx.orders.docs[0].orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('an order past its expiry becomes EXPIRED, frees its seats and fails with HOLD_EXPIRED', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);
		ctx.orders.docs[0].expiresAt = new Date(Date.now() - 1000);
		ctx.seatOf(1).heldUntil = new Date(Date.now() - 1000);
		ctx.seatOf(2).heldUntil = new Date(Date.now() - 1000);

		await expect(ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow(Message.HOLD_EXPIRED);

		expect(ctx.orders.docs[0].orderStatus).toBe(OrderStatus.EXPIRED);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.payments.docs).toHaveLength(0);
	});

	it('only the buyer can pay or cancel an order', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);
		await expect(ctx.orderService.payOrder(M2 as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		await expect(ctx.orderService.cancelPendingOrder(M2 as any, order._id)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.HELD);
	});

	it('cancelPendingOrder releases the held seats and cannot cancel a PAID order', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);

		const cancelled: any = await ctx.orderService.cancelPendingOrder(M1 as any, order._id);
		expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.seatOf(2).seatStatus).toBe(SeatStatus.AVAILABLE);

		const second: any = await checkout(ctx, [3]);
		await ctx.orderService.payOrder(M1 as any, second._id, PaymentSimulation.SUCCESS);
		await expect(ctx.orderService.cancelPendingOrder(M1 as any, second._id)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		expect(ctx.seatOf(3).seatStatus).toBe(SeatStatus.SOLD);
	});

	it('undoes the payment and the seat sale when issuing tickets fails, so the buyer can retry', async () => {
		const ctx = build();
		const order: any = await checkout(ctx);
		ctx.tickets.insertMany = jest.fn().mockRejectedValue(new Error('db down'));

		await expect(ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow();

		expect(ctx.orders.docs[0].orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		expect(ctx.seatOf(1).seatStatus).toBe(SeatStatus.HELD);
		expect(ctx.payments.docs).toHaveLength(0);
		expect(ctx.refund).toHaveBeenCalled();
	});
});

describe('checkout and payment of general admission', () => {
	const generalInput = { eventId: GENERAL_EVENT, items: [{ ticketTypeId: GENERAL_TT, quantity: 3 }] } as any;

	it('reserves stock, prices on the server and expires after SEAT_HOLD_SECONDS', async () => {
		process.env.SEAT_HOLD_SECONDS = '60';
		const ctx = build();

		const order: any = await ctx.orderService.createCheckout(M1 as any, generalInput);

		expect(ctx.ticketTypeService.reserve).toHaveBeenCalledWith(expect.anything(), 3);
		expect(order.subtotal).toBe(60);
		expect(order.commissionAmount).toBe(6);
		expect(order.totalAmount).toBe(60);
		expect(order.seatIds).toEqual([]);
		const seconds = (order.expiresAt.getTime() - Date.now()) / 1000;
		expect(seconds).toBeGreaterThan(58);
		expect(seconds).toBeLessThanOrEqual(60);
	});

	it('SUCCESS issues one ticket per quantity; FAILURE gives the stock back', async () => {
		const ctx = build();
		const order: any = await ctx.orderService.createCheckout(M1 as any, generalInput);
		await ctx.orderService.payOrder(M1 as any, order._id, PaymentSimulation.SUCCESS);
		expect(ctx.tickets.docs).toHaveLength(3);
		expect(ctx.tickets.docs.every((t) => t.seatId === undefined && parseQrToken(t.qrToken) === String(t._id))).toBe(true);
		expect(ctx.ticketTypeService.release).not.toHaveBeenCalled();

		const next: any = await ctx.orderService.createCheckout(M1 as any, generalInput);
		const failed: any = await ctx.orderService.payOrder(M1 as any, next._id, PaymentSimulation.FAILURE);
		expect(failed.orderStatus).toBe(OrderStatus.FAILED);
		expect(ctx.ticketTypeService.release).toHaveBeenCalledWith(GENERAL_TT, 3);
		expect(ctx.tickets.docs).toHaveLength(3);
	});

	it('releases stock when the order is cancelled', async () => {
		const ctx = build();
		const order: any = await ctx.orderService.createCheckout(M1 as any, generalInput);
		await ctx.orderService.cancelPendingOrder(M1 as any, order._id);
		expect(ctx.ticketTypeService.release).toHaveBeenCalledWith(GENERAL_TT, 3);
	});

	it('releases earlier reservations when a later item cannot be reserved', async () => {
		const ctx = build();
		ctx.ticketTypeService.reserve.mockResolvedValueOnce({ _id: GENERAL_TT, eventId: GENERAL_EVENT, ticketPrice: 20, ticketCurrency: 'USD' }).mockResolvedValueOnce(null);
		await expect(
			ctx.orderService.createCheckout(M1 as any, {
				eventId: GENERAL_EVENT,
				items: [
					{ ticketTypeId: GENERAL_TT, quantity: 1 },
					{ ticketTypeId: oid(), quantity: 1 },
				],
			} as any),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ctx.ticketTypeService.release).toHaveBeenCalledTimes(1);
		expect(ctx.orders.docs).toHaveLength(0);
	});
});
