import { DEFAULT_SEAT_HOLD_SECONDS, getSeatHoldSeconds, parseSeatHoldSeconds, validateEnv } from './env.validation';

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
