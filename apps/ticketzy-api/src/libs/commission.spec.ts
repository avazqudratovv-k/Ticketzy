import { BASE_COMMISSION_RATE, calculateOrderAmounts, getCommissionRate } from './commission';

describe('getCommissionRate', () => {
	it('is 10 percent for a new organizer', () => {
		expect(getCommissionRate({ completedEvents: 0 })).toBe(10);
		expect(getCommissionRate({})).toBe(BASE_COMMISSION_RATE);
		expect(getCommissionRate({ completedEvents: 4 })).toBe(10);
	});

	it('drops to 7 percent at 5 completed events and 5 percent at 20', () => {
		expect(getCommissionRate({ completedEvents: 5 })).toBe(7);
		expect(getCommissionRate({ completedEvents: 19 })).toBe(7);
		expect(getCommissionRate({ completedEvents: 20 })).toBe(5);
		expect(getCommissionRate({ completedEvents: 500 })).toBe(5);
	});

	it('uses an active override instead of the tier, even a 0 percent one', () => {
		expect(getCommissionRate({ completedEvents: 30, commissionOverride: { rate: 12 } })).toBe(12);
		expect(getCommissionRate({ completedEvents: 0, commissionOverride: { rate: 0 } })).toBe(0);
		const future = new Date(Date.now() + 86400000);
		expect(getCommissionRate({ completedEvents: 0, commissionOverride: { rate: 3, endsAt: future } })).toBe(3);
	});

	it('falls back to the tier once the override has ended', () => {
		const past = new Date(Date.now() - 1000);
		expect(getCommissionRate({ completedEvents: 6, commissionOverride: { rate: 1, endsAt: past } })).toBe(7);
		const now = new Date('2026-01-01T00:00:00Z');
		expect(getCommissionRate({ completedEvents: 0, commissionOverride: { rate: 1, endsAt: now } }, now)).toBe(10);
	});
});

describe('calculateOrderAmounts', () => {
	it('takes the commission out of the organizer share and rounds to cents', () => {
		expect(calculateOrderAmounts(220, 10)).toEqual({ subtotal: 220, commissionRate: 10, commissionAmount: 22, total: 220 });
		expect(calculateOrderAmounts(33.33, 7).commissionAmount).toBe(2.33);
		expect(calculateOrderAmounts(100, 0).commissionAmount).toBe(0);
	});
});
