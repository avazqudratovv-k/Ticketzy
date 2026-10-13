import { UnauthorizedException } from '@nestjs/common';
import * as express from 'express';
import * as request from 'supertest';
import { graphqlUploadExpress } from 'graphql-upload';
import { createUploadAuthMiddleware, isMultipartRequest } from './upload-guard';
import { Message } from './enums/common.enum';

const multipart = (authorization?: string) => ({
	headers: { 'content-type': 'multipart/form-data; boundary=----x', ...(authorization ? { authorization } : {}) },
});
const json = (authorization?: string) => ({ headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) } });

const fakeResponse = () => {
	const res: any = { headers: {} };
	res.setHeader = jest.fn((k, v) => (res.headers[k] = v));
	res.status = jest.fn(() => res);
	res.json = jest.fn(() => res);
	return res;
};

const realLikeAuth = (member: any) => ({
	getBearerToken: (req: any) => {
		const header = req.headers.authorization;
		if (!header) throw new UnauthorizedException(Message.TOKEN_NOT_EXIST);
		return header.split(' ')[1];
	},
	authenticate: jest.fn(async (token: string) => {
		if (token !== 'good' || !member) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		return member;
	}),
});

describe('upload guard (multipart before parsing)', () => {
	it('recognises multipart content types only', () => {
		expect(isMultipartRequest(multipart())).toBe(true);
		expect(isMultipartRequest({ headers: { 'content-type': 'Multipart/Form-Data; boundary=a' } })).toBe(true);
		expect(isMultipartRequest(json())).toBe(false);
		expect(isMultipartRequest({ headers: {} })).toBe(false);
	});

	it('rejects a multipart request without a token and never calls next (so the body is not parsed)', async () => {
		const next = jest.fn();
		const res = fakeResponse();
		await createUploadAuthMiddleware(realLikeAuth({ _id: 'm1' }))(multipart(), res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json.mock.calls[0][0].errors[0]).toEqual({ message: Message.TOKEN_NOT_EXIST, extensions: { code: 'UNAUTHENTICATED' } });
		expect(res.headers['Connection']).toBe('close');
	});

	it('rejects a multipart request with a bad token and with a blocked member', async () => {
		for (const authorization of ['Bearer bad', 'Basic abc']) {
			const next = jest.fn();
			const res = fakeResponse();
			await createUploadAuthMiddleware(realLikeAuth({ _id: 'm1' }))(multipart(authorization), res, next);
			expect(next).not.toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(401);
		}
		const blocked: any = {
			getBearerToken: () => 'good',
			authenticate: jest.fn().mockRejectedValue(new UnauthorizedException(Message.ACCOUNT_NOT_VERIFIED)),
		};
		const res = fakeResponse();
		const next = jest.fn();
		await createUploadAuthMiddleware(blocked)(multipart('Bearer good'), res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.json.mock.calls[0][0].errors[0].message).toBe(Message.ACCOUNT_NOT_VERIFIED);
	});

	it('does not leak unexpected error text (a database failure answers the generic message)', async () => {
		const broken: any = { getBearerToken: () => 'good', authenticate: jest.fn().mockRejectedValue(new Error('mongodb://user:pw@host failed')) };
		const res = fakeResponse();
		await createUploadAuthMiddleware(broken)(multipart('Bearer good'), res, jest.fn());
		expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb');
		expect(res.json.mock.calls[0][0].errors[0].message).toBe(Message.NOT_AUTHENTICATED);
	});

	it('lets an authenticated multipart upload through to the parser', async () => {
		const next = jest.fn();
		const res = fakeResponse();
		await createUploadAuthMiddleware(realLikeAuth({ _id: 'm1' }))(multipart('Bearer good'), res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
	});

	it('does not touch JSON requests, with or without a token', async () => {
		const auth = realLikeAuth({ _id: 'm1' });
		for (const req of [json(), json('Bearer bad')]) {
			const next = jest.fn();
			await createUploadAuthMiddleware(auth)(req, fakeResponse(), next);
			expect(next).toHaveBeenCalledTimes(1);
		}
		expect(auth.authenticate).not.toHaveBeenCalled();
	});
});

describe('upload guard in front of the real multipart parser', () => {
	const operations = JSON.stringify({ query: 'mutation($file: Upload!){ imageUploader(file: $file, target: "member") }', variables: { file: null } });

	const buildApp = (auth: any) => {
		const reachedParser = jest.fn();
		const app = express();
		app.use(createUploadAuthMiddleware(auth));
		app.use((req, _res, next) => (reachedParser(), next()));
		app.use(graphqlUploadExpress({ maxFileSize: 15000000, maxFiles: 10 }));
		app.post('/graphql', (req, res) => res.json({ query: req.body?.query, hasUpload: Boolean(req.body?.variables?.file) }));
		return { app, reachedParser };
	};

	it('refuses a guest multipart upload before the parser sees it, even when the body is garbage', async () => {
		const { app, reachedParser } = buildApp(realLikeAuth({ _id: 'm1' }));
		const res = await request(app)
			.post('/graphql')
			.set('content-type', 'multipart/form-data; boundary=----broken')
			.send('------broken\r\nContent-Disposition: form-data; name=\r\n\r\n');
		expect(res.status).toBe(401);
		expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
		expect(reachedParser).not.toHaveBeenCalled();
	});

	it('still parses an authenticated multipart upload and a plain JSON query', async () => {
		const { app, reachedParser } = buildApp(realLikeAuth({ _id: 'm1' }));
		const upload = await request(app)
			.post('/graphql')
			.set('authorization', 'Bearer good')
			.field('operations', operations)
			.field('map', JSON.stringify({ '0': ['variables.file'] }))
			.attach('0', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'a.png', contentType: 'image/png' });
		expect(upload.status).toBe(200);
		expect(upload.body).toEqual({ query: expect.stringContaining('imageUploader'), hasUpload: true });

		const plain = await request(app).post('/graphql').send({ query: '{ getSeatConfig { seatHoldSeconds } }' });
		expect(plain.status).toBe(200);
		expect(reachedParser).toHaveBeenCalledTimes(2);
	});
});
