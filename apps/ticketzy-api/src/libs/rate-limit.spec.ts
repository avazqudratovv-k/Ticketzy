import * as express from 'express';
import * as request from 'supertest';
import { CodedException } from './coded-exception';
import { RateLimiter } from './rate-limiter';
import { DEFAULT_RATE_LIMITS } from './env.validation';
import { RateLimits, createGeneralRateLimitMiddleware, enforceLoginLimit, enforcePasswordLimit, enforceSignupLimit, getClientIp } from './rate-limit';

const limits = (over: Partial<typeof DEFAULT_RATE_LIMITS> = {}) => new RateLimits({ ...DEFAULT_RATE_LIMITS, ...over });
const req = (ip: string) => ({ ip });
const catchError = (fn: () => void): CodedException => {
	try {
		fn();
	} catch (err) {
		return err as CodedException;
	}
	throw new Error('expected a RATE_LIMITED error');
};

describe('RateLimiter.consume', () => {
	it('tells how long to wait and lets the caller back in when the window passed', () => {
		const limiter = new RateLimiter(2, 60_000);
		expect(limiter.consume('k', 0).allowed).toBe(true);
		expect(limiter.consume('k', 10_000).allowed).toBe(true);
		expect(limiter.consume('k', 20_000)).toEqual({ allowed: false, retryAfterSeconds: 40 });
		expect(limiter.consume('k', 60_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
		expect(limiter.tryConsume('other', 0)).toBe(true);
	});
});

describe('operation limits (C3-37)', () => {
	it('login: the 11th attempt from one IP is refused with RATE_LIMITED and a retry hint', () => {
		const shared = limits();
		for (let attempt = 0; attempt < 10; attempt++) enforceLoginLimit(req('1.1.1.1'), `user${attempt}@x.com`, shared);
		const error = catchError(() => enforceLoginLimit(req('1.1.1.1'), 'next@x.com', shared));
		expect(error.code).toBe('RATE_LIMITED');
		expect(error.retryAfterSeconds).toBeGreaterThan(0);
		expect(error.message).toMatch(/try again in \d+ seconds/);
		expect(error.message).not.toMatch(/stack|at /);
		expect(() => enforceLoginLimit(req('2.2.2.2'), 'next@x.com', shared)).not.toThrow();
	});

	it('login: one email is limited across many IPs, at twice the per-IP number', () => {
		const shared = limits();
		for (let attempt = 0; attempt < 20; attempt++) enforceLoginLimit(req(`9.9.9.${attempt}`), 'victim@x.com', shared);
		expect(catchError(() => enforceLoginLimit(req('9.9.9.99'), 'victim@x.com', shared)).code).toBe('RATE_LIMITED');
		// the email is case-insensitive
		expect(catchError(() => enforceLoginLimit(req('9.9.9.98'), 'VICTIM@x.com', shared)).code).toBe('RATE_LIMITED');
	});

	it('GraphQL aliases are counted one by one because the resolver counts, not the HTTP request', () => {
		const shared = limits({ loginPer15Min: 3 });
		const aliases = Array.from({ length: 5 }, (_unused, i) => () => enforceLoginLimit(req('3.3.3.3'), `a${i}@x.com`, shared));
		const refused = aliases.filter((run) => { try { run(); return false; } catch { return true; } });
		expect(refused).toHaveLength(2);
	});

	it('sign-up: 5 per hour per IP, for users and organizers together', () => {
		const shared = limits();
		for (let attempt = 0; attempt < 5; attempt++) enforceSignupLimit(req('4.4.4.4'), shared);
		expect(catchError(() => enforceSignupLimit(req('4.4.4.4'), shared)).code).toBe('RATE_LIMITED');
		expect(() => enforceSignupLimit(req('4.4.4.5'), shared)).not.toThrow();
	});

	it('password change: limited per member and per IP', () => {
		const shared = limits({ passwordPer15Min: 2 });
		enforcePasswordLimit(req('5.5.5.5'), 'm1', shared);
		enforcePasswordLimit(req('5.5.5.6'), 'm1', shared);
		expect(catchError(() => enforcePasswordLimit(req('5.5.5.7'), 'm1', shared)).code).toBe('RATE_LIMITED');
		expect(() => enforcePasswordLimit(req('5.5.5.8'), 'm2', shared)).not.toThrow();
	});

	it('the window rolls over', () => {
		const shared = limits({ signupPerHour: 1 });
		shared.enforce('signup', 'ip', 0);
		expect(() => shared.enforce('signup', 'ip', 1000)).toThrow();
		expect(() => shared.enforce('signup', 'ip', 3_600_001)).not.toThrow();
	});

	it('falls back to the socket address and never crashes without a request', () => {
		expect(getClientIp({ socket: { remoteAddress: '6.6.6.6' } })).toBe('6.6.6.6');
		expect(getClientIp(undefined)).toBe('unknown');
	});
});

describe('general per-IP middleware', () => {
	const makeApp = (max: number) => {
		const app = express();
		app.set('trust proxy', 1);
		app.use('/graphql', createGeneralRateLimitMiddleware(limits({ generalPerMinute: max })));
		app.post('/graphql', (_req, res) => res.json({ data: 'ok' }));
		app.get('/health', (_req, res) => res.json({ status: 'ok' }));
		return app;
	};

	it('answers 429 with Retry-After and a JSON error, and never a stack trace', async () => {
		const app = makeApp(2);
		await request(app).post('/graphql').expect(200);
		await request(app).post('/graphql').expect(200);
		const refused = await request(app).post('/graphql').expect(429);
		expect(refused.headers['retry-after']).toMatch(/^\d+$/);
		expect(refused.body.errors[0]).toMatchObject({ code: 'RATE_LIMITED' });
		expect(refused.body.errors[0].retryAfterSeconds).toBeGreaterThan(0);
		expect(JSON.stringify(refused.body)).not.toMatch(/stack| at \w+/);
	});

	it('never counts the health endpoint, and preflight requests are not counted', async () => {
		const app = makeApp(1);
		for (let i = 0; i < 10; i++) await request(app).get('/health').expect(200);
		for (let i = 0; i < 5; i++) await request(app).options('/graphql').expect((res) => expect(res.status).not.toBe(429));
		await request(app).post('/graphql').expect(200);
	});

	it('counts each client address on its own, using the forwarded address behind a proxy', async () => {
		const app = makeApp(1);
		await request(app).post('/graphql').set('X-Forwarded-For', '7.7.7.1').expect(200);
		await request(app).post('/graphql').set('X-Forwarded-For', '7.7.7.2').expect(200);
		await request(app).post('/graphql').set('X-Forwarded-For', '7.7.7.1').expect(429);
	});
});
