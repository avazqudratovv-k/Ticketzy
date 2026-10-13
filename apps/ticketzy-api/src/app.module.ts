import { Logger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { SocketModule } from './socket/socket.module';
import { validateEnv } from './libs/env.validation';

import { getGraphQLOptions } from './libs/graphql-options';

const logger = new Logger('GraphQL');

@Module({
	imports: [
		ConfigModule.forRoot({ validate: validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true, web: true }) }),
		GraphQLModule.forRootAsync<ApolloDriverConfig>({
			driver: ApolloDriver,
			// read after ConfigModule has loaded .env; playground and introspection stay off in production
			useFactory: () => getGraphQLOptions(process.env, logger),
		}),
		ComponentsModule,
		DatabaseModule,
		SocketModule,
	],
	controllers: [AppController, HealthController],
	providers: [AppService, AppResolver],
})
export class AppModule {}
