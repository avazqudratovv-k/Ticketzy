import { Module, Logger } from '@nestjs/common';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getMongoUriKey } from 'apps/ticketzy-api/src/libs/env.validation';
import { buildMongoOptions } from 'apps/ticketzy-api/src/libs/mongo-options';

@Module({
	imports: [
		MongooseModule.forRootAsync({
			useFactory: () => ({
				uri: process.env[getMongoUriKey()],
				// the API owns the indexes; the batch app never builds them
				...buildMongoOptions({ autoIndex: false }),
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
