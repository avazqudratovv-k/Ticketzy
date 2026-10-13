import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { HelmetOptions } from 'helmet';
import { parseCorsOrigins } from './env.validation';

/**
 * CORS for the browser frontend on another origin (Vercel). The origins are exact (no wildcard, see `parseCorsOrigins`).
 * The frontend sends its bearer token in the Authorization header and uses no cookies, so credentials stay off:
 * with `credentials: true` a browser would also accept cookies, which nothing here needs.
 * A request without an Origin header (curl, server to server, the health check) is not a CORS request and is let through.
 */
export const buildCorsOptions = (env: Record<string, any> = process.env): CorsOptions => {
	const allowed = new Set(parseCorsOrigins(env));
	return {
		origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
		credentials: false,
		methods: ['GET', 'POST', 'OPTIONS'],
		maxAge: 600,
	};
};

/**
 * Helmet for a JSON API that also serves uploaded images to a page on another origin.
 * - `crossOriginResourcePolicy: cross-origin`: the default `same-origin` would stop the Vercel site from showing /uploads images.
 * - The Content-Security-Policy is helmet's strict default in production (the API serves no HTML). In development it is off
 *   because the Apollo sandbox page loads scripts from Apollo's CDN.
 * - Helmet only sets HTTP response headers: multipart uploads and the WebSocket upgrade are not touched.
 * - `X-Powered-By` is removed by helmet (and `app.disable('x-powered-by')` in main.ts).
 */
export const getHelmetOptions = (env: Record<string, any> = process.env): HelmetOptions => ({
	contentSecurityPolicy: env.NODE_ENV === 'production',
	crossOriginResourcePolicy: { policy: 'cross-origin' },
	crossOriginEmbedderPolicy: false,
});
