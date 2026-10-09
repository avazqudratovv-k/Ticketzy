import { ObjectId } from 'bson';
import { PayoutStatus } from './enums/payout.enum';
import { PAYOUT_DEFAULT_TIMEZONE, buildPayoutPipeline, getPayoutDate, getPayoutStatus, shapePayoutTotals } from './payout';

const iso = (date: Date) => date.toISOString();

describe('getPayoutDate (event end + 3 days on the venue wall clock)', () => {
	it('Asia/Seoul: same time of day, three days later', () => {
		expect(iso(getPayoutDate('2026-09-01T12:00:00Z', 'Asia/Seoul'))).toBe('2026-09-04T12:00:00.000Z');
	});

	it('uses the end of the event, so a multi-day event is paid 3 days after its last day, not its first', () => {
		// starts Sep 1, ends Sep 4 01:00 Seoul (= Sep 3 16:00Z)
		expect(iso(getPayoutDate(new Date('2026-09-03T16:00:00Z'), 'Asia/Seoul'))).toBe('2026-09-06T16:00:00.000Z');
	});

	it('a zone ahead of UTC and one behind it land on different instants for the same end', () => {
		const end = '2026-06-10T20:00:00Z';
		expect(iso(getPayoutDate(end, 'Pacific/Auckland'))).toBe('2026-06-13T20:00:00.000Z');
		expect(iso(getPayoutDate(end, 'America/Los_Angeles'))).toBe('2026-06-13T20:00:00.000Z');
		// a fixed offset does not change the 72 hours, so only DST can make the zones differ (next tests)
	});

	it('keeps the wall clock across the DST start: 22:00 New York stays 22:00, which is 71 hours later in UTC', () => {
		// 2026-03-06 22:00 EST, three days later 2026-03-09 22:00 EDT
		expect(iso(getPayoutDate('2026-03-07T03:00:00Z', 'America/New_York'))).toBe('2026-03-10T02:00:00.000Z');
	});

	it('keeps the wall clock across the DST end (Europe/London, 2026-10-25)', () => {
		// 2026-10-23 20:00 BST, three days later 2026-10-26 20:00 GMT
		expect(iso(getPayoutDate('2026-10-23T19:00:00Z', 'Europe/London'))).toBe('2026-10-26T20:00:00.000Z');
	});

	it('a venue without a timezone uses Asia/Seoul, like the refund deadline', () => {
		const end = '2026-09-01T12:00:00Z';
		expect(PAYOUT_DEFAULT_TIMEZONE).toBe('Asia/Seoul');
		expect(iso(getPayoutDate(end, undefined))).toBe(iso(getPayoutDate(end, 'Asia/Seoul')));
		expect(iso(getPayoutDate(end, ''))).toBe(iso(getPayoutDate(end, 'Asia/Seoul')));
	});
});

describe('getPayoutStatus', () => {
	const now = new Date('2026-10-09T00:00:00Z');
	const past = new Date('2026-10-01T00:00:00Z');
	const future = new Date('2026-10-20T00:00:00Z');

	it.each([
		['payout date in the future', { paid: false, net: 5000, payoutDate: future }, PayoutStatus.NOT_YET_DUE],
		['payout date passed, nothing recorded', { paid: false, net: 5000, payoutDate: past }, PayoutStatus.DUE],
		['payout date exactly now counts as passed', { paid: false, net: 5000, payoutDate: now }, PayoutStatus.DUE],
		['recorded by an admin', { paid: true, net: 5000, payoutDate: past }, PayoutStatus.PAID_OUT],
		['recorded, even if refunds changed the live net afterwards', { paid: true, net: 0, payoutDate: past }, PayoutStatus.PAID_OUT],
		['net 0 after the date (all refunded, cancelled)', { paid: false, net: 0, payoutDate: past }, PayoutStatus.NOTHING_TO_PAY],
		['net 0 before the date', { paid: false, net: 0, payoutDate: future }, PayoutStatus.NOTHING_TO_PAY],
	])('%s', (_name, row, expected) => {
		expect(getPayoutStatus(row, now)).toBe(expected);
	});
});

describe('buildPayoutPipeline', () => {
	const now = new Date('2026-10-09T00:00:00Z');
	const stageKeys = (pipeline: any[]) => pipeline.map((stage) => Object.keys(stage)[0]);
	const find = (pipeline: any[], key: string) => pipeline.find((stage) => stage[key]);

	it('adds the payout date in the venue timezone with $dateAdd, 3 days after the event end', () => {
		const pipeline = buildPayoutPipeline({ now }) as any[];
		const add = pipeline.find((stage) => stage.$addFields?.payoutDate).$addFields.payoutDate.$dateAdd;
		expect(add).toEqual({ startDate: '$endAt', unit: 'day', amount: 3, timezone: '$venueTimezone' });
	});

	it('sums only PAID orders with the commission stored on each order (never a current rate)', () => {
		const pipeline = buildPayoutPipeline({ now }) as any[];
		const orders = pipeline.find((stage) => stage.$lookup?.from === 'orders').$lookup.pipeline;
		expect(orders[0].$match.orderStatus).toBe('PAID');
		expect(orders[1].$group.commission).toEqual({ $sum: '$commissionAmount' });
		expect(orders[1].$group.gross).toEqual({ $sum: '$totalAmount' });
		expect(JSON.stringify(pipeline)).not.toMatch(/commissionRate/);
	});

	it('only events that can have a payout are listed (no DRAFT, PENDING, REJECTED)', () => {
		const match = find(buildPayoutPipeline({ now }) as any[], '$match').$match;
		expect(match.eventStatus.$in).toEqual(['APPROVED', 'ENDED', 'CANCELLED']);
	});

	it('the status filter and the page run inside one $facet on the computed status; the totals ignore the status filter', () => {
		const pipeline = buildPayoutPipeline({ now, payoutStatus: PayoutStatus.DUE, page: { skip: 20, limit: 10 } }) as any[];
		const facet = find(pipeline, '$facet').$facet;
		expect(facet.list.slice(0, 3)).toEqual([{ $match: { payoutStatus: 'DUE' } }, { $skip: 20 }, { $limit: 10 }]);
		expect(facet.metaCounter[0]).toEqual({ $match: { payoutStatus: 'DUE' } });
		expect(JSON.stringify(facet.totals)).not.toContain('payoutStatus":"DUE');
		// the status is computed before the facet, in the database
		expect(stageKeys(pipeline).indexOf('$facet')).toBeGreaterThan(pipeline.findIndex((stage) => stage.$addFields?.payoutStatus));
	});

	it('the organizer is joined only for the rows of the page, and only for the admin', () => {
		const facetOf = (withOrganizer: boolean) => find(buildPayoutPipeline({ now, withOrganizer, page: { skip: 0, limit: 5 } }) as any[], '$facet').$facet;
		expect(JSON.stringify(facetOf(true).list)).toContain('memberNick');
		expect(JSON.stringify(facetOf(false).list)).not.toContain('memberNick');
		// nothing joins members before the page is cut
		const pipeline = buildPayoutPipeline({ now, withOrganizer: true, page: { skip: 0, limit: 5 } }) as any[];
		expect(pipeline.filter((stage) => stage.$lookup?.from === 'members')).toHaveLength(0);
	});

	it('filters: organizer, one event, title, and the payout date range', () => {
		const organizerId = new ObjectId();
		const eventId = new ObjectId();
		const dateFrom = new Date('2026-09-01');
		const dateTo = new Date('2026-09-30');
		const pipeline = buildPayoutPipeline({ now, organizerId: organizerId as any, eventId: eventId as any, titleRegex: /rock/i, dateFrom, dateTo }) as any[];
		const match = pipeline[0].$match;
		expect(match.organizerId).toBe(organizerId);
		expect(match._id).toBe(eventId);
		expect(match.$or).toEqual([{ eventTitle: /rock/i }, { 'eventTranslations.title': /rock/i }]);
		// the date range is on the computed payout date, so it is matched after $dateAdd
		const rangeIndex = pipeline.findIndex((stage) => stage.$match?.payoutDate);
		expect(pipeline[rangeIndex].$match.payoutDate).toEqual({ $gte: dateFrom, $lte: dateTo });
		expect(rangeIndex).toBeGreaterThan(pipeline.findIndex((stage) => stage.$addFields?.payoutDate));
	});

	it('a cancelled event has no amounts and a recorded payout shows its stored snapshot', () => {
		const json = JSON.stringify(buildPayoutPipeline({ now }));
		expect(json).toContain('"$eq":["$eventStatus","CANCELLED"]');
		expect(json).toContain('$payout.gross');
		expect(json).toContain('$payout.net');
	});
});

describe('shapePayoutTotals', () => {
	it('maps the grouped nets to the three totals and defaults to 0', () => {
		expect(
			shapePayoutTotals([
				{ _id: PayoutStatus.PAID_OUT, net: 900 },
				{ _id: PayoutStatus.DUE, net: 300 },
				{ _id: PayoutStatus.NOT_YET_DUE, net: 50 },
				{ _id: PayoutStatus.NOTHING_TO_PAY, net: 0 },
			]),
		).toEqual({ totalPaidOut: 900, totalDue: 300, totalUpcoming: 50 });
		expect(shapePayoutTotals(undefined)).toEqual({ totalPaidOut: 0, totalDue: 0, totalUpcoming: 0 });
	});
});
