/**
 * The safety rules of `seed:demo`, `reset:demo` and `check:demo` (DECISIONS #108). Pure on purpose: nothing here connects to
 * anything, so every rule is unit tested. Messages name variables and rules, never a value.
 */
import { getMongoUriKey } from './env.validation';

export const DEMO_EMAIL_DOMAIN = 'ticketzy.demo';
export const DEMO_EMAIL_PATTERN = /@ticketzy\.demo$/i;

export type DemoAction = 'seed' | 'reset';

/** must be set to the NAME of the database variable the command is meant for (MONGO_DEV or MONGO_PROD) */
export const DEMO_CONFIRM_ENV = 'DEMO_SEED_CONFIRM';
export const ALLOW_PRODUCTION_ENV = 'ALLOW_DEMO_SEED';
export const ALLOW_NON_DEMO_DB_ENV = 'DEMO_SEED_ALLOW_NON_DEMO_DB';

/** the demo accounts that can log in; the 49 other buyers and the 7 other organizers share the buyer and organizer password */
export const DEMO_PASSWORD_ENVS = {
	buyer: 'DEMO_BUYER_PASSWORD',
	organizer: 'DEMO_ORGANIZER_PASSWORD',
	pending: 'DEMO_PENDING_ORGANIZER_PASSWORD',
	rejected: 'DEMO_REJECTED_ORGANIZER_PASSWORD',
} as const;
export type DemoPasswordKey = keyof typeof DEMO_PASSWORD_ENVS;

type Env = Record<string, string | undefined>;

const isTrue = (value: string | undefined): boolean => String(value ?? '').trim().toLowerCase() === 'true';

/**
 * Checked before anything connects. In production ALLOW_DEMO_SEED=true is also needed, and in every environment
 * DEMO_SEED_CONFIRM must name the database variable in use, so a value left over from a development session cannot
 * confirm a run against production.
 */
export const assertDemoCommandAllowed = (env: Env, action: DemoAction): { uriKey: string; production: boolean } => {
	const production = env.NODE_ENV === 'production';
	if (production && !isTrue(env[ALLOW_PRODUCTION_ENV])) {
		throw new Error(`Refusing to ${action} demo data when NODE_ENV=production. Set ${ALLOW_PRODUCTION_ENV}=true if you really mean it.`);
	}
	const uriKey = getMongoUriKey(env.NODE_ENV);
	if (String(env[DEMO_CONFIRM_ENV] ?? '').trim() !== uriKey) {
		throw new Error(
			`Refusing to ${action} demo data without confirmation. Set ${DEMO_CONFIRM_ENV}=${uriKey} to confirm that you mean the database in ${uriKey}.`,
		);
	}
	if (!String(env[uriKey] ?? '').trim()) throw new Error(`${uriKey} is missing`);
	return { uriKey, production };
};

export interface ForeignDataCounts {
	members: number;
	venues: number;
	events: number;
	orders: number;
}

/** documents the demo seed did not create; ADMIN accounts are not counted (the seed reuses the existing admin) */
export const assertNoForeignData = (counts: ForeignDataCounts, env: Env, action: DemoAction): void => {
	const total = counts.members + counts.venues + counts.events + counts.orders;
	if (total === 0 || isTrue(env[ALLOW_NON_DEMO_DB_ENV])) return;
	throw new Error(
		`Refusing to ${action} demo data: this database already holds data the demo seed did not create ` +
			`(${counts.members} members, ${counts.venues} venues, ${counts.events} events, ${counts.orders} orders). ` +
			`Use an empty database, or set ${ALLOW_NON_DEMO_DB_ENV}=true to go on; only records tracked by the seed are ever removed.`,
	);
};

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores everything after 72 bytes
const GUESSABLE_FRAGMENTS = ['password', 'passwd', 'demo', 'ticketzy', 'qwerty', 'letmein', 'welcome', 'admin', 'changeme', 'iloveyou', 'test', '123456', 'abcdef', '111111'];

/** why a demo password is not accepted, or null. The text names the rule, never the value. */
export const getDemoPasswordProblem = (value: string): string | null => {
	if (value.length < MIN_PASSWORD_LENGTH) return `must be at least ${MIN_PASSWORD_LENGTH} characters`;
	if (value.length > MAX_PASSWORD_LENGTH) return `must be at most ${MAX_PASSWORD_LENGTH} characters`;
	const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
	if (classes < 3) return 'must mix at least 3 of: lower case, upper case, digits, symbols';
	const lower = value.toLowerCase();
	if (GUESSABLE_FRAGMENTS.some((fragment) => lower.includes(fragment))) return 'contains a common or guessable word';
	if (new Set(lower).size < 8 || /(.)\1{3,}/.test(value)) return 'has too few different characters';
	return null;
};

/** all four passwords from the environment; every missing or weak one is listed (by variable name) in one error */
export const readDemoPasswords = (env: Env): Record<DemoPasswordKey, string> => {
	const problems: string[] = [];
	const passwords = {} as Record<DemoPasswordKey, string>;
	for (const [key, name] of Object.entries(DEMO_PASSWORD_ENVS) as [DemoPasswordKey, string][]) {
		const value = env[name];
		if (!value) {
			problems.push(`${name} is missing`);
			continue;
		}
		const problem = getDemoPasswordProblem(value);
		if (problem) problems.push(`${name} ${problem}`);
		else passwords[key] = value;
	}
	if (problems.length) throw new Error(`Demo passwords are not usable: ${problems.join('; ')}.`);
	return passwords;
};
