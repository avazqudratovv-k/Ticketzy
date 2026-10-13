import { ApolloDriverConfig } from '@nestjs/apollo';
import { formatGraphQLError } from './error-mapping';
import { T } from './types/common';

/**
 * The Apollo settings, read after ConfigModule has loaded .env. In production the playground and introspection are off,
 * a client never gets a stack trace (it gets `{ code, message }` from `formatGraphQLError`) and "did you mean field X"
 * hints are hidden; `uploads` is off because `graphqlUploadExpress` in main.ts parses multipart bodies.
 */
export const getGraphQLOptions = (
	env: Record<string, any>,
	logger: { warn: (message: string) => void; error: (message: string) => void },
): ApolloDriverConfig => {
	const isProduction = env.NODE_ENV === 'production';
	return {
		playground: !isProduction,
		introspection: !isProduction,
		uploads: false,
		// the client gets { code, message } from formatError; no stack trace and, in production, no "did you mean field X" hints
		includeStacktraceInErrorResponses: false,
		hideSchemaDetailsFromClientErrors: isProduction,
		autoSchemaFile: true,
		formatError: (error: T, originalError?: unknown) => formatGraphQLError(error, originalError, logger),
	} as ApolloDriverConfig;
};
