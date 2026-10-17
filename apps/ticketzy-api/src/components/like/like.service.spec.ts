import { LikeService } from './like.service';
import { LikeGroup } from '../../libs/enums/like.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('LikeService favorites (#122)', () => {
	it('puts the caller\'s liked flag on every favorite event, so the heart is red after a reload', async () => {
		const likeModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])) };
		const service = new LikeService(likeModel);

		await service.getFavoriteEvents('m1' as any, { page: 1, limit: 10 } as any);

		const pipeline = likeModel.aggregate.mock.calls[0][0];
		expect(pipeline[0].$match).toEqual({ likeGroup: LikeGroup.EVENT, memberId: 'm1' });
		const list = pipeline.find((stage: any) => stage.$facet).$facet.list;
		expect(list.find((stage: any) => stage.$set)).toEqual({
			$set: { 'favoriteEvent.meLiked': [{ memberId: '$memberId', likeRefId: '$likeRefId', myFavorite: true }] },
		});
	});

	it('returns the events themselves, carrying meLiked', async () => {
		const favoriteEvent = { _id: 'e1', eventLikes: 3, meLiked: [{ memberId: 'm1', likeRefId: 'e1', myFavorite: true }] };
		const likeModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ list: [{ favoriteEvent }], metaCounter: [{ total: 1 }] }])) };

		const result = await new LikeService(likeModel).getFavoriteEvents('m1' as any, { page: 1, limit: 10 } as any);

		expect(result.list).toEqual([favoriteEvent]);
		expect(result.list[0].meLiked?.[0].myFavorite).toBe(true);
	});
});
