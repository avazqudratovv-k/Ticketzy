import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './libs/interceptor/Logging.interceptor';
import { graphqlUploadExpress } from 'graphql-upload'
import * as express from 'express';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
	app.useGlobalInterceptors(new LoggingInterceptor());
	// CLIENT_URL may hold several comma-separated origins; development falls back to the local Next.js app
	const clientUrl = process.env.CLIENT_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
	const origin = clientUrl.split(',').map((url) => url.trim()).filter(Boolean);
	app.enableCors({ origin, credentials: true });

	app.use(graphqlUploadExpress({maxFileSize: 15000000, maxFiles: 10}));
	app.use('/uploads', express.static('./uploads'))

	app.useWebSocketAdapter(new WsAdapter(app));
	await app.listen(process.env.PORT_API ?? 3000);
}
bootstrap();
