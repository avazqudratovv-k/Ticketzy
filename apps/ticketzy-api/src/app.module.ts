import { Logger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { T } from './libs/types/common';
import { SocketModule } from './socket/socket.module';
import { validateEnv } from './libs/env.validation';

import { formatGraphQLError } from './libs/error-mapping';

const logger = new Logger('GraphQL');

@Module({
	imports: [
		ConfigModule.forRoot({ validate: validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true }) }),
		GraphQLModule.forRootAsync<ApolloDriverConfig>({
			driver: ApolloDriver,
			// read after ConfigModule has loaded .env; playground and introspection stay off in production
			useFactory: () => {
				const isProduction = process.env.NODE_ENV === 'production';
				return {
					playground: !isProduction,
					introspection: !isProduction,
					uploads: false,
					autoSchemaFile: true,
					formatError: (error: T, originalError?: unknown) => formatGraphQLError(error, originalError, logger),
				};
			},
		}),
		ComponentsModule,
		DatabaseModule,
		SocketModule,
	],
	controllers: [AppController],
	providers: [AppService, AppResolver],
})
export class AppModule {}
