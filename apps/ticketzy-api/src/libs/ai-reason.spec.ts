import { sanitizeProviderReason } from './ai-reason';

describe('sanitizeProviderReason', () => {
	it('reads the Google error JSON', () => {
		expect(sanitizeProviderReason('{"error":{"code":400,"message":"Manually set deadline 8s is too short.","status":"INVALID_ARGUMENT"}}')).toBe('INVALID_ARGUMENT: Manually set deadline 8s is too short.');
	});

	it('removes the configured key, key shaped text and long quoted passages, and truncates to 300 characters', () => {
		const text = sanitizeProviderReason(`key=abc123 mine my-secret-key AIzaSyA1234567890abcdefghijkl Bearer abcdefgh12345 "${'user typed text '.repeat(4)}" ${'z'.repeat(500)}`, ['my-secret-key']);
		expect(text).not.toMatch(/abc123|my-secret-key|AIza|abcdefgh12345|user typed/);
		expect(text).toContain('[redacted]');
		expect(text.length).toBeLessThanOrEqual(300);
	});

	it('gives an empty string for nothing', () => {
		expect(sanitizeProviderReason(undefined)).toBe('');
	});
});
