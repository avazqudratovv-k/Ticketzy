import { createHash, randomBytes } from 'crypto';
import { EmailTokenPurpose } from './enums/email-token.enum';
import { DEMO_EMAIL_PATTERN } from './demo-guards';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** how long a link works, by purpose (DECISIONS #135) */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
	[EmailTokenPurpose.VERIFY_EMAIL]: 24 * HOUR,
	[EmailTokenPurpose.CHANGE_EMAIL]: 24 * HOUR,
	[EmailTokenPurpose.RESET_PASSWORD]: 30 * MINUTE,
};

/** the front end routes the links open; the token is the only query parameter (DECISIONS #135) */
export const EMAIL_LINK_PATH: Record<EmailTokenPurpose, string> = {
	[EmailTokenPurpose.VERIFY_EMAIL]: '/verify-email',
	[EmailTokenPurpose.CHANGE_EMAIL]: '/verify-email',
	[EmailTokenPurpose.RESET_PASSWORD]: '/reset-password',
};

/** 32 random bytes, base64url (43 characters); only the SHA-256 of it is stored */
export const generateEmailToken = (): { token: string; tokenHash: string } => {
	const token = randomBytes(32).toString('base64url');
	return { token, tokenHash: hashEmailToken(token) };
};

export const hashEmailToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** a token the server could have made: 43 base64url characters. Anything else is refused before the database is asked. */
export const looksLikeEmailToken = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

export const buildEmailLink = (siteUrl: string, purpose: EmailTokenPurpose, token: string): string =>
	`${siteUrl.replace(/\/+$/, '')}${EMAIL_LINK_PATH[purpose]}?token=${encodeURIComponent(token)}`;

/** demo accounts have no real inbox; deleted accounts must not get mail (their address may belong to someone else now) */
export const isMailableAddress = (email: string): boolean => !DEMO_EMAIL_PATTERN.test(String(email ?? '').trim());
