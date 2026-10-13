import { DemoSeedError, scrubFailureText, withScenario } from './demo-errors';

describe('demo seed failures name the scenario', () => {
	it('puts the scenario path in front of the reason', async () => {
		const failing = () =>
			withScenario('event 46/56 harbor-04-derby4 (APPROVED)', () =>
				withScenario('sales', () => withScenario('refund 2/3 (buyer)', async () => Promise.reject(new Error('The refund deadline of this order has passed!')))),
			);
		await expect(failing()).rejects.toThrow('event 46/56 harbor-04-derby4 (APPROVED) > sales > refund 2/3 (buyer): The refund deadline of this order has passed!');
	});

	it('keeps one error and its path, however many scenarios wrap it', async () => {
		const err = await withScenario('a', () => withScenario('b', async () => Promise.reject(new Error('boom')))).catch((e) => e);
		expect(err).toBeInstanceOf(DemoSeedError);
		expect(err.path).toEqual(['a', 'b']);
		expect(err.reason).toBe('boom');
	});

	it('returns the value when nothing fails', async () => {
		await expect(withScenario('ok', async () => 7)).resolves.toBe(7);
	});

	it('does not print database addresses, secrets or long texts', () => {
		const text = scrubFailureText('connect to mongodb+srv://user:pw@cluster0.example.net/db?x=1 failed, token=abc123 password: hunter2');
		expect(text).not.toMatch(/user:pw|cluster0|abc123|hunter2/);
		expect(text).toContain('[database address]');
		expect(scrubFailureText('x'.repeat(2000)).length).toBeLessThanOrEqual(300);
	});

	it('handles a thrown value that is not an Error', async () => {
		await expect(withScenario('s', async () => Promise.reject('plain text'))).rejects.toThrow('s: plain text');
	});
});
