import { ApolloServer } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { ValidationPipe } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { of } from 'rxjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { OrdinaryInquiry } from './dto/common/common.input';
import { Message } from './enums/common.enum';
import { formatGraphQLError, mapRawError, mapValidationMessage } from './error-mapping';
import { createRateLimitedError } from './rate-limit';
import { LoggingInterceptor } from './interceptor/Logging.interceptor';
import { buildMongoOptions } from './mongo-options';
import { SocketGateway } from '../socket/socket.gateway';
import AiUsageSchema from './schemas/AiUsage.model';
import AuditLogSchema from './schemas/AuditLog.model';
import CommentSchema from './schemas/Comment.model';
import EventSchema from './schemas/Event.model';
import FollowSchema from './schemas/Follow.model';
import MemberSchema from './schemas/Member.model';
import NoticeSchema from './schemas/Notice.model';
import OrderSchema from './schemas/Order.model';
import PaymentSchema from './schemas/Payment.model';
import TicketSchema from './schemas/Ticket.model';
import VenueSchema from './schemas/Venue.model';

describe('over-limit list arguments get a clear message (item 8)', () => {
	const validate = async (value: object) => {
		const pipe = new ValidationPipe({ whitelist: true, transform: true });
		try {
			await pipe.transform(value, { type: 'body', metatype: OrdinaryInquiry });
		} catch (err: any) {
			return err;
		}
		throw new Error('expected a validation error');
	};

	it('limit above 100 says what the maximum is, through the real ValidationPipe and formatError', async () => {
		const err = await validate({ page: 1, limit: 5000 });
		expect(err.getResponse().message).toEqual(['limit must not be greater than 100']);
		// what Nest's Apollo driver does with an HttpException: the text becomes the message, the response moves to extensions.originalError
		const asDriver = new GraphQLError(err.message, { extensions: { code: 'BAD_REQUEST', originalError: err.getResponse() } });
		const server = new ApolloServer({
			typeDefs: 'type Query { a: String }',
			resolvers: { Query: { a: () => { throw asDriver; } } },
			formatError: (formatted, original) => formatGraphQLError(formatted as any, original, { warn: jest.fn(), error: jest.fn() }) as any,
		});
		const body: any = (await server.executeOperation({ query: '{ a }' })).body;
		expect(body.singleResult.errors[0]).toEqual({ code: 'BAD_REQUEST', message: 'You asked for too many items at once, the maximum is 100 per page!' });
	});

	it('page above 10000 says so too, and other validation texts stay as they are', async () => {
		expect(mapValidationMessage(['page must not be greater than 10000'])).toBe('That page number is too high, the maximum is 10000!');
		expect(mapValidationMessage(['search.limit must not be greater than 200'])).toBe(Message.LIMIT_TOO_HIGH.replace('{max}', '200'));
		expect(mapValidationMessage(['limit must not be less than 1', 'page must be an integer number'])).toBeNull();
		expect(mapValidationMessage('plain text')).toBeNull();
	});
});

describe('MongoDB down or slow (item 11)', () => {
	const named = (name: string, message: string) => Object.assign(new Error(message), { name });

	it.each([
		['the driver cannot select a server', named('MongoServerSelectionError', 'connect ECONNREFUSED 127.0.0.1:27017')],
		['Mongoose wraps the same error', named('MongooseServerSelectionError', 'Server selection timed out after 8000 ms')],
		['commands wait for a lost connection', named('MongooseError', 'Operation `orders.find()` buffering timed out after 8000ms')],
		['a socket dies', named('MongoNetworkError', 'connection 3 to cluster0.example.mongodb.net:27017 closed')],
	])('%s: the client gets SERVICE_UNAVAILABLE with a friendly text and no internal detail', (_name, err) => {
		const mapped = mapRawError(err);
		expect(mapped).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: Message.SERVICE_TEMPORARILY_UNAVAILABLE, level: 'error' });
		expect(mapped.message).not.toMatch(/mongodb|cluster|ECONNREFUSED|buffering/i);
	});
});

describe('RATE_LIMITED reaches the client with its retry hint and nothing else', () => {
	it('keeps code, message and retryAfterSeconds; no stack, no extensions', async () => {
		const warn = jest.fn();
		const server = new ApolloServer({
			typeDefs: 'type Query { a: String }',
			resolvers: { Query: { a: () => { throw createRateLimitedError(42); } } },
			formatError: (formatted, original) => formatGraphQLError(formatted as any, original, { warn, error: jest.fn() }) as any,
		});
		const body: any = (await server.executeOperation({ query: '{ a }' })).body;
		expect(body.singleResult.errors[0]).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests, please try again in 42 seconds!', retryAfterSeconds: 42 });
		expect(warn).toHaveBeenCalledWith('RATE_LIMITED (retry in 42s)');
	});
});

describe('LoggingInterceptor (item 12)', () => {
	const gqlContext = (body: object) => ({ getType: () => 'graphql' }) as any;

	it('lets plain HTTP routes (/, /health, /ready) pass through to the handler', async () => {
		const handle = jest.fn().mockReturnValue(of('ok'));
		const result = new LoggingInterceptor().intercept({ getType: () => 'http' } as any, { handle });
		expect(result).toBeDefined();
		expect(handle).toHaveBeenCalled();
	});

	it('logs the operation name and the time, never the variables or the response body', (done) => {
		jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({ getContext: () => ({ req: { body: { operationName: 'login', variables: { input: { memberPassword: 'hunter2hunter2' } } } } }) } as any);
		const interceptor = new LoggingInterceptor();
		const lines: string[] = [];
		jest.spyOn((interceptor as any).logger, 'log').mockImplementation((line: any) => void lines.push(String(line)));
		interceptor.intercept(gqlContext({}), { handle: () => of({ memberEmail: 'a@b.com', accessToken: 'jwt-token-value' }) }).subscribe({
			complete: () => {
				expect(lines[0]).toBe('login');
				expect(lines[1]).toMatch(/^\d+ms$/);
				expect(lines.join(' ')).not.toMatch(/hunter2|a@b\.com|jwt-token-value/);
				done();
			},
		});
	});
});

describe('indexes (item 10)', () => {
	const indexes = (schema: any) => schema.indexes().map(([fields, options]: [Record<string, number>, Record<string, any>]) => ({ fields, options }));
	const has = (schema: any, fields: Record<string, number>) => indexes(schema).some((index: any) => JSON.stringify(index.fields) === JSON.stringify(fields));

	it.each([
		['events by status and age', EventSchema, { eventStatus: 1, createdAt: -1 }],
		['events the batch job ends', EventSchema, { eventStatus: 1, endAt: 1 }],
		['events of one venue by time', EventSchema, { venueId: 1, startAt: 1 }],
		['comments of one event', CommentSchema, { commentRefId: 1, commentGroup: 1, commentStatus: 1, createdAt: -1 }],
		['followings of one member', FollowSchema, { followerId: 1, createdAt: -1 }],
		['tickets of one order', TicketSchema, { orderId: 1 }],
		['payments of one order', PaymentSchema, { orderId: 1, paymentStatus: 1 }],
		['audit by target', AuditLogSchema, { targetId: 1, createdAt: -1 }],
		['audit by actor', AuditLogSchema, { actorId: 1, createdAt: -1 }],
		['public notices', NoticeSchema, { noticeStatus: 1, createdAt: -1 }],
		['venues by status and city', VenueSchema, { venueStatus: 1, venueCity: 1 }],
		['organizers by type and status', MemberSchema, { memberType: 1, memberStatus: 1, createdAt: -1 }],
		['pending orders by expiry', OrderSchema, { orderStatus: 1, expiresAt: 1 }],
	])('has the index for %s', (_name, schema, fields) => {
		expect(has(schema, fields)).toBe(true);
	});

	it('the indexes added in this task are all non-unique, so they cannot fail on existing duplicate data', () => {
		const added = [
			[EventSchema, { eventStatus: 1, createdAt: -1 }], [EventSchema, { eventStatus: 1, endAt: 1 }], [EventSchema, { venueId: 1, startAt: 1 }],
			[CommentSchema, { commentRefId: 1, commentGroup: 1, commentStatus: 1, createdAt: -1 }], [FollowSchema, { followerId: 1, createdAt: -1 }],
			[TicketSchema, { orderId: 1 }], [PaymentSchema, { orderId: 1, paymentStatus: 1 }], [AuditLogSchema, { targetId: 1, createdAt: -1 }],
			[AuditLogSchema, { actorId: 1, createdAt: -1 }], [NoticeSchema, { noticeStatus: 1, createdAt: -1 }], [VenueSchema, { venueStatus: 1, venueCity: 1 }],
			[MemberSchema, { memberType: 1, memberStatus: 1, createdAt: -1 }],
		] as const;
		for (const [schema, fields] of added) {
			const index = indexes(schema).find((item: any) => JSON.stringify(item.fields) === JSON.stringify(fields));
			expect(index.options.unique).toBeUndefined();
		}
	});

	it('ai_usage counters expire by TTL and are unique per key', () => {
		expect(indexes(AiUsageSchema)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ fields: { expireAt: 1 }, options: expect.objectContaining({ expireAfterSeconds: 0 }) }),
				expect.objectContaining({ fields: { usageKey: 1 }, options: expect.objectContaining({ unique: true }) }),
			]),
		);
	});
});

describe('connection settings and scripts (items 7, 11)', () => {
	it('bounds server selection, the socket and the pool so a dead MongoDB answers fast instead of hanging', () => {
		const options = buildMongoOptions({ autoIndex: true });
		expect(options.serverSelectionTimeoutMS).toBeLessThanOrEqual(10_000);
		expect(options.connectTimeoutMS).toBeLessThanOrEqual(15_000);
		expect(options.socketTimeoutMS).toBeGreaterThan(0);
		expect(options.maxPoolSize).toBeLessThanOrEqual(20);
		expect(options.retryAttempts).toBeLessThanOrEqual(5);
		expect(buildMongoOptions({ autoIndex: false }).autoIndex).toBe(false);
	});

	it('start:prod and start:prod:batch both set NODE_ENV=production (C3-84)', () => {
		const scripts = JSON.parse(readFileSync(join(__dirname, '../../../../package.json'), 'utf8')).scripts;
		expect(scripts['start:prod']).toMatch(/^NODE_ENV=production node dist\/apps\/ticketzy-api\/main/);
		expect(scripts['start:prod:batch']).toMatch(/^NODE_ENV=production node dist\/apps\/ticketzy-batch\/main/);
	});

	it('both main.ts files enable shutdown hooks and listen on PORT through getListenPort, bound to 0.0.0.0 (C3-59, C3-62)', () => {
		for (const app of ['ticketzy-api', 'ticketzy-batch']) {
			const main = readFileSync(join(__dirname, `../../../${app}/src/main.ts`), 'utf8');
			expect(main).toContain('app.enableShutdownHooks()');
			expect(main).toMatch(/getListenPort\([^)]*\), '0\.0\.0\.0'\)/);
			expect(main).not.toMatch(/process\.env\.PORT_(API|BATCH)/);
		}
	});

	it('the WebSocket gateway clears its pending auth timers on shutdown', () => {
		const gateway: any = new SocketGateway({} as any, {} as any, {} as any);
		const timer = setTimeout(() => { throw new Error('should have been cleared'); }, 20);
		gateway.authTimers.set({}, timer);
		gateway.onModuleDestroy();
		expect(gateway.authTimers.size).toBe(0);
	});
});
