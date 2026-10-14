import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './libs/interceptor/Logging.interceptor';
import { graphqlUploadExpress } from 'graphql-upload'
import * as express from 'express';
import helmet from 'helmet';
import { WsAdapter } from '@nestjs/platform-ws';
import { AuthService } from './components/auth/auth.service';
import { createUploadAuthMiddleware } from './libs/upload-guard';
import { getListenPort, getLogLevels, getTrustProxyHops, getUploadLimits } from './libs/env.validation';
import { buildCorsOptions, getHelmetOptions } from './libs/http-hardening';
import { createGeneralRateLimitMiddleware } from './libs/rate-limit';

async function bootstrap() {
	// production logs warn and error only (LOG_LEVEL changes that); the settings were validated when ConfigModule loaded
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: getLogLevels() });
	app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
	app.useGlobalInterceptors(new LoggingInterceptor());

	// behind Render's proxy `req.ip` is the proxy unless the hops are trusted; rate limits and logs need the real client
	app.disable('x-powered-by');
	app.set('trust proxy', getTrustProxyHops());
	app.use(helmet(getHelmetOptions()));
	// CORS before the rate limit and the upload guard, so their 429 and 401 answers carry the CORS headers a browser needs
	app.enableCors(buildCorsOptions());
	app.use('/graphql', createGeneralRateLimitMiddleware());

	// multipart bodies are only parsed for members who are logged in (C3-72)
	app.use(createUploadAuthMiddleware(app.get(AuthService, { strict: false })));
	app.use(graphqlUploadExpress(getUploadLimits()));
	app.use('/uploads', express.static('./uploads'))
	// the committed demo photos (credits in demo-images/CREDITS.md); read only, like uploads they are found from the working directory
	app.use('/demo-images', express.static('./demo-images'))

	app.useWebSocketAdapter(new WsAdapter(app));
	// SIGTERM (a deploy, Render stopping the service) lets running requests finish and closes MongoDB and the WebSocket server
	app.enableShutdownHooks();
	// 0.0.0.0 so the host's proxy can reach the container; PORT is what Render sets
	const server = await app.listen(getListenPort(), '0.0.0.0');
	// longer than the proxy's idle timeout, or the proxy reuses a connection the server just closed (sporadic 502s)
	server.keepAliveTimeout = 65_000;
	server.headersTimeout = 66_000;
}
bootstrap();
