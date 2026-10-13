import {
	assertDemoCommandAllowed,
	assertNoForeignData,
	getDemoPasswordProblem,
	readDemoPasswords,
} from './demo-guards';

const strong = 'Vq7!mR2#xLp9';
const passwords = {
	DEMO_BUYER_PASSWORD: strong,
	DEMO_ORGANIZER_PASSWORD: 'Hk4$wZ8&nTb1',
	DEMO_PENDING_ORGANIZER_PASSWORD: 'Jd6%cY3*sFa5',
	DEMO_REJECTED_ORGANIZER_PASSWORD: 'Pe2^uG9(rMq7',
};

describe('demo commands: confirmation and production guards', () => {
	const dev = { NODE_ENV: 'development', MONGO_DEV: 'x', DEMO_SEED_CONFIRM: 'MONGO_DEV' };

	it('refuses without the confirmation variable', () => {
		expect(() => assertDemoCommandAllowed({ MONGO_DEV: 'x' }, 'seed')).toThrow(/DEMO_SEED_CONFIRM=MONGO_DEV/);
		expect(() => assertDemoCommandAllowed({ MONGO_DEV: 'x' }, 'reset')).toThrow(/Refusing to reset/);
		expect(() => assertDemoCommandAllowed({ ...dev, DEMO_SEED_CONFIRM: 'true' }, 'seed')).toThrow(/Refusing/);
		expect(() => assertDemoCommandAllowed({ ...dev, DEMO_SEED_CONFIRM: '' }, 'seed')).toThrow(/Refusing/);
	});

	it('accepts the confirmation that names the database variable in use', () => {
		expect(assertDemoCommandAllowed(dev, 'seed')).toEqual({ uriKey: 'MONGO_DEV', production: false });
		expect(assertDemoCommandAllowed(dev, 'reset').uriKey).toBe('MONGO_DEV');
	});

	it('refuses in production without ALLOW_DEMO_SEED=true, even when confirmed', () => {
		const prod = { NODE_ENV: 'production', MONGO_PROD: 'x', DEMO_SEED_CONFIRM: 'MONGO_PROD' };
		expect(() => assertDemoCommandAllowed(prod, 'seed')).toThrow(/ALLOW_DEMO_SEED=true/);
		expect(() => assertDemoCommandAllowed({ ...prod, ALLOW_DEMO_SEED: 'yes' }, 'seed')).toThrow(/ALLOW_DEMO_SEED=true/);
		expect(() => assertDemoCommandAllowed({ ...prod, ALLOW_DEMO_SEED: 'true' }, 'reset')).not.toThrow();
	});

	it('does not let a development confirmation confirm a production run', () => {
		const prod = { NODE_ENV: 'production', MONGO_PROD: 'x', MONGO_DEV: 'y', ALLOW_DEMO_SEED: 'true', DEMO_SEED_CONFIRM: 'MONGO_DEV' };
		expect(() => assertDemoCommandAllowed(prod, 'seed')).toThrow(/DEMO_SEED_CONFIRM=MONGO_PROD/);
	});

	it('needs the connection string variable, and never prints a value', () => {
		expect(() => assertDemoCommandAllowed({ DEMO_SEED_CONFIRM: 'MONGO_DEV' }, 'seed')).toThrow(/MONGO_DEV is missing/);
		try {
			assertDemoCommandAllowed({ ...dev, MONGO_DEV: 'mongodb://user:secret@host/db', DEMO_SEED_CONFIRM: 'no' }, 'seed');
		} catch (err) {
			expect((err as Error).message).not.toContain('secret');
		}
	});
});

describe('demo commands: database with data the seed did not create', () => {
	const none = { members: 0, venues: 0, events: 0, orders: 0 };

	it('passes an empty or demo-only database', () => {
		expect(() => assertNoForeignData(none, {}, 'seed')).not.toThrow();
	});

	it('refuses foreign data unless the second flag is true, and says only how many', () => {
		const foreign = { ...none, members: 3, events: 2 };
		expect(() => assertNoForeignData(foreign, {}, 'seed')).toThrow(/3 members, 0 venues, 2 events, 0 orders/);
		expect(() => assertNoForeignData(foreign, { DEMO_SEED_ALLOW_NON_DEMO_DB: 'false' }, 'reset')).toThrow(/Refusing to reset/);
		expect(() => assertNoForeignData(foreign, { DEMO_SEED_ALLOW_NON_DEMO_DB: 'true' }, 'seed')).not.toThrow();
	});
});

describe('demo passwords', () => {
	it('accepts four strong passwords', () => {
		expect(readDemoPasswords(passwords)).toEqual({
			buyer: passwords.DEMO_BUYER_PASSWORD,
			organizer: passwords.DEMO_ORGANIZER_PASSWORD,
			pending: passwords.DEMO_PENDING_ORGANIZER_PASSWORD,
			rejected: passwords.DEMO_REJECTED_ORGANIZER_PASSWORD,
		});
	});

	it('lists every missing variable by name', () => {
		expect(() => readDemoPasswords({})).toThrow(/DEMO_BUYER_PASSWORD is missing.*DEMO_ORGANIZER_PASSWORD is missing.*DEMO_PENDING_ORGANIZER_PASSWORD is missing.*DEMO_REJECTED_ORGANIZER_PASSWORD is missing/);
	});

	it('rejects weak values without repeating them', () => {
		const weak = { ...passwords, DEMO_BUYER_PASSWORD: 'Demo1234!' };
		let message = '';
		try {
			readDemoPasswords(weak);
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toMatch(/DEMO_BUYER_PASSWORD/);
		expect(message).not.toContain('Demo1234!');
		expect(message).not.toContain(passwords.DEMO_ORGANIZER_PASSWORD);
	});

	it.each([
		['short', 'Ab1!xyz'],
		['one kind of character', 'abcdefghijklmnop'],
		['two kinds only', 'abcdefgh12345678'],
		['guessable word', 'MyPassword!2024xx'],
		['demo word', 'Demo-Account-77!z'],
		['repeated characters', 'Aaaaa1!bbbbb2#'],
		['too long for bcrypt', `Aa1!${'x'.repeat(80)}`],
	])('rejects %s', (_name, value) => {
		expect(getDemoPasswordProblem(value)).not.toBeNull();
	});

	it('accepts a long mixed password', () => {
		expect(getDemoPasswordProblem(strong)).toBeNull();
	});
});
