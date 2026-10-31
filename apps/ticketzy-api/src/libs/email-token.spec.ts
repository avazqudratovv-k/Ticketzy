import { EMAIL_TOKEN_TTL_MS, buildEmailLink, generateEmailToken, hashEmailToken, isMailableAddress, looksLikeEmailToken } from './email-token';
import { EmailTokenPurpose } from './enums/email-token.enum';

describe('one-time email tokens (DECISIONS #135)', () => {
	it('makes 32 random bytes (43 base64url characters) and stores only the SHA-256 hash', () => {
		const { token, tokenHash } = generateEmailToken();
		expect(token).toHaveLength(43);
		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(tokenHash).toBe(hashEmailToken(token));
		expect(tokenHash).not.toContain(token);
	});

	it('never repeats', () => {
		const tokens = new Set(Array.from({ length: 200 }, () => generateEmailToken().token));
		expect(tokens.size).toBe(200);
	});

	it('refuses anything that is not shaped like a token before the database is asked', () => {
		expect(looksLikeEmailToken(generateEmailToken().token)).toBe(true);
		for (const bad of ['', 'abc', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}=`, `${'x'.repeat(42)}$`, undefined, null, 42, { $ne: null }]) {
			expect(looksLikeEmailToken(bad)).toBe(false);
		}
	});

	it('is valid 24 hours for verification and email change, 30 minutes for a reset', () => {
		expect(EMAIL_TOKEN_TTL_MS[EmailTokenPurpose.VERIFY_EMAIL]).toBe(24 * 60 * 60 * 1000);
		expect(EMAIL_TOKEN_TTL_MS[EmailTokenPurpose.CHANGE_EMAIL]).toBe(24 * 60 * 60 * 1000);
		expect(EMAIL_TOKEN_TTL_MS[EmailTokenPurpose.RESET_PASSWORD]).toBe(30 * 60 * 1000);
	});

	it('builds the links the front end opens, with the token as the only query parameter', () => {
		expect(buildEmailLink('https://shop.example', EmailTokenPurpose.VERIFY_EMAIL, 'T')).toBe('https://shop.example/verify-email?token=T');
		expect(buildEmailLink('https://shop.example/', EmailTokenPurpose.CHANGE_EMAIL, 'T')).toBe('https://shop.example/verify-email?token=T');
		expect(buildEmailLink('https://shop.example', EmailTokenPurpose.RESET_PASSWORD, 'T')).toBe('https://shop.example/reset-password?token=T');
	});

	it('does not mail demo addresses', () => {
		expect(isMailableAddress('buyer@ticketzy.demo')).toBe(false);
		expect(isMailableAddress(' Organizer@TICKETZY.DEMO ')).toBe(false);
		expect(isMailableAddress('real@example.com')).toBe(true);
		expect(isMailableAddress('x@ticketzy.demo.example.com')).toBe(true);
	});
});
