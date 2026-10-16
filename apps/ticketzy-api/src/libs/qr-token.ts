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

/** what the QR code carries: `<ticketId>.<signature>`, so a scan can be verified before any database lookup */
export const buildQrToken = (ticketId: unknown): string => `${String(ticketId)}.${signQrToken(ticketId)}`;

/** the ticket id of a well-formed token whose signature is genuine, otherwise null; touches no database */
export const parseQrToken = (token: unknown): string | null => {
	if (typeof token !== 'string') return null;
	const match = /^([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(token.trim());
	if (!match) return null;
	return verifyQrToken(match[1], match[2]) ? match[1] : null;
};

/** a ticket code as typed at the gate: spaces and dashes removed, upper case; null unless it is 20 hex characters */
export const normalizeTicketCode = (input: unknown): string | null => {
	if (typeof input !== 'string' || input.length > 100) return null;
	const code = input.replace(/[\s-]/g, '').toUpperCase();
	return /^[A-F0-9]{20}$/.test(code) ? code : null;
};
