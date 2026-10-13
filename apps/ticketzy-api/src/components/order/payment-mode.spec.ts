import { GraphQLError } from 'graphql';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { OrderService } from './order.service';
import { PaymentService } from '../payment/payment.service';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus, PaymentSimulation } from '../../libs/enums/ticket.enum';

const oid = () => new ObjectId();
const BUYER = oid();
const ORG = oid();
const EVENT = oid();
const TT = oid();
const inHours = (hours: number) => new Date(Date.now() + hours * 3600000);

const build = () => {
	const members = new FakeModel([
		{ _id: BUYER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER },
		{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, completedEvents: 0 },
	]);
	const events = new FakeModel([
		{ _id: EVENT, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: inHours(24), endAt: inHours(27) },
	]);
	const orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
	const tickets = new FakeModel();
	const ticketTypeService: any = {
		reserve: jest.fn(async () => ({ _id: TT, eventId: EVENT, ticketPrice: 20, ticketCurrency: 'KRW' })),
		release: jest.fn().mockResolvedValue(undefined),
		addSold: jest.fn(async (counts: any[]) => counts),
	};
	const provider = new MockPaymentProvider();
	const charge = jest.spyOn(provider, 'charge');
	const service = new OrderService(
		orders as any,
		events as any,
		tickets as any,
		members as any,
		ticketTypeService,
		{} as any,
		new PaymentService(new FakeModel() as any, provider),
		{ createNotification: jest.fn().mockResolvedValue(undefined) } as any,
	);
	return { service, orders, tickets, charge };
};

describe('PAYMENT_MODE and payOrder', () => {
	const original = { mode: process.env.PAYMENT_MODE, nodeEnv: process.env.NODE_ENV, qr: process.env.QR_SECRET };
	beforeAll(() => {
		process.env.QR_SECRET = 'test-qr-secret';
	});
	afterEach(() => {
		if (original.mode === undefined) delete process.env.PAYMENT_MODE;
		else process.env.PAYMENT_MODE = original.mode;
	});
	afterAll(() => {
		if (original.qr === undefined) delete process.env.QR_SECRET;
		else process.env.QR_SECRET = original.qr;
	});

	const checkout = async (ctx: ReturnType<typeof build>) =>
		(await ctx.service.createCheckout(BUYER as any, { eventId: EVENT, items: [{ ticketTypeId: TT, quantity: 2 }] } as any)) as any;

	it('simulated mode behaves as before: the buyer picks the result', async () => {
		process.env.PAYMENT_MODE = 'simulated';
		const ctx = build();
		const order = await checkout(ctx);
		const paid: any = await ctx.service.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS);
		expect(paid.orderStatus).toBe(OrderStatus.PAID);
		expect(ctx.tickets.docs).toHaveLength(2);

		const next = await checkout(ctx);
		const failed: any = await ctx.service.payOrder(BUYER as any, next._id, PaymentSimulation.FAILURE);
		expect(failed.orderStatus).toBe(OrderStatus.FAILED);
	});

	it('an unset PAYMENT_MODE outside production means simulated', async () => {
		delete process.env.PAYMENT_MODE;
		const ctx = build();
		const order = await checkout(ctx);
		const paid: any = await ctx.service.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS);
		expect(paid.orderStatus).toBe(OrderStatus.PAID);
	});

	it('disabled mode refuses payOrder with a clear SERVICE_UNAVAILABLE error and touches nothing', async () => {
		process.env.PAYMENT_MODE = 'disabled';
		const ctx = build();
		const order = await checkout(ctx);

		const error: any = await ctx.service.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS).catch((e) => e);
		expect(error).toBeInstanceOf(GraphQLError);
		expect(error.message).toBe(Message.PAYMENTS_DISABLED);
		expect(error.extensions.code).toBe('SERVICE_UNAVAILABLE');
		expect(ctx.charge).not.toHaveBeenCalled();
		expect(ctx.tickets.docs).toHaveLength(0);
		expect(ctx.orders.docs[0].orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('disabled mode also refuses a repeat payment of an order that is already paid', async () => {
		process.env.PAYMENT_MODE = 'simulated';
		const ctx = build();
		const order = await checkout(ctx);
		await ctx.service.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS);
		process.env.PAYMENT_MODE = 'disabled';
		await expect(ctx.service.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS)).rejects.toThrow(Message.PAYMENTS_DISABLED);
	});
});
