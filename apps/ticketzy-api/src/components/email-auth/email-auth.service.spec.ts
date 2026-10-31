import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { hashEmailToken } from '../../libs/email-token';
import { AuditAction } from '../../libs/enums/audit-log.enum';
import { Message } from '../../libs/enums/common.enum';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { AuthService } from '../auth/auth.service';
import { EmailTokenService } from '../mail/email-token.service';
import { EmailAuthService } from './email-auth.service';
import { EventLocale } from '../../libs/enums/event.enum';

const PASSWORD = 'old-password-1';
const minutes = (count: number) => count * 60_000;

/** the token inside the link of the n-th mail sent */
const tokenOf = (mail: { send: jest.Mock }, n = 0): string => new URL(mail.send.mock.calls[n][0].link).searchParams.get('token')!;

const member = (over: any = {}) => ({
	_id: 'm1',
	memberEmail: 'user@example.com',
	memberStatus: MemberStatus.ACTIVE,
	memberType: MemberType.USER,
	memberLang: EventLocale.EN,
	memberPassword: bcrypt.hashSync(PASSWORD, 4),
	tokenVersion: 0,
	...over,
});

const build = (members: any[] = [member()]) => {
	const memberModel = new FakeModel(members);
	const tokenModel = new FakeModel();
	const mail = { send: jest.fn().mockResolvedValue('sent') };
	const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
	const authService = new AuthService(new JwtService({ secret: 'test-secret' }), memberModel as any);
	const emailTokens = new EmailTokenService(tokenModel as any);
	const service = new EmailAuthService(memberModel as any, emailTokens, mail as any, authService, auditLogService as any);
	service.resetMinMs = 0;
	return { memberModel, tokenModel, mail, auditLogService, emailTokens, service };
};

describe('EmailAuthService (DECISIONS #135)', () => {
	beforeAll(() => {
		process.env.SITE_URL = 'https://shop.example';
	});
	afterAll(() => {
		delete process.env.SITE_URL;
	});

	describe('sign-up verification link', () => {
		it('mails a link to the address, in the language of the member, valid 24 hours, and audits it without the token', async () => {
			const { service, mail, tokenModel, auditLogService } = build([member({ memberLang: EventLocale.RU })]);
			service.sendVerificationInBackground(member({ memberLang: EventLocale.RU }) as any);
			await service.whenIdle();

			expect(mail.send).toHaveBeenCalledTimes(1);
			const sent = mail.send.mock.calls[0][0];
			expect(sent).toMatchObject({ to: 'user@example.com', lang: EventLocale.RU, purpose: EmailTokenPurpose.VERIFY_EMAIL });
			expect(sent.link).toMatch(/^https:\/\/shop\.example\/verify-email\?token=[A-Za-z0-9_-]{43}$/);
			const token = tokenOf(mail);
			expect(tokenModel.docs[0].tokenHash).toBe(hashEmailToken(token));
			expect(tokenModel.docs[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(minutes(60 * 24) - 5000);

			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: AuditAction.EMAIL_VERIFICATION_SENT, targetId: 'm1', meta: { purpose: EmailTokenPurpose.VERIFY_EMAIL } }),
			);
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain(token);
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('user@example.com');
		});

		it('never fails the caller when the mail provider is down', async () => {
			const { service, mail } = build();
			mail.send.mockRejectedValue(new Error('down'));
			expect(() => service.sendVerificationInBackground(member() as any)).not.toThrow();
			await expect(service.whenIdle()).resolves.toBeUndefined();
		});

		it('skips @ticketzy.demo accounts and deleted accounts: no token, no mail', async () => {
			const { service, mail, tokenModel } = build();
			service.sendVerificationInBackground(member({ memberEmail: 'buyer@ticketzy.demo' }) as any);
			service.sendVerificationInBackground(member({ memberStatus: MemberStatus.DELETE }) as any);
			await service.whenIdle();
			expect(mail.send).not.toHaveBeenCalled();
			expect(tokenModel.docs).toHaveLength(0);
		});
	});

	describe('verifyEmail', () => {
		it('a valid link verifies the address and audits it', async () => {
			const { service, mail, memberModel, auditLogService } = build();
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();

			await expect(service.verifyEmail(tokenOf(mail))).resolves.toBe(Message.EMAIL_VERIFIED);
			expect(memberModel.docs[0].emailVerifiedAt).toBeInstanceOf(Date);
			expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.EMAIL_VERIFIED, targetId: 'm1' }));
		});

		it('an expired link is refused and verifies nothing', async () => {
			const { service, memberModel, emailTokens } = build();
			const token = await emailTokens.issue('m1' as any, EmailTokenPurpose.VERIFY_EMAIL, { now: new Date(Date.now() - minutes(60 * 24 + 1)) });
			await expect(service.verifyEmail(token)).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			expect(memberModel.docs[0].emailVerifiedAt).toBeUndefined();
		});

		it('a link that was already used is refused', async () => {
			const { service, mail } = build();
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();
			const token = tokenOf(mail);
			await service.verifyEmail(token);
			await expect(service.verifyEmail(token)).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
		});

		it('a wrong or malformed token is refused', async () => {
			const { service, memberModel } = build();
			for (const bad of ['x'.repeat(43), 'nope', '', undefined, { $gt: '' }]) {
				await expect(service.verifyEmail(bad)).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN', message: Message.INVALID_OR_EXPIRED_TOKEN });
			}
			expect(memberModel.docs[0].emailVerifiedAt).toBeUndefined();
		});

		it('a link for an account that was deleted since is refused', async () => {
			const { service, mail, memberModel } = build();
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();
			memberModel.docs[0].memberStatus = MemberStatus.DELETE;
			await expect(service.verifyEmail(tokenOf(mail))).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
		});

		it('a second link after the address is verified is harmless and keeps the first date', async () => {
			const { service, mail, memberModel } = build();
			await service.resendVerificationEmail('m1' as any);
			await service.verifyEmail(tokenOf(mail, 0));
			const first = memberModel.docs[0].emailVerifiedAt;
			// a link mailed before, still open: only the newest works, so issue a fresh one the way a second sign-up mail would
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();
			await expect(service.verifyEmail(tokenOf(mail, 1))).resolves.toBe(Message.EMAIL_VERIFIED);
			expect(memberModel.docs[0].emailVerifiedAt).toBe(first);
		});
	});

	describe('resendVerificationEmail', () => {
		it('sends a new link, and the older link stops working', async () => {
			const { service, mail } = build();
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();
			await expect(service.resendVerificationEmail('m1' as any)).resolves.toBe(Message.VERIFICATION_EMAIL_SENT);

			await expect(service.verifyEmail(tokenOf(mail, 0))).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			await expect(service.verifyEmail(tokenOf(mail, 1))).resolves.toBe(Message.EMAIL_VERIFIED);
		});

		it('refuses an address that is already verified', async () => {
			const { service, mail } = build([member({ emailVerifiedAt: new Date() })]);
			await expect(service.resendVerificationEmail('m1' as any)).rejects.toThrow(Message.EMAIL_ALREADY_VERIFIED);
			expect(mail.send).not.toHaveBeenCalled();
		});

		it('refuses a deleted or unknown account', async () => {
			const { service } = build([member({ memberStatus: MemberStatus.DELETE })]);
			await expect(service.resendVerificationEmail('m1' as any)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
			await expect(service.resendVerificationEmail('nobody' as any)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
		});
	});

	describe('email change', () => {
		const ask = (service: EmailAuthService, over: any = {}) => service.requestEmailChange('m1' as any, { newEmail: 'New@Example.com', currentPassword: PASSWORD, ...over });

		it('mails the NEW address and keeps the old one until the link is opened', async () => {
			const { service, mail, memberModel, auditLogService } = build([member({ emailVerifiedAt: new Date('2026-01-01') })]);
			await expect(ask(service)).resolves.toBe(Message.EMAIL_CHANGE_REQUESTED);

			expect(mail.send.mock.calls[0][0]).toMatchObject({ to: 'new@example.com', purpose: EmailTokenPurpose.CHANGE_EMAIL });
			expect(memberModel.docs[0].memberEmail).toBe('user@example.com');
			expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.EMAIL_CHANGE_REQUESTED }));

			await expect(service.verifyEmail(tokenOf(mail))).resolves.toBe(Message.EMAIL_CHANGED);
			expect(memberModel.docs[0].memberEmail).toBe('new@example.com');
			expect(memberModel.docs[0].emailVerifiedAt).toBeInstanceOf(Date);
			expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.EMAIL_CHANGED }));
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('new@example.com');
		});

		it('a new unverified address becomes verified by the change link (they proved the inbox)', async () => {
			const { service, mail, memberModel } = build();
			await ask(service);
			await service.verifyEmail(tokenOf(mail));
			expect(memberModel.docs[0].emailVerifiedAt).toBeInstanceOf(Date);
		});

		it('needs the current password', async () => {
			const { service, mail } = build();
			await expect(ask(service, { currentPassword: 'wrong-password' })).rejects.toThrow(Message.WRONG_PASSWORD);
			expect(mail.send).not.toHaveBeenCalled();
		});

		it('refuses the same address and an address another member uses', async () => {
			const { service, mail } = build([member(), member({ _id: 'm2', memberEmail: 'taken@example.com' })]);
			await expect(ask(service, { newEmail: 'USER@example.com' })).rejects.toThrow(Message.EMAIL_CHANGE_SAME);
			await expect(ask(service, { newEmail: 'taken@example.com' })).rejects.toThrow(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			expect(mail.send).not.toHaveBeenCalled();
		});

		it('refuses an address that was recently deleted by someone else', async () => {
			const { service } = build([
				member(),
				member({ _id: 'gone', memberEmail: 'recent@example.com', memberStatus: MemberStatus.DELETE, deletedAt: new Date(), emailReusableAt: new Date(Date.now() + minutes(60 * 24 * 30)) }),
			]);
			await expect(ask(service, { newEmail: 'recent@example.com' })).rejects.toMatchObject({ code: 'EMAIL_RECENTLY_DELETED' });
		});

		it('if someone else took the address while the link was out, the change is refused and the old address stays', async () => {
			const { service, mail, memberModel } = build();
			await ask(service);
			memberModel.docs.push(member({ _id: 'm2', memberEmail: 'new@example.com' }));
			await expect(service.verifyEmail(tokenOf(mail))).rejects.toThrow(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			expect(memberModel.docs[0].memberEmail).toBe('user@example.com');
		});

		it('does not end an open verification link, and a verification link cannot change the address', async () => {
			const { service, mail, memberModel } = build();
			service.sendVerificationInBackground(member() as any);
			await service.whenIdle();
			await ask(service);
			await expect(service.verifyEmail(tokenOf(mail, 0))).resolves.toBe(Message.EMAIL_VERIFIED);
			expect(memberModel.docs[0].memberEmail).toBe('user@example.com');
		});

		it('a newer change request replaces the older one', async () => {
			const { service, mail, memberModel } = build();
			await ask(service, { newEmail: 'first@example.com' });
			await ask(service, { newEmail: 'second@example.com' });
			await expect(service.verifyEmail(tokenOf(mail, 0))).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			await service.verifyEmail(tokenOf(mail, 1));
			expect(memberModel.docs[0].memberEmail).toBe('second@example.com');
		});

		it('sends nothing to a demo address', async () => {
			const { service, mail } = build();
			await expect(ask(service, { newEmail: 'x@ticketzy.demo' })).resolves.toBe(Message.EMAIL_CHANGE_REQUESTED);
			expect(mail.send).not.toHaveBeenCalled();
		});
	});

	describe('requestPasswordReset', () => {
		it('answers the same for a known and an unknown address, and mails only the known one', async () => {
			const { service, mail, tokenModel } = build();
			const known = await service.requestPasswordReset('user@example.com');
			const unknown = await service.requestPasswordReset('nobody@example.com');
			await service.whenIdle();

			expect(known).toBe(Message.PASSWORD_RESET_REQUESTED);
			expect(unknown).toBe(known);
			expect(mail.send).toHaveBeenCalledTimes(1);
			expect(mail.send.mock.calls[0][0]).toMatchObject({ to: 'user@example.com', purpose: EmailTokenPurpose.RESET_PASSWORD });
			expect(mail.send.mock.calls[0][0].link).toMatch(/^https:\/\/shop\.example\/reset-password\?token=/);
			expect(tokenModel.docs).toHaveLength(1);
		});

		it('takes at least the same minimum time for a known and an unknown address', async () => {
			const { service } = build();
			service.resetMinMs = 80;
			for (const email of ['user@example.com', 'nobody@example.com', '', 'not an email']) {
				const started = Date.now();
				await service.requestPasswordReset(email);
				expect(Date.now() - started).toBeGreaterThanOrEqual(75);
			}
			await service.whenIdle();
		});

		it('ignores case and spaces of the address', async () => {
			const { service, mail } = build();
			await service.requestPasswordReset('  USER@Example.COM ');
			await service.whenIdle();
			expect(mail.send).toHaveBeenCalledTimes(1);
		});

		it('gives the same answer and sends nothing for a demo account or a deleted account', async () => {
			const { service, mail, tokenModel } = build([
				member({ _id: 'd1', memberEmail: 'buyer@ticketzy.demo' }),
				member({ _id: 'd2', memberEmail: 'gone@example.com', memberStatus: MemberStatus.DELETE }),
			]);
			await expect(service.requestPasswordReset('buyer@ticketzy.demo')).resolves.toBe(Message.PASSWORD_RESET_REQUESTED);
			await expect(service.requestPasswordReset('gone@example.com')).resolves.toBe(Message.PASSWORD_RESET_REQUESTED);
			await service.whenIdle();
			expect(mail.send).not.toHaveBeenCalled();
			expect(tokenModel.docs).toHaveLength(0);
		});

		it('audits the request without the token or the address', async () => {
			const { service, mail, auditLogService } = build();
			await service.requestPasswordReset('user@example.com');
			await service.whenIdle();
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: AuditAction.PASSWORD_RESET_REQUESTED, targetId: 'm1', meta: { purpose: EmailTokenPurpose.RESET_PASSWORD } }),
			);
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain(tokenOf(mail));
		});

		it('a mail failure still gives the normal answer', async () => {
			const { service, mail } = build();
			mail.send.mockRejectedValue(new Error('down'));
			await expect(service.requestPasswordReset('user@example.com')).resolves.toBe(Message.PASSWORD_RESET_REQUESTED);
			await service.whenIdle();
		});
	});

	describe('resetPassword', () => {
		const requestLink = async (ctx: ReturnType<typeof build>) => {
			await ctx.service.requestPasswordReset('user@example.com');
			await ctx.service.whenIdle();
			return tokenOf(ctx.mail, ctx.mail.send.mock.calls.length - 1);
		};

		it('sets the new password (hashed like sign-up), raises tokenVersion, verifies the address and audits without secrets', async () => {
			const ctx = build();
			const token = await requestLink(ctx);
			await expect(ctx.service.resetPassword(token, 'brand-new-pass-1')).resolves.toBe(Message.PASSWORD_RESET_DONE);

			const stored = ctx.memberModel.docs[0];
			expect(stored.memberPassword).not.toContain('brand-new-pass-1');
			expect(await bcrypt.compare('brand-new-pass-1', stored.memberPassword)).toBe(true);
			expect(await bcrypt.compare(PASSWORD, stored.memberPassword)).toBe(false);
			expect(stored.tokenVersion).toBe(1);
			expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
			expect(ctx.auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.PASSWORD_RESET_COMPLETED, targetId: 'm1' }));
			const audit = JSON.stringify(ctx.auditLogService.record.mock.calls);
			expect(audit).not.toContain(token);
			expect(audit).not.toContain('brand-new-pass-1');
		});

		it('keeps the date of an address that was verified already', async () => {
			const verifiedAt = new Date('2026-01-01');
			const ctx = build([member({ emailVerifiedAt: verifiedAt })]);
			await ctx.service.resetPassword(await requestLink(ctx), 'brand-new-pass-1');
			expect(ctx.memberModel.docs[0].emailVerifiedAt).toBe(verifiedAt);
		});

		it('the link is single use: the second try fails and the first password stays', async () => {
			const ctx = build();
			const token = await requestLink(ctx);
			await ctx.service.resetPassword(token, 'first-new-pass-1');
			await expect(ctx.service.resetPassword(token, 'second-new-pass-2')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			expect(await bcrypt.compare('first-new-pass-1', ctx.memberModel.docs[0].memberPassword)).toBe(true);
			expect(ctx.memberModel.docs[0].tokenVersion).toBe(1);
		});

		it('the link expires after 30 minutes and changes nothing', async () => {
			const ctx = build();
			const old = await ctx.emailTokens.issue('m1' as any, EmailTokenPurpose.RESET_PASSWORD, { now: new Date(Date.now() - minutes(31)) });
			await expect(ctx.service.resetPassword(old, 'brand-new-pass-1')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			expect(await bcrypt.compare(PASSWORD, ctx.memberModel.docs[0].memberPassword)).toBe(true);
			expect(ctx.memberModel.docs[0].tokenVersion).toBe(0);
			expect(ctx.memberModel.docs[0].emailVerifiedAt).toBeUndefined();
		});

		it('only the newest link works when two were requested', async () => {
			const ctx = build();
			const first = await requestLink(ctx);
			const second = await requestLink(ctx);
			await expect(ctx.service.resetPassword(first, 'brand-new-pass-1')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			await expect(ctx.service.resetPassword(second, 'brand-new-pass-1')).resolves.toBe(Message.PASSWORD_RESET_DONE);
		});

		it('a wrong token, a verification token and a deleted account are all refused the same way', async () => {
			const ctx = build();
			await expect(ctx.service.resetPassword('x'.repeat(43), 'brand-new-pass-1')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });

			const verifyToken = await ctx.emailTokens.issue('m1' as any, EmailTokenPurpose.VERIFY_EMAIL);
			await expect(ctx.service.resetPassword(verifyToken, 'brand-new-pass-1')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });

			const resetToken = await ctx.emailTokens.issue('m1' as any, EmailTokenPurpose.RESET_PASSWORD);
			ctx.memberModel.docs[0].memberStatus = MemberStatus.DELETE;
			await expect(ctx.service.resetPassword(resetToken, 'brand-new-pass-1')).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
			expect(await bcrypt.compare(PASSWORD, ctx.memberModel.docs[0].memberPassword)).toBe(true);
		});

		it('ends the old sessions: a token made before the reset is rejected, a new login works', async () => {
			const ctx = build([member({ _id: new ObjectId() })]);
			(ctx.memberModel as any).findById = (id: any) => ctx.memberModel.findOne({ _id: id });
			const authService = new AuthService(new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1d' } }), ctx.memberModel as any);
			// the browser kept this token in localStorage
			const oldToken = await authService.createToken(ctx.memberModel.docs[0] as any);
			await expect(authService.authenticate(oldToken)).resolves.toMatchObject({ memberStatus: MemberStatus.ACTIVE });

			await ctx.service.resetPassword(await requestLink(ctx), 'brand-new-pass-1');

			await expect(authService.authenticate(oldToken)).rejects.toThrow(Message.NOT_AUTHENTICATED);
			const newToken = await authService.createToken(ctx.memberModel.docs[0] as any);
			await expect(authService.authenticate(newToken)).resolves.toMatchObject({ memberStatus: MemberStatus.ACTIVE });
		});
	});
});
