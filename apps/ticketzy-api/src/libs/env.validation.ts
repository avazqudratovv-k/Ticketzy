/** which variable holds the Mongo URI for the current NODE_ENV */
export const getMongoUriKey = (nodeEnv: string | undefined = process.env.NODE_ENV): string =>
	nodeEnv === 'production' ? 'MONGO_PROD' : 'MONGO_DEV';

export const DEFAULT_SEAT_HOLD_SECONDS = 30;
export const MAX_SEAT_HOLD_SECONDS = 3600;

/** SEAT_HOLD_SECONDS is optional (default 30); when it is set it must be a whole number from 1 to 3600 */
export const parseSeatHoldSeconds = (raw: unknown): number => {
	if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_SEAT_HOLD_SECONDS;
	const text = String(raw).trim();
	const seconds = Number(text);
	if (!/^\d+$/.test(text) || seconds < 1 || seconds > MAX_SEAT_HOLD_SECONDS) {
		throw new Error(`SEAT_HOLD_SECONDS must be a whole number from 1 to ${MAX_SEAT_HOLD_SECONDS}`);
	}
	return seconds;
};

/** how long a seat hold or an unpaid GENERAL order lasts; read at call time, after ConfigModule has loaded .env */
export const getSeatHoldSeconds = (env: Record<string, any> = process.env): number => parseSeatHoldSeconds(env.SEAT_HOLD_SECONDS);

export type PaymentMode = 'simulated' | 'disabled';
const PAYMENT_MODES: PaymentMode[] = ['simulated', 'disabled'];

/**
 * PAYMENT_MODE decides what `payOrder` does (DECISIONS #92): `simulated` is the mock provider (the buyer picks the
 * result), `disabled` refuses every payment. Outside production an unset value means `simulated`; in production there
 * is no default, so a deployment cannot go live with fake payments by forgetting a variable.
 */
export const parsePaymentMode = (env: Record<string, any> = process.env): PaymentMode => {
	const raw = String(env.PAYMENT_MODE ?? '').trim().toLowerCase();
	if (!raw) {
		if (env.NODE_ENV === 'production') throw new Error('PAYMENT_MODE must be set to simulated or disabled in production');
		return 'simulated';
	}
	if (!PAYMENT_MODES.includes(raw as PaymentMode)) throw new Error('PAYMENT_MODE must be simulated or disabled');
	return raw as PaymentMode;
};

/** read at call time, after ConfigModule has loaded .env */
export const getPaymentMode = (env: Record<string, any> = process.env): PaymentMode => parsePaymentMode(env);

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'; // flash models have a free tier
export const DEFAULT_AI_TIMEOUT_MS = 15000;
export const DEFAULT_AI_RATE_LIMIT_PER_MINUTE = 10;

export type AiProviderName = 'anthropic' | 'gemini';

export interface AiConfig {
	enabled: boolean;
	provider: AiProviderName;
	/** the key of the SELECTED provider only */
	apiKey: string;
	/** the model of the SELECTED provider only */
	model: string;
	/** GEMINI_FALLBACK_MODEL (gemini only): tried once when the main model fails; '' means no fallback */
	fallbackModel: string;
	timeoutMs: number;
	rateLimitPerMinute: number;
}

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

const parseBoundedInt = (name: string, raw: unknown, fallback: number, min: number, max: number): number => {
	if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
	const text = String(raw).trim();
	const value = Number(text);
	if (!/^\d+$/.test(text) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
	return value;
};

const PROVIDER_ENV: Record<AiProviderName, { key: string; model: string; defaultModel: string }> = {
	anthropic: { key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL', defaultModel: DEFAULT_ANTHROPIC_MODEL },
	gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL', defaultModel: DEFAULT_GEMINI_MODEL },
};

/**
 * AI is off unless AI_ENABLED is true, and the API key is optional: a missing key only turns the AI operations off
 * (they answer with a clear message), it never stops the app from starting. AI_PROVIDER picks anthropic (default) or
 * gemini; only the variables of the selected provider are read and checked, the other provider's are ignored.
 * Read at call time, after .env has loaded. Errors never contain the key.
 */
export const getAiConfig = (env: Record<string, any> = process.env): AiConfig => {
	const flag = String(env.AI_ENABLED ?? '').trim().toLowerCase();
	if (flag && !['true', 'false', '1', '0'].includes(flag)) throw new Error('AI_ENABLED must be true or false');
	const provider = (String(env.AI_PROVIDER ?? '').trim().toLowerCase() || 'anthropic') as AiProviderName;
	if (!(provider in PROVIDER_ENV)) throw new Error('AI_PROVIDER must be anthropic or gemini');
	const names = PROVIDER_ENV[provider];
	const model = String(env[names.model] ?? '').trim() || names.defaultModel;
	if (!MODEL_NAME_PATTERN.test(model)) throw new Error(`${names.model} is not a valid model name`);
	const fallbackRaw = provider === 'gemini' ? String(env.GEMINI_FALLBACK_MODEL ?? '').trim() : '';
	if (fallbackRaw && !MODEL_NAME_PATTERN.test(fallbackRaw)) throw new Error('GEMINI_FALLBACK_MODEL is not a valid model name');
	return {
		enabled: flag === 'true' || flag === '1',
		provider,
		apiKey: String(env[names.key] ?? '').trim(),
		model,
		fallbackModel: fallbackRaw === model ? '' : fallbackRaw,
		timeoutMs: parseBoundedInt('AI_TIMEOUT_MS', env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS, 1000, 120000),
		rateLimitPerMinute: parseBoundedInt('AI_RATE_LIMIT_PER_MINUTE', env.AI_RATE_LIMIT_PER_MINUTE, DEFAULT_AI_RATE_LIMIT_PER_MINUTE, 1, 1000),
	};
};

/** startup hints (never fatal) for AI_PROVIDER=gemini; no key or model value is ever included */
export const getAiStartupWarnings = (env: Record<string, any> = process.env): string[] => {
	if (String(env.AI_PROVIDER ?? '').trim().toLowerCase() !== 'gemini') return [];
	const warnings: string[] = [];
	if (!String(env.GEMINI_API_KEY ?? '').trim()) warnings.push('GEMINI_API_KEY is not set, so the AI features will not work');
	if (!String(env.GEMINI_MODEL ?? '').trim()) warnings.push(`GEMINI_MODEL is not set, the default ${DEFAULT_GEMINI_MODEL} is used`);
	if (warnings.length) warnings.push('Run `npm run ai:check` to test the AI setup');
	return warnings;
};

/** ConfigModule `validate` hook: the app refuses to start when a required variable is missing or blank */
export const validateEnv =
	(required: string[] = [], options: { checkPayment?: boolean } = {}) =>
	(config: Record<string, any>): Record<string, any> => {
		const missing = [getMongoUriKey(config.NODE_ENV), ...required].filter((key) => !String(config[key] ?? '').trim());
		if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
		parseSeatHoldSeconds(config.SEAT_HOLD_SECONDS);
		getAiConfig(config);
		// only the API takes payments; the batch app does not need the variable
		if (options.checkPayment) parsePaymentMode(config);
		return config;
	};
