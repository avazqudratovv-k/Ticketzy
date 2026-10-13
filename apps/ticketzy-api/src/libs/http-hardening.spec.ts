import * as express from 'express';
import * as cors from 'cors';
import * as request from 'supertest';
import helmet from 'helmet';
import { buildCorsOptions, getHelmetOptions } from './http-hardening';

const makeApp = (env: Record<string, string>) => {
	const app = express();
	app.disable('x-powered-by');
	app.use(helmet(getHelmetOptions(env)));
	app.use(cors(buildCorsOptions(env) as any));
	app.get('/uploads/a.png', (_req, res) => res.type('png').send('x'));
	app.post('/graphql', (_req, res) => res.json({ ok: true }));
	return app;
};
const production = { NODE_ENV: 'production', CORS_ORIGINS: 'https://shop.vercel.app,https://admin.example.com' };

describe('CORS from CORS_ORIGINS', () => {
	it.each(['https://shop.vercel.app', 'https://admin.example.com'])('lets the listed origin %s in', async (origin) => {
		const res = await request(makeApp(production)).post('/graphql').set('Origin', origin).expect(200);
		expect(res.headers['access-control-allow-origin']).toBe(origin);
	});

	it('gives other origins no CORS header, and never answers with a wildcard', async () => {
		for (const origin of ['https://evil.example.com', 'https://shop.vercel.app.evil.com', 'null']) {
			const res = await request(makeApp(production)).post('/graphql').set('Origin', origin);
			expect(res.headers['access-control-allow-origin']).toBeUndefined();
		}
		const listed = await request(makeApp(production)).post('/graphql').set('Origin', 'https://shop.vercel.app');
		expect(listed.headers['access-control-allow-origin']).not.toBe('*');
	});

	it('does not allow credentials (the frontend sends a bearer header, no cookies)', async () => {
		const res = await request(makeApp(production)).post('/graphql').set('Origin', 'https://shop.vercel.app');
		expect(res.headers['access-control-allow-credentials']).toBeUndefined();
	});

	it('answers the preflight of a browser with the Authorization header', async () => {
		const res = await request(makeApp(production))
			.options('/graphql')
			.set('Origin', 'https://shop.vercel.app')
			.set('Access-Control-Request-Method', 'POST')
			.set('Access-Control-Request-Headers', 'authorization,content-type,apollo-require-preflight');
		expect(res.status).toBe(204);
		expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
	});

	it('lets requests without an Origin through (curl, health checks)', async () => {
		await request(makeApp(production)).post('/graphql').expect(200);
	});

	it('allows the local frontend in development', async () => {
		const res = await request(makeApp({})).post('/graphql').set('Origin', 'http://localhost:3000');
		expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
	});
});

describe('helmet settings', () => {
	it('removes X-Powered-By and sets the usual protective headers', async () => {
		const res = await request(makeApp(production)).post('/graphql');
		expect(res.headers['x-powered-by']).toBeUndefined();
		expect(res.headers['x-content-type-options']).toBe('nosniff');
		expect(res.headers['strict-transport-security']).toBeDefined();
		expect(res.headers['content-security-policy']).toBeDefined();
	});

	it('lets a page on another origin show the uploaded images (cross-origin resource policy)', async () => {
		const res = await request(makeApp(production)).get('/uploads/a.png').set('Origin', 'https://shop.vercel.app');
		expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
	});

	it('keeps the Apollo sandbox working in development (no CSP there)', async () => {
		const res = await request(makeApp({})).post('/graphql');
		expect(res.headers['content-security-policy']).toBeUndefined();
	});
});
