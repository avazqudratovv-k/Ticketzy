import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Message } from '../../libs/enums/common.enum';
import { EmailAuthResolver } from './email-auth.resolver';
import { AuthGuard } from '../auth/guards/auth.guard';

/** one request object per "client": the shared in-memory limits count by IP */
let ipCounter = 0;
const context = () => ({ req: { ip: `10.20.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` } });

const build = () => {
	const service = {
		verifyEmail: jest.fn().mockResolvedValue(Message.EMAIL_VERIFIED),
		resendVerificationEmail: jest.fn().mockResolvedValue(Message.VERIFICATION_EMAIL_SENT),
		requestEmailChange: jest.fn().mockResolvedValue(Message.EMAIL_CHANGE_REQUESTED),
		requestPasswordReset: jest.fn().mockResolvedValue(Message.PASSWORD_RESET_REQUESTED),
		resetPassword: jest.fn().mockResolvedValue(Message.PASSWORD_RESET_DONE),
	};
	return { service, resolver: new EmailAuthResolver(service as any) };
};

describe('EmailAuthResolver (DECISIONS #135)', () => {
	it('the logged-in operations use the auth guard, the link operations are public', () => {
		for (const name of ['resendVerificationEmail', 'requestEmailChange']) {
			expect(Reflect.getMetadata(GUARDS_METADATA, (EmailAuthResolver.prototype as any)[name])).toContain(AuthGuard);
		}
		for (const name of ['verifyEmail', 'requestPasswordReset', 'resetPassword']) {
			expect(Reflect.getMetadata(GUARDS_METADATA, (EmailAuthResolver.prototype as any)[name])).toBeUndefined();
		}
	});

	describe('requestPasswordReset limits', () => {
		it('3 per address per hour: the 4th is RATE_LIMITED with a retry hint and does no work, for any address', async () => {
			const { resolver, service } = build();
			const ctx = context();
			for (let i = 0; i < 3; i++) await resolver.requestPasswordReset('limited@example.com', ctx);
			const err: any = await resolver.requestPasswordReset('Limited@Example.com', context()).catch((e) => e);
			expect(err.code).toBe('RATE_LIMITED');
			expect(err.retryAfterSeconds).toBeGreaterThan(0);
			expect(service.requestPasswordReset).toHaveBeenCalledTimes(3);
		});

		it('an address that has no account is limited exactly the same (nothing to learn from the refusal)', async () => {
			const { resolver, service } = build();
			for (let i = 0; i < 3; i++) await resolver.requestPasswordReset('ghost@example.com', context());
			await expect(resolver.requestPasswordReset('ghost@example.com', context())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
			expect(service.requestPasswordReset).toHaveBeenCalledTimes(3);
		});

		it('10 per IP per hour across addresses', async () => {
			const { resolver } = build();
			const ctx = context();
			for (let i = 0; i < 10; i++) await resolver.requestPasswordReset(`ip-limit-${i}@example.com`, ctx);
			await expect(resolver.requestPasswordReset('ip-limit-11@example.com', ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
			await expect(resolver.requestPasswordReset('ip-limit-11@example.com', context())).resolves.toBe(Message.PASSWORD_RESET_REQUESTED);
		});
	});

	it('resendVerificationEmail is limited per address: 3 per hour', async () => {
		const { resolver, service } = build();
		const member: any = { _id: 'm1', memberEmail: 'resend-limit@example.com' };
		for (let i = 0; i < 3; i++) await resolver.resendVerificationEmail(member, context());
		await expect(resolver.resendVerificationEmail(member, context())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
		expect(service.resendVerificationEmail).toHaveBeenCalledTimes(3);
	});

	it('requestEmailChange is limited per new address and counts password attempts', async () => {
		const { resolver, service } = build();
		const input = { newEmail: 'change-limit@example.com', currentPassword: 'whatever-1' };
		for (let i = 0; i < 3; i++) await resolver.requestEmailChange(input, 'm1' as any, context());
		await expect(resolver.requestEmailChange(input, 'm1' as any, context())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
		expect(service.requestEmailChange).toHaveBeenCalledTimes(3);
	});

	it('verifyEmail and resetPassword are limited per IP: 20 tries per 15 minutes', async () => {
		const { resolver, service } = build();
		const ctx = context();
		for (let i = 0; i < 20; i++) await resolver.verifyEmail('x'.repeat(43), ctx);
		await expect(resolver.verifyEmail('x'.repeat(43), ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
		// the same budget covers resetPassword from that IP
		await expect(resolver.resetPassword('x'.repeat(43), 'long-enough-1', ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
		expect(service.verifyEmail).toHaveBeenCalledTimes(20);
		expect(service.resetPassword).not.toHaveBeenCalled();
	});

	describe('resetPassword password rule', () => {
		it.each([['too short', 'short'], ['empty', ''], ['seven characters', '1234567'], ['absurdly long', 'x'.repeat(201)]])('refuses a password that is %s with VALIDATION_FAILED and does not spend the link', async (_label, password) => {
			const { resolver, service } = build();
			const err: any = await resolver.resetPassword('x'.repeat(43), password, context()).catch((e) => e);
			expect(err.code).toBe('VALIDATION_FAILED');
			expect(err.fields).toEqual([{ field: 'newPassword', rules: ['length'] }]);
			expect(service.resetPassword).not.toHaveBeenCalled();
		});

		it('passes an 8 character password to the service', async () => {
			const { resolver, service } = build();
			await expect(resolver.resetPassword('x'.repeat(43), '12345678', context())).resolves.toBe(Message.PASSWORD_RESET_DONE);
			expect(service.resetPassword).toHaveBeenCalledWith('x'.repeat(43), '12345678');
		});
	});
});
