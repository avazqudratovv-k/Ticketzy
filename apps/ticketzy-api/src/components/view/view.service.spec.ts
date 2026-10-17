import { ObjectId } from 'bson';
import { ViewService } from './view.service';
import { ViewGroup } from '../../libs/enums/view.enum';

const MEMBER = new ObjectId();
const EVENT = new ObjectId();
const input = () => ({ memberId: MEMBER, viewRefId: EVENT, viewGroup: ViewGroup.EVENT }) as any;

const dup = () => Object.assign(new Error('E11000 duplicate key error collection: views'), { code: 11000 });

/** a unique-keyed store whose upsert is atomic; `barrier` makes concurrent callers all arrive before any inserts */
const makeModel = (barrier?: Promise<void>) => {
	const keys = new Set<string>();
	const updateOne = jest.fn().mockImplementation((filter: any) => ({
		exec: async () => {
			if (barrier) await barrier;
			const key = `${filter.memberId}|${filter.viewRefId}|${filter.viewGroup}`;
			if (keys.has(key)) return { upsertedCount: 0 };
			keys.add(key);
			return { upsertedCount: 1, upsertedId: new ObjectId() };
		},
	}));
	return { keys, updateOne };
};

describe('ViewService.recordView', () => {
	it('records a new view once and reports it', async () => {
		const model = makeModel();
		const service = new ViewService(model as any);

		expect(await service.recordView(input())).toMatchObject({ memberId: MEMBER, viewRefId: EVENT, viewGroup: ViewGroup.EVENT });
		expect(await service.recordView(input())).toBeNull();
		expect(model.keys.size).toBe(1);
	});

	it('is one upsert on the unique key and leaves updatedAt alone on a repeat view', async () => {
		const model = makeModel();
		await new ViewService(model as any).recordView(input());

		const [filter, update, options] = model.updateOne.mock.calls[0];
		expect(filter).toEqual({ memberId: MEMBER, viewRefId: EVENT, viewGroup: ViewGroup.EVENT });
		expect(Object.keys(update)).toEqual(['$setOnInsert']);
		expect(options).toEqual({ upsert: true, timestamps: false });
	});

	it('two concurrent calls for the same view: exactly one inserts, neither throws', async () => {
		let release: () => void;
		const model = makeModel(new Promise<void>((resolve) => (release = resolve)));
		const service = new ViewService(model as any);

		const both = Promise.all([service.recordView(input()), service.recordView(input())]);
		release();
		const results = await both;

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(model.keys.size).toBe(1);
	});

	it('a duplicate-key error from a lost upsert race is retried and ends as "already seen"', async () => {
		const model = makeModel();
		model.updateOne
			.mockImplementationOnce(() => ({ exec: () => Promise.reject(dup()) }))
			.mockImplementationOnce(() => ({ exec: () => Promise.resolve({ upsertedCount: 0 }) }));

		await expect(new ViewService(model as any).recordView(input())).resolves.toBeNull();
		expect(model.updateOne).toHaveBeenCalledTimes(2);
	});

	it('gives up after one retry on a persistent duplicate-key error, still without throwing', async () => {
		const model = makeModel();
		model.updateOne.mockImplementation(() => ({ exec: () => Promise.reject(dup()) }));

		await expect(new ViewService(model as any).recordView(input())).resolves.toBeNull();
		expect(model.updateOne).toHaveBeenCalledTimes(2);
	});

	it('any other database error is logged and swallowed', async () => {
		const model = makeModel();
		model.updateOne.mockImplementation(() => ({ exec: () => Promise.reject(new Error('connection lost')) }));

		await expect(new ViewService(model as any).recordView(input())).resolves.toBeNull();
		expect(model.updateOne).toHaveBeenCalledTimes(1);
	});
});

describe('ViewService.getVisitedEvents liked flag (#122)', () => {
	it('looks up the caller\'s like of each visited event and puts it on the event', async () => {
		const visitedEvent = { _id: 'e1', eventLikes: 2 };
		const meLiked = [{ memberId: 'm1', likeRefId: 'e1', myFavorite: true }];
		const viewModel: any = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [{ visitedEvent, meLiked }], metaCounter: [] }]) }) };

		const result = await new ViewService(viewModel).getVisitedEvents('m1' as any, { page: 1, limit: 10 } as any);

		const list = viewModel.aggregate.mock.calls[0][0].find((stage: any) => stage.$facet).$facet.list;
		const lookup = list.find((stage: any) => stage.$lookup?.from === 'likes').$lookup;
		expect(lookup.let.localLikeRefId).toBe('$visitedEvent._id');
		expect(lookup.let.localMemberId).toBe('m1');
		expect(result.list).toEqual([{ _id: 'e1', eventLikes: 2, meLiked }]);
	});
});
