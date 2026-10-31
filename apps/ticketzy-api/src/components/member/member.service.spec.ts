import { UnauthorizedException } from '@nestjs/common';
import { createValidationPipe } from '../../libs/validation';
import { MemberService } from './member.service';
import { AuthService } from '../auth/auth.service';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { MemberAuthType, MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { LoginInput, MemberInput } from '../../libs/dto/member/member.input';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';

const query = (value: any) => ({ select: () => ({ exec: jest.fn().mockResolvedValue(value) }) });
/** find().select().sort().lean().exec() as signup reads the holders of an email */
const holders = (rows: any[]) => ({ select: () => ({ sort: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(rows) }) }) }) });

describe('MemberService signup and login', () => {
	let memberModel: any;
	let service: MemberService;
	let authService: AuthService;

	const input = (): MemberInput => ({ memberEmail: 'a@b.com', memberPassword: 'longenough1', memberNick: 'nick' });

	beforeEach(() => {
		memberModel = {
			create: jest.fn(async (doc) => ({ _id: 'm1', ...doc })),
			findOne: jest.fn(),
			find: jest.fn(() => holders([])),
			updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) })),
		};
		authService = new AuthService({ signAsync: jest.fn().mockResolvedValue('token') } as any, {} as any);
		service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any, {} as any, { sendVerificationInBackground: jest.fn() } as any);
	});

	it('signupUser creates an ACTIVE USER with a hashed password', async () => {
		const result = await service.signupUser(input());

		const doc = memberModel.create.mock.calls[0][0];
		expect(doc).toMatchObject({ memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, memberAuthType: MemberAuthType.EMAIL });
		expect(doc.memberPassword).not.toBe('longenough1');
		expect(await authService.comparePasswords('longenough1', doc.memberPassword)).toBe(true);
		expect(result.accessToken).toBe('token');
	});

	it('signup starts unverified, saves the language, and sends the verification link in the background (DECISIONS #135)', async () => {
		const emailAuth = { sendVerificationInBackground: jest.fn() };
		service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any, {} as any, emailAuth as any);

		await service.signupUser({ ...input(), memberLang: 'ko' as any });
		const doc = memberModel.create.mock.calls[0][0];
		expect(doc.memberLang).toBe('ko');
		expect(doc.emailVerifiedAt).toBeUndefined();
		expect(doc).not.toHaveProperty('tokenVersion');
		expect(emailAuth.sendVerificationInBackground).toHaveBeenCalledWith(expect.objectContaining({ _id: 'm1', memberEmail: 'a@b.com', memberLang: 'ko' }));

		await service.signupOrganizer(input());
		expect(memberModel.create.mock.calls[1][0]).not.toHaveProperty('memberLang');
		expect(emailAuth.sendVerificationInBackground).toHaveBeenCalledTimes(2);
	});

	it('a failing mail provider cannot fail the signup, and a failed signup sends no mail', async () => {
		const emailAuth = { sendVerificationInBackground: jest.fn() };
		service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any, {} as any, emailAuth as any);
		memberModel.create.mockRejectedValue({ code: 11000, message: 'E11000' });
		await expect(service.signupUser(input())).rejects.toThrow(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
		expect(emailAuth.sendVerificationInBackground).not.toHaveBeenCalled();
	});

	it('the signup input accepts only the four languages', async () => {
		const pipe = createValidationPipe();
		const check = (memberLang: unknown) => pipe.transform({ ...input(), memberLang }, { type: 'body', metatype: MemberInput });
		await expect(check('uz')).resolves.toMatchObject({ memberLang: 'uz' });
		await expect(check(undefined)).resolves.toBeDefined();
		await expect(check('fr')).rejects.toBeDefined();
	});

	it('signupOrganizer creates a PENDING ORGANIZER', async () => {
		await service.signupOrganizer(input());

		expect(memberModel.create.mock.calls[0][0]).toMatchObject({
			memberType: MemberType.ORGANIZER,
			memberStatus: MemberStatus.PENDING,
		});
	});

	it('maps a duplicate key error to one clear message', async () => {
		memberModel.create.mockRejectedValue({ code: 11000, message: 'E11000' });
		await expect(service.signupUser(input())).rejects.toThrow(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
	});

	describe('email of a deleted account (DECISIONS #123)', () => {
		const DAY = 24 * 60 * 60 * 1000;
		const deleted = (id: string, deletedAgoDays: number, extra: any = {}) => {
			const deletedAt = new Date(Date.now() - deletedAgoDays * DAY);
			return { _id: id, memberStatus: MemberStatus.DELETE, deletedAt, emailReusableAt: new Date(deletedAt.getTime() + 30 * DAY), ...extra };
		};

		it('refuses a live account email with the usual message and creates nothing', async () => {
			memberModel.find.mockReturnValue(holders([{ _id: 'live', memberStatus: MemberStatus.ACTIVE }]));
			await expect(service.signupUser(input())).rejects.toThrow(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			expect(memberModel.create).not.toHaveBeenCalled();
		});

		it('refuses within 30 days with EMAIL_RECENTLY_DELETED and a message without dates', async () => {
			memberModel.find.mockReturnValue(holders([deleted('old', 29)]));
			const err: any = await service.signupUser(input()).catch((e) => e);

			expect(err.code).toBe('EMAIL_RECENTLY_DELETED');
			expect(err.message).toBe(
				'This email belonged to a deleted account and cannot be used for a new account yet. Please try again later or use another email.',
			);
			expect(err.message).not.toMatch(/\d/);
			expect(memberModel.create).not.toHaveBeenCalled();
		});

		it('computes the wait from deletedAt when emailReusableAt is missing', async () => {
			memberModel.find.mockReturnValue(holders([deleted('old', 5, { emailReusableAt: undefined })]));
			await expect(service.signupUser(input())).rejects.toMatchObject({ code: 'EMAIL_RECENTLY_DELETED' });
		});

		it('allows the same email after emailReusableAt and tags both accounts', async () => {
			memberModel.find.mockReturnValue(holders([deleted('old', 31)]));
			const result: any = await service.signupUser(input());

			expect(memberModel.create.mock.calls[0][0]).toMatchObject({ memberEmail: 'a@b.com', previousAccountId: 'old' });
			expect(result.previousAccountId).toBe('old');
			expect(memberModel.updateOne).toHaveBeenCalledWith(
				{ _id: 'old', memberStatus: MemberStatus.DELETE },
				{ $set: { reusedByMemberId: 'm1' } },
				{ timestamps: false },
			);
		});

		it('is allowed exactly at emailReusableAt', async () => {
			memberModel.find.mockReturnValue(holders([deleted('old', 30)]));
			await expect(service.signupUser(input())).resolves.toBeDefined();
		});

		it('lets the newest deleted account decide and tags that one', async () => {
			// a second account was created on the same email and deleted again: the older one is long past its wait
			memberModel.find.mockReturnValue(holders([deleted('newer', 3), deleted('older', 100, { reusedByMemberId: 'newer' })]));
			await expect(service.signupUser(input())).rejects.toMatchObject({ code: 'EMAIL_RECENTLY_DELETED' });

			memberModel.find.mockReturnValue(holders([deleted('newer', 40), deleted('older', 100, { reusedByMemberId: 'newer' })]));
			await service.signupUser(input());
			expect(memberModel.create.mock.calls[0][0].previousAccountId).toBe('newer');
		});

		it('looks the email up trimmed and lowercased, like the unique index stores it', async () => {
			await service.signupUser({ ...input(), memberEmail: '  A@B.com ' });
			expect(memberModel.find).toHaveBeenCalledWith({ memberEmail: 'a@b.com' });
		});

		it('a brand new email gets no tags and no update of any other account', async () => {
			await service.signupUser(input());
			expect(memberModel.create.mock.calls[0][0]).not.toHaveProperty('previousAccountId');
			expect(memberModel.updateOne).not.toHaveBeenCalled();
		});

		it('a failed reusedByMemberId write does not undo the sign-up', async () => {
			memberModel.find.mockReturnValue(holders([deleted('old', 31)]));
			memberModel.updateOne.mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('down')) });
			await expect(service.signupUser(input())).resolves.toBeDefined();
		});

		it('sign-in only ever matches a non-deleted account, and a deleted-only email looks like an unknown email', async () => {
			memberModel.findOne.mockReturnValue(query(null));
			const err: any = await service.login({ memberEmail: 'a@b.com', memberPassword: 'correct-password' }).catch((e) => e);

			expect(memberModel.findOne).toHaveBeenCalledWith({ memberEmail: 'a@b.com', memberStatus: { $ne: MemberStatus.DELETE } });
			expect(err).toBeInstanceOf(UnauthorizedException);
			expect(err.message).toBe(Message.WRONG_EMAIL_OR_PASSWORD);
		});

		it('sign-in picks the new account when an old deleted one has the same email (the filter excludes the deleted one)', async () => {
			const live = { _id: 'new', memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, memberPassword: await authService.hashPassword('correct-password') };
			memberModel.findOne.mockImplementation((filter: any) => {
				const rows = [
					{ _id: 'old', memberStatus: MemberStatus.DELETE, memberPassword: live.memberPassword },
					live,
				].filter((row) => filter.memberStatus.$ne !== row.memberStatus);
				return query(rows[0] ?? null);
			});
			const result: any = await service.login({ memberEmail: 'a@b.com', memberPassword: 'correct-password' });
			expect(result._id).toBe('new');
		});
	});

	describe('login', () => {
		const stored = async (memberStatus: MemberStatus) => ({
			_id: 'm1',
			memberType: MemberType.USER,
			memberStatus,
			memberPassword: await authService.hashPassword('correct-password'),
		});
		const login: LoginInput = { memberEmail: 'a@b.com', memberPassword: 'correct-password' };

		it('uses the same message for an unknown email and for a wrong password', async () => {
			memberModel.findOne.mockReturnValue(query(null));
			const unknown: any = await service.login(login).catch((e) => e);

			memberModel.findOne.mockReturnValue(query(await stored(MemberStatus.ACTIVE)));
			const wrong: any = await service.login({ ...login, memberPassword: 'wrong-password' }).catch((e) => e);

			expect(unknown.message).toBe(Message.WRONG_EMAIL_OR_PASSWORD);
			expect(wrong.message).toBe(Message.WRONG_EMAIL_OR_PASSWORD);
			expect(unknown.getStatus()).toBe(401);
			expect(unknown).toBeInstanceOf(UnauthorizedException);
		});

		it.each([MemberStatus.REJECTED, MemberStatus.SUSPENDED, MemberStatus.DELETE])(
			'refuses a %s account with the ACCOUNT_NOT_VERIFIED code',
			async (status) => {
				memberModel.findOne.mockReturnValue(query(await stored(status)));
				const err: any = await service.login(login).catch((e) => e);

				expect(err.message).toBe(Message.ACCOUNT_NOT_VERIFIED);
				expect(err.extensions.code).toBe('ACCOUNT_NOT_VERIFIED');
			},
		);

		it('lets ACTIVE members and PENDING organizers log in', async () => {
			for (const status of [MemberStatus.ACTIVE, MemberStatus.PENDING]) {
				memberModel.findOne.mockReturnValue(query(await stored(status)));
				expect((await service.login(login)).accessToken).toBe('token');
			}
		});
	});
});

describe('signup input validation (global ValidationPipe)', () => {
	const pipe = createValidationPipe();
	const run = (value: any) => pipe.transform(value, { type: 'body', metatype: MemberInput });

	it('trims and lowercases the email and drops fields the client may not set', async () => {
		const result: any = await run({
			memberEmail: '  Mixed@Case.COM ',
			memberPassword: 'longenough1',
			memberType: 'ADMIN',
			memberStatus: 'ACTIVE',
		});

		expect(result.memberEmail).toBe('mixed@case.com');
		expect(result.memberType).toBeUndefined();
		expect(result.memberStatus).toBeUndefined();
	});

	it('requires 8+ characters and has no upper cap', async () => {
		await expect(run({ memberEmail: 'a@b.com', memberPassword: '1234567' })).rejects.toBeDefined();
		await expect(run({ memberEmail: 'a@b.com', memberPassword: 'x'.repeat(40) })).resolves.toBeDefined();
	});

	it('rejects a malformed email', async () => {
		await expect(run({ memberEmail: 'not-an-email', memberPassword: 'longenough1' })).rejects.toBeDefined();
	});
});

describe('MemberService public listings', () => {
	let memberModel: any;
	let eventModel: any;
	let service: MemberService;

	beforeEach(() => {
		memberModel = {
			findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'm1', memberViews: 0 }) }) }),
			aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }),
		};
		eventModel = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
		service = new MemberService(memberModel, eventModel, {} as any, {} as any, {} as any, {} as any, { sendVerificationInBackground: jest.fn() } as any);
	});

	it('an organizer profile counts APPROVED events only, not the memberEvents counter', async () => {
		memberModel.findOne.mockReturnValue({
			lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'm1', memberType: MemberType.ORGANIZER, memberEvents: 9 }) }),
		});
		eventModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'm1', total: 3 }]) });

		const result = await service.getMember(null, 'm1' as any);

		expect(eventModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ eventStatus: EventStatus.APPROVED });
		expect(result.memberEvents).toBe(3);
	});

	it('an organizer without APPROVED events shows 0, and a USER profile is not touched', async () => {
		memberModel.findOne.mockReturnValue({
			lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'm1', memberType: MemberType.ORGANIZER, memberEvents: 4 }) }),
		});
		expect((await service.getMember(null, 'm1' as any)).memberEvents).toBe(0);

		memberModel.findOne.mockReturnValue({
			lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'u1', memberType: MemberType.USER, memberEvents: 0 }) }),
		});
		eventModel.aggregate.mockClear();
		await service.getMember(null, 'u1' as any);
		expect(eventModel.aggregate).not.toHaveBeenCalled();
	});

	it('getOrganizers fixes the count of every listed organizer with one query', async () => {
		memberModel.aggregate.mockReturnValue({
			exec: jest.fn().mockResolvedValue([
				{ list: [{ _id: 'o1', memberType: MemberType.ORGANIZER, memberEvents: 5 }, { _id: 'o2', memberType: MemberType.ORGANIZER, memberEvents: 2 }], metaCounter: [] },
			]),
		});
		eventModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'o1', total: 1 }]) });

		const result = await service.getOrganizers(null as any, { page: 1, limit: 10, search: {} } as any);

		expect(eventModel.aggregate).toHaveBeenCalledTimes(1);
		expect(result.list.map((m: any) => m.memberEvents)).toEqual([1, 0]);
	});

	it('getMember shows ACTIVE members only to everyone else', async () => {
		await service.getMember(null, 'm1' as any);
		await service.getMember('someone-else' as any, 'm1' as any).catch(() => undefined);

		for (const [search] of memberModel.findOne.mock.calls) expect(search.memberStatus).toBe(MemberStatus.ACTIVE);
	});

	it('getMember lets a member open their own page while PENDING', async () => {
		await service.getMember('m1' as any, 'm1' as any).catch(() => undefined);

		expect(memberModel.findOne.mock.calls[0][0].memberStatus).toEqual({ $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] });
	});

	it('getOrganizers lists ACTIVE organizers only', async () => {
		await service.getOrganizers(null as any, { page: 1, limit: 10, search: {} } as any);

		const [{ $match }] = memberModel.aggregate.mock.calls[0][0];
		expect($match).toEqual({ memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE });
	});
});

describe('MemberService.updateMemberByAdmin keeps organizer status changes audited and protects admins', () => {
	const ADMIN = 'admin-1';
	const target = (value: any) => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) }) });
	const build = (found: any, updated: any = { _id: 'u1' }) => {
		const memberModel: any = {
			findOne: jest.fn().mockReturnValue(target(found)),
			findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) }),
		};
		const authService: any = { hashPassword: jest.fn(async (password: string) => `hash-of-${password}`), createToken: jest.fn().mockResolvedValue('token') };
		const auditLogService: any = { record: jest.fn().mockResolvedValue(undefined) };
		const service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any, auditLogService, { sendVerificationInBackground: jest.fn() } as any);
		return { memberModel, auditLogService, authService, service };
	};

	it('refuses to change status or role of an organizer, and points to the organizer operations', async () => {
		const { memberModel, service } = build({ _id: 'o1', memberType: MemberType.ORGANIZER });

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: 'o1' as any, memberStatus: MemberStatus.SUSPENDED })).rejects.toThrow(
			Message.USE_ORGANIZER_OPERATIONS,
		);
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it.each([
		['another account', 'u1'],
		['their own account', ADMIN],
	])('refuses setting memberType to ADMIN on %s, before any database call', async (_name, id) => {
		const { memberModel, service } = build({ _id: 'u1', memberType: MemberType.USER });

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: id as any, memberType: MemberType.ADMIN })).rejects.toThrow(Message.CANNOT_ASSIGN_ADMIN_ROLE);
		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: id as any, memberType: MemberType.ADMIN, memberNick: 'x' })).rejects.toThrow(
			Message.CANNOT_ASSIGN_ADMIN_ROLE,
		);
		expect(memberModel.findOne).not.toHaveBeenCalled();
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('an admin cannot set DELETE (accounts are deleted by their owner only, #123), before any database call', async () => {
		const { memberModel, service } = build({ _id: 'u1', memberType: MemberType.USER });

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: 'u1' as any, memberStatus: MemberStatus.DELETE })).rejects.toThrow(
			Message.CANNOT_SET_DELETED_STATUS,
		);
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('an admin cannot bring back or re-role a deleted account (its email may belong to a new account)', async () => {
		const { memberModel, service } = build({ _id: 'u1', memberType: MemberType.USER, memberStatus: MemberStatus.DELETE });

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: 'u1' as any, memberStatus: MemberStatus.ACTIVE })).rejects.toThrow(Message.ACCOUNT_IS_DELETED);
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('still lets an admin change the status of a USER', async () => {
		const { service } = build({ _id: 'u1', memberType: MemberType.USER }, { _id: 'u1', memberStatus: MemberStatus.SUSPENDED });

		const result = await service.updateMemberByAdmin(ADMIN as any, { _id: 'u1' as any, memberStatus: MemberStatus.SUSPENDED });

		expect(result.memberStatus).toBe(MemberStatus.SUSPENDED);
	});

	it.each([
		['status', { memberStatus: MemberStatus.SUSPENDED }],
		['role', { memberType: MemberType.USER }],
	])('refuses an admin changing their own %s, before any database call', async (_name, change) => {
		const { memberModel, service } = build(null);

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: ADMIN as any, ...change })).rejects.toThrow(Message.CANNOT_CHANGE_OWN_ACCESS);
		expect(memberModel.findOne).not.toHaveBeenCalled();
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('compares ids as strings, so an ObjectId and its hex string are the same admin', async () => {
		const { ObjectId } = require('bson');
		const id = new ObjectId();
		const { service } = build(null);

		await expect(service.updateMemberByAdmin(id as any, { _id: String(id) as any, memberStatus: MemberStatus.SUSPENDED })).rejects.toThrow(
			Message.CANNOT_CHANGE_OWN_ACCESS,
		);
	});

	it.each([
		['status', { memberStatus: MemberStatus.SUSPENDED }],
		['role', { memberType: MemberType.USER }],
	])("refuses changing another ADMIN account's %s", async (_name, change) => {
		const { memberModel, service } = build({ _id: 'admin-2', memberType: MemberType.ADMIN });

		await expect(service.updateMemberByAdmin(ADMIN as any, { _id: 'admin-2' as any, ...change })).rejects.toThrow(Message.CANNOT_CHANGE_ADMIN_ACCESS);
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('does not block profile edits: an admin can still edit their own nick, and another admin\'s, without status or role', async () => {
		const { memberModel, service } = build({ _id: 'admin-2', memberType: MemberType.ADMIN });

		await service.updateMemberByAdmin(ADMIN as any, { _id: ADMIN as any, memberNick: 'newnick' });
		await service.updateMemberByAdmin(ADMIN as any, { _id: 'admin-2' as any, memberNick: 'other' });

		expect(memberModel.findOne).not.toHaveBeenCalled();
		expect(memberModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
	});
	describe('password reset and audit (DECISIONS #93)', () => {
		it('refuses to set the password of another ADMIN, writes an audit entry for the attempt and changes nothing', async () => {
			const { memberModel, auditLogService, authService, service } = build({ _id: 'admin-2', memberType: MemberType.ADMIN });

			await expect(service.updateMemberByAdmin(ADMIN as any, { _id: 'admin-2' as any, memberPassword: 'newpassword1' })).rejects.toThrow(
				Message.CANNOT_RESET_ADMIN_PASSWORD,
			);

			expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
			expect(authService.hashPassword).not.toHaveBeenCalled();
			expect(auditLogService.record).toHaveBeenCalledTimes(1);
			expect(auditLogService.record).toHaveBeenCalledWith({
				actorId: ADMIN,
				action: AuditAction.ADMIN_PASSWORD_RESET_BLOCKED,
				targetType: AuditTargetType.MEMBER,
				targetId: 'admin-2',
				meta: { changedFields: ['memberPassword'] },
			});
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('newpassword1');
		});

		it('also refuses a password hidden in a bigger edit of another ADMIN (nick plus password)', async () => {
			const { memberModel, service } = build({ _id: 'admin-2', memberType: MemberType.ADMIN });
			await expect(
				service.updateMemberByAdmin(ADMIN as any, { _id: 'admin-2' as any, memberNick: 'sneaky', memberPassword: 'newpassword1' }),
			).rejects.toThrow(Message.CANNOT_RESET_ADMIN_PASSWORD);
			expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('still lets an admin set the password of a USER or an ORGANIZER, hashed, and audits it without the value', async () => {
			for (const memberType of [MemberType.USER, MemberType.ORGANIZER]) {
				const { memberModel, auditLogService, service } = build({ _id: 'x1', memberType }, { _id: 'x1' });
				await service.updateMemberByAdmin(ADMIN as any, { _id: 'x1' as any, memberPassword: 'newpassword1' });
				expect(memberModel.findOneAndUpdate.mock.calls[0][1].$set.memberPassword).toBe('hash-of-newpassword1');
				// an admin-set password ends the member's sessions (#135)
				expect(memberModel.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ tokenVersion: 1 });
				expect(auditLogService.record).toHaveBeenCalledWith(
					expect.objectContaining({ action: AuditAction.MEMBER_UPDATED_BY_ADMIN, targetId: 'x1', meta: { changedFields: ['memberPassword'] } }),
				);
				expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('newpassword1');
			}
		});

		it('keeps self-service: an admin can still change their own password', async () => {
			const { memberModel, auditLogService, service } = build({ _id: ADMIN, memberType: MemberType.ADMIN }, { _id: ADMIN });
			await service.updateMemberByAdmin(ADMIN as any, { _id: ADMIN as any, memberPassword: 'newpassword1' });
			expect(memberModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
			expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.MEMBER_UPDATED_BY_ADMIN }));

			// and updateMember (the member's own mutation) hashes and applies it
			await service.updateMember(ADMIN as any, { _id: ADMIN as any, memberPassword: 'another-password' });
			expect(memberModel.findOneAndUpdate.mock.calls[1][1].$set.memberPassword).toBe('hash-of-another-password');
			expect(memberModel.findOneAndUpdate.mock.calls[1][1].$inc).toEqual({ tokenVersion: 1 });
		});

		it('writes an audit entry for an ordinary admin edit, with field names and the new status only', async () => {
			const { auditLogService, service } = build({ _id: 'u1', memberType: MemberType.USER }, { _id: 'u1' });
			await service.updateMemberByAdmin(ADMIN as any, { _id: 'u1' as any, memberStatus: MemberStatus.SUSPENDED, memberNick: 'private-nick' });
			expect(auditLogService.record).toHaveBeenCalledWith({
				actorId: ADMIN,
				action: AuditAction.MEMBER_UPDATED_BY_ADMIN,
				targetType: AuditTargetType.MEMBER,
				targetId: 'u1',
				meta: { changedFields: ['memberStatus', 'memberNick'], toStatus: MemberStatus.SUSPENDED },
			});
			expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('private-nick');
		});

		it('writes no audit entry when the update fails or is refused', async () => {
			const refused = build({ _id: 'o1', memberType: MemberType.ORGANIZER });
			await expect(refused.service.updateMemberByAdmin(ADMIN as any, { _id: 'o1' as any, memberStatus: MemberStatus.SUSPENDED })).rejects.toThrow();
			expect(refused.auditLogService.record).not.toHaveBeenCalled();

			const failed = build(null, null);
			await expect(failed.service.updateMemberByAdmin(ADMIN as any, { _id: 'zz' as any, memberNick: 'abc' })).rejects.toThrow(Message.UPDATE_FAILED);
			expect(failed.auditLogService.record).not.toHaveBeenCalled();
		});
	});
});

describe('MemberService approval celebration (DECISIONS #120)', () => {
	let stored: any;
	let memberModel: any;
	let service: MemberService;

	beforeEach(() => {
		stored = { _id: 'org-1', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: true };
		memberModel = {
			// like MongoDB: the update applies only when every part of the filter matches
			updateOne: jest.fn((filter: any, update: any) => ({
				exec: async () => {
					const hit = Object.entries(filter).every(([key, value]) => stored[key] === value);
					if (hit) Object.assign(stored, update.$set);
					return { modifiedCount: hit ? 1 : 0 };
				},
			})),
			findById: jest.fn((id: string) => ({ select: () => ({ lean: () => ({ exec: async () => (id === stored._id ? { ...stored } : null) }) }) })),
		};
		service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any, {} as any, { sendVerificationInBackground: jest.fn() } as any);
	});

	it('clears the flag once with a conditional update true to false', async () => {
		const result = await service.markApprovalCelebrationDone('org-1' as any);

		expect(memberModel.updateOne.mock.calls[0][0]).toEqual({ _id: 'org-1', memberType: MemberType.ORGANIZER, approvalCelebrationPending: true });
		expect(result).toEqual({ memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: false });
	});

	it('is idempotent: a second call changes nothing and does not fail', async () => {
		await service.markApprovalCelebrationDone('org-1' as any);
		const again = await service.markApprovalCelebrationDone('org-1' as any);

		expect(again.approvalCelebrationPending).toBe(false);
		expect(stored.approvalCelebrationPending).toBe(false);
	});

	it('only touches the caller\'s own account: another member\'s flag stays set', async () => {
		const other = { _id: 'org-2', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: true };
		memberModel.findById.mockImplementation((id: string) => ({ select: () => ({ lean: () => ({ exec: async () => ({ ...(id === 'org-2' ? other : stored) }) }) }) }));
		await service.markApprovalCelebrationDone('org-2' as any);

		// the id is always the token's; org-1 was not part of that call
		expect(memberModel.updateOne.mock.calls[0][0]._id).toBe('org-2');
		expect(stored.approvalCelebrationPending).toBe(true);
	});

	it('does nothing for a non-organizer account', async () => {
		stored.memberType = MemberType.USER;
		const result = await service.markApprovalCelebrationDone('org-1' as any);

		expect(stored.approvalCelebrationPending).toBe(true);
		expect(result.approvalCelebrationPending).toBe(true);
	});

	it('getMyAccountState reads a missing flag as false (every account before this feature)', async () => {
		delete stored.approvalCelebrationPending;
		expect(await service.getMyAccountState('org-1' as any)).toEqual({ memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: false });
	});

	it('getMyAccountState fails for an unknown member', async () => {
		await expect(service.getMyAccountState('nobody' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
	});
});

describe('MemberService.updateMember and sessions (DECISIONS #135)', () => {
	const ID = 'u1';
	const build = () => {
		const stored: any = { _id: ID, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, tokenVersion: 0 };
		const memberModel: any = {
			findOneAndUpdate: jest.fn((_filter: any, update: any) => ({
				exec: async () => {
					if (update.$inc) for (const [key, by] of Object.entries(update.$inc)) stored[key] = (stored[key] ?? 0) + (by as number);
					Object.assign(stored, update.$set ?? update);
					return stored;
				},
			})),
		};
		const jwt: any = { signAsync: jest.fn(async (payload: any) => `token:${payload.tv}`) };
		const authService = new AuthService(jwt, {} as any);
		const service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any, {} as any, {} as any);
		return { stored, memberModel, service };
	};

	it('a new password raises tokenVersion in the same update and the returned token carries the new version', async () => {
		const { stored, memberModel, service } = build();
		const result = await service.updateMember(ID as any, { _id: ID as any, memberPassword: 'another-password' });

		const [, update] = memberModel.findOneAndUpdate.mock.calls[0];
		expect(update.$inc).toEqual({ tokenVersion: 1 });
		expect(update.$set.memberPassword).not.toBe('another-password');
		expect(stored.tokenVersion).toBe(1);
		expect(result.accessToken).toBe('token:1');
	});

	it('other edits leave sessions alone and can set the language of the emails', async () => {
		const { stored, memberModel, service } = build();
		const result = await service.updateMember(ID as any, { _id: ID as any, memberLang: 'ru' as any, memberNick: 'newnick' });

		const [, update] = memberModel.findOneAndUpdate.mock.calls[0];
		expect(update.$inc).toBeUndefined();
		expect(update).toMatchObject({ memberLang: 'ru', memberNick: 'newnick' });
		expect(stored.tokenVersion).toBe(0);
		expect(result.accessToken).toBe('token:0');
	});

	it('the update input cannot carry the email, the verification date or the token version', async () => {
		const pipe = createValidationPipe();
		const out: any = await pipe.transform(
			{ _id: ID, memberNick: 'nick1', memberEmail: 'x@y.com', emailVerifiedAt: new Date(), tokenVersion: 9 },
			{ type: 'body', metatype: (await import('../../libs/dto/member/member.update')).MemberUpdate },
		);
		expect(out).not.toHaveProperty('memberEmail');
		expect(out).not.toHaveProperty('emailVerifiedAt');
		expect(out).not.toHaveProperty('tokenVersion');
	});
});
