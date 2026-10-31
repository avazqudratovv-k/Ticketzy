import { RefundPolicyType } from './enums/event.enum';
import { getRefundDeadline, getRefundPolicyText, isBeforeRefundDeadline } from './refund-policy';

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

describe('refund deadline boundaries', () => {
	const deadline = (start: string, zone: string) => getRefundDeadline(new Date(start), zone).toISOString();

	describe('events around local midnight (Asia/Seoul, UTC+9)', () => {
		it('an event starting at 00:00:00.000 local has its deadline one millisecond before it', () => {
			expect(deadline('2026-12-24T15:00:00.000Z', 'Asia/Seoul')).toBe('2026-12-24T14:59:59.999Z');
		});

		it('an event starting at 00:00:00.001 and one at 23:59:59.999 of the same local day share a deadline', () => {
			expect(deadline('2026-12-24T15:00:00.001Z', 'Asia/Seoul')).toBe('2026-12-24T14:59:59.999Z');
			expect(deadline('2026-12-25T14:59:59.999Z', 'Asia/Seoul')).toBe('2026-12-24T14:59:59.999Z');
		});

		it('one millisecond before local midnight belongs to the previous day', () => {
			expect(deadline('2026-12-24T14:59:59.999Z', 'Asia/Seoul')).toBe('2026-12-23T14:59:59.999Z');
		});

		it('crosses month and year ends', () => {
			expect(deadline('2027-01-01T01:00:00Z', 'Asia/Seoul')).toBe('2026-12-31T14:59:59.999Z'); // Jan 1 10:00 KST
			expect(deadline('2026-03-01T01:00:00Z', 'Asia/Seoul')).toBe('2026-02-28T14:59:59.999Z');
		});
	});

	describe('buyer cut-off just before and just after 23:59 the day before', () => {
		const start = new Date('2026-12-25T10:00:00Z'); // 19:00 on Dec 25 in Seoul
		it.each([
			['23:58:00 local', '2026-12-24T14:58:00.000Z', true],
			['23:59:00 local', '2026-12-24T14:59:00.000Z', true],
			['23:59:59.999 local', '2026-12-24T14:59:59.999Z', true],
			['00:00:00.000 local on the event day', '2026-12-24T15:00:00.000Z', false],
			['00:00:01 local on the event day', '2026-12-24T15:00:01.000Z', false],
			['the event start itself', '2026-12-25T10:00:00.000Z', false],
		])('Seoul at %s', (_label, now, expected) => {
			expect(isBeforeRefundDeadline(start, 'Asia/Seoul', new Date(now))).toBe(expected);
		});
	});

	describe('other timezones, including half-hour offsets', () => {
		it('Asia/Kolkata (UTC+5:30)', () => {
			expect(deadline('2026-12-25T10:00:00Z', 'Asia/Kolkata')).toBe('2026-12-24T18:29:59.999Z');
		});

		it('UTC and a zone far west (Pacific/Honolulu, UTC-10)', () => {
			expect(deadline('2026-12-25T10:00:00Z', 'UTC')).toBe('2026-12-24T23:59:59.999Z');
			// 10:00Z is 00:00 on Dec 25 in Honolulu: the event day starts exactly then
			expect(deadline('2026-12-25T10:00:00Z', 'Pacific/Honolulu')).toBe('2026-12-25T09:59:59.999Z');
			expect(deadline('2026-12-25T09:59:59.999Z', 'Pacific/Honolulu')).toBe('2026-12-24T09:59:59.999Z');
		});
	});

	describe('daylight saving time', () => {
		it('America/New_York, clocks go back on 2026-11-01: the 25 hour day', () => {
			// midnight of Nov 1 is still EDT (UTC-4); midnight of Nov 2 is EST (UTC-5)
			expect(deadline('2026-11-01T15:00:00Z', 'America/New_York')).toBe('2026-11-01T03:59:59.999Z');
			expect(deadline('2026-11-02T15:00:00Z', 'America/New_York')).toBe('2026-11-02T04:59:59.999Z');
			expect(isBeforeRefundDeadline('2026-11-01T15:00:00Z', 'America/New_York', new Date('2026-11-01T03:59:59.999Z'))).toBe(true);
			expect(isBeforeRefundDeadline('2026-11-01T15:00:00Z', 'America/New_York', new Date('2026-11-01T04:00:00.000Z'))).toBe(false);
		});

		it('America/New_York, an event in the repeated hour (01:30 EDT and 01:30 EST)', () => {
			expect(deadline('2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-01T03:59:59.999Z'); // 01:30 EDT
			expect(deadline('2026-11-01T06:30:00Z', 'America/New_York')).toBe('2026-11-01T03:59:59.999Z'); // 01:30 EST
		});

		it('America/New_York, clocks go forward on 2026-03-08: the 23 hour day', () => {
			expect(deadline('2026-03-08T12:00:00Z', 'America/New_York')).toBe('2026-03-08T04:59:59.999Z');
			// an event in the evening of the short day still uses that day's midnight
			expect(deadline('2026-03-09T03:30:00Z', 'America/New_York')).toBe('2026-03-08T04:59:59.999Z'); // 23:30 EDT on Mar 8
		});

		it('Europe/London, summer time starts on 2026-03-29', () => {
			expect(deadline('2026-03-29T12:00:00Z', 'Europe/London')).toBe('2026-03-28T23:59:59.999Z'); // midnight is GMT
			expect(deadline('2026-03-30T12:00:00Z', 'Europe/London')).toBe('2026-03-29T22:59:59.999Z'); // midnight is BST
		});

		it('Australia/Sydney, summer time ends on 2026-04-05 (southern hemisphere)', () => {
			expect(deadline('2026-04-05T02:00:00Z', 'Australia/Sydney')).toBe('2026-04-04T12:59:59.999Z'); // midnight AEDT, UTC+11
			expect(deadline('2026-04-06T02:00:00Z', 'Australia/Sydney')).toBe('2026-04-05T13:59:59.999Z'); // midnight AEST, UTC+10
		});

		it('the deadline is always strictly before the start and less than two days earlier, all year in every zone', () => {
			const zones = ['Asia/Seoul', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Honolulu', 'America/Santiago'];
			for (const zone of zones) {
				for (let hours = 0; hours < 24 * 366; hours += 7) {
					const start = new Date(Date.UTC(2026, 0, 1) + hours * 3600000);
					const gap = start.getTime() - getRefundDeadline(start, zone).getTime();
					expect(gap).toBeGreaterThan(0);
					expect(gap).toBeLessThanOrEqual(2 * 86400000 + 3600000);
				}
			}
		});
	});
});

describe('getRefundPolicyText (AI assistant)', () => {
	const startAt = new Date('2026-12-25T10:00:00Z');

	it('describes the per-event policy and no longer the fixed day-before rule', () => {
		const text = getRefundPolicyText();
		expect(text).not.toContain('23:59 on the day before');
		expect(text).toMatch(/1 to 30 days/);
		expect(text).toMatch(/non-refundable/);
		expect(text).toMatch(/event page/);
	});

	it('uses the own policy and deadline of an event in context', () => {
		const text = getRefundPolicyText({ startAt, venueTimezone: 'Asia/Seoul', refundPolicy: { policyType: RefundPolicyType.REFUNDABLE, daysBefore: 7 } });
		expect(text).toContain('refundable until 7 day(s) before');
		expect(text).toContain(getRefundDeadline(startAt, 'Asia/Seoul', 7).toISOString());
	});

	it('says a non-refundable event cannot be refunded, and an old event without a policy reads as 1 day', () => {
		expect(getRefundPolicyText({ startAt, venueTimezone: 'UTC', refundPolicy: { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 } })).toContain('NON-REFUNDABLE');
		expect(getRefundPolicyText({ startAt, venueTimezone: 'UTC' })).toContain('refundable until 1 day(s) before');
	});
});
