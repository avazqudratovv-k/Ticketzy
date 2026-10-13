import { Logger, UnauthorizedException } from '@nestjs/common';
import { Message } from './enums/common.enum';

const logger = new Logger('UploadGuard');

/** the part of AuthService the middleware needs, so it can be tested without a database */
export interface UploadAuthenticator {
	getBearerToken(request: any): string;
	authenticate(token: string): Promise<unknown>;
}

export const isMultipartRequest = (request: any): boolean => /^multipart\//i.test(String(request?.headers?.['content-type'] ?? ''));

/**
 * `graphqlUploadExpress` parses multipart bodies before any GraphQL guard runs, and a malformed multipart body can crash
 * the parser (C3-72). This middleware goes in front of it: a multipart request needs a valid bearer token of a member
 * who may log in, otherwise it is answered with 401 and the body is never parsed. Non-multipart requests pass through
 * untouched (JSON queries and the guards decide as before).
 */
export const createUploadAuthMiddleware =
	(authService: UploadAuthenticator) =>
	async (request: any, response: any, next: (error?: unknown) => void): Promise<void> => {
		if (!isMultipartRequest(request)) return next();

		try {
			await authService.authenticate(authService.getBearerToken(request));
			return next();
		} catch (err) {
			const message = err instanceof UnauthorizedException ? err.message : Message.NOT_AUTHENTICATED;
			logger.warn(`Multipart request refused before parsing: ${message}`);
			// the unread body is not parsed; closing the connection stops the client from streaming the rest
			response.setHeader('Connection', 'close');
			response.status(401).json({ errors: [{ message, extensions: { code: 'UNAUTHENTICATED' } }] });
		}
	};
