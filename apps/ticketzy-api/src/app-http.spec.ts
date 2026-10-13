import { UnauthorizedException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApolloDriver } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import helmet from 'helmet';
import { AuthService } from './components/auth/auth.service';
import { MemberResolver } from './components/member/member.resolver';
import { MemberService } from './components/member/member.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { Message } from './libs/enums/common.enum';
import { DEFAULT_RATE_LIMITS } from './libs/env.validation';
import { buildCorsOptions, getHelmetOptions } from './libs/http-hardening';
import { getGraphQLOptions } from './libs/graphql-options';
import { RateLimits, createGeneralRateLimitMiddleware } from './libs/rate-limit';
import * as rateLimitModule from './libs/rate-limit';

/**
 * The real Nest + Apollo pipeline of the API (resolvers, guards, formatError, the middleware order of main.ts) with a stub
 * MemberService and no database, so the production behaviour can be checked over HTTP without MongoDB.
 */
const makeApp = async (env: Record<string, string>, limits: Partial<typeof DEFAULT_RATE_LIMITS> = {}): Promise<NestExpressApplication> => {
	const shared = new RateLimits({ ...DEFAULT_RATE_LIMITS, ...limits });
	jest.spyOn(rateLimitModule, 'getRateLimits').mockReturnValue(shared);
	const memberService = {
		login: jest.fn().mockRejectedValue(new UnauthorizedException(Message.WRONG_EMAIL_OR_PASSWORD)),
		signupUser: jest.fn().mockRejectedValue(new UnauthorizedException(Message.WRONG_EMAIL_OR_PASSWORD)),
		signupOrganizer: jest.fn(),
	};
	const moduleRef = await Test.createTestingModule({
		imports: [GraphQLModule.forRoot({ driver: ApolloDriver, ...getGraphQLOptions(env, { warn: jest.fn(), error: jest.fn() }) } as any)],
		controllers: [AppController, HealthController],
		providers: [
			AppService,
			MemberResolver,
			{ provide: MemberService, useValue: memberService },
			{ provide: AuthService, useValue: {} },
			{ provide: getConnectionToken(), useValue: { readyState: 1 } },
		],
	}).compile();
	const app = moduleRef.createNestApplication<NestExpressApplication>();
	app.disable('x-powered-by');
	app.set('trust proxy', 1);
	app.use(helmet(getHelmetOptions(env)));
	app.enableCors(buildCorsOptions(env));
	app.use('/graphql', createGeneralRateLimitMiddleware(shared));
	await app.init();
	return app;
};

const login = (email: string) => ({ query: 'mutation($input: LoginInput!) { login(input: $input) { _id } }', variables: { input: { memberEmail: email, memberPassword: 'wrong-password-1' } } });
const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://shop.vercel.app' };

afterEach(() => jest.restoreAllMocks());

describe('the API over HTTP (without MongoDB)', () => {
	it('a login loop from one IP is answered RATE_LIMITED on the 11th attempt, with a retry hint and no stack trace', async () => {
		const app = await makeApp(env);
		const codes: string[] = [];
		let last: any;
		for (let attempt = 0; attempt < 12; attempt++) {
			const res = await request(app.getHttpServer()).post('/graphql').set('X-Forwarded-For', '203.0.113.9').send(login(`user${attempt}@x.com`));
			expect(res.status).toBe(200);
			last = res.body.errors[0];
			codes.push(last.code);
		}
		expect(codes.slice(0, 10).every((code) => code === 'UNAUTHENTICATED')).toBe(true);
		expect(codes.slice(10)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
		expect(last).toEqual({ code: 'RATE_LIMITED', message: expect.stringMatching(/^Too many requests, please try again in \d+ seconds!$/), retryAfterSeconds: expect.any(Number) });
		expect(JSON.stringify(last)).not.toMatch(/stack|node_modules|at \w+ \(/);
		// another client address is not affected
		const other = await request(app.getHttpServer()).post('/graphql').set('X-Forwarded-For', '203.0.113.10').send(login('fresh@x.com'));
		expect(other.body.errors[0].code).toBe('UNAUTHENTICATED');
		await app.close();
	});

	it('the general per-IP limit answers HTTP 429 with Retry-After for any GraphQL request, but never for /health or /ready', async () => {
		const app = await makeApp(env, { generalPerMinute: 3 });
		const query = { query: '{ __typename }' };
		for (let i = 0; i < 3; i++) await request(app.getHttpServer()).post('/graphql').set('X-Forwarded-For', '198.51.100.1').send(query).expect(200);
		const refused = await request(app.getHttpServer()).post('/graphql').set('X-Forwarded-For', '198.51.100.1').send(query).expect(429);
		expect(refused.headers['retry-after']).toMatch(/^\d+$/);
		expect(refused.body.errors[0].code).toBe('RATE_LIMITED');
		for (let i = 0; i < 20; i++) {
			await request(app.getHttpServer()).get('/health').set('X-Forwarded-For', '198.51.100.1').expect(200);
			await request(app.getHttpServer()).get('/ready').set('X-Forwarded-For', '198.51.100.1').expect(200);
		}
		await request(app.getHttpServer()).get('/').set('X-Forwarded-For', '198.51.100.1').expect(200);
		await app.close();
	});

	it('production: introspection is off, no playground page, and a bad field does not reveal a suggestion', async () => {
		const app = await makeApp(env);
		const introspection = await request(app.getHttpServer()).post('/graphql').send({ query: '{ __schema { types { name } } }' });
		expect(JSON.stringify(introspection.body)).not.toContain('"types"');
		const page = await request(app.getHttpServer()).get('/graphql').set('Accept', 'text/html');
		expect(page.text).not.toMatch(/sandbox\.embed|Apollo Sandbox|GraphQL Playground/i);
		const typo = await request(app.getHttpServer()).post('/graphql').send({ query: '{ sayHelo }' });
		expect(JSON.stringify(typo.body)).not.toMatch(/Did you mean/i);
		await app.close();
	});

	it('development keeps introspection on', async () => {
		const app = await makeApp({ NODE_ENV: 'development' });
		const res = await request(app.getHttpServer()).post('/graphql').send({ query: '{ __schema { queryType { name } } }' });
		expect(res.body.data.__schema.queryType.name).toBe('Query');
		await app.close();
	});

	it('sends the protective headers, no X-Powered-By, and CORS only for the listed origin', async () => {
		const app = await makeApp(env);
		const ok = await request(app.getHttpServer()).get('/health').set('Origin', 'https://shop.vercel.app');
		expect(ok.headers['access-control-allow-origin']).toBe('https://shop.vercel.app');
		expect(ok.headers['x-powered-by']).toBeUndefined();
		expect(ok.headers['x-content-type-options']).toBe('nosniff');
		const bad = await request(app.getHttpServer()).get('/health').set('Origin', 'https://evil.example.com');
		expect(bad.headers['access-control-allow-origin']).toBeUndefined();
		// a refused request still carries the CORS headers a browser needs to read the 429
		await app.close();
	});

	it('a 429 carries the CORS header, so the browser can read it', async () => {
		const app = await makeApp(env, { generalPerMinute: 1 });
		const send = () => request(app.getHttpServer()).post('/graphql').set('Origin', 'https://shop.vercel.app').set('X-Forwarded-For', '192.0.2.5').send({ query: '{ __typename }' });
		await send().expect(200);
		const refused = await send().expect(429);
		expect(refused.headers['access-control-allow-origin']).toBe('https://shop.vercel.app');
		await app.close();
	});
});
