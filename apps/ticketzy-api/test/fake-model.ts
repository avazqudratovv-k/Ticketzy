import { ObjectId } from 'bson';

/**
 * A tiny in-memory stand-in for a Mongoose model, for tests that need state to carry across calls
 * (seat races, payment idempotency). Each operation runs synchronously when exec() is called, so a
 * findOneAndUpdate is atomic exactly like the real one; only the matching subset the services use is supported:
 * equality, $or, $and, $in, $nin, $ne, $gt, $gte, $lt, $lte and the $set, $unset, $inc update operators.
 */
const same = (a: any, b: any): boolean => (a === undefined || a === null ? b === undefined || b === null : String(a) === String(b));
const isObjectId = (value: any): boolean => value instanceof ObjectId;
/** ObjectIds compare by their hex string (they grow with creation order), everything else as a time */
const order = (a: any, b: any): number => {
	if (isObjectId(a) && isObjectId(b)) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
	return new Date(a).getTime() - new Date(b).getTime();
};
const time = (value: any): number => new Date(value).getTime();

const matchesCondition = (value: any, condition: any): boolean => {
	const isOperatorObject =
		condition && typeof condition === 'object' && !(condition instanceof Date) && !(condition instanceof ObjectId) &&
		Object.keys(condition).some((key) => key.startsWith('$'));
	if (!isOperatorObject) return same(value, condition);
	return Object.entries(condition).every(([op, operand]: [string, any]) => {
		switch (op) {
			case '$in':
				return operand.some((item: any) => same(value, item));
			case '$nin':
				return !operand.some((item: any) => same(value, item));
			case '$ne':
				return !same(value, operand);
			case '$gt':
				return value != null && order(value, operand) > 0;
			case '$gte':
				return value != null && order(value, operand) >= 0;
			case '$lt':
				return value != null && order(value, operand) < 0;
			case '$lte':
				return value != null && order(value, operand) <= 0;
			default:
				throw new Error(`FakeModel does not support ${op}`);
		}
	});
};

export const matches = (doc: any, filter: any): boolean =>
	Object.entries(filter ?? {}).every(([key, condition]: [string, any]) => {
		if (key === '$or') return condition.some((part: any) => matches(doc, part));
		if (key === '$and') return condition.every((part: any) => matches(doc, part));
		return matchesCondition(doc[key], condition);
	});

const applyUpdate = (doc: any, update: any): void => {
	for (const [key, value] of Object.entries(update ?? {}) as [string, any][]) {
		if (key === '$set') Object.assign(doc, value);
		else if (key === '$unset') Object.keys(value).forEach((field) => delete doc[field]);
		else if (key === '$inc') Object.entries(value).forEach(([field, by]: [string, any]) => (doc[field] = (doc[field] ?? 0) + by));
		else doc[key] = value;
	}
};

const clone = (doc: any) => (doc ? { ...doc } : doc);

export class FakeModel {
	public docs: any[];

	constructor(docs: any[] = [], private readonly defaults: Record<string, any> = {}) {
		this.docs = docs.map((doc) => ({ ...this.defaults, ...doc }));
	}

	private query<R>(run: () => R) {
		const q: any = {
			lean: () => q,
			select: () => q,
			limit: () => q,
			sort: () => q,
			exec: () => {
				try {
					return Promise.resolve(run());
				} catch (err) {
					return Promise.reject(err);
				}
			},
		};
		q.then = (resolve: any, reject: any) => q.exec().then(resolve, reject);
		return q;
	}

	public find(filter?: any) {
		let sortSpec: Record<string, number> | undefined;
		let limitTo: number | undefined;
		let skipBy = 0;
		const q = this.query(() => {
			let found = this.docs.filter((doc) => matches(doc, filter));
			if (sortSpec) {
				const [[key, direction]] = Object.entries(sortSpec);
				found = [...found].sort((a, b) => order(a[key], b[key]) * direction);
			}
			found = found.slice(skipBy);
			if (limitTo !== undefined) found = found.slice(0, limitTo);
			return found.map(clone);
		});
		q.sort = (spec: Record<string, number>) => ((sortSpec = spec), q);
		q.limit = (count: number) => ((limitTo = count), q);
		q.skip = (count: number) => ((skipBy = count), q);
		return q;
	}

	public countDocuments(filter?: any) {
		return this.query(() => this.docs.filter((doc) => matches(doc, filter)).length);
	}

	public findOne(filter?: any) {
		return this.query(() => clone(this.docs.find((doc) => matches(doc, filter))) ?? null);
	}

	public exists(filter?: any) {
		return this.query(() => {
			const doc = this.docs.find((item) => matches(item, filter));
			return doc ? { _id: doc._id } : null;
		});
	}

	public findOneAndUpdate(filter: any, update: any, options: any = {}) {
		return this.query(() => {
			const doc = this.docs.find((item) => matches(item, filter));
			if (!doc) return null;
			const before = clone(doc);
			applyUpdate(doc, update);
			return options.new ? clone(doc) : before;
		});
	}

	public updateOne(filter: any, update: any) {
		return this.query(() => {
			const doc = this.docs.find((item) => matches(item, filter));
			if (doc) applyUpdate(doc, update);
			return { modifiedCount: doc ? 1 : 0 };
		});
	}

	public updateMany(filter: any, update: any) {
		return this.query(() => {
			const targets = this.docs.filter((item) => matches(item, filter));
			targets.forEach((doc) => applyUpdate(doc, update));
			return { modifiedCount: targets.length };
		});
	}

	public deleteMany(filter: any) {
		return this.query(() => {
			const before = this.docs.length;
			this.docs = this.docs.filter((doc) => !matches(doc, filter));
			return { deletedCount: before - this.docs.length };
		});
	}

	public async create(doc: any) {
		const created = { _id: new ObjectId(), ...this.defaults, ...doc };
		this.docs.push(created);
		return clone(created);
	}

	public async insertMany(docs: any[]) {
		const created = docs.map((doc) => ({ _id: new ObjectId(), ...this.defaults, ...doc }));
		this.docs.push(...created);
		return created.map(clone);
	}
}
