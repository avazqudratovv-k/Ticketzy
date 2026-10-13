import { Module, Logger } from '@nestjs/common';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getMongoAutoIndex, getMongoUriKey } from '../libs/env.validation';
import { MONGO_BUFFER_TIMEOUT_MS, buildMongoOptions } from '../libs/mongo-options';

const connectionLogger = new Logger('MongoDB');

@Module({
	imports: [
		MongooseModule.forRootAsync({
			useFactory: () => ({
				uri: process.env[getMongoUriKey()],
				...buildMongoOptions({ autoIndex: getMongoAutoIndex() }),
				// the driver reconnects by itself after boot; these lines are the only trace of an outage in a quiet (warn) log
				connectionFactory: (connection: Connection) => {
					connection.base.set('bufferTimeoutMS', MONGO_BUFFER_TIMEOUT_MS);
					connection.on('disconnected', () => connectionLogger.warn('MongoDB disconnected'));
					connection.on('reconnected', () => connectionLogger.warn('MongoDB reconnected'));
					return connection;
				},
			}),
		}),
	],
	exports: [MongooseModule],
})
export class DatabaseModule {
	private readonly logger = new Logger(DatabaseModule.name);

	constructor(@InjectConnection() private readonly connection: Connection) {
		if (connection.readyState === 1) {
			this.logger.log(
				`MongoDB is connected into ${process.env.NODE_ENV === 'production' ? 'production' : 'development'} db`,
			);
		} else {
			this.logger.error('DB is not connected!');
		}
	}
}
