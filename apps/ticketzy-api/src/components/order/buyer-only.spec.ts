import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { SeatService } from '../seat/seat.service';
import { OrderService } from './order.service';
import { PaymentService } from '../payment/payment.service';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus, PaymentSimulation } from '../../libs/enums/ticket.enum';
import { assertBuyerAccount, assertVerifiedEmail } from '../../libs/buyer';
import { OrderResolver } from './order.resolver';
import { SeatResolver } from '../seat/seat.resolver';

const oid = () => new ObjectId();
const USER = oid();
const ORG = oid();
const OTHER_ORG = oid();
const ADMIN = oid();
const UNVERIFIED = oid();
const EVENT = oid();
const GENERAL_EVENT = oid();
const OWN_EVENT = oid();
const TT = oid();
const hours = (n: number) => new Date(Date.now() + n * 3600000);
const REFUSAL = 'Only buyer accounts can buy tickets! Organizer and admin accounts cannot.';

const build = () => {
	const active = { memberStatus: MemberStatus.ACTIVE, completedEvents: 0 };
	const members = new FakeModel([
		{ _id: USER, memberType: MemberType.USER, emailVerifiedAt: new Date('2026-01-01'), ...active },
		{ _id: UNVERIFIED, memberType: MemberType.USER, ...active },
		{ _id: ORG, memberType: MemberType.ORGANIZER, ...active },
		{ _id: OTHER_ORG, memberType: MemberType.ORGANIZER, ...active },
		{ _id: ADMIN, memberType: MemberType.ADMIN, ...active },
	]);
	const base = { eventStatus: EventStatus.APPROVED, startAt: hours(24), endAt: hours(27) };
	const events = new FakeModel([
		{ _id: EVENT, seatingType: SeatingType.RESERVED, organizerId: OTHER_ORG, ...base },
		{ _id: GENERAL_EVENT, seatingType: SeatingType.GENERAL, organizerId: OTHER_ORG, ...base },
		{ _id: OWN_EVENT, seatingType: SeatingType.GENERAL, organizerId: ORG, ...base },
	]);
	const seats = new FakeModel(
		[1, 2, 3].map((number) => ({ _id: oid(), eventId: EVENT, ticketTypeId: TT, sectionKey: 'A', row: 1, number, seatStatus: SeatStatus.AVAILABLE })),
	);
	const orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
	const ticketTypeService: any = {
		findSellable: jest.fn(async () => [{ _id: TT, eventId: EVENT, ticketPrice: 50, ticketCurrency: 'USD' }]),
		reserve: jest.fn(async (id: any) => ({ _id: id, eventId: GENERAL_EVENT, ticketPrice: 20, ticketCurrency: 'USD' })),
		release: jest.fn().mockResolvedValue(undefined),
		addSold: jest.fn(async (counts: any[]) => counts),
	};
	const seatService = new SeatService(seats as any, events as any, members as any);
	const orderService = new OrderService(
		orders as any,
		events as any,
		new FakeModel() as any,
		members as any,
		ticketTypeService,
		seatService,
		new PaymentService(new FakeModel() as any, new MockPaymentProvider()),
		{ createNotification: jest.fn().mockResolvedValue(undefined) } as any,
	);
	return { members, orders, seats, ticketTypeService, seatService, orderService };
};

beforeAll(() => {
	process.env.QR_SECRET = 'test-qr-secret';
});

describe('a buyer needs a verified email address (DECISIONS #135)', () => {
	const NOT_VERIFIED = { code: 'EMAIL_NOT_VERIFIED', message: Message.EMAIL_NOT_VERIFIED };

	it('holdSeats is refused with EMAIL_NOT_VERIFIED and nothing is held', async () => {
		const ctx = build();
		await expect(ctx.seatService.holdSeats(UNVERIFIED as any, EVENT as any, [ctx.seats.docs[0]._id])).rejects.toMatchObject(NOT_VERIFIED);
		expect(ctx.seats.docs.every((seat) => seat.seatStatus === SeatStatus.AVAILABLE)).toBe(true);
	});

	it('createCheckout is refused for a general and a reserved event, and nothing is reserved or created', async () => {
		const ctx = build();
		await expect(ctx.orderService.createCheckout(UNVERIFIED as any, { eventId: GENERAL_EVENT, items: [{ ticketTypeId: TT, quantity: 1 }] } as any)).rejects.toMatchObject(NOT_VERIFIED);
		await expect(ctx.orderService.createCheckout(UNVERIFIED as any, { eventId: EVENT, seatIds: [ctx.seats.docs[0]._id] } as any)).rejects.toMatchObject(NOT_VERIFIED);
		expect(ctx.ticketTypeService.reserve).not.toHaveBeenCalled();
		expect(ctx.orders.docs).toHaveLength(0);
	});

	it('payOrder is refused even for a pending order that exists (an order made before verification was required)', async () => {
		const ctx = build();
		const order = { _id: oid(), buyerId: UNVERIFIED, eventId: GENERAL_EVENT, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: hours(1), items: [] };
		ctx.orders.docs.push(order);
		await expect(ctx.orderService.payOrder(UNVERIFIED as any, order._id as any, PaymentSimulation.SUCCESS)).rejects.toMatchObject(NOT_VERIFIED);
		expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('the refusal is a coded error a client can branch on, and a verified buyer is not affected', async () => {
		expect(() => assertVerifiedEmail({ emailVerifiedAt: new Date() })).not.toThrow();
		for (const bad of [{}, { emailVerifiedAt: null }, undefined, null]) expect(() => assertVerifiedEmail(bad as any)).toThrow(Message.EMAIL_NOT_VERIFIED);
		const ctx = build();
		const err: any = await ctx.seatService.holdSeats(UNVERIFIED as any, EVENT as any, [ctx.seats.docs[0]._id]).catch((e) => e);
		expect(err.code).toBe('EMAIL_NOT_VERIFIED');
		expect(err.getStatus()).toBe(403);
	});

	it('an organizer is still refused as a non-buyer first', async () => {
		const ctx = build();
		await expect(ctx.seatService.holdSeats(ORG as any, EVENT as any, [ctx.seats.docs[0]._id])).rejects.toThrow(REFUSAL);
	});
});

describe('only buyer accounts (USER) can buy tickets', () => {
	it('the new refusal text is the one specified', () => {
		expect(Message.ONLY_BUYERS_CAN_BUY).toBe(REFUSAL);
		expect(() => assertBuyerAccount(MemberType.ORGANIZER)).toThrow(REFUSAL);
		expect(() => assertBuyerAccount(MemberType.USER)).not.toThrow();
	});

	describe.each([
		['ORGANIZER', ORG],
		['ADMIN', ADMIN],
	])('%s', (_label, member) => {
		it('holdSeats is refused with the buyer-only message and nothing is held', async () => {
			const ctx = build();
			const attempt = ctx.seatService.holdSeats(member as any, EVENT as any, [ctx.seats.docs[0]._id]);
			await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
			await expect(attempt).rejects.toThrow(REFUSAL);
			expect(ctx.seats.docs.every((seat) => seat.seatStatus === SeatStatus.AVAILABLE)).toBe(true);
		});

		it('createCheckout is refused, for a general event and a reserved one, and nothing is reserved or created', async () => {
			const ctx = build();
			await expect(ctx.orderService.createCheckout(member as any, { eventId: GENERAL_EVENT, items: [{ ticketTypeId: TT, quantity: 1 }] } as any)).rejects.toThrow(REFUSAL);
			await expect(ctx.orderService.createCheckout(member as any, { eventId: EVENT, seatIds: [ctx.seats.docs[0]._id] } as any)).rejects.toThrow(REFUSAL);
			expect(ctx.ticketTypeService.reserve).not.toHaveBeenCalled();
			expect(ctx.orders.docs).toHaveLength(0);
		});

		it('payOrder is refused even for an order the account somehow owns, and the order stays untouched', async () => {
			const ctx = build();
			const order = { _id: oid(), buyerId: member, eventId: GENERAL_EVENT, orderStatus: OrderStatus.PENDING_PAYMENT, expiresAt: hours(1), items: [] };
			ctx.orders.docs.push(order);
			await expect(ctx.orderService.payOrder(member as any, order._id as any, PaymentSimulation.SUCCESS)).rejects.toThrow(REFUSAL);
			expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		});
	});

	it('an organizer is refused on their own event', async () => {
		const ctx = build();
		await expect(ctx.orderService.createCheckout(ORG as any, { eventId: OWN_EVENT, items: [{ ticketTypeId: TT, quantity: 1 }] } as any)).rejects.toThrow(REFUSAL);
		expect(ctx.ticketTypeService.reserve).not.toHaveBeenCalled();
	});

	it('a USER still holds seats, checks out a reserved and a general event, and pays', async () => {
		const ctx = build();
		const seatId = ctx.seats.docs[0]._id;
		await ctx.seatService.holdSeats(USER as any, EVENT as any, [seatId]);
		const reservedOrder: any = await ctx.orderService.createCheckout(USER as any, { eventId: EVENT, seatIds: [seatId] } as any);
		expect(reservedOrder.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		const paid: any = await ctx.orderService.payOrder(USER as any, reservedOrder._id, PaymentSimulation.SUCCESS);
		expect(paid.orderStatus).toBe(OrderStatus.PAID);

		const general: any = await ctx.orderService.createCheckout(USER as any, { eventId: GENERAL_EVENT, items: [{ ticketTypeId: TT, quantity: 1 }] } as any);
		expect(general.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('an inactive or unknown account keeps the old refusal (not the role message)', async () => {
		const ctx = build();
		ctx.members.docs[0].memberStatus = MemberStatus.SUSPENDED;
		await expect(ctx.seatService.holdSeats(USER as any, EVENT as any, [ctx.seats.docs[0]._id])).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		await expect(ctx.orderService.createCheckout(oid() as any, { eventId: GENERAL_EVENT, items: [] } as any)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
	});

	it('visitors (no token) are still stopped by AuthGuard before the service runs; refunds and reads are not role-limited', () => {
		const guards = (type: any, name: string) => (Reflect.getMetadata('__guards__', type.prototype[name]) ?? []).map((g: any) => g.name);
		for (const [type, name] of [[SeatResolver, 'holdSeats'], [OrderResolver, 'createCheckout'], [OrderResolver, 'payOrder']] as const) {
			expect(guards(type, name)).toContain('AuthGuard');
		}
		for (const name of ['getMyOrders', 'getOrder', 'cancelPendingOrder']) {
			expect(Reflect.getMetadata('roles', OrderResolver.prototype[name])).toBeUndefined();
		}
	});
});
