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

export const MIN_SECRET_LENGTH = 32;

/** words that mark a copied example or a lazy secret; matched case-insensitively anywhere in the value */
const WEAK_SECRET_FRAGMENTS = ['changeme', 'change-me', 'change_me', 'replace', 'example', 'placeholder', 'default', 'your-', 'your_', 'password', 'secret', 'token', 'qwerty', '123456', 'abcdef', 'xxxx', 'todo', 'test'];

/**
 * Why a secret is not acceptable in production, or null when it is fine. The text names the rule, never the value.
 * `SECRET_TOKEN=a` boots in development, but a short or guessable JWT secret can be brute forced offline (C3-39).
 */
export const getWeakSecretReason = (value: unknown): string | null => {
	const text = String(value ?? '').trim();
	if (text.length < MIN_SECRET_LENGTH) return `must be at least ${MIN_SECRET_LENGTH} characters`;
	const lower = text.toLowerCase();
	if (WEAK_SECRET_FRAGMENTS.some((fragment) => lower.includes(fragment))) return 'looks like a placeholder or a guessable word, use random characters';
	if (new Set(lower).size < 10) return 'has too few different characters, use random characters';
	return null;
};

export const DEFAULT_PORT = 3000;

/** PORT (the host sets it), then PORT_API, then 3000; the batch app uses `PORT_BATCH` as its second choice */
export const getListenPort = (env: Record<string, any> = process.env, fallbackName: 'PORT_API' | 'PORT_BATCH' = 'PORT_API'): number => {
	for (const name of ['PORT', fallbackName]) {
		const raw = String(env[name] ?? '').trim();
		if (!raw) continue;
		if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error(`${name} must be a whole number from 1 to 65535`);
		return Number(raw);
	}
	return DEFAULT_PORT;
};

/**
 * CORS_ORIGINS is a comma-separated list of exact origins (scheme + host + optional port, no path, no wildcard).
 * CLIENT_URL is the older name and is only read when CORS_ORIGINS is empty. Outside production an empty list means the
 * local Next.js app. A bad entry is reported by position, never by value.
 */
export const parseCorsOrigins = (env: Record<string, any> = process.env): string[] => {
	const name = String(env.CORS_ORIGINS ?? '').trim() ? 'CORS_ORIGINS' : 'CLIENT_URL';
	const raw = String(env[name] ?? '').trim();
	if (!raw) return env.NODE_ENV === 'production' ? [] : ['http://localhost:3000'];
	const origins = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
	origins.forEach((origin, index) => {
		if (origin.includes('*')) throw new Error(`${name} entry ${index + 1} has a wildcard; list exact origins`);
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new Error(`${name} entry ${index + 1} is not a valid origin like https://example.com`);
		}
		const isOrigin = (url.protocol === 'https:' || url.protocol === 'http:') && origin === url.origin;
		if (!isOrigin) throw new Error(`${name} entry ${index + 1} must be an origin (scheme, host, optional port) without a path or trailing slash`);
		const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (env.NODE_ENV === 'production' && url.protocol !== 'https:' && !isLocal) throw new Error(`${name} entry ${index + 1} must use https in production`);
	});
	return [...new Set(origins)];
};

export const DEFAULT_AI_DAILY_CAP = 400;
export const DEFAULT_AI_PER_KEY_DAILY_CAP = 30;

/** AI_DAILY_CAP: model calls per UTC day for the whole app (0 switches the AI off); AI_PER_KEY_DAILY_CAP: assistant operations per member or IP per UTC day */
export const getAiCaps = (env: Record<string, any> = process.env): { dailyCap: number; perKeyDailyCap: number } => ({
	dailyCap: parseBoundedInt('AI_DAILY_CAP', env.AI_DAILY_CAP, DEFAULT_AI_DAILY_CAP, 0, 1_000_000),
	perKeyDailyCap: parseBoundedInt('AI_PER_KEY_DAILY_CAP', env.AI_PER_KEY_DAILY_CAP, DEFAULT_AI_PER_KEY_DAILY_CAP, 0, 100_000),
});

export const DEFAULT_UPLOAD_MAX_FILE_MB = 15;
export const DEFAULT_UPLOAD_MAX_FILES = 10;

/** UPLOAD_MAX_FILE_MB (1 to 50) and UPLOAD_MAX_FILES (1 to 20) feed `graphqlUploadExpress` */
export const getUploadLimits = (env: Record<string, any> = process.env): { maxFileSize: number; maxFiles: number } => ({
	maxFileSize: parseBoundedInt('UPLOAD_MAX_FILE_MB', env.UPLOAD_MAX_FILE_MB, DEFAULT_UPLOAD_MAX_FILE_MB, 1, 50) * 1_000_000,
	maxFiles: parseBoundedInt('UPLOAD_MAX_FILES', env.UPLOAD_MAX_FILES, DEFAULT_UPLOAD_MAX_FILES, 1, 20),
});

const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** LOG_LEVEL picks the least important level that is printed; default `warn` in production and `debug` otherwise */
export const getLogLevels = (env: Record<string, any> = process.env): LogLevel[] => {
	const raw = String(env.LOG_LEVEL ?? '').trim().toLowerCase();
	if (raw && !LOG_LEVELS.includes(raw as LogLevel)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
	const level = (raw || (env.NODE_ENV === 'production' ? 'warn' : 'verbose')) as LogLevel;
	return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
};

/** MONGO_AUTO_INDEX=false stops Mongoose from building indexes at startup (default true, so a new database gets its unique indexes) */
export const getMongoAutoIndex = (env: Record<string, any> = process.env): boolean => {
	const raw = String(env.MONGO_AUTO_INDEX ?? '').trim().toLowerCase();
	if (raw && !['true', 'false', '1', '0'].includes(raw)) throw new Error('MONGO_AUTO_INDEX must be true or false');
	return raw !== 'false' && raw !== '0';
};

export interface RateLimitConfig {
	/** GraphQL requests per client IP per minute, all operations together */
	generalPerMinute: number;
	/** login attempts per client IP per 15 minutes (per email: twice as many) */
	loginPer15Min: number;
	/** sign-ups (user and organizer) per client IP per hour */
	signupPerHour: number;
	/** password changes and resets per member and per client IP per 15 minutes */
	passwordPer15Min: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = { generalPerMinute: 300, loginPer15Min: 10, signupPerHour: 5, passwordPer15Min: 5 };

/** RATE_LIMIT_GENERAL_PER_MINUTE, RATE_LIMIT_LOGIN_PER_15_MIN, RATE_LIMIT_SIGNUP_PER_HOUR, RATE_LIMIT_PASSWORD_PER_15_MIN; all optional */
export const getRateLimitConfig = (env: Record<string, any> = process.env): RateLimitConfig => ({
	generalPerMinute: parseBoundedInt('RATE_LIMIT_GENERAL_PER_MINUTE', env.RATE_LIMIT_GENERAL_PER_MINUTE, DEFAULT_RATE_LIMITS.generalPerMinute, 1, 100_000),
	loginPer15Min: parseBoundedInt('RATE_LIMIT_LOGIN_PER_15_MIN', env.RATE_LIMIT_LOGIN_PER_15_MIN, DEFAULT_RATE_LIMITS.loginPer15Min, 1, 1000),
	signupPerHour: parseBoundedInt('RATE_LIMIT_SIGNUP_PER_HOUR', env.RATE_LIMIT_SIGNUP_PER_HOUR, DEFAULT_RATE_LIMITS.signupPerHour, 1, 1000),
	passwordPer15Min: parseBoundedInt('RATE_LIMIT_PASSWORD_PER_15_MIN', env.RATE_LIMIT_PASSWORD_PER_15_MIN, DEFAULT_RATE_LIMITS.passwordPer15Min, 1, 1000),
});

/** TRUST_PROXY_HOPS: how many proxies sit in front of the API (Render: 1). 0 outside production unless set; more than 5 is a mistake */
export const getTrustProxyHops = (env: Record<string, any> = process.env): number =>
	parseBoundedInt('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, env.NODE_ENV === 'production' ? 1 : 0, 0, 5);

const SECRET_NAMES = ['SECRET_TOKEN', 'QR_SECRET'];

const isMongoUri = (value: unknown): boolean => /^mongodb(\+srv)?:\/\//i.test(String(value ?? '').trim());

/** run one check and turn its Error into a line of the report (the report never holds a value) */
const collect = (problems: string[], check: () => unknown): void => {
	try {
		check();
	} catch (err) {
		problems.push((err as Error).message);
	}
};

/**
 * ConfigModule `validate` hook: the app refuses to start when a required variable is missing or invalid.
 * Every problem is collected and reported at once, by variable NAME only, never by value.
 * Outside production the checks are the light ones (presence, ranges). In production the API (`web: true`) also needs
 * CORS_ORIGINS, a Mongo URI that looks like one, and secrets that are long, not placeholders and different from each other.
 */
export const validateEnv =
	(required: string[] = [], options: { checkPayment?: boolean; web?: boolean } = {}) =>
	(config: Record<string, any>): Record<string, any> => {
		const isProduction = config.NODE_ENV === 'production';
		const problems: string[] = [];

		const mongoKey = getMongoUriKey(config.NODE_ENV);
		const missing = [mongoKey, ...required].filter((key) => !String(config[key] ?? '').trim());
		if (options.web && isProduction && !String(config.CORS_ORIGINS ?? config.CLIENT_URL ?? '').trim()) missing.push('CORS_ORIGINS');
		if (missing.length) problems.push(`Missing required environment variables: ${missing.join(', ')}`);

		if (config.NODE_ENV !== undefined && !['production', 'development', 'test'].includes(String(config.NODE_ENV))) {
			problems.push('NODE_ENV must be production, development or test');
		}
		// Render sets RENDER on its services; a dev-mode server there would use the dev database and show the playground
		if (config.RENDER && !isProduction) problems.push('NODE_ENV must be production on Render');

		if (isProduction) {
			if (String(config[mongoKey] ?? '').trim() && !isMongoUri(config[mongoKey])) problems.push(`${mongoKey} must start with mongodb:// or mongodb+srv://`);
			if (options.web) {
				for (const name of SECRET_NAMES.filter((secret) => required.includes(secret) && String(config[secret] ?? '').trim())) {
					const reason = getWeakSecretReason(config[name]);
					if (reason) problems.push(`${name} ${reason}`);
				}
				if (config.SECRET_TOKEN && config.QR_SECRET && String(config.SECRET_TOKEN).trim() === String(config.QR_SECRET).trim()) {
					problems.push('QR_SECRET must be different from SECRET_TOKEN');
				}
			}
		}

		collect(problems, () => parseSeatHoldSeconds(config.SEAT_HOLD_SECONDS));
		collect(problems, () => getAiConfig(config));
		collect(problems, () => getListenPort(config, options.web ? 'PORT_API' : 'PORT_BATCH'));
		collect(problems, () => getLogLevels(config));
		collect(problems, () => getMongoAutoIndex(config));
		// only the API takes payments, serves browsers, takes uploads and counts requests; the batch app needs none of that
		if (options.checkPayment) collect(problems, () => parsePaymentMode(config));
		if (options.web) {
			collect(problems, () => parseCorsOrigins(config));
			collect(problems, () => getAiCaps(config));
			collect(problems, () => getUploadLimits(config));
			collect(problems, () => getRateLimitConfig(config));
			collect(problems, () => getTrustProxyHops(config));
		}

		if (problems.length) throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
		return config;
	};
