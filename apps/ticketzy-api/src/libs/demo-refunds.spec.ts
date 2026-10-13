import { REFUND_ROUTE_MARGIN_MS, getRefundRoute } from './demo-refunds';
import { getRefundDeadline } from './refund-policy';

const SEOUL = 'Asia/Seoul';
// an event "tomorrow" at 15:00 in Seoul: the buyer deadline is midnight of Seoul, 15:00 UTC today
const start = new Date('2026-10-14T06:00:00Z');

describe('who refunds a demo order', () => {
	it('the real deadline of that event is the end of the day before, in Seoul', () => {
		expect(getRefundDeadline(start, SEOUL).toISOString()).toBe('2026-10-13T14:59:59.999Z');
	});

	it('the buyer refunds while the deadline is ahead', () => {
		expect(getRefundRoute(start, SEOUL, new Date('2026-10-13T02:00:00Z'))).toBe('buyer');
	});

	it('an admin refunds once the deadline has passed (event tomorrow, run after Seoul midnight)', () => {
		expect(getRefundRoute(start, SEOUL, new Date('2026-10-13T16:00:00Z'))).toBe('admin');
	});

	it('keeps a margin: a buyer refund that could cross the deadline during the run goes to the admin', () => {
		const deadline = getRefundDeadline(start, SEOUL).getTime();
		expect(getRefundRoute(start, SEOUL, new Date(deadline - REFUND_ROUTE_MARGIN_MS - 1000))).toBe('buyer');
		expect(getRefundRoute(start, SEOUL, new Date(deadline - 1000))).toBe('admin');
	});

	it('a far-away event is always a buyer refund', () => {
		expect(getRefundRoute(new Date('2026-12-20T10:00:00Z'), SEOUL, new Date('2026-10-13T16:00:00Z'))).toBe('buyer');
	});
});
