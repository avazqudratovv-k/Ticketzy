import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { AccountService } from './account.service';
import { AccountResolver } from './account.resolver';
import { SeatService } from '../seat/seat.service';
import { OrderService } from '../order/order.service';
import { PaymentService } from '../payment/payment.service';
import { MockPaymentProvider } from '../payment/mock-payment.provider';
import { TicketService } from '../ticket/ticket.service';
import { AuthService } from '../auth/auth.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccountDeletionBlockedException } from '../../libs/coded-exception';
import { formatGraphQLError } from '../../libs/error-mapping';
import { createValidationPipe } from '../../libs/validation';
import { DeleteAccountInput } from '../../libs/dto/account/account.input';
import { DeletionBlockReason } from '../../libs/enums/account.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, SeatStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus, PaymentSimulation, TicketStatus } from '../../libs/enums/ticket.enum';

const oid = () => new ObjectId();
const DAY = 24 * 3600 * 1000;
const inHours = (hours: number) => new Date(Date.now() + hours * 3600000);
const BUYER = oid();
const OTHER = oid();
const ORG = oid();
const ADMIN = oid();
const EVENT = oid();
const GENERAL_EVENT = oid();
const TT = oid();
const GENERAL_TT = oid();

const build = () => {
	const members = new FakeModel([
		{ _id: BUYER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER, emailVerifiedAt: new Date('2026-01-01'), memberEmail: 'buyer@x.com', memberNick: 'buyer' },
		{ _id: OTHER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER, emailVerifiedAt: new Date('2026-01-01') },
		{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, memberEmail: 'org@x.com' },
		{ _id: ADMIN, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ADMIN },
	]);
	const events = new FakeModel([
		{ _id: EVENT, eventTitle: 'Reserved', eventStatus: EventStatus.APPROVED, seatingType: SeatingType.RESERVED, organizerId: ORG, startAt: inHours(24), endAt: inHours(27) },
		{ _id: GENERAL_EVENT, eventTitle: 'General', eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: inHours(24), endAt: inHours(27) },
	]);
	const seats = new FakeModel(
		Array.from({ length: 5 }, (_, i) => ({
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
		findSellable: jest.fn(async () => [{ _id: TT, eventId: EVENT, ticketPrice: 50, ticketCurrency: 'KRW' }]),
		reserve: jest.fn(async () => ({ _id: GENERAL_TT, eventId: GENERAL_EVENT, ticketPrice: 20, ticketCurrency: 'KRW' })),
		release: jest.fn().mockResolvedValue(undefined),
		addSold: jest.fn(async (counts: any[]) => counts),
	};
	const notificationService: any = { createNotification: jest.fn().mockResolvedValue(undefined) };
	const seatService = new SeatService(seats as any, events as any, members as any);
	const orderService = new OrderService(
		orders as any,
		events as any,
		tickets as any,
		members as any,
		ticketTypeService,
		seatService,
		new PaymentService(payments as any, new MockPaymentProvider()),
		notificationService,
	);
	const payoutService: any = { getOpenPayoutsOf: jest.fn().mockResolvedValue({ count: 0, eventNames: [] }) };
	const auditLogService: any = { record: jest.fn().mockResolvedValue(undefined) };
	const accountService = new AccountService(members as any, events as any, tickets as any, orderService, seatService, payoutService, auditLogService);
	const ticketService = new TicketService(tickets as any, events as any, members as any, { findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }) } as any, { findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }) } as any);
	const asMember = (id: ObjectId) => members.docs.find((doc) => String(doc._id) === String(id));
	const statusOf = (id: ObjectId) => asMember(id).memberStatus;
	return { members, events, seats, orders, tickets, ticketTypeService, seatService, orderService, payoutService, auditLogService, accountService, ticketService, asMember, statusOf };
};

beforeAll(() => {
	process.env.QR_SECRET = 'test-qr-secret';
});

describe('deleting an account: the buyer (DECISIONS #123)', () => {
	it('sets DELETE and adds the two tags, and changes no other value of the member', async () => {
		const ctx = build();
		const before = { ...ctx.asMember(BUYER) };
		const result = await ctx.accountService.deleteAccount(ctx.asMember(BUYER));

		const after = ctx.asMember(BUYER);
		expect(result.deleted).toBe(true);
		expect(after.memberStatus).toBe(MemberStatus.DELETE);
		expect(after.deletedAt).toBeInstanceOf(Date);
		expect(after.emailReusableAt.getTime() - after.deletedAt.getTime()).toBe(30 * DAY);
		// only memberStatus changed among the old values; email, nick and the rest are exactly as they were
		const { memberStatus: _a, ...oldRest } = before;
		const { memberStatus: _b, deletedAt: _c, emailReusableAt: _d, ...newRest } = after;
		expect(newRest).toEqual(oldRest);
	});

	it('releases seat holds on every event and cancels unpaid orders; other members\' holds are untouched', async () => {
		const ctx = build();
		await ctx.seatService.holdSeats(BUYER as any, EVENT as any, [ctx.seats.docs[0]._id, ctx.seats.docs[1]._id]);
		await ctx.seatService.holdSeats(OTHER as any, EVENT as any, [ctx.seats.docs[3]._id]);
		const reserved: any = await ctx.orderService.createCheckout(BUYER as any, { eventId: EVENT, seatIds: [ctx.seats.docs[0]._id, ctx.seats.docs[1]._id] } as any);
		const general: any = await ctx.orderService.createCheckout(BUYER as any, { eventId: GENERAL_EVENT, items: [{ ticketTypeId: GENERAL_TT, quantity: 2 }] } as any);

		const result = await ctx.accountService.deleteAccount(ctx.asMember(BUYER));

		expect(result).toEqual({ deleted: true, releasedSeatHolds: 2, cancelledPendingOrders: 2 });
		expect(ctx.seats.docs[0].seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.seats.docs[1].seatStatus).toBe(SeatStatus.AVAILABLE);
		expect(ctx.seats.docs[0].heldBy).toBeUndefined();
		expect(ctx.seats.docs[3].seatStatus).toBe(SeatStatus.HELD);
		expect(String(ctx.seats.docs[3].heldBy)).toBe(String(OTHER));
		for (const order of [reserved, general]) {
			expect(ctx.orders.docs.find((doc) => String(doc._id) === String(order._id)).orderStatus).toBe(OrderStatus.CANCELLED);
		}
		// general stock goes back through the ticket type service
		expect(ctx.ticketTypeService.release).toHaveBeenCalledWith(GENERAL_TT, 2);
		expect(ctx.auditLogService.record).toHaveBeenCalledWith({
			actorId: BUYER,
			action: AuditAction.ACCOUNT_DELETED_BY_OWNER,
			targetType: AuditTargetType.MEMBER,
			targetId: BUYER,
			meta: { memberType: MemberType.USER, releasedSeatHolds: 2, cancelledPendingOrders: 2 },
		});
	});

	it('paid orders, sold seats and valid tickets are not touched, and the tickets still check in by ticket code and by QR', async () => {
		const ctx = build();
		await ctx.seatService.holdSeats(BUYER as any, EVENT as any, [ctx.seats.docs[0]._id, ctx.seats.docs[1]._id]);
		const order: any = await ctx.orderService.createCheckout(BUYER as any, { eventId: EVENT, seatIds: [ctx.seats.docs[0]._id, ctx.seats.docs[1]._id] } as any);
		const paid: any = await ctx.orderService.payOrder(BUYER as any, order._id, PaymentSimulation.SUCCESS);
		expect(paid.orderStatus).toBe(OrderStatus.PAID);
		const [ticketA, ticketB] = ctx.tickets.docs.map((doc) => ({ ...doc }));
		expect(ticketA.ticketStatus).toBe(TicketStatus.VALID);

		const result = await ctx.accountService.deleteAccount(ctx.asMember(BUYER));

		expect(result).toMatchObject({ releasedSeatHolds: 0, cancelledPendingOrders: 0 });
		expect(ctx.orders.docs[0].orderStatus).toBe(OrderStatus.PAID);
		expect(ctx.seats.docs[0].seatStatus).toBe(SeatStatus.SOLD);
		expect(ctx.tickets.docs.map((doc) => doc.ticketStatus)).toEqual([TicketStatus.VALID, TicketStatus.VALID]);
		expect(ctx.statusOf(BUYER)).toBe(MemberStatus.DELETE);

		// the organizer scans: the gate never reads the buyer's status
		const byCode = await ctx.ticketService.checkInTicketByCode(ORG as any, MemberType.ORGANIZER, EVENT as any, ticketA.ticketCode);
		expect(byCode.ticketStatus).toBe(TicketStatus.USED);
		const byQr = await ctx.ticketService.checkInTicket(ORG as any, MemberType.ORGANIZER, ticketB.qrToken, EVENT as any);
		expect(byQr.ticketStatus).toBe(TicketStatus.USED);
	});

	it('is a buyer-only cleanup: a repeated call matches nothing and releases nothing twice', async () => {
		const ctx = build();
		await ctx.accountService.deleteAccount(ctx.asMember(BUYER));
		await expect(ctx.accountService.deleteAccount(ctx.asMember(BUYER))).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		expect(ctx.auditLogService.record).toHaveBeenCalledTimes(1);
	});

	it('stays deleted when giving back holds fails (holds and unpaid orders run out by themselves)', async () => {
		const ctx = build();
		jest.spyOn(ctx.seatService, 'releaseAllHoldsOf').mockRejectedValue(new Error('db down'));

		await expect(ctx.accountService.deleteAccount(ctx.asMember(BUYER))).resolves.toMatchObject({ deleted: true, releasedSeatHolds: 0 });
		expect(ctx.statusOf(BUYER)).toBe(MemberStatus.DELETE);
		expect(ctx.auditLogService.record).toHaveBeenCalledTimes(1);
	});

	it('the check counts VALID tickets of events that have not ended, and a buyer is never blocked', async () => {
		const ctx = build();
		const aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ total: 3 }]) });
		const service = new AccountService(ctx.members as any, ctx.events as any, { aggregate } as any, ctx.orderService, ctx.seatService, ctx.payoutService, ctx.auditLogService);

		const check = await service.getDeletionCheck(ctx.asMember(BUYER));

		expect(check).toEqual({ canDelete: true, blockers: [], unusedUpcomingTickets: 3 });
		const [match, lookup, ended, count] = aggregate.mock.calls[0][0];
		expect(match.$match).toEqual({ ownerId: BUYER, ticketStatus: TicketStatus.VALID });
		expect(lookup.$lookup.from).toBe('events');
		expect(ended.$match['eventData.endAt'].$gt).toBeInstanceOf(Date);
		expect(count).toEqual({ $count: 'total' });
		expect(ctx.payoutService.getOpenPayoutsOf).not.toHaveBeenCalled();
	});
});

describe('deleting an account: the organizer (DECISIONS #123)', () => {
	const withEvents = (extra: any[]) => {
		const ctx = build();
		ctx.events.docs.length = 0;
		ctx.events.docs.push(...extra.map((doc) => ({ _id: oid(), organizerId: ORG, startAt: inHours(24), endAt: inHours(27), ...doc })));
		return ctx;
	};

	it('is allowed with no events, or with DRAFT, REJECTED, CANCELLED and ENDED events and nothing to pay out', async () => {
		const ctx = withEvents([
			{ eventTitle: 'd', eventStatus: EventStatus.DRAFT },
			{ eventTitle: 'r', eventStatus: EventStatus.REJECTED },
			{ eventTitle: 'c', eventStatus: EventStatus.CANCELLED },
			{ eventTitle: 'e', eventStatus: EventStatus.ENDED, endAt: new Date(Date.now() - DAY) },
			{ eventTitle: 'approved but over by the clock', eventStatus: EventStatus.APPROVED, startAt: new Date(Date.now() - 2 * DAY), endAt: new Date(Date.now() - DAY) },
		]);
		expect(await ctx.accountService.getDeletionCheck(ctx.asMember(ORG))).toEqual({ canDelete: true, blockers: [], unusedUpcomingTickets: 0 });

		const result = await ctx.accountService.deleteAccount(ctx.asMember(ORG));

		expect(result).toEqual({ deleted: true, releasedSeatHolds: 0, cancelledPendingOrders: 0 });
		expect(ctx.statusOf(ORG)).toBe(MemberStatus.DELETE);
		// the organizer's events are not changed or removed; they disappear from the public because the organizer is no longer ACTIVE
		expect(ctx.events.docs).toHaveLength(5);
		expect(ctx.events.docs.map((doc) => doc.eventStatus)).toEqual([EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.CANCELLED, EventStatus.ENDED, EventStatus.APPROVED]);
	});

	it('a PENDING organizer may delete too', async () => {
		const ctx = withEvents([]);
		ctx.asMember(ORG).memberStatus = MemberStatus.PENDING;
		await expect(ctx.accountService.deleteAccount(ctx.asMember(ORG))).resolves.toMatchObject({ deleted: true });
	});

	it('is blocked by an event in PENDING review, naming it', async () => {
		const ctx = withEvents([{ eventTitle: 'Waiting show', eventStatus: EventStatus.PENDING }]);
		const blocked: any = await ctx.accountService.deleteAccount(ctx.asMember(ORG)).catch((err) => err);

		expect(blocked).toBeInstanceOf(AccountDeletionBlockedException);
		expect(blocked.code).toBe('ACCOUNT_DELETE_BLOCKED');
		expect(blocked.message).toBe(Message.ACCOUNT_DELETE_BLOCKED);
		expect(blocked.reasons).toEqual([{ reason: DeletionBlockReason.EVENTS_IN_REVIEW, count: 1, eventNames: ['Waiting show'] }]);
		expect(ctx.statusOf(ORG)).toBe(MemberStatus.ACTIVE);
		expect(ctx.auditLogService.record).not.toHaveBeenCalled();
	});

	it('is blocked by an APPROVED event that has not ended', async () => {
		const ctx = withEvents([{ eventTitle: 'Live show', eventStatus: EventStatus.APPROVED }]);
		const check = await ctx.accountService.getDeletionCheck(ctx.asMember(ORG));

		expect(check.canDelete).toBe(false);
		expect(check.blockers).toEqual([{ reason: DeletionBlockReason.EVENTS_NOT_ENDED, count: 1, eventNames: ['Live show'] }]);
	});

	it.each([
		['NOT_YET_DUE and DUE payouts', { count: 2, eventNames: ['Due show', 'Soon show'] }],
	])('is blocked by %s', async (_name, payouts) => {
		const ctx = withEvents([]);
		ctx.payoutService.getOpenPayoutsOf.mockResolvedValue(payouts);
		const check = await ctx.accountService.getDeletionCheck(ctx.asMember(ORG));

		expect(check.blockers).toEqual([{ reason: DeletionBlockReason.PAYOUTS_NOT_PAID, count: 2, eventNames: ['Due show', 'Soon show'] }]);
		expect(ctx.payoutService.getOpenPayoutsOf.mock.calls[0][0]).toBe(ORG);
	});

	it('lists every reason at once, keeps the full count and shows at most 10 names', async () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ eventTitle: `Open ${i}`, eventStatus: EventStatus.APPROVED }));
		const ctx = withEvents([{ eventTitle: 'Review', eventStatus: EventStatus.PENDING }, ...many]);
		ctx.payoutService.getOpenPayoutsOf.mockResolvedValue({ count: 1, eventNames: ['Open 0'] });

		const { blockers } = await ctx.accountService.getDeletionCheck(ctx.asMember(ORG));

		expect(blockers.map((blocker) => blocker.reason)).toEqual([
			DeletionBlockReason.EVENTS_IN_REVIEW,
			DeletionBlockReason.EVENTS_NOT_ENDED,
			DeletionBlockReason.PAYOUTS_NOT_PAID,
		]);
		expect(blockers[1].count).toBe(12);
		expect(blockers[1].eventNames).toHaveLength(10);
	});

	it('only the organizer\'s own events count', async () => {
		const ctx = withEvents([{ eventTitle: 'Not mine', eventStatus: EventStatus.PENDING, organizerId: oid() }]);
		expect((await ctx.accountService.getDeletionCheck(ctx.asMember(ORG))).canDelete).toBe(true);
	});

	it('the refusal reaches the client as { code, message, reasons } and nothing else', () => {
		const error = new AccountDeletionBlockedException(Message.ACCOUNT_DELETE_BLOCKED, [{ reason: DeletionBlockReason.EVENTS_IN_REVIEW, count: 1, eventNames: ['A'] }]);
		const logger = { warn: jest.fn(), error: jest.fn() };

		expect(formatGraphQLError({ extensions: {} }, error, logger)).toEqual({
			code: 'ACCOUNT_DELETE_BLOCKED',
			message: Message.ACCOUNT_DELETE_BLOCKED,
			reasons: [{ reason: 'EVENTS_IN_REVIEW', count: 1, eventNames: ['A'] }],
		});
	});
});

describe('who may call it, the confirmation word and the old token', () => {
	it('only USER and ORGANIZER may call both operations; an admin is refused by the role guard', async () => {
		for (const method of ['deleteMyAccount', 'getMyAccountDeletionCheck'] as const) {
			expect(Reflect.getMetadata('roles', AccountResolver.prototype[method])).toEqual([MemberType.USER, MemberType.ORGANIZER]);
		}
		const authService: any = { getBearerToken: () => 't', authenticate: jest.fn().mockResolvedValue({ _id: ADMIN, memberType: MemberType.ADMIN }) };
		const guard = new RolesGuard(new Reflector(), authService);
		const context: any = {
			contextType: 'graphql',
			getHandler: () => AccountResolver.prototype.deleteMyAccount,
			getArgByIndex: () => ({ req: { body: {} } }),
		};
		await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
	});

	it('needs the exact word DELETE; the error names the field and the rule, never the value', async () => {
		const pipe = createValidationPipe();
		const run = (value: any) => pipe.transform(value, { type: 'body', metatype: DeleteAccountInput });
		await expect(run({ confirmation: 'DELETE' })).resolves.toMatchObject({ confirmation: 'DELETE' });
		for (const bad of [{ confirmation: 'delete' }, { confirmation: ' DELETE' }, { confirmation: 'yes' }, {}, { confirmation: true }]) {
			const err: any = await run(bad).catch((e) => e);
			expect(err.code).toBe('VALIDATION_FAILED');
			expect(err.fields).toEqual([{ field: 'confirmation', rules: ['equals'] }]);
		}
	});

	it('the old token stops working at once: the guards reload the member and refuse DELETE', async () => {
		const ctx = build();
		const authService = new AuthService({ signAsync: jest.fn().mockResolvedValue('t'), verifyAsync: jest.fn().mockResolvedValue({ _id: String(BUYER), memberType: MemberType.USER }) } as any, ctx.members as any);
		// FakeModel has no findById; the guard path only needs the lean lookup by id
		(ctx.members as any).findById = (id: any) => ctx.members.findOne({ _id: id });
		await expect(authService.authenticate('token')).resolves.toBeDefined();

		await ctx.accountService.deleteAccount(ctx.asMember(BUYER));

		await expect(authService.authenticate('token')).rejects.toThrow(Message.ACCOUNT_NOT_VERIFIED);
		await expect(authService.authenticate('token', { allowRestricted: true })).rejects.toThrow(Message.ACCOUNT_NOT_VERIFIED);
	});

	it('a delete mutation is rate limited like a password change: 5 per 15 minutes per member', async () => {
		const { RateLimits, enforceAccountDeleteLimit } = await import('../../libs/rate-limit');
		const { DEFAULT_RATE_LIMITS } = await import('../../libs/env.validation');
		const shared = new RateLimits({ ...DEFAULT_RATE_LIMITS });
		for (let attempt = 0; attempt < 5; attempt++) enforceAccountDeleteLimit({ ip: `1.1.1.${attempt}` }, 'm1', shared);
		let error: any;
		try {
			enforceAccountDeleteLimit({ ip: '1.1.1.9' }, 'm1', shared);
		} catch (err) {
			error = err;
		}
		expect(error.code).toBe('RATE_LIMITED');
		expect(() => enforceAccountDeleteLimit({ ip: '2.2.2.2' }, 'm2', shared)).not.toThrow();
		// its own bucket: a password change is not affected
		expect(() => shared.enforce('password', 'member:m1')).not.toThrow();
	});
});

describe('the same operation cannot be abused', () => {
	it('an admin account is never deleted by the service either', async () => {
		const ctx = build();
		await expect(ctx.accountService.deleteAccount(ctx.asMember(ADMIN))).rejects.toThrow(BadRequestException);
		expect(ctx.statusOf(ADMIN)).toBe(MemberStatus.ACTIVE);
	});
});
