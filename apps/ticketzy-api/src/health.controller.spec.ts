import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import * as request from 'supertest';
import { HealthController } from './health.controller';

const makeApp = async (readyState: number): Promise<{ app: INestApplication; connection: { readyState: number; db?: any } }> => {
	// anything that touches the database would fail here: the connection has no methods
	const connection = { readyState };
	const moduleRef = await Test.createTestingModule({
		controllers: [HealthController],
		providers: [{ provide: getConnectionToken(), useValue: connection }],
	}).compile();
	const app = moduleRef.createNestApplication();
	await app.init();
	return { app, connection };
};

describe('GET /health and GET /ready', () => {
	it('/health is 200 with a tiny body even when MongoDB is down', async () => {
		const { app } = await makeApp(0);
		const res = await request(app.getHttpServer()).get('/health').expect(200);
		expect(res.body).toEqual({ status: 'ok' });
		await app.close();
	});

	it('/ready is 200 only while the connection is open', async () => {
		const { app, connection } = await makeApp(1);
		await request(app.getHttpServer()).get('/ready').expect(200).expect({ status: 'ready' });
		for (const state of [0, 2, 3]) {
			connection.readyState = state;
			await request(app.getHttpServer()).get('/ready').expect(503).expect({ status: 'unavailable' });
		}
		await app.close();
	});

	it('answers without a token and reveals no version, environment or secrets', async () => {
		const { app } = await makeApp(1);
		for (const path of ['/health', '/ready']) {
			const res = await request(app.getHttpServer()).get(path);
			expect(Object.keys(res.body)).toEqual(['status']);
			expect(res.text.length).toBeLessThan(40);
		}
		await app.close();
	});
});
