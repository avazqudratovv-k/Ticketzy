import { IndexCollection, IndexInfo, planMemberIndexMigration, runMemberIndexMigration } from './member-index-migration';

const OLD_EMAIL: IndexInfo = { name: 'memberEmail_1', key: { memberEmail: 1 }, unique: true };
const OLD_PHONE: IndexInfo = { name: 'memberPhone_1', key: { memberPhone: 1 }, unique: true, sparse: true };
const ID: IndexInfo = { name: '_id_', key: { _id: 1 } };
const NICK: IndexInfo = { name: 'memberNick_1', key: { memberNick: 1 }, unique: true, sparse: true };
const NEW_EMAIL: IndexInfo = { name: 'memberEmail_1_deletedAt_1', key: { memberEmail: 1, deletedAt: 1 }, unique: true };
const NEW_PHONE: IndexInfo = { name: 'memberPhone_1_deletedAt_1', key: { memberPhone: 1, deletedAt: 1 }, unique: true, sparse: true };

/** a fake collection that records every call; it holds indexes only, so "no document is touched" is true by construction */
const fakeCollection = (existing: IndexInfo[], failOn?: string) => {
	const calls: string[] = [];
	const collection: IndexCollection = {
		indexes: async () => existing,
		createIndex: async (key, options) => {
			calls.push(`create ${options.name}`);
			if (failOn === options.name) throw new Error('E11000 duplicate key');
			return options.name;
		},
		dropIndex: async (name) => {
			calls.push(`drop ${name}`);
		},
	};
	return { collection, calls };
};

describe('member index migration (DECISIONS #123)', () => {
	it('plans the creation of both new indexes first and the drop of both old ones after', () => {
		const steps = planMemberIndexMigration([ID, OLD_EMAIL, OLD_PHONE, NICK]);
		expect(steps.map((step) => `${step.action} ${step.name}`)).toEqual([
			'create memberEmail_1_deletedAt_1',
			'create memberPhone_1_deletedAt_1',
			'drop memberEmail_1',
			'drop memberPhone_1',
		]);
	});

	it('a dry run changes nothing', async () => {
		const { collection, calls } = fakeCollection([ID, OLD_EMAIL, OLD_PHONE]);
		const steps = await runMemberIndexMigration(collection, { apply: false });
		expect(steps).toHaveLength(4);
		expect(calls).toEqual([]);
	});

	it('apply creates before it drops, and never touches the nick or _id indexes', async () => {
		const { collection, calls } = fakeCollection([ID, OLD_EMAIL, OLD_PHONE, NICK]);
		await runMemberIndexMigration(collection, { apply: true });
		expect(calls).toEqual(['create memberEmail_1_deletedAt_1', 'create memberPhone_1_deletedAt_1', 'drop memberEmail_1', 'drop memberPhone_1']);
	});

	it('drops nothing when a creation fails, so the old uniqueness stays', async () => {
		const { collection, calls } = fakeCollection([ID, OLD_EMAIL, OLD_PHONE], 'memberPhone_1_deletedAt_1');
		await expect(runMemberIndexMigration(collection, { apply: true })).rejects.toThrow('E11000');
		expect(calls.filter((call) => call.startsWith('drop'))).toEqual([]);
	});

	it('running it again changes nothing', async () => {
		const { collection, calls } = fakeCollection([ID, NEW_EMAIL, NEW_PHONE, NICK]);
		const steps = await runMemberIndexMigration(collection, { apply: true });
		expect(steps.every((step) => step.action === 'keep')).toBe(true);
		expect(calls).toEqual([]);
	});

	it('finishes a half-done run: new indexes there, old ones still to drop', async () => {
		const { collection, calls } = fakeCollection([ID, NEW_EMAIL, NEW_PHONE, OLD_EMAIL, OLD_PHONE]);
		await runMemberIndexMigration(collection, { apply: true });
		expect(calls).toEqual(['drop memberEmail_1', 'drop memberPhone_1']);
	});

	it('works when only the email had a unique index (no phone index yet)', async () => {
		const steps = planMemberIndexMigration([ID, OLD_EMAIL]);
		expect(steps.map((step) => `${step.action} ${step.name}`)).toEqual([
			'create memberEmail_1_deletedAt_1',
			'create memberPhone_1_deletedAt_1',
			'drop memberEmail_1',
		]);
	});

	it('does not drop an index on the same field that is not the old plain unique one', () => {
		const partial: IndexInfo = { name: 'custom', key: { memberEmail: 1 }, unique: true, partialFilterExpression: { memberStatus: 'ACTIVE' } };
		const nonUnique: IndexInfo = { name: 'lookup', key: { memberEmail: 1 } };
		expect(planMemberIndexMigration([ID, partial, nonUnique]).filter((step) => step.action === 'drop')).toEqual([]);
	});

	it('refuses to go on when a new-named index exists with other options', () => {
		expect(() => planMemberIndexMigration([{ ...NEW_EMAIL, unique: false }])).toThrow('other options');
	});

	it('a missing collection (code 26) is an empty database: both new indexes are planned, nothing to drop', async () => {
		const collection: IndexCollection = {
			indexes: async () => {
				throw Object.assign(new Error('ns does not exist'), { code: 26 });
			},
			createIndex: async (_key, options) => options.name,
			dropIndex: async () => undefined,
		};
		const steps = await runMemberIndexMigration(collection, { apply: false });
		expect(steps.map((step) => step.action)).toEqual(['create', 'create']);
	});

	it('other errors while reading the indexes stop the run', async () => {
		const collection: IndexCollection = { indexes: async () => Promise.reject(new Error('auth failed')), createIndex: jest.fn(), dropIndex: jest.fn() };
		await expect(runMemberIndexMigration(collection, { apply: true })).rejects.toThrow('auth failed');
	});
});
