import { NestFactory } from '@nestjs/core';
import { BatchModule } from './batch.module';
import { getListenPort, getLogLevels } from 'apps/ticketzy-api/src/libs/env.validation';

async function bootstrap() {
	const app = await NestFactory.create(BatchModule, { logger: getLogLevels() });
	// the host's own PORT first, so a platform health check finds the port; the job server has no other route than GET /
	app.enableShutdownHooks();
	await app.listen(getListenPort(process.env, 'PORT_BATCH'), '0.0.0.0');
}
bootstrap();
