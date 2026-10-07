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

	it('puts only _id and memberType in the token, and the token expires in one day', async () => {
		const token = await service.createToken({ _id: memberId as any, memberType: MemberType.USER });
		const payload: any = new JwtService({ secret: 'test-secret' }).decode(token);

		expect(Object.keys(payload).sort()).toEqual(['_id', 'exp', 'iat', 'memberType']);
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
});
