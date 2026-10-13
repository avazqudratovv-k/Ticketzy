import { HttpException } from '@nestjs/common';
import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLError } from 'graphql';
import { Message } from './enums/common.enum';
import { isExpectedDomainError } from './expected-errors';
import { T } from './types/common';

/** what a client gets: the existing `{ code, message }` shape, never a database value or an internal text */
export interface SafeGraphQLError {
	code: string;
	message: string;
}

export interface MappedRawError extends SafeGraphQLError {
	/** the server-side log line (no secrets, no document values) and how loud it is */
	level: 'warn' | 'error';
	detail: string;
}

const KNOWN_MESSAGES = new Set<string>(Object.values(Message));
const MEMBER_UNIQUE_FIELDS = ['memberEmail', 'memberNick', 'memberPhone'];

/** connection strings and credentials never reach a log line */
export const redactSecrets = (text: string): string =>
	text.replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://<redacted>').replace(/(password|secret|token|key)=\S+/gi, '$1=<redacted>').slice(0, 300);

const nameOf = (err: any): string => String(err?.name ?? err?.constructor?.name ?? 'Error');

const isDuplicateKey = (err: any): boolean => err?.code === 11000 || err?.code === 11001;

const isUnavailable = (err: any): boolean =>
	/^(MongoNetwork|MongoServerSelection|MongoNotConnected|MongoTopologyClosed|MongoPoolClosed|MongoWaitQueueTimeout)/.test(nameOf(err)) ||
	/buffering timed out|ECONNREFUSED|ENOTFOUND|topology was destroyed|connection .* closed/i.test(String(err?.message ?? ''));

const isBadInput = (err: any): boolean =>
	['CastError', 'ValidationError', 'BSONError', 'BSONTypeError', 'BSONRuntimeError'].includes(nameOf(err)) ||
	/24 character hex string|Cast to \w+ failed/i.test(String(err?.message ?? ''));

/**
 * Turns an error that was not thrown on purpose (a MongoDB duplicate key, a buffering timeout, a Mongoose cast error,
 * a bad ObjectId, any other plain Error) into a safe `{ code, message }` plus a server-side log detail.
 * Returns null for errors that are meant for the client already: Nest HTTP exceptions, GraphQLErrors (login uses one
 * for ACCOUNT_NOT_VERIFIED) and plain Errors whose text is a `Message` value (the uploader).
 */
export const mapRawError = (raw: unknown): MappedRawError | null => {
	if (raw instanceof HttpException || raw instanceof GraphQLError) return null;
	const err: any = raw;

	if (isDuplicateKey(err)) {
		// field names only (the index key pattern), never the duplicated values
		const fields = Object.keys(err?.keyPattern ?? {});
		const memberField = fields.some((field) => MEMBER_UNIQUE_FIELDS.includes(field));
		return {
			code: 'BAD_REQUEST',
			message: memberField ? Message.USED_MEMBER_EMAIL_NICK_OR_PHONE : Message.DUPLICATE_VALUE,
			level: 'warn',
			detail: `duplicate key on [${fields.join(', ') || 'unknown index'}]`,
		};
	}
	if (isBadInput(err)) {
		return { code: 'BAD_REQUEST', message: Message.BAD_REQUEST, level: 'warn', detail: `${nameOf(err)}: ${redactSecrets(String(err?.message ?? ''))}` };
	}
	if (isUnavailable(err)) {
		return {
			code: 'SERVICE_UNAVAILABLE',
			message: Message.SERVICE_TEMPORARILY_UNAVAILABLE,
			level: 'error',
			detail: `${nameOf(err)}: ${redactSecrets(String(err?.message ?? ''))}`,
		};
	}
	// a plain Error that carries one of our own messages (for example the uploader) is meant for the client
	if (err instanceof Error && KNOWN_MESSAGES.has(err.message)) return null;
	if (err instanceof Error) {
		return {
			code: 'INTERNAL_SERVER_ERROR',
			message: Message.SOMETHING_WENT_WRONG,
			level: 'error',
			detail: `${nameOf(err)}: ${redactSecrets(err.message)}`,
		};
	}
	return null;
};

/** the `formatError` hook of the GraphQL module: the client always gets `{ code, message }` and nothing internal */
export const formatGraphQLError = (
	error: T,
	originalError: unknown,
	logger: { warn: (message: string) => void; error: (message: string) => void },
): SafeGraphQLError => {
	// raw database and runtime errors become a safe code and message; the detail stays in the server log (C3-61)
	const mapped = mapRawError(unwrapResolverError(originalError));
	if (mapped) {
		const line = `${mapped.code} (${mapped.detail})`;
		if (mapped.level === 'warn') logger.warn(line);
		else logger.error(line);
		return { code: mapped.code, message: mapped.message };
	}

	const graphQLFormattedError = {
		code: error?.extensions.code,
		message: error?.extensions?.exception?.response?.message || error?.extensions?.response?.message || error?.message,
	};
	if (isExpectedDomainError(graphQLFormattedError)) {
		logger.warn(`${graphQLFormattedError.code}: ${graphQLFormattedError.message}`);
	} else {
		logger.error(`GRAPHQL GLOBAL ERR: ${JSON.stringify(graphQLFormattedError)}`);
	}
	return graphQLFormattedError;
};
