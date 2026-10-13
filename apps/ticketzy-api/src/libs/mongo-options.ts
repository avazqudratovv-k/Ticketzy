import { MongooseModuleOptions } from '@nestjs/mongoose';

/**
 * Connection settings for MongoDB Atlas behind a small host (DECISIONS #103). Nothing here is a secret.
 * - serverSelectionTimeoutMS: how long a query waits for a reachable server before it fails with MongoServerSelectionError
 *   (default 30 s); `formatGraphQLError` turns that into SERVICE_UNAVAILABLE. connectTimeoutMS / socketTimeoutMS bound a stuck socket.
 * - MONGO_BUFFER_TIMEOUT_MS (bufferTimeoutMS): how long a command waits for the connection to come back (default 10 s) before "buffering timed out".
 * - maxPoolSize: a free Atlas cluster (M0) allows 500 connections in total, and one API instance does not need more than 10.
 * - retryAttempts / retryDelay: the boot-time retries of the Nest module (default 9 x 3 s). When Atlas is still unreachable the
 *   process exits with a clear log line and the host restarts it; after boot the driver reconnects without restarting anything.
 * - autoIndex: build the schema indexes at startup (needed once on a new database for the unique indexes);
 *   MONGO_AUTO_INDEX=false switches it off once they exist.
 */
/** a global Mongoose setting, not a connection option: applied with `mongoose.set` when the connection is created */
export const MONGO_BUFFER_TIMEOUT_MS = 8000;

export const buildMongoOptions = (options: { autoIndex: boolean }): Partial<MongooseModuleOptions> => ({
	serverSelectionTimeoutMS: 8000,
	connectTimeoutMS: 10000,
	socketTimeoutMS: 45000,
	maxPoolSize: 10,
	retryAttempts: 5,
	retryDelay: 3000,
	autoIndex: options.autoIndex,
});
