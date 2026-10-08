import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { MemberService } from './member.service';
import { AuthService } from '../auth/auth.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberAuthType, MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { LoginInput, MemberInput } from '../../libs/dto/member/member.input';

const query = (value: any) => ({ select: () => ({ exec: jest.fn().mockResolvedValue(value) }) });

describe('MemberService signup and login', () => {
	let memberModel: any;
	let service: MemberService;
	let authService: AuthService;

	const input = (): MemberInput => ({ memberEmail: 'a@b.com', memberPassword: 'longenough1', memberNick: 'nick' });

	beforeEach(() => {
		memberModel = { create: jest.fn(async (doc) => ({ _id: 'm1', ...doc })), findOne: jest.fn() };
		authService = new AuthService({ signAsync: jest.fn().mockResolvedValue('token') } as any, {} as any);
		service = new MemberService(memberModel, {} as any, authService, {} as any, {} as any);
	});

	it('signupUser creates an ACTIVE USER with a hashed password', async () => {
		const result = await service.signupUser(input());

		const doc = memberModel.create.mock.calls[0][0];
		expect(doc).toMatchObject({ memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, memberAuthType: MemberAuthType.EMAIL });
		expect(doc.memberPassword).not.toBe('longenough1');
		expect(await authService.comparePasswords('longenough1', doc.memberPassword)).toBe(true);
		expect(result.accessToken).toBe('token');
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
	const pipe = new ValidationPipe({ whitelist: true, transform: true });
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
	let service: MemberService;

	beforeEach(() => {
		memberModel = {
			findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'm1', memberViews: 0 }) }) }),
			aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }),
		};
		service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any);
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

describe('MemberService.updateMemberByAdmin keeps organizer status changes audited', () => {
	const lean = (value: any) => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) });

	it('refuses to change status or role of an organizer, and points to the organizer operations', async () => {
		const memberModel: any = { findOne: jest.fn().mockReturnValue(lean({ _id: 'o1' })), findOneAndUpdate: jest.fn() };
		const service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any);

		await expect(service.updateMemberByAdmin({ _id: 'o1' as any, memberStatus: MemberStatus.SUSPENDED })).rejects.toThrow(
			Message.USE_ORGANIZER_OPERATIONS,
		);
		expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('still lets an admin change the status of a USER', async () => {
		const memberModel: any = {
			findOne: jest.fn().mockReturnValue(lean(null)),
			findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'u1', memberStatus: MemberStatus.SUSPENDED }) }),
		};
		const service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any);

		const result = await service.updateMemberByAdmin({ _id: 'u1' as any, memberStatus: MemberStatus.SUSPENDED });

		expect(result.memberStatus).toBe(MemberStatus.SUSPENDED);
	});
});
