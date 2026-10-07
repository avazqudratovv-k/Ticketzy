/** which variable holds the Mongo URI for the current NODE_ENV */
export const getMongoUriKey = (nodeEnv: string | undefined = process.env.NODE_ENV): string =>
	nodeEnv === 'production' ? 'MONGO_PROD' : 'MONGO_DEV';

export const DEFAULT_SEAT_HOLD_SECONDS = 30;
export const MAX_SEAT_HOLD_SECONDS = 3600;

/** SEAT_HOLD_SECONDS is optional (default 30); when it is set it must be a whole number from 1 to 3600 */
export const parseSeatHoldSeconds = (raw: unknown): number => {
	if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_SEAT_HOLD_SECONDS;
	const text = String(raw).trim();
	const seconds = Number(text);
	if (!/^\d+$/.test(text) || seconds < 1 || seconds > MAX_SEAT_HOLD_SECONDS) {
		throw new Error(`SEAT_HOLD_SECONDS must be a whole number from 1 to ${MAX_SEAT_HOLD_SECONDS}`);
	}
	return seconds;
};

/** how long a seat hold or an unpaid GENERAL order lasts; read at call time, after ConfigModule has loaded .env */
export const getSeatHoldSeconds = (env: Record<string, any> = process.env): number => parseSeatHoldSeconds(env.SEAT_HOLD_SECONDS);

/** ConfigModule `validate` hook: the app refuses to start when a required variable is missing or blank */
export const validateEnv =
	(required: string[] = []) =>
	(config: Record<string, any>): Record<string, any> => {
		const missing = [getMongoUriKey(config.NODE_ENV), ...required].filter((key) => !String(config[key] ?? '').trim());
		if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
		parseSeatHoldSeconds(config.SEAT_HOLD_SECONDS);
		return config;
	};
