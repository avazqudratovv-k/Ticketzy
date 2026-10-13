/**
 * Failures of the demo seed name the scenario that failed (DECISIONS #109): "event 46/56 harbor-04-derby4 > refunds >
 * refund 2/3 (buyer): The refund deadline of this order has passed!". Only names, indexes and the safe service message
 * are printed; database addresses and anything that looks like a secret are scrubbed.
 */

const DB_ADDRESS = /mongodb(?:\+srv)?:\/\/\S+/gi;
const SECRET_PAIR = /\b(password|passwd|secret|token|api[_-]?key|authorization)\b\s*[=:]\s*\S+/gi;
const MAX_REASON = 300;

export const scrubFailureText = (text: string): string =>
	text.replace(DB_ADDRESS, '[database address]').replace(SECRET_PAIR, '$1=[hidden]').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);

const reasonOf = (err: unknown): string => scrubFailureText(String((err as { message?: unknown })?.message ?? err ?? 'unknown error'));

export class DemoSeedError extends Error {
	constructor(
		public readonly path: string[],
		public readonly reason: string,
	) {
		super(`${path.join(' > ')}: ${reason}`);
		this.name = 'DemoSeedError';
	}
}

/** runs `work`; a failure comes out as a DemoSeedError whose path starts with `label` (outer labels are put in front) */
export const withScenario = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
	try {
		return await work();
	} catch (err) {
		if (err instanceof DemoSeedError) throw new DemoSeedError([label, ...err.path], err.reason);
		throw new DemoSeedError([label], reasonOf(err));
	}
};
