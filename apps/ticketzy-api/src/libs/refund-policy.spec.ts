import { getRefundDeadline, isBeforeRefundDeadline } from './refund-policy';

describe('getRefundDeadline', () => {
	// 2026-12-25 10:00 UTC is 19:00 on Dec 25 in Seoul (UTC+9) and 02:00 on Dec 25 in Los Angeles (UTC-8)
	const startAt = new Date('2026-12-25T10:00:00Z');

	it('is the end of 23:59 on the day before the event, on the venue wall clock', () => {
		expect(getRefundDeadline(startAt, 'Asia/Seoul').toISOString()).toBe('2026-12-24T14:59:59.999Z');
	});

	it('moves with the venue timezone for the very same start instant', () => {
		expect(getRefundDeadline(startAt, 'America/Los_Angeles').toISOString()).toBe('2026-12-25T07:59:59.999Z');
		expect(getRefundDeadline(startAt, 'UTC').toISOString()).toBe('2026-12-24T23:59:59.999Z');
	});

	it('uses the event day of the venue, which can differ from the UTC day', () => {
		// 16:00 UTC on Dec 24 is already 01:00 on Dec 25 in Seoul: the day before is Dec 24 there, Dec 23 in UTC
		const lateUtc = new Date('2026-12-24T16:00:00Z');
		expect(getRefundDeadline(lateUtc, 'Asia/Seoul').toISOString()).toBe('2026-12-24T14:59:59.999Z');
		expect(getRefundDeadline(lateUtc, 'UTC').toISOString()).toBe('2026-12-23T23:59:59.999Z');
	});

	it('follows daylight saving time', () => {
		// New York changed to summer time on 2026-03-08: midnight of that day is still EST (UTC-5)
		expect(getRefundDeadline(new Date('2026-03-08T15:00:00Z'), 'America/New_York').toISOString()).toBe('2026-03-08T04:59:59.999Z');
		// the day after the change is EDT (UTC-4)
		expect(getRefundDeadline(new Date('2026-03-09T15:00:00Z'), 'America/New_York').toISOString()).toBe('2026-03-09T03:59:59.999Z');
	});

	it('accepts an ISO string for the start', () => {
		expect(getRefundDeadline('2026-12-25T10:00:00Z', 'Asia/Seoul').toISOString()).toBe('2026-12-24T14:59:59.999Z');
	});
});

describe('isBeforeRefundDeadline', () => {
	const startAt = new Date('2026-12-25T10:00:00Z');

	it('includes the last millisecond and excludes the next', () => {
		expect(isBeforeRefundDeadline(startAt, 'Asia/Seoul', new Date('2026-12-24T14:59:59.999Z'))).toBe(true);
		expect(isBeforeRefundDeadline(startAt, 'Asia/Seoul', new Date('2026-12-24T15:00:00.000Z'))).toBe(false);
	});

	it('answers differently for different timezones at the same moment', () => {
		const now = new Date('2026-12-24T20:00:00Z');
		expect(isBeforeRefundDeadline(startAt, 'Asia/Seoul', now)).toBe(false);
		expect(isBeforeRefundDeadline(startAt, 'America/Los_Angeles', now)).toBe(true);
	});
});
