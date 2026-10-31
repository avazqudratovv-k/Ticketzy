import { getMailConfig, validateEnv } from './env.validation';

const STRONG_A = 'Xk9vQ2mZp7LdR4tWy8NcB5hFj3GsUe6A';
const STRONG_B = 'pL0oM9iN8bV7cX6zA5sD4fG3hJ2kQ1wE';
const production = {
	NODE_ENV: 'production',
	MONGO_PROD: 'mongodb+srv://u:p@cluster.example.mongodb.net/db',
	SECRET_TOKEN: STRONG_A,
	QR_SECRET: STRONG_B,
	PAYMENT_MODE: 'simulated',
	CORS_ORIGINS: 'https://shop.vercel.app',
	RESEND_API_KEY: 're_SecretKeyValue123',
	MAIL_FROM: 'Ticketzy <noreply@shop.example>',
	SITE_URL: 'https://shop.vercel.app',
};
const validateApi = validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true, web: true });
const messageOf = (run: () => unknown): string => {
	try {
		run();
	} catch (err) {
		return (err as Error).message;
	}
	return '';
};

describe('mail configuration (DECISIONS #135)', () => {
	it('reads the three names and strips a trailing slash from SITE_URL', () => {
		expect(getMailConfig({ ...production, SITE_URL: 'https://shop.vercel.app/' })).toEqual({
			apiKey: 're_SecretKeyValue123',
			from: 'Ticketzy <noreply@shop.example>',
			siteUrl: 'https://shop.vercel.app',
		});
	});

	it('production needs RESEND_API_KEY, MAIL_FROM and SITE_URL, and lists all three missing names at once, names only', () => {
		const message = messageOf(() => validateApi({ ...production, RESEND_API_KEY: '', MAIL_FROM: '', SITE_URL: '' }));
		for (const name of ['RESEND_API_KEY', 'MAIL_FROM', 'SITE_URL']) expect(message).toContain(name);
		expect(() => validateApi({ ...production })).not.toThrow();
	});

	it('outside production the key may be empty (dev mode) and SITE_URL defaults to a CORS origin or localhost', () => {
		expect(getMailConfig({ NODE_ENV: 'development' })).toEqual({ apiKey: '', from: '', siteUrl: 'http://localhost:3000' });
		expect(getMailConfig({ NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:4000, https://b.example' }).siteUrl).toBe('http://localhost:4000');
	});

	it('a key without a sender is an error in every environment', () => {
		expect(messageOf(() => getMailConfig({ NODE_ENV: 'development', RESEND_API_KEY: 're_x' }))).toContain('MAIL_FROM');
	});

	it.each([
		['not an address', { MAIL_FROM: 'sender-without-at-sign' }, 'MAIL_FROM'],
		['an address with line breaks', { MAIL_FROM: 'a@b.co\nBcc: x@y.co' }, 'MAIL_FROM'],
		['http in production', { SITE_URL: 'http://shop.vercel.app' }, 'SITE_URL'],
		['a path', { SITE_URL: 'https://shop.vercel.app/app' }, 'SITE_URL'],
		['a query', { SITE_URL: 'https://shop.vercel.app/?a=1' }, 'SITE_URL'],
		['credentials', { SITE_URL: 'https://user:pw@shop.vercel.app' }, 'SITE_URL'],
		['not a URL', { SITE_URL: 'shop' }, 'SITE_URL'],
		['a key with spaces', { RESEND_API_KEY: 're_ x' }, 'RESEND_API_KEY'],
	])('refuses %s, naming the variable and never the value', (_label, change, name) => {
		const message = messageOf(() => validateApi({ ...production, ...change }));
		expect(message).toContain(name);
		for (const value of Object.values(change)) expect(message).not.toContain(String(value));
		expect(message).not.toContain('re_SecretKeyValue123');
	});
});
