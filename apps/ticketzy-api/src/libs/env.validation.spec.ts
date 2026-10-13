import { DEFAULT_SEAT_HOLD_SECONDS, getAiConfig, getPaymentMode, getSeatHoldSeconds, parsePaymentMode, parseSeatHoldSeconds, validateEnv } from './env.validation';

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
		expect(getAiConfig({})).toEqual({ enabled: false, provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5', fallbackModel: '', timeoutMs: 15000, rateLimitPerMinute: 10 });
		expect(getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODEL: ' b ' }).fallbackModel).toBe('b');
		expect(getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODEL: 'a' }).fallbackModel).toBe('');
		expect(getAiConfig({ GEMINI_FALLBACK_MODEL: 'b' }).fallbackModel).toBe('');
		expect(() => getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_FALLBACK_MODEL: 'x y' })).toThrow('GEMINI_FALLBACK_MODEL');
		expect(getAiConfig({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: ' k ', ANTHROPIC_MODEL: 'm' })).toMatchObject({ enabled: true, apiKey: 'k', model: 'm' });
	});

	it('picks the key and model of the selected provider only, with a free-tier flash default for gemini', () => {
		const env = { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'a-key', ANTHROPIC_MODEL: 'claude-x', GEMINI_API_KEY: 'g-key' };
		expect(getAiConfig({ ...env, AI_PROVIDER: 'gemini' })).toMatchObject({ provider: 'gemini', apiKey: 'g-key', model: 'gemini-2.5-flash' });
		expect(getAiConfig({ ...env, AI_PROVIDER: ' Gemini ', GEMINI_MODEL: 'gemini-x' })).toMatchObject({ provider: 'gemini', model: 'gemini-x' });
		expect(getAiConfig({ ...env, AI_PROVIDER: 'anthropic' })).toMatchObject({ provider: 'anthropic', apiKey: 'a-key', model: 'claude-x' });
		expect(getAiConfig({ AI_PROVIDER: 'gemini' }).apiKey).toBe(''); // another provider's key is never used
	});

	it('validates only the selected provider: a bad model of the other one is ignored', () => {
		expect(getAiConfig({ AI_PROVIDER: 'gemini', ANTHROPIC_MODEL: 'bad model!' }).model).toBe('gemini-2.5-flash');
		expect(() => getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'bad model!' })).toThrow('GEMINI_MODEL');
		expect(() => getAiConfig({ ANTHROPIC_MODEL: 'bad model!' })).toThrow('ANTHROPIC_MODEL');
	});

	it.each([{ AI_ENABLED: 'maybe' }, { AI_TIMEOUT_MS: '5' }, { AI_RATE_LIMIT_PER_MINUTE: '0' }, { AI_PROVIDER: 'openai' }, { AI_PROVIDER: 'gemini', GEMINI_MODEL: 'x y' }])(
		'rejects %p at startup',
		(bad) => {
			const base = { MONGO_DEV: 'mongodb://x', SECRET_TOKEN: 's', QR_SECRET: 'q' };
			expect(() => validateEnv(['SECRET_TOKEN', 'QR_SECRET'])({ ...base, ...bad })).toThrow();
		},
	);

	it('never puts a key in an error message', () => {
		const error = (() => {
			try {
				getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'SECRET-KEY', GEMINI_MODEL: 'bad model' });
			} catch (err) {
				return err as Error;
			}
		})();
		expect(error?.message).not.toContain('SECRET-KEY');
	});
});

describe('PAYMENT_MODE', () => {
	it('defaults to simulated outside production', () => {
		expect(parsePaymentMode({})).toBe('simulated');
		expect(parsePaymentMode({ NODE_ENV: 'development', PAYMENT_MODE: '  ' })).toBe('simulated');
		expect(getPaymentMode({ NODE_ENV: 'test' })).toBe('simulated');
	});

	it('accepts simulated and disabled, in any case', () => {
		expect(parsePaymentMode({ PAYMENT_MODE: 'disabled' })).toBe('disabled');
		expect(parsePaymentMode({ PAYMENT_MODE: ' Simulated ' })).toBe('simulated');
		expect(parsePaymentMode({ NODE_ENV: 'production', PAYMENT_MODE: 'disabled' })).toBe('disabled');
	});

	it.each(['stripe', 'true', 'mock', '1'])('rejects %s', (value) => {
		expect(() => parsePaymentMode({ PAYMENT_MODE: value })).toThrow('PAYMENT_MODE must be simulated or disabled');
	});

	it('has no default in production: it must be set explicitly', () => {
		expect(() => parsePaymentMode({ NODE_ENV: 'production' })).toThrow('PAYMENT_MODE must be set');
		expect(() => parsePaymentMode({ NODE_ENV: 'production', PAYMENT_MODE: '' })).toThrow('PAYMENT_MODE must be set');
	});

	it('is checked at startup by the API (checkPayment) and never contains a value in the error', () => {
		const prod = { NODE_ENV: 'production', MONGO_PROD: 'mongodb://x', SECRET_TOKEN: 's', QR_SECRET: 'q' };
		const validateApi = validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true });
		expect(() => validateApi({ ...prod })).toThrow('PAYMENT_MODE');
		expect(validateApi({ ...prod, PAYMENT_MODE: 'simulated' })).toMatchObject({ PAYMENT_MODE: 'simulated' });
		expect(() => validateApi({ ...prod, PAYMENT_MODE: 'secretvalue' })).toThrow(/^(?!.*secretvalue)/);
		// the batch app takes no payments, so it does not need the variable
		expect(validateEnv()({ NODE_ENV: 'production', MONGO_PROD: 'mongodb://x' })).toBeDefined();
	});
});
