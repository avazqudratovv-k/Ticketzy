import { NextFunction, Request, Response } from 'express';
import { Message } from './enums/common.enum';
import { CodedException } from './coded-exception';
import { RateLimitConfig, getRateLimitConfig } from './env.validation';
import { RateLimiter } from './rate-limiter';

const MINUTE = 60_000;
const QUARTER_HOUR = 15 * MINUTE;
const HOUR = 60 * MINUTE;

export const RATE_LIMITED_CODE = 'RATE_LIMITED';

export type RateLimitName = 'general' | 'login' | 'loginEmail' | 'signup' | 'password';

/** the text a client sees; the number of seconds is the retry hint */
export const rateLimitedMessage = (retryAfterSeconds: number): string => Message.RATE_LIMITED.replace('{seconds}', String(retryAfterSeconds));

/** thrown by `enforce`; `formatGraphQLError` keeps its code and its retry hint and nothing else */
export const createRateLimitedError = (retryAfterSeconds: number, message: string = rateLimitedMessage(retryAfterSeconds)): CodedException =>
	new CodedException(message, RATE_LIMITED_CODE, 429, retryAfterSeconds);

/**
 * The limits of the API, one sliding window per kind of request, counted in this process' memory (single instance).
 * Behind a second instance every instance counts alone, so a shared store would be needed (see RateLimiter).
 * Counting happens where the operation runs (the resolver), so GraphQL aliases that repeat `login` in one HTTP request
 * are counted once each.
 */
export class RateLimits {
	private readonly limiters: Record<RateLimitName, RateLimiter>;

	constructor(public readonly config: RateLimitConfig) {
		this.limiters = {
			general: new RateLimiter(config.generalPerMinute, MINUTE),
			login: new RateLimiter(config.loginPer15Min, QUARTER_HOUR),
			// a stolen password list spread over many IPs still hits one account: twice the per-IP number, so a victim is not locked out by a handful of requests
			loginEmail: new RateLimiter(config.loginPer15Min * 2, QUARTER_HOUR),
			signup: new RateLimiter(config.signupPerHour, HOUR),
			password: new RateLimiter(config.passwordPer15Min, QUARTER_HOUR),
		};
	}

	public check(name: RateLimitName, key: string, now?: number): { allowed: boolean; retryAfterSeconds: number } {
		return this.limiters[name].consume(`${name}:${key}`, now);
	}

	/** throws RATE_LIMITED with a retry hint when `key` used up the limit */
	public enforce(name: RateLimitName, key: string, now?: number): void {
		const result = this.check(name, key, now);
		if (!result.allowed) throw createRateLimitedError(result.retryAfterSeconds);
	}
}

let shared: { signature: string; limits: RateLimits } | null = null;

/** one instance per process; rebuilt if the environment changed (the signature is the numbers, never a secret) */
export const getRateLimits = (env: Record<string, any> = process.env): RateLimits => {
	const config = getRateLimitConfig(env);
	const signature = JSON.stringify(config);
	if (!shared || shared.signature !== signature) shared = { signature, limits: new RateLimits(config) };
	return shared.limits;
};

/** the client address as Express sees it; with `trust proxy` set this is the real client behind Render's proxy */
export const getClientIp = (req: { ip?: string; socket?: { remoteAddress?: string } } | undefined | null): string =>
	req?.ip || req?.socket?.remoteAddress || 'unknown';

/** the HTTP body of a refused request; the same `{ code, message }` shape as the GraphQL errors */
export const rateLimitedBody = (retryAfterSeconds: number) => ({
	errors: [{ code: RATE_LIMITED_CODE, message: rateLimitedMessage(retryAfterSeconds), retryAfterSeconds }],
});

/**
 * Express middleware for the general per-IP limit. Mount it on the GraphQL path only: /health, /ready, `/` and /uploads
 * are never counted. Answers 429 with `Retry-After` and a JSON body, never a stack trace.
 */
export const createGeneralRateLimitMiddleware =
	(limits: RateLimits = getRateLimits()) =>
	(req: Request, res: Response, next: NextFunction): void => {
		// CORS preflights carry no credentials and the browser would hide a 429 on them; the real request is counted
		if (req.method === 'OPTIONS') return next();
		const result = limits.check('general', getClientIp(req));
		if (result.allowed) return next();
		res.setHeader('Retry-After', String(result.retryAfterSeconds));
		res.status(429).json(rateLimitedBody(result.retryAfterSeconds));
	};

/**
 * The operation limits, called from the resolvers with the request of the caller (`context.req`).
 * They run before any database or bcrypt work, so a flood costs almost nothing.
 */
export const enforceLoginLimit = (req: any, memberEmail: unknown, limits: RateLimits = getRateLimits()): void => {
	limits.enforce('login', getClientIp(req));
	const email = String(memberEmail ?? '').trim().toLowerCase();
	if (email) limits.enforce('loginEmail', email);
};

export const enforceSignupLimit = (req: any, limits: RateLimits = getRateLimits()): void => limits.enforce('signup', getClientIp(req));

/** password change (`updateMember`) and admin reset (`updateMemberByAdmin`): per acting member and per IP */
export const enforcePasswordLimit = (req: any, actorId: unknown, limits: RateLimits = getRateLimits()): void => {
	limits.enforce('password', `member:${String(actorId)}`);
	limits.enforce('password', `ip:${getClientIp(req)}`);
};
