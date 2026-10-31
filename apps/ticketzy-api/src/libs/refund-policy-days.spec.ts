import { Message } from './enums/common.enum';
import { RefundPolicyType } from './enums/event.enum';
import { buildRefundPolicy, getRefundDeadline, getRefundPolicyError, isBeforeRefundDeadline, readRefundPolicy } from './refund-policy';

describe('refund policy per event (DECISIONS #129)', () => {
	describe('getRefundDeadline with daysBefore', () => {
		const start = new Date('2026-12-20T10:00:00Z'); // 19:00 on 12-20 in Seoul

		it('1 day (the default) is the old rule: the end of the day before', () => {
			expect(getRefundDeadline(start, 'Asia/Seoul').toISOString()).toBe('2026-12-19T14:59:59.999Z');
			expect(getRefundDeadline(start, 'Asia/Seoul', 1).toISOString()).toBe('2026-12-19T14:59:59.999Z');
		});

		it('N days is the end of the day N days before', () => {
			expect(getRefundDeadline(start, 'Asia/Seoul', 2).toISOString()).toBe('2026-12-18T14:59:59.999Z');
			expect(getRefundDeadline(start, 'Asia/Seoul', 7).toISOString()).toBe('2026-12-13T14:59:59.999Z');
			expect(getRefundDeadline(start, 'Asia/Seoul', 30).toISOString()).toBe('2026-11-20T14:59:59.999Z');
		});

		it('crosses month and year ends', () => {
			expect(getRefundDeadline(new Date('2027-01-02T10:00:00Z'), 'Asia/Seoul', 5).toISOString()).toBe('2026-12-28T14:59:59.999Z');
		});

		it('is the instant to the millisecond: the last moment is still before, the next is not', () => {
			const deadline = getRefundDeadline(start, 'Asia/Seoul', 3);
			expect(isBeforeRefundDeadline(start, 'Asia/Seoul', deadline, 3)).toBe(true);
			expect(isBeforeRefundDeadline(start, 'Asia/Seoul', new Date(deadline.getTime() + 1), 3)).toBe(false);
		});

		it('follows the venue clock across a DST change (New York, clocks go back on 2026-11-01)', () => {
			const event = new Date('2026-11-03T00:00:00Z'); // 19:00 on 11-02 in New York (EST)
			// 3 days before 11-02 is 10-30 (EDT, UTC-4): the end of that day is 2026-10-31T03:59:59.999Z
			expect(getRefundDeadline(event, 'America/New_York', 3).toISOString()).toBe('2026-10-31T03:59:59.999Z');
		});
	});

	describe('policy values', () => {
		it('an event or order saved before policies reads as refundable until the day before', () => {
			expect(readRefundPolicy({})).toEqual({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 1 });
			expect(readRefundPolicy(null)).toEqual({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 1 });
		});

		it('a non-refundable policy has no days', () => {
			expect(readRefundPolicy({ refundPolicy: { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 9 } })).toEqual({ policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 });
			expect(buildRefundPolicy({ policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 5 })).toEqual({ policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 });
		});

		it('REFUNDABLE defaults to 1 day and accepts 1 to 30', () => {
			expect(buildRefundPolicy({ policyType: RefundPolicyType.REFUNDABLE })).toEqual({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 1 });
			expect(getRefundPolicyError({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 1 })).toBeNull();
			expect(getRefundPolicyError({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 30 })).toBeNull();
			expect(getRefundPolicyError({ policyType: RefundPolicyType.REFUNDABLE })).toBeNull();
		});

		it.each([0, 31, -2, 1.5, NaN])('refuses %p days', (days) => {
			expect(getRefundPolicyError({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: days })).toBe(Message.INVALID_REFUND_POLICY);
		});

		it('refuses an unknown type', () => {
			expect(getRefundPolicyError({ policyType: 'MAYBE' as any })).toBe(Message.INVALID_REFUND_POLICY);
		});
	});
});
