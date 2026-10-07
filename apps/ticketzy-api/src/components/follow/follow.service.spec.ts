import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FollowService } from './follow.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('FollowService', () => {
	let followModel: any;
	let memberService: any;
	let service: FollowService;

	beforeEach(() => {
		followModel = {
			create: jest.fn(async (doc) => doc),
			findOneAndDelete: jest.fn().mockReturnValue(exec({ followerId: 'u1', followingId: 'o1' })),
			aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])),
		};
		memberService = { getMember: jest.fn(), memberStatsEditor: jest.fn() };
		service = new FollowService(followModel, memberService);
	});

	it('follows an organizer', async () => {
		memberService.getMember.mockResolvedValue({ _id: 'o1', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE });

		await service.subscribe('u1' as any, 'o1' as any);

		expect(followModel.create).toHaveBeenCalledWith({ followingId: 'o1', followerId: 'u1' });
	});

	it.each([MemberType.USER, MemberType.ADMIN])('refuses to follow a %s', async (memberType) => {
		memberService.getMember.mockResolvedValue({ _id: 'x1', memberType, memberStatus: MemberStatus.ACTIVE });

		const err: any = await service.subscribe('u1' as any, 'x1' as any).catch((e) => e);

		expect(err).toBeInstanceOf(BadRequestException);
		expect(err.message).toBe(Message.ONLY_ORGANIZERS_CAN_BE_FOLLOWED);
		expect(followModel.create).not.toHaveBeenCalled();
	});

	it('cannot follow an organizer that is not ACTIVE (getMember hides them)', async () => {
		memberService.getMember.mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND));

		await expect(service.subscribe('u1' as any, 'o1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		expect(followModel.create).not.toHaveBeenCalled();
	});

	it('can always unfollow, without looking the organizer up', async () => {
		await service.unsubscribe('u1' as any, 'o1' as any);

		expect(memberService.getMember).not.toHaveBeenCalled();
		expect(followModel.findOneAndDelete).toHaveBeenCalledWith({ followingId: 'o1', followerId: 'u1' });
	});

	it('lists only ACTIVE members, filtered before pagination so the total stays right', async () => {
		await service.getMemberFollowings(null as any, { page: 1, limit: 5, search: { followerId: 'u1' as any } });
		await service.getMemberFollowers(null as any, { page: 1, limit: 5, search: { followingId: 'o1' as any } });

		const [followings, followers] = followModel.aggregate.mock.calls.map(([pipeline]: any) => pipeline);
		for (const [pipeline, key] of [[followings, 'followingData'], [followers, 'followerData']] as const) {
			const matchIndex = pipeline.findIndex((s: any) => s.$match?.[`${key}.memberStatus`] === MemberStatus.ACTIVE);
			const facetIndex = pipeline.findIndex((s: any) => s.$facet);
			expect(matchIndex).toBeGreaterThan(-1);
			expect(matchIndex).toBeLessThan(facetIndex);
		}
	});
});
