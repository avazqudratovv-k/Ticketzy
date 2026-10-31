/**
 * Who may refund a demo order (DECISIONS #109). A buyer is bound to the real refund deadline (the day before the event, venue
 * time zone, `libs/refund-policy.ts`); the check is never weakened for the seed. An event that starts tomorrow is past that
 * deadline from midnight of the venue's time zone, so a refund the plan gives to the buyer is then done through the real admin
 * refund (`refundOrderByAdmin`), which the policy allows after the deadline and which writes its audit entry.
 */
import { RefundPolicy, isBeforeRefundDeadline, readRefundPolicy } from './refund-policy';
import { RefundPolicyType } from './enums/event.enum';

export type RefundRoute = 'buyer' | 'admin';

/** why a refund the plan gives to a buyer goes through an admin: the deadline of the policy passed, or the event is non-refundable (#129) */
export type RefundRouteReason = 'deadline' | 'policy';

/** a refund takes a moment and a seed run is long: the buyer route is used only with this much time to spare */
export const REFUND_ROUTE_MARGIN_MS = 5 * 60 * 1000;

export const getRefundRoute = (startAt: Date | string, venueTimezone: string, now: Date, policy?: RefundPolicy): RefundRoute =>
	getRefundRouteReason(startAt, venueTimezone, now, policy) ? 'admin' : 'buyer';

/** null when the buyer may refund; otherwise why only an admin can (a non-refundable event is never a buyer refund) */
export const getRefundRouteReason = (startAt: Date | string, venueTimezone: string, now: Date, policy?: RefundPolicy): RefundRouteReason | null => {
	const rule = readRefundPolicy(policy ? { refundPolicy: policy } : null);
	if (rule.policyType === RefundPolicyType.NON_REFUNDABLE) return 'policy';
	return isBeforeRefundDeadline(startAt, venueTimezone, new Date(now.getTime() + REFUND_ROUTE_MARGIN_MS), rule.daysBefore) ? null : 'deadline';
};
