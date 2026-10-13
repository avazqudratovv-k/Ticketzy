import { CodedException } from '../../libs/coded-exception';
import { AiClientService } from './ai-client.service';
import { AiUsageService, secondsUntilUtcMidnight, utcDay } from './ai-usage.service';
import { Message } from '../../libs/enums/common.enum';

/** the one query AiUsageService makes, with MongoDB's upsert semantics: no match + existing key = duplicate key */
class FakeUsageModel {
	public docs = new Map<string, any>();
	public duplicateOnce = 0;
	public failWith: Error | null = null;
	public calls = 0;

	public findOneAndUpdate(filter: any, update: any) {
		const run = () => {
			this.calls++;
			if (this.failWith) throw this.failWith;
			const doc = this.docs.get(filter.usageKey);
			if (doc && doc.count < filter.count.$lt) {
				doc.count += update.$inc.count;
				return { ...doc };
			}
			if (doc || this.duplicateOnce > 0) {
				if (this.duplicateOnce > 0) this.duplicateOnce--;
				throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
			}
			const created = { usageKey: filter.usageKey, count: update.$inc.count, ...update.$setOnInsert };
			this.docs.set(filter.usageKey, created);
			return { ...created };
		};
		const q: any = { lean: () => q, exec: () => new Promise((resolve, reject) => { try { resolve(run()); } catch (err) { reject(err); } }) };
		return q;
	}
}

const at = (iso: string) => new Date(iso);

describe('AiUsageService (AI_DAILY_CAP counter in MongoDB)', () => {
	let model: FakeUsageModel;
	let usage: AiUsageService;
	beforeEach(() => {
		model = new FakeUsageModel();
		usage = new AiUsageService(model as any);
	});

	it('counts up to the cap and then refuses', async () => {
		const now = at('2026-10-13T10:00:00Z');
		const results = [];
		for (let i = 0; i < 4; i++) results.push(await usage.consume('global', 3, now));
		expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
		expect(results.map((r) => r.count)).toEqual([1, 2, 3, 3]);
	});

	it('starts a new counter on the next UTC day (day rollover)', async () => {
		for (let i = 0; i < 3; i++) await usage.consume('global', 3, at('2026-10-13T23:59:59Z'));
		expect((await usage.consume('global', 3, at('2026-10-13T23:59:59.999Z'))).allowed).toBe(false);
		expect(await usage.consume('global', 3, at('2026-10-14T00:00:00Z'))).toEqual({ allowed: true, count: 1 });
		expect([...model.docs.keys()].sort()).toEqual(['global:2026-10-13', 'global:2026-10-14']);
	});

	it('uses the UTC day, not the server clock zone', async () => {
		expect(utcDay(at('2026-10-13T23:30:00-05:00'))).toBe('2026-10-14');
		expect(secondsUntilUtcMidnight(at('2026-10-13T23:59:30Z'))).toBe(30);
		expect(secondsUntilUtcMidnight(at('2026-10-14T00:00:00Z'))).toBe(86400);
	});

	it('keeps one counter per key, each with a TTL date after its day', async () => {
		const now = at('2026-10-13T10:00:00Z');
		await usage.consume('key:member:1', 1, now);
		expect((await usage.consume('key:member:1', 1, now)).allowed).toBe(false);
		expect((await usage.consume('key:member:2', 1, now)).allowed).toBe(true);
		const doc = model.docs.get('key:member:1:2026-10-13');
		expect(doc.day).toBe('2026-10-13');
		expect(doc.expireAt.getTime()).toBeGreaterThan(Date.parse('2026-10-14T00:00:00Z'));
	});

	it('a cap of 0 refuses everything without touching the database', async () => {
		expect(await usage.consume('global', 0)).toEqual({ allowed: false, count: 0 });
		expect(model.calls).toBe(0);
	});

	it('two requests creating the first counter of the day at once both count', async () => {
		model.duplicateOnce = 1; // the insert of the loser fails once, the retry finds the winner's document
		model.docs.set('global:2026-10-13', { usageKey: 'global:2026-10-13', count: 1 });
		expect((await usage.consume('global', 5, at('2026-10-13T10:00:00Z'))).allowed).toBe(true);
	});

	it('passes a real database error on, so the caller can fail closed', async () => {
		model.failWith = new Error('connection lost');
		await expect(usage.consume('global', 5)).rejects.toThrow('connection lost');
	});
});

describe('AiClientService with the daily caps', () => {
	const ENV = ['AI_ENABLED', 'ANTHROPIC_API_KEY', 'AI_DAILY_CAP', 'AI_PER_KEY_DAILY_CAP', 'AI_RATE_LIMIT_PER_MINUTE'];
	let saved: Record<string, string | undefined>;
	let model: FakeUsageModel;
	beforeEach(() => {
		saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
		process.env.AI_ENABLED = 'true';
		process.env.ANTHROPIC_API_KEY = 'sk-test-key';
		process.env.AI_RATE_LIMIT_PER_MINUTE = '1000';
		model = new FakeUsageModel();
	});
	afterEach(() => {
		for (const key of ENV) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});
	const makeClient = (provider: any) => new AiClientService(() => provider, new AiUsageService(model as any));
	const okProvider = () => ({ name: 'mock', generateText: jest.fn().mockResolvedValue({ text: 'hi' }), generateJson: jest.fn(), chat: jest.fn() });

	it('refuses model calls over AI_DAILY_CAP with a friendly code, and the provider is not called (fail closed)', async () => {
		process.env.AI_DAILY_CAP = '2';
		const provider = okProvider();
		const client = makeClient(provider);
		await client.generateText({ system: 's', messages: [], maxTokens: 10 } as any);
		await client.generateText({ system: 's', messages: [], maxTokens: 10 } as any);
		const error = await client.generateText({ system: 's', messages: [], maxTokens: 10 } as any).catch((err) => err);
		expect(error).toBeInstanceOf(CodedException);
		expect(error.code).toBe('AI_DAILY_CAP_REACHED');
		expect(error.message).toBe(Message.AI_DAILY_CAP_REACHED);
		expect(provider.generateText).toHaveBeenCalledTimes(2);
	});

	it('counts a retry as a model call too', async () => {
		process.env.AI_DAILY_CAP = '1';
		const { AiProviderError } = jest.requireActual('./providers/ai-provider');
		const provider = okProvider();
		provider.generateText.mockRejectedValue(new AiProviderError('failed', 503));
		const error = await makeClient(provider).generateText({ system: 's', messages: [], maxTokens: 10 } as any).catch((err) => err);
		expect(error.code).toBe('AI_DAILY_CAP_REACHED');
		expect(provider.generateText).toHaveBeenCalledTimes(1);
	}, 10000);

	it('fails closed when the counter cannot be read', async () => {
		model.failWith = new Error('mongo down');
		const provider = okProvider();
		const error = await makeClient(provider).generateText({ system: 's', messages: [], maxTokens: 10 } as any).catch((err) => err);
		expect(error.code).toBe('SERVICE_UNAVAILABLE');
		expect(provider.generateText).not.toHaveBeenCalled();
	});

	it('limits one member or IP per day with RATE_LIMITED and the seconds until 00:00 UTC', async () => {
		process.env.AI_PER_KEY_DAILY_CAP = '2';
		const client = makeClient(okProvider());
		await client.reserve('member:1');
		await client.reserve('member:1');
		const error = await client.reserve('member:1').catch((err) => err);
		expect(error.code).toBe('RATE_LIMITED');
		expect(error.retryAfterSeconds).toBeGreaterThan(0);
		expect(error.message).toBe(Message.AI_USER_DAILY_LIMIT);
		await expect(client.reserve('member:2')).resolves.toBeDefined();
		await expect(client.reserve('ip:1.2.3.4')).resolves.toBeDefined();
	});

	it('never logs a prompt, only counts', async () => {
		process.env.AI_DAILY_CAP = '1';
		const client = makeClient(okProvider());
		const logged: string[] = [];
		const logger = (client as any).logger;
		jest.spyOn(logger, 'warn').mockImplementation((line: any) => void logged.push(String(line)));
		jest.spyOn(logger, 'error').mockImplementation((line: any) => void logged.push(String(line)));
		await client.generateText({ system: 'SECRET SYSTEM PROMPT', messages: [{ role: 'user', text: 'my private question' }], maxTokens: 10 } as any);
		await client.generateText({ system: 'SECRET SYSTEM PROMPT', messages: [{ role: 'user', text: 'my private question' }], maxTokens: 10 } as any).catch(() => undefined);
		expect(logged.join('\n')).toMatch(/1\/1 model calls/);
		expect(logged.join('\n')).not.toMatch(/SECRET SYSTEM PROMPT|private question/);
	});
});
