import { MEMBER_EMAIL_INDEX, MEMBER_PHONE_INDEX, MemberIndexSpec } from './member-indexes';

/**
 * One-off replacement of the unique indexes on `members` (DECISIONS #123): the old single-field unique indexes on
 * `memberEmail` and `memberPhone` become the compound ones that also hold `deletedAt`. Only indexes are touched, never a
 * document. The new indexes are created first and the old ones dropped only after every creation worked, so there is no
 * moment without a uniqueness guarantee. Running it twice changes nothing the second time.
 */
export interface IndexInfo {
	name: string;
	key: Record<string, number>;
	unique?: boolean;
	sparse?: boolean;
	partialFilterExpression?: unknown;
}

/** the part of a MongoDB collection this needs, so a test can use a fake */
export interface IndexCollection {
	indexes(): Promise<IndexInfo[]>;
	createIndex(key: Record<string, 1>, options: { name: string; unique: true; sparse?: true }): Promise<string>;
	dropIndex(name: string): Promise<unknown>;
}

export interface MigrationStep {
	action: 'create' | 'drop' | 'keep';
	name: string;
	note: string;
}

const sameKey = (left: Record<string, number>, right: Record<string, number>): boolean => {
	const a = Object.entries(left);
	const b = Object.entries(right);
	return a.length === b.length && a.every(([field, direction], position) => b[position][0] === field && b[position][1] === direction);
};

/** a plain index on the one field, which is what Mongoose built from `index: { unique: true }` */
const findOldIndex = (existing: IndexInfo[], field: 'memberEmail' | 'memberPhone'): IndexInfo | undefined =>
	existing.find((index) => sameKey(index.key, { [field]: 1 }) && index.unique === true && !index.partialFilterExpression);

/** pure: what has to happen, in order (creations first). Throws when an index with a new name exists but is not what we expect. */
export const planMemberIndexMigration = (existing: IndexInfo[]): MigrationStep[] => {
	const creates: MigrationStep[] = [];
	const drops: MigrationStep[] = [];

	const plan = (spec: MemberIndexSpec, field: 'memberEmail' | 'memberPhone') => {
		const current = existing.find((index) => index.name === spec.name);
		if (current) {
			const matches = sameKey(current.key, spec.key) && current.unique === true && Boolean(current.sparse) === Boolean(spec.sparse);
			if (!matches) throw new Error(`Index ${spec.name} exists with other options; nothing was changed. Check it by hand.`);
			creates.push({ action: 'keep', name: spec.name, note: 'already in place' });
		} else {
			creates.push({ action: 'create', name: spec.name, note: `unique on ${Object.keys(spec.key).join(' + ')}${spec.sparse ? ' (sparse)' : ''}` });
		}
		const old = findOldIndex(existing, field);
		if (old) drops.push({ action: 'drop', name: old.name, note: `old unique index on ${field} alone` });
	};
	plan(MEMBER_EMAIL_INDEX, 'memberEmail');
	plan(MEMBER_PHONE_INDEX, 'memberPhone');
	return [...creates, ...drops];
};

const specOf = (name: string): MemberIndexSpec => [MEMBER_EMAIL_INDEX, MEMBER_PHONE_INDEX].find((spec) => spec.name === name)!;

/** reads the indexes, plans, and (only with `apply`) runs the plan. Returns the plan either way. */
export const runMemberIndexMigration = async (collection: IndexCollection, options: { apply: boolean }): Promise<MigrationStep[]> => {
	let existing: IndexInfo[] = [];
	try {
		existing = await collection.indexes();
	} catch (err: any) {
		// code 26: the collection does not exist yet; the application builds the new indexes when it first starts
		if (err?.code !== 26) throw err;
	}
	const steps = planMemberIndexMigration(existing);
	if (!options.apply) return steps;

	for (const step of steps.filter((item) => item.action === 'create')) {
		const spec = specOf(step.name);
		await collection.createIndex(spec.key, { name: spec.name, unique: true, ...(spec.sparse ? { sparse: true as const } : {}) });
	}
	for (const step of steps.filter((item) => item.action === 'drop')) await collection.dropIndex(step.name);
	return steps;
};
