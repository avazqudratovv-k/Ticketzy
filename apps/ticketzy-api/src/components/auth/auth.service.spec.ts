import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

const memberId = '64b7f0f2a1b2c3d4e5f60718';
const query = (value: any) => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) });

describe('AuthService', () => {
	let memberModel: any;
	let service: AuthService;

	beforeEach(() => {
		memberModel = { findById: jest.fn() };
		service = new AuthService(new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1d' } }), memberModel);
	});

	it('puts only _id, memberType and the token version in the token, and the token expires in one day', async () => {
		const token = await service.createToken({ _id: memberId as any, memberType: MemberType.USER });
		const payload: any = new JwtService({ secret: 'test-secret' }).decode(token);

		expect(Object.keys(payload).sort()).toEqual(['_id', 'exp', 'iat', 'memberType', 'tv']);
		expect(payload).toMatchObject({ _id: memberId, memberType: MemberType.USER });
		expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
	});

	it('turns any invalid token into a plain 401 without the jwt library message', async () => {
		const err: any = await service.verifyToken('not.a.token').catch((e) => e);
		expect(err).toBeInstanceOf(UnauthorizedException);
		expect(err.message).toBe(Message.NOT_AUTHENTICATED);

		const foreign = await new JwtService({ secret: 'other-secret' }).signAsync({ _id: memberId, memberType: 'ADMIN' });
		await expect(service.verifyToken(foreign)).rejects.toThrow(Message.NOT_AUTHENTICATED);
	});

	it('loads the member from the database and returns it for a valid token', async () => {
		memberModel.findById.mockReturnValue(query({ _id: memberId, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE }));
		const token = await service.createToken({ _id: memberId as any, memberType: MemberType.USER });

		const member = await service.authenticate(token);
		expect(member.memberStatus).toBe(MemberStatus.ACTIVE);
		expect(memberModel.findById).toHaveBeenCalledTimes(1);
	});

	it.each([MemberStatus.REJECTED, MemberStatus.SUSPENDED, MemberStatus.DELETE])(
		'rejects a %s member even though the token is still valid',
		async (memberStatus) => {
			memberModel.findById.mockReturnValue(query({ _id: memberId, memberType: MemberType.USER, memberStatus }));
			const token = await service.createToken({ _id: memberId as any, memberType: MemberType.USER });

			await expect(service.authenticate(token)).rejects.toThrow(Message.ACCOUNT_NOT_VERIFIED);
		},
	);

	it.each([MemberStatus.REJECTED, MemberStatus.SUSPENDED])(
		'allowRestricted (contact support) lets a %s member in, but never a DELETE one',
		async (memberStatus) => {
			memberModel.findById.mockReturnValue(query({ _id: memberId, memberType: MemberType.ORGANIZER, memberStatus }));
			const token = await service.createToken({ _id: memberId as any, memberType: MemberType.ORGANIZER });
			await expect(service.authenticate(token, { allowRestricted: true })).resolves.toMatchObject({ memberStatus });

			memberModel.findById.mockReturnValue(query({ _id: memberId, memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.DELETE }));
			await expect(service.authenticate(token, { allowRestricted: true })).rejects.toThrow(Message.ACCOUNT_NOT_VERIFIED);
		},
	);

	it('lets a PENDING organizer authenticate', async () => {
		memberModel.findById.mockReturnValue(
			query({ _id: memberId, memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.PENDING }),
		);
		const token = await service.createToken({ _id: memberId as any, memberType: MemberType.ORGANIZER });

		await expect(service.authenticate(token)).resolves.toMatchObject({ memberStatus: MemberStatus.PENDING });
	});

	it('rejects a token whose member no longer exists', async () => {
		memberModel.findById.mockReturnValue(query(null));
		const token = await service.createToken({ _id: memberId as any, memberType: MemberType.USER });

		await expect(service.authenticate(token)).rejects.toThrow(Message.NOT_AUTHENTICATED);
	});

	it('reads only a Bearer token from the header', () => {
		expect(service.getBearerToken({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
		expect(() => service.getBearerToken({ headers: {} })).toThrow(Message.TOKEN_NOT_EXIST);
		expect(() => service.getBearerToken({ headers: { authorization: 'Basic abc' } })).toThrow(Message.NOT_AUTHENTICATED);
	});

	describe('sessions after a password reset (DECISIONS #135)', () => {
		const made = async (tokenVersion?: number) => service.createToken({ _id: memberId as any, memberType: MemberType.USER, tokenVersion });
		const stored = (tokenVersion?: number) =>
			memberModel.findById.mockReturnValue(query({ _id: memberId, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, ...(tokenVersion === undefined ? {} : { tokenVersion }) }));

		it('puts the tokenVersion of the member in the token (0 when the member has none)', async () => {
			const jwt = new JwtService({ secret: 'test-secret' });
			expect((jwt.decode(await made(3)) as any).tv).toBe(3);
			expect((jwt.decode(await made()) as any).tv).toBe(0);
		});

		it('accepts a token whose version matches', async () => {
			stored(2);
			await expect(service.authenticate(await made(2))).resolves.toMatchObject({ memberStatus: MemberStatus.ACTIVE });
		});

		it('rejects a token made before the version went up, with the plain 401', async () => {
			stored(1);
			const err: any = await service.authenticate(await made(0)).catch((e) => e);
			expect(err).toBeInstanceOf(UnauthorizedException);
			expect(err.message).toBe(Message.NOT_AUTHENTICATED);
		});

		it('keeps tokens from before this feature (no tv) working until the first reset', async () => {
			stored(undefined);
			const oldToken = await new JwtService({ secret: 'test-secret' }).signAsync({ _id: memberId, memberType: MemberType.USER });
			await expect(service.authenticate(oldToken)).resolves.toBeDefined();
			stored(1);
			await expect(service.authenticate(oldToken)).rejects.toThrow(Message.NOT_AUTHENTICATED);
		});

		it('rejects a token with a higher version than the member too (a forged or rolled back one)', async () => {
			stored(0);
			await expect(service.authenticate(await made(5))).rejects.toThrow(Message.NOT_AUTHENTICATED);
		});

		it('applies to the restricted (support) flow as well', async () => {
			stored(1);
			await expect(service.authenticate(await made(0), { allowRestricted: true })).rejects.toThrow(Message.NOT_AUTHENTICATED);
		});
	});
});
