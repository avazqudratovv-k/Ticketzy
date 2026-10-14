import {
	DEFAULT_RATE_LIMITS,
	getAiCaps,
	getListenPort,
	getLogLevels,
	getMongoAutoIndex,
	getRateLimitConfig,
	getTrustProxyHops,
	getUploadLimits,
	getWeakSecretReason,
	parseCorsOrigins,
	validateEnv,
} from './env.validation';

const STRONG_A = 'Xk9vQ2mZp7LdR4tWy8NcB5hFj3GsUe6A';
const STRONG_B = 'pL0oM9iN8bV7cX6zA5sD4fG3hJ2kQ1wE';
const production = { NODE_ENV: 'production', MONGO_PROD: 'mongodb+srv://u:p@cluster.example.mongodb.net/db', SECRET_TOKEN: STRONG_A, QR_SECRET: STRONG_B, PAYMENT_MODE: 'simulated', CORS_ORIGINS: 'https://shop.vercel.app' };
const validateApi = validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true, web: true });

describe('production environment validation (DECISIONS #103)', () => {
	it('accepts a complete production environment', () => {
		expect(validateApi({ ...production })).toMatchObject({ PAYMENT_MODE: 'simulated' });
	});

	it('lists every missing NAME at once', () => {
		let message = '';
		try {
			validateApi({ NODE_ENV: 'production' });
		} catch (err) {
			message = (err as Error).message;
		}
		for (const name of ['MONGO_PROD', 'SECRET_TOKEN', 'QR_SECRET', 'CORS_ORIGINS', 'PAYMENT_MODE']) expect(message).toContain(name);
	});

	describe.each([
		['too short', 'short-secret'],
		['the empty example placeholder', ''],
		['a placeholder word', 'please-change-me-to-a-long-random-string-1234'],
		['an example value', 'example-example-example-example-12345'],
		['a repeated character', 'a'.repeat(40)],
	])('SECRET_TOKEN that is %s', (_name, value) => {
		it('is refused in production and the error never contains the value', () => {
			const run = () => validateApi({ ...production, SECRET_TOKEN: value });
			expect(run).toThrow('SECRET_TOKEN');
			if (value) expect(run).toThrow(/^(?!.*example-example)(?!.*please-change)/s);
		});
	});

	it('refuses a weak QR_SECRET and an equal pair of secrets', () => {
		expect(() => validateApi({ ...production, QR_SECRET: 'tiny' })).toThrow('QR_SECRET');
		expect(() => validateApi({ ...production, QR_SECRET: STRONG_A })).toThrow('QR_SECRET must be different from SECRET_TOKEN');
	});

	it('does not apply the strength rule outside production (tests and local work use short secrets)', () => {
		expect(validateApi({ MONGO_DEV: 'mongodb://x', SECRET_TOKEN: 's', QR_SECRET: 'q', PAYMENT_MODE: 'simulated' })).toBeDefined();
	});

	it('needs a Mongo URI that looks like one, and a known NODE_ENV', () => {
		expect(() => validateApi({ ...production, MONGO_PROD: 'localhost:27017' })).toThrow('MONGO_PROD must start with mongodb');
		expect(() => validateApi({ ...production, NODE_ENV: 'prod' })).toThrow('NODE_ENV');
	});

	it('refuses a service on Render that is not in production mode', () => {
		expect(() => validateApi({ ...production, NODE_ENV: 'development', MONGO_DEV: 'mongodb://x', RENDER: 'true' })).toThrow('NODE_ENV must be production on Render');
	});

	it('checks PORT, CORS_ORIGINS, the caps, the upload settings and the rate limits together', () => {
		for (const bad of [{ PORT: 'abc' }, { CORS_ORIGINS: '*' }, { AI_DAILY_CAP: '-1' }, { UPLOAD_MAX_FILES: '500' }, { RATE_LIMIT_LOGIN_PER_15_MIN: '0' }, { LOG_LEVEL: 'loud' }, { TRUST_PROXY_HOPS: '9' }, { MONGO_AUTO_INDEX: 'maybe' }]) {
			expect(() => validateApi({ ...production, ...bad })).toThrow(Object.keys(bad)[0]);
		}
	});

	it('the batch app checks the Mongo URI and its port only, not the web settings', () => {
		const validateBatch = validateEnv();
		expect(validateBatch({ NODE_ENV: 'production', MONGO_PROD: 'mongodb://x' })).toBeDefined();
		expect(() => validateBatch({ NODE_ENV: 'production' })).toThrow('MONGO_PROD');
		expect(() => validateBatch({ NODE_ENV: 'production', MONGO_PROD: 'mongodb://x', PORT_BATCH: 'zero' })).toThrow('PORT_BATCH');
	});
});

describe('getWeakSecretReason', () => {
	it('accepts a long random value', () => expect(getWeakSecretReason(STRONG_A)).toBeNull());
	it.each(['', '   ', 'x'.repeat(31), 'my-super-secret-value-that-is-long-enough', 'ChangeMe-ChangeMe-ChangeMe-ChangeMe-1', '1234561234561234561234561234567'])('refuses %p', (value) => {
		expect(getWeakSecretReason(value)).not.toBeNull();
	});
});

describe('getListenPort (C3-59)', () => {
	it('prefers PORT (the host), then PORT_API, then 3000', () => {
		expect(getListenPort({ PORT: '10000', PORT_API: '4000' })).toBe(10000);
		expect(getListenPort({ PORT_API: '4000' })).toBe(4000);
		expect(getListenPort({})).toBe(3000);
	});
	it('the batch app falls back to PORT_BATCH', () => {
		expect(getListenPort({ PORT_BATCH: '4100', PORT_API: '4000' }, 'PORT_BATCH')).toBe(4100);
		expect(getListenPort({ PORT: '10000', PORT_BATCH: '4100' }, 'PORT_BATCH')).toBe(10000);
	});
	it.each(['0', '65536', 'abc', '3000x', '-1'])('refuses PORT=%s', (value) => {
		expect(() => getListenPort({ PORT: value })).toThrow('PORT');
	});
});

describe('parseCorsOrigins', () => {
	it('splits exact origins, trims them and drops repeats', () => {
		expect(parseCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: ' https://a.vercel.app , https://b.com:8443,https://a.vercel.app ' })).toEqual(['https://a.vercel.app', 'https://b.com:8443']);
	});
	it('falls back to the older CLIENT_URL only when CORS_ORIGINS is empty', () => {
		expect(parseCorsOrigins({ NODE_ENV: 'production', CLIENT_URL: 'https://old.example.com' })).toEqual(['https://old.example.com']);
		expect(parseCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://new.example.com', CLIENT_URL: 'https://old.example.com' })).toEqual(['https://new.example.com']);
	});
	it('defaults to the local frontend outside production and to nothing in production', () => {
		expect(parseCorsOrigins({})).toEqual(['http://localhost:3000']);
		expect(parseCorsOrigins({ NODE_ENV: 'production' })).toEqual([]);
	});
	it.each(['*', 'https://*.vercel.app', 'shop.vercel.app', 'https://shop.vercel.app/', 'https://shop.vercel.app/app', 'ftp://shop.vercel.app'])('refuses %p', (value) => {
		expect(() => parseCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: value })).toThrow('CORS_ORIGINS entry 1');
	});
	it('wants https in production except for localhost', () => {
		expect(() => parseCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'http://shop.example.com' })).toThrow('https');
		expect(parseCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:3000' })).toEqual(['http://localhost:3000']);
	});
});

describe('the other settings', () => {
	it('AI_DAILY_CAP defaults to 200 (and the per key cap to 10), accepts 0 (AI off) and refuses junk', () => {
		expect(getAiCaps({})).toEqual({ dailyCap: 200, perKeyDailyCap: 10 });
		expect(getAiCaps({ AI_DAILY_CAP: '0', AI_PER_KEY_DAILY_CAP: '5' })).toEqual({ dailyCap: 0, perKeyDailyCap: 5 });
		expect(() => getAiCaps({ AI_DAILY_CAP: 'many' })).toThrow('AI_DAILY_CAP');
	});
	it('upload limits default to 15 MB and 10 files', () => {
		expect(getUploadLimits({})).toEqual({ maxFileSize: 15_000_000, maxFiles: 10 });
		expect(getUploadLimits({ UPLOAD_MAX_FILE_MB: '5', UPLOAD_MAX_FILES: '3' })).toEqual({ maxFileSize: 5_000_000, maxFiles: 3 });
		expect(() => getUploadLimits({ UPLOAD_MAX_FILE_MB: '0' })).toThrow('UPLOAD_MAX_FILE_MB');
	});
	it('rate limit settings have safe defaults', () => {
		expect(getRateLimitConfig({})).toEqual(DEFAULT_RATE_LIMITS);
		expect(getRateLimitConfig({ RATE_LIMIT_SIGNUP_PER_HOUR: '2' }).signupPerHour).toBe(2);
	});
	it('the log level is warn in production and everything otherwise, and LOG_LEVEL overrides', () => {
		expect(getLogLevels({ NODE_ENV: 'production' })).toEqual(['error', 'warn']);
		expect(getLogLevels({})).toEqual(['error', 'warn', 'log', 'debug', 'verbose']);
		expect(getLogLevels({ NODE_ENV: 'production', LOG_LEVEL: 'log' })).toEqual(['error', 'warn', 'log']);
	});
	it('trusts one proxy hop in production and none otherwise', () => {
		expect(getTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
		expect(getTrustProxyHops({})).toBe(0);
		expect(getTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' })).toBe(2);
	});
	it('index building is on unless MONGO_AUTO_INDEX=false', () => {
		expect(getMongoAutoIndex({})).toBe(true);
		expect(getMongoAutoIndex({ MONGO_AUTO_INDEX: 'false' })).toBe(false);
	});
});
