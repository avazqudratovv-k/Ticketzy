import { Message } from './enums/common.enum';
import { RefundPolicyType } from './enums/event.enum';

/** the policy of an event, or the snapshot on an order (DECISIONS #129). `daysBefore` is 0 for NON_REFUNDABLE (not applicable) */
export interface RefundPolicy {
	policyType: RefundPolicyType;
	daysBefore: number;
}

/** the rule before policies existed: refundable until the end of the day before the event */
export const DEFAULT_REFUND_DAYS = 1;
export const MAX_REFUND_DAYS = 30;
export const DEFAULT_REFUND_POLICY: RefundPolicy = { policyType: RefundPolicyType.REFUNDABLE, daysBefore: DEFAULT_REFUND_DAYS };

/** an event or order saved before policies read as the default (refundable until the day before) */
export const readRefundPolicy = (source: { refundPolicy?: Partial<RefundPolicy> | null } | null | undefined): RefundPolicy => {
	const stored = source?.refundPolicy;
	if (!stored?.policyType) return { ...DEFAULT_REFUND_POLICY };
	if (stored.policyType === RefundPolicyType.NON_REFUNDABLE) return { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 };
	return { policyType: RefundPolicyType.REFUNDABLE, daysBefore: stored.daysBefore ?? DEFAULT_REFUND_DAYS };
};

/** why a policy from a client is refused, or null */
export const getRefundPolicyError = (input: { policyType?: RefundPolicyType; daysBefore?: number } | null | undefined): Message | null => {
	if (!input) return null;
	if (input.policyType === RefundPolicyType.NON_REFUNDABLE) return null;
	if (input.policyType !== RefundPolicyType.REFUNDABLE) return Message.INVALID_REFUND_POLICY;
	if (input.daysBefore === undefined || input.daysBefore === null) return null;
	const valid = Number.isInteger(input.daysBefore) && input.daysBefore >= 1 && input.daysBefore <= MAX_REFUND_DAYS;
	return valid ? null : Message.INVALID_REFUND_POLICY;
};

/** what is stored for a policy a client sent (already validated) */
export const buildRefundPolicy = (input: { policyType: RefundPolicyType; daysBefore?: number }): RefundPolicy =>
	input.policyType === RefundPolicyType.NON_REFUNDABLE
		? { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 }
		: { policyType: RefundPolicyType.REFUNDABLE, daysBefore: input.daysBefore ?? DEFAULT_REFUND_DAYS };

/** offset of `timeZone` from UTC at the instant `at`, in milliseconds */
export const getZoneOffsetMs = (at: Date, timeZone: string): number => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	}).formatToParts(at);
	const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return asUtc - Math.floor(at.getTime() / 1000) * 1000;
};

/** the instant (UTC) at which the calendar day year-month-day starts in `timeZone`; two passes keep DST changes right */
const getZonedDayStart = (year: number, month: number, day: number, timeZone: string): Date => {
	const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
	const first = guess - getZoneOffsetMs(new Date(guess), timeZone);
	const second = guess - getZoneOffsetMs(new Date(first), timeZone);
	return new Date(second);
};

/** the year, month and day of `at` as they are on the wall clock in `timeZone` */
const getZonedDate = (at: Date, timeZone: string): { year: number; month: number; day: number } => {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
	const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
	return { year: get('year'), month: get('month'), day: get('day') };
};

/**
 * The last moment a buyer may still refund: the end of 23:59 on the day that is `daysBefore` days before the event starts
 * (1 = the day before, the rule before policies existed), on the wall clock of the venue's timezone. Returned as a UTC
 * instant (what the database stores).
 */
export const getRefundDeadline = (startAt: Date | string, venueTimezone: string, daysBefore: number = DEFAULT_REFUND_DAYS): Date => {
	const { year, month, day } = getZonedDate(new Date(startAt), venueTimezone);
	// the first moment of the day after the last refundable day; Date.UTC rolls a day below 1 into the month before
	const firstMomentAfter = getZonedDayStart(year, month, day - (Math.max(1, daysBefore) - 1), venueTimezone);
	return new Date(firstMomentAfter.getTime() - 1);
};

export const isBeforeRefundDeadline = (startAt: Date | string, venueTimezone: string, now: Date = new Date(), daysBefore: number = DEFAULT_REFUND_DAYS): boolean =>
	now.getTime() <= getRefundDeadline(startAt, venueTimezone, daysBefore).getTime();

/** the refund rules in plain words, for the AI assistant; keep it in line with RefundService.assess and getRefundDeadline (#129) */
export const getRefundPolicyText = (event?: { startAt: Date | string; venueTimezone: string; refundPolicy?: Partial<RefundPolicy> | null }): string => {
	const lines = [
		'Refunds are per order: the whole order is refunded, never a single ticket.',
		'Only a paid order can be refunded, and only while every ticket in it is unused (not checked in at the gate).',
		'Each event has its own refund policy, shown on its event page: either refundable until a number of days before the event (1 to 30 days; the organizer chooses, 1 day is the default), or non-refundable. The last refund moment is 23:59 on that day, on the clock of the venue timezone. After it the buyer can no longer refund, and only the support team can decide.',
	];
	if (event) {
		const policy = readRefundPolicy(event);
		if (policy.policyType === RefundPolicyType.NON_REFUNDABLE) {
			lines.push('This event is NON-REFUNDABLE: the buyer cannot refund an order for it; only the support team can decide.');
		} else {
			const deadline = getRefundDeadline(event.startAt, event.venueTimezone, policy.daysBefore).toISOString();
			lines.push(`This event is refundable until ${policy.daysBefore} day(s) before it starts, that is until ${deadline} (UTC), which is 23:59 on the clock of ${event.venueTimezone}.`);
		}
	}
	lines.push(
		'If the event is cancelled, every paid order of that event is refunded automatically, including tickets that were already used.',
		'A refunded order cannot be paid or used again; its tickets stop working.',
		'The money goes back through the original payment method. Refunding an order that is already refunded changes nothing.',
	);
	return lines.join('\n');
};
