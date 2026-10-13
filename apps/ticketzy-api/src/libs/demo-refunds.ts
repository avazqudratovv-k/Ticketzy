/**
 * Who may refund a demo order (DECISIONS #109). A buyer is bound to the real refund deadline (the day before the event, venue
 * time zone, `libs/refund-policy.ts`); the check is never weakened for the seed. An event that starts tomorrow is past that
 * deadline from midnight of the venue's time zone, so a refund the plan gives to the buyer is then done through the real admin
 * refund (`refundOrderByAdmin`), which the policy allows after the deadline and which writes its audit entry.
 */
import { isBeforeRefundDeadline } from './refund-policy';

export type RefundRoute = 'buyer' | 'admin';

/** a refund takes a moment and a seed run is long: the buyer route is used only with this much time to spare */
export const REFUND_ROUTE_MARGIN_MS = 5 * 60 * 1000;

export const getRefundRoute = (startAt: Date | string, venueTimezone: string, now: Date): RefundRoute =>
	isBeforeRefundDeadline(startAt, venueTimezone, new Date(now.getTime() + REFUND_ROUTE_MARGIN_MS)) ? 'buyer' : 'admin';
