import { Controller, Get, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Response } from 'express';
import { Connection } from 'mongoose';

/** mongoose `readyState` 1 means connected */
export const MONGO_CONNECTED = 1;

/**
 * Probes for the host (Render's health check) and for a keep-alive ping. Both are public, never read the database and
 * answer a tiny JSON body with no version, no environment and no secrets. They sit outside `/graphql`, so the GraphQL
 * rate limit does not count them.
 */
@Controller()
export class HealthController {
	constructor(@InjectConnection() private readonly connection: Connection) {}

	/** liveness: the process is up and the event loop answers; touches nothing else, so it is always fast */
	@Get('health')
	public health(): { status: string } {
		return { status: 'ok' };
	}

	/** readiness: 200 only while the MongoDB connection is open, otherwise 503 so a load balancer can stop sending traffic */
	@Get('ready')
	public ready(@Res({ passthrough: true }) res: Response): { status: string } {
		if (this.connection.readyState === MONGO_CONNECTED) return { status: 'ready' };
		res.status(503);
		return { status: 'unavailable' };
	}
}
