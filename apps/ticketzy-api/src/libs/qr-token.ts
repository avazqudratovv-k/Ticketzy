import { createHmac, timingSafeEqual } from 'crypto';

const getQrSecret = (): string => {
	const secret = process.env.QR_SECRET;
	if (!secret || !secret.trim()) throw new Error('QR_SECRET is not set');
	return secret;
};

/** HMAC-SHA256 of the ticket id, hex encoded; the secret never leaves the server */
export const signQrToken = (ticketId: unknown): string =>
	createHmac('sha256', getQrSecret()).update(String(ticketId)).digest('hex');

export const verifyQrToken = (ticketId: unknown, token: string): boolean => {
	const expected = Buffer.from(signQrToken(ticketId));
	const given = Buffer.from(String(token ?? ''));
	return expected.length === given.length && timingSafeEqual(expected, given);
};
