/** which variable holds the Mongo URI for the current NODE_ENV */
export const getMongoUriKey = (nodeEnv: string | undefined = process.env.NODE_ENV): string =>
	nodeEnv === 'production' ? 'MONGO_PROD' : 'MONGO_DEV';

/** ConfigModule `validate` hook: the app refuses to start when a required variable is missing or blank */
export const validateEnv =
	(required: string[] = []) =>
	(config: Record<string, any>): Record<string, any> => {
		const missing = [getMongoUriKey(config.NODE_ENV), ...required].filter((key) => !String(config[key] ?? '').trim());
		if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
		return config;
	};
