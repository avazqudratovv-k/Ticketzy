import { ApolloServer } from '@apollo/server';
import { BadRequestException } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { formatGraphQLError, mapRawError, redactSecrets } from './error-mapping';
import { Message } from './enums/common.enum';

const mongoDuplicate = (keyPattern: Record<string, number>) =>
	Object.assign(new Error('E11000 duplicate key error collection: ticketzy.members index: memberNick_1 dup key: { memberNick: "secretnick" }'), {
		name: 'MongoServerError',
		code: 11000,
		keyPattern,
		keyValue: { memberNick: 'secretnick' },
	});

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('mapRawError', () => {
	it('maps a duplicate key on a member field to the existing member message, without any value', () => {
		const mapped = mapRawError(mongoDuplicate({ memberNick: 1 }))!;
		expect(mapped).toMatchObject({ code: 'BAD_REQUEST', message: Message.USED_MEMBER_EMAIL_NICK_OR_PHONE, level: 'warn' });
		expect(JSON.stringify(mapped)).not.toContain('secretnick');
		expect(mapped.detail).toBe('duplicate key on [memberNick]');
	});

	it('maps any other duplicate key to the generic duplicate message', () => {
		const mapped = mapRawError(mongoDuplicate({ venueCity: 1, venueName: 1, venueAddress: 1 }))!;
		expect(mapped).toMatchObject({ code: 'BAD_REQUEST', message: Message.DUPLICATE_VALUE });
	});

	it('maps buffering timeouts and connection failures to SERVICE_UNAVAILABLE and logs them as errors', () => {
		const buffering = mapRawError(named('MongooseError', 'Operation `members.findOne()` buffering timed out after 10000ms'))!;
		expect(buffering).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: Message.SERVICE_TEMPORARILY_UNAVAILABLE, level: 'error' });
		expect(buffering.message).not.toContain('members');
		expect(mapRawError(named('MongoServerSelectionError', 'connect ECONNREFUSED 127.0.0.1:27017'))!.code).toBe('SERVICE_UNAVAILABLE');
		expect(mapRawError(named('MongoNetworkError', 'socket closed'))!.code).toBe('SERVICE_UNAVAILABLE');
	});

	it('maps cast errors, validation errors and bad ObjectIds to BAD_REQUEST', () => {
		for (const err of [
			named('CastError', 'Cast to ObjectId failed for value "abc" (type string) at path "_id" for model "Member"'),
			named('ValidationError', 'Member validation failed: memberEmail: Path `memberEmail` is required.'),
			named('BSONError', 'input must be a 24 character hex string, 12 byte Uint8Array, or an integer'),
			new Error('input must be a 24 character hex string, 12 byte Uint8Array, or an integer'),
		]) {
			expect(mapRawError(err)).toMatchObject({ code: 'BAD_REQUEST', message: Message.BAD_REQUEST, level: 'warn' });
		}
	});

	it('turns an unknown plain Error into SOMETHING_WENT_WRONG and keeps the text only in the log detail', () => {
		const mapped = mapRawError(new Error('Cannot read properties of undefined (reading "memberPassword")'))!;
		expect(mapped).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: Message.SOMETHING_WENT_WRONG, level: 'error' });
		expect(mapped.detail).toContain('memberPassword');
	});

	it('leaves errors that are meant for the client alone', () => {
		expect(mapRawError(new BadRequestException(Message.NO_DATA_FOUND))).toBeNull();
		expect(mapRawError(new GraphQLError(Message.ACCOUNT_NOT_VERIFIED, { extensions: { code: 'ACCOUNT_NOT_VERIFIED' } }))).toBeNull();
		expect(mapRawError(new Error(Message.UPLOAD_FAILED))).toBeNull();
		expect(mapRawError(undefined)).toBeNull();
	});

	it('redacts connection strings and credentials in log detail', () => {
		expect(redactSecrets('failed mongodb+srv://user:pass@cluster0.example.net/db?x=1 now')).toBe('failed mongodb://<redacted> now');
		expect(redactSecrets('bad password=hunter2 key=abc')).toBe('bad password=<redacted> key=<redacted>');
		const mapped = mapRawError(new Error('cannot connect to mongodb://admin:hunter2@db.internal:27017/prod'))!;
		expect(mapped.detail).not.toContain('hunter2');
	});
});

describe('formatGraphQLError through a real Apollo execution', () => {
	const logger = { warn: jest.fn(), error: jest.fn() };
	const failing = (thrower: () => never) =>
		new ApolloServer({
			typeDefs: 'type Query { boom: String ok: String }',
			resolvers: { Query: { boom: () => thrower(), ok: () => 'fine' } },
			formatError: (formatted, original) => formatGraphQLError(formatted as any, original, logger) as any,
		});
	const run = async (server: ApolloServer, query = '{ boom }') => {
		const response = await server.executeOperation({ query });
		return (response.body as any).singleResult.errors[0];
	};

	beforeEach(() => jest.clearAllMocks());

	it('answers a Mongo duplicate key with a safe code and message and logs the index fields at warn', async () => {
		const error = await run(
			failing(() => {
				throw mongoDuplicate({ memberNick: 1 });
			}),
		);
		expect(error).toEqual({ code: 'BAD_REQUEST', message: Message.USED_MEMBER_EMAIL_NICK_OR_PHONE });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('memberNick'));
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secretnick');
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('answers a buffering timeout with SERVICE_UNAVAILABLE and logs it at error', async () => {
		const error = await run(
			failing(() => {
				throw named('MongooseError', 'Operation `members.findOne()` buffering timed out after 10000ms');
			}),
		);
		expect(error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: Message.SERVICE_TEMPORARILY_UNAVAILABLE });
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('buffering timed out'));
	});

	it('answers a cast error with BAD_REQUEST', async () => {
		const error = await run(
			failing(() => {
				throw named('CastError', 'Cast to ObjectId failed for value "x"');
			}),
		);
		expect(error).toEqual({ code: 'BAD_REQUEST', message: Message.BAD_REQUEST });
	});

	it('keeps the old behaviour for deliberate errors and for schema validation errors', async () => {
		const deliberate = await run(
			failing(() => {
				throw new GraphQLError(Message.ACCOUNT_NOT_VERIFIED, { extensions: { code: 'ACCOUNT_NOT_VERIFIED' } });
			}),
		);
		expect(deliberate).toEqual({ code: 'ACCOUNT_NOT_VERIFIED', message: Message.ACCOUNT_NOT_VERIFIED });
		expect(logger.warn).toHaveBeenCalledWith(`ACCOUNT_NOT_VERIFIED: ${Message.ACCOUNT_NOT_VERIFIED}`); // an expected login case (#65d)
		expect(logger.error).not.toHaveBeenCalled();

		const upload = await run(
			failing(() => {
				throw new Error(Message.UPLOAD_FAILED);
			}),
		);
		expect(upload.message).toBe(Message.UPLOAD_FAILED);

		const unknownField = await run(failing(() => 'x' as never), '{ nope }');
		expect(unknownField.code).toBe('GRAPHQL_VALIDATION_FAILED');
	});
});
