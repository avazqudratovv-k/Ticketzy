import { DemoSeeder } from './demo-seeder';
import { createRng } from './libs/demo-plan';
import { withScenario } from './libs/demo-errors';

const exec = { exec: async () => ({}) };
const model = () => ({ updateOne: jest.fn(() => exec), updateMany: jest.fn(() => exec) });

const makeSeeder = () => {
	const seeder: any = Object.create(DemoSeeder.prototype);
	seeder.now = new Date();
	seeder.admin = { _id: 'admin' };
	seeder.refundCounts = { buyer: 0, admin: 0, adminAfterDeadline: 0 };
	seeder.refundService = { requestRefund: jest.fn(async () => ({})), refundOrderByAdmin: jest.fn(async () => ({})) };
	seeder.models = { refund: model(), order: model(), notification: model(), auditLog: model() };
	return seeder;
};

const build = (startAt: Date, orderCount = 6) => {
	const plan: any = { key: 'harbor-04-derby4', refundAll: false, refundShare: 0.1, adminRefunds: 0, shiftDays: 0, startAt };
	const placed: any[] = Array.from({ length: orderCount }, (_, i) => ({
		orderId: `order-${i}`,
		buyerId: `buyer-${i}`,
		outcome: 'paid',
		toRefund: i === 0, // a refund the plan always wants (like the "refunded" buyer order of the cup)
		protectedOrder: false,
		checkIn: false,
		at: new Date('2026-10-10T10:00:00Z'),
	}));
	return { built: { plan, event: { startAt }, ticketTypes: [] }, placed };
};

describe('DemoSeeder refunds', () => {
	afterEach(() => jest.useRealTimers());

	it('uses the real buyer refund while the deadline is ahead', async () => {
		jest.useFakeTimers({ now: new Date('2026-10-13T02:00:00Z') });
		const seeder = makeSeeder();
		const { built, placed } = build(new Date('2026-10-14T06:00:00Z'));
		await seeder.refunds(built, placed, createRng(1));
		expect(seeder.refundService.requestRefund).toHaveBeenCalled();
		expect(seeder.refundService.refundOrderByAdmin).not.toHaveBeenCalled();
		expect(seeder.refundCounts.buyer).toBeGreaterThanOrEqual(2);
		expect(seeder.refundCounts.adminAfterDeadline).toBe(0);
	});

	it('refunds through the admin path when the event starts tomorrow and the deadline has passed, and never asks the buyer path', async () => {
		jest.useFakeTimers({ now: new Date('2026-10-13T16:00:00Z') });
		const seeder = makeSeeder();
		const { built, placed } = build(new Date('2026-10-14T06:00:00Z'));
		await seeder.refunds(built, placed, createRng(1));
		expect(seeder.refundService.requestRefund).not.toHaveBeenCalled();
		const calls = seeder.refundService.refundOrderByAdmin.mock.calls;
		expect(calls.length).toBeGreaterThanOrEqual(2);
		expect(calls.map(([, input]: any[]) => input.orderId)).toContain('order-0'); // the forced refund is not lost
		expect(calls[0][1].reason).toBeTruthy(); // the admin refund needs a reason
		expect(seeder.refundCounts.adminAfterDeadline).toBe(calls.length);
		// the refund is dated like the others
		expect(seeder.models.refund.updateOne).toHaveBeenCalledTimes(calls.length);
	});

	it('a refund that fails says which refund of which event failed', async () => {
		jest.useFakeTimers({ now: new Date('2026-10-13T02:00:00Z') });
		const seeder = makeSeeder();
		seeder.refundService.requestRefund.mockRejectedValueOnce(new Error('The refund deadline of this order has passed!'));
		const { built, placed } = build(new Date('2026-10-14T06:00:00Z'));
		await expect(withScenario('event 46/56 harbor-04-derby4 (APPROVED)', () => seeder.refunds(built, placed, createRng(1)))).rejects.toThrow(
			/^event 46\/56 harbor-04-derby4 \(APPROVED\) > refund 1\/\d+ \(buyer\): The refund deadline of this order has passed!$/,
		);
	});
});

describe('DemoSeeder moderation', () => {
	it('swaps the moderation of its own EventService for a counter, with no AI call and no warning', async () => {
		const seeder = makeSeeder();
		const original = { moderateEvent: jest.fn() };
		seeder.eventService = { aiModerationService: original };
		seeder.moderationSkipped = 0;
		seeder.skipModeration();
		await seeder.eventService.aiModerationService.moderateEvent('e1');
		await seeder.eventService.aiModerationService.moderateEvent('e2');
		expect(seeder.moderationSkipped).toBe(2);
		expect(original.moderateEvent).not.toHaveBeenCalled();
	});
});
