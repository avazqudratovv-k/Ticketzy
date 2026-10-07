import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ActiveOrganizerGuard } from './organizer.guard';
import { Message } from '../../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../../libs/enums/member.enum';

const gqlContext = (req: any) => ({ contextType: 'graphql', getArgByIndex: () => ({ req }), getHandler: () => ({}) });
const request = () => ({ headers: { authorization: 'Bearer abc' }, body: {} as any });

describe('RolesGuard', () => {
	const reflector: any = { get: jest.fn().mockReturnValue([MemberType.ORGANIZER, MemberType.ADMIN]) };

	it('does not crash on a missing member: it answers 401, not a TypeError', async () => {
		const authService: any = {
			getBearerToken: () => 'abc',
			authenticate: jest.fn().mockRejectedValue(new UnauthorizedException(Message.NOT_AUTHENTICATED)),
		};
		const guard = new RolesGuard(reflector, authService);

		await expect(guard.canActivate(gqlContext(request()))).rejects.toThrow(Message.NOT_AUTHENTICATED);
	});

	it('rejects a role that is not listed and accepts one that is', async () => {
		const req = request();
		const authService: any = { getBearerToken: () => 'abc', authenticate: jest.fn() };
		const guard = new RolesGuard(reflector, authService);

		authService.authenticate.mockResolvedValue({ _id: 'm1', memberType: MemberType.USER });
		await expect(guard.canActivate(gqlContext(req))).rejects.toBeInstanceOf(ForbiddenException);

		authService.authenticate.mockResolvedValue({ _id: 'm2', memberType: MemberType.ORGANIZER });
		await expect(guard.canActivate(gqlContext(req))).resolves.toBe(true);
		expect(req.body.authMember._id).toBe('m2');
	});
});

describe('ActiveOrganizerGuard', () => {
	const guard = new ActiveOrganizerGuard();
	const withMember = (authMember: any) => gqlContext({ body: { authMember } });

	it('blocks a PENDING or REJECTED organizer', () => {
		for (const memberStatus of [MemberStatus.PENDING, MemberStatus.REJECTED]) {
			expect(() => guard.canActivate(withMember({ memberType: MemberType.ORGANIZER, memberStatus }))).toThrow(
				Message.ORGANIZER_NOT_APPROVED,
			);
		}
	});

	it('lets an ACTIVE organizer and an admin through', () => {
		expect(guard.canActivate(withMember({ memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE }))).toBe(true);
		expect(guard.canActivate(withMember({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE }))).toBe(true);
	});

	it('answers 401 when no member was loaded', () => {
		expect(() => guard.canActivate(withMember(undefined))).toThrow(UnauthorizedException);
	});
});
