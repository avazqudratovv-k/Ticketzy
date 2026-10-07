/** platform commission rates in percent: 10 base, 7 from 5 completed events, 5 from 20 */
export const BASE_COMMISSION_RATE = 10;
export const commissionTiers = [
	{ minCompletedEvents: 20, rate: 5 },
	{ minCompletedEvents: 5, rate: 7 },
];

export interface CommissionSubject {
	completedEvents?: number;
	commissionOverride?: { rate: number; endsAt?: Date | null } | null;
}

/** an admin override wins while it has no end date or the end date is in the future; otherwise the tier by completed events */
export const getCommissionRate = (organizer: CommissionSubject, now: Date = new Date()): number => {
	const override = organizer.commissionOverride;
	if (override && typeof override.rate === 'number' && (!override.endsAt || new Date(override.endsAt) > now)) {
		return override.rate;
	}
	const completed = organizer.completedEvents ?? 0;
	return commissionTiers.find((tier) => completed >= tier.minCompletedEvents)?.rate ?? BASE_COMMISSION_RATE;
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** the commission is taken from the organizer's share; the buyer pays the subtotal */
export const calculateOrderAmounts = (subtotal: number, commissionRate: number) => {
	const commissionAmount = roundMoney((subtotal * commissionRate) / 100);
	return { subtotal, commissionRate, commissionAmount, total: subtotal };
};
