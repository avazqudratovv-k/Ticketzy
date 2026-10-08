import { DEFAULT_SEAT_HOLD_SECONDS, getAiConfig, getSeatHoldSeconds, parseSeatHoldSeconds, validateEnv } from './env.validation';

describe('SEAT_HOLD_SECONDS', () => {
	it('defaults to 30 when unset or blank', () => {
		expect(parseSeatHoldSeconds(undefined)).toBe(DEFAULT_SEAT_HOLD_SECONDS);
		expect(parseSeatHoldSeconds('')).toBe(30);
		expect(getSeatHoldSeconds({})).toBe(30);
	});

	it('accepts a whole number from 1 to 3600', () => {
		expect(parseSeatHoldSeconds('45')).toBe(45);
		expect(getSeatHoldSeconds({ SEAT_HOLD_SECONDS: '600' })).toBe(600);
	});

	it.each(['0', '-5', '1.5', 'abc', '3601'])('rejects %s', (value) => {
		expect(() => parseSeatHoldSeconds(value)).toThrow('SEAT_HOLD_SECONDS');
	});

	it('is checked at startup by validateEnv, together with the required variables', () => {
		const base = { MONGO_DEV: 'mongodb://x', SECRET_TOKEN: 's', QR_SECRET: 'q' };
		const validate = validateEnv(['SECRET_TOKEN', 'QR_SECRET']);
		expect(validate({ ...base })).toEqual(base);
		expect(() => validate({ ...base, SEAT_HOLD_SECONDS: 'soon' })).toThrow('SEAT_HOLD_SECONDS');
		expect(() => validate({ MONGO_DEV: 'mongodb://x', SECRET_TOKEN: 's' })).toThrow('QR_SECRET');
	});
});

describe('AI settings', () => {
	it('is off by default, the key is optional and the model is a small one', () => {
		expect(getAiConfig({})).toEqual({ enabled: false, apiKey: '', model: 'claude-haiku-4-5', timeoutMs: 20000, rateLimitPerMinute: 10 });
		expect(getAiConfig({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: ' k ', ANTHROPIC_MODEL: 'm' })).toMatchObject({ enabled: true, apiKey: 'k', model: 'm' });
	});

	it.each([{ AI_ENABLED: 'maybe' }, { AI_TIMEOUT_MS: '5' }, { AI_RATE_LIMIT_PER_MINUTE: '0' }])('rejects %p at startup', (bad) => {
		const base = { MONGO_DEV: 'mongodb://x', SECRET_TOKEN: 's', QR_SECRET: 'q' };
		expect(() => validateEnv(['SECRET_TOKEN', 'QR_SECRET'])({ ...base, ...bad })).toThrow();
	});
});
