import { HttpException } from '@nestjs/common';

/**
 * An error with its own GraphQL `code` (RATE_LIMITED, AI_DAILY_CAP_REACHED, SERVICE_UNAVAILABLE). It is an HttpException on
 * purpose: Nest logs a thrown plain Error or GraphQLError with its stack trace, which is noise for something a client causes
 * in normal use (and a flood of them would flood the log). `formatGraphQLError` turns it into `{ code, message }`
 * plus `retryAfterSeconds` when there is one; the Apollo driver's own status mapping never sees the code.
 */
export class CodedException extends HttpException {
	constructor(
		message: string,
		public readonly code: string,
		status: number = 400,
		public readonly retryAfterSeconds?: number,
	) {
		super(message, status);
	}
}

/** one failed field of an input: the property path (`input.memberNick` is `memberNick`) and the class-validator rule names, never a value */
export interface ValidationIssue {
	field: string;
	rules: string[];
}

/** a request that failed input validation; `formatGraphQLError` adds the `fields` list to the answer (#113) */
export class ValidationFailedException extends CodedException {
	constructor(
		message: string,
		public readonly fields: ValidationIssue[],
	) {
		super(message, 'VALIDATION_FAILED', 400);
	}
}
