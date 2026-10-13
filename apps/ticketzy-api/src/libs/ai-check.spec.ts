import { closestModels, explainStatus, runAiCheck } from './ai-check';
import { AiProviderError } from '../components/ai/providers/ai-provider';

const KEY = 'g-test-SECRET-key';
const env = (extra: Record<string, string> = {}) => ({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-2.5-flash', ...extra });
const listing = (...names: string[]) => ({
	ok: true,
	status: 200,
	json: async () => ({ models: names.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })).concat([{ name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] }]) }),
});

const run = async (environment: Record<string, any>, fetchResult: any, generate: jest.Mock) => {
	const lines: string[] = [];
	const fetchFn = jest.fn().mockImplementation(() => (fetchResult instanceof Error ? Promise.reject(fetchResult) : Promise.resolve(fetchResult)));
	const code = await runAiCheck(environment, { fetchFn, createProvider: () => ({ name: 'gemini', generateText: generate } as any), now: jest.fn().mockReturnValueOnce(1000).mockReturnValue(1250) }, (line) => lines.push(line));
	return { code, out: lines.join('\n'), fetchFn };
};

describe('ai:check', () => {
	it('passes: lists only generateContent models, marks the configured one, prints OK with the time', async () => {
		const generate = jest.fn().mockResolvedValue({ text: 'hello', model: 'm' });
		const { code, out, fetchFn } = await run(env(), listing('gemini-2.5-flash', 'gemini-2.5-pro'), generate);
		expect(code).toBe(0);
		expect(out).toContain('  gemini-2.5-flash   <-- GEMINI_MODEL');
		expect(out).toContain('  gemini-2.5-pro');
		expect(out).not.toContain('embed-1');
		expect(out).toContain('GEMINI_API_KEY: set');
		expect(out).toContain('OK in 250 ms');
		expect(out).not.toContain(KEY);
		// the key travels in a header, not in the URL
		expect(fetchFn.mock.calls[0][0]).not.toContain(KEY);
		expect(fetchFn.mock.calls[0][1].headers['x-goog-api-key']).toBe(KEY);
	});

	it('fails clearly when the model is not in the list and shows the closest IDs', async () => {
		const generate = jest.fn().mockRejectedValue(new AiProviderError('failed', 404));
		const { code, out } = await run(env({ GEMINI_MODEL: 'gemini-3.1-flash-lite' }), listing('gemini-3.1-flash-lite-preview', 'gemini-2.5-flash', 'other-model'), generate);
		expect(code).toBe(1);
		expect(out).toContain('"gemini-3.1-flash-lite" is not in the list. Closest: gemini-3.1-flash-lite-preview');
		expect(out).toContain('wrong model (404)');
	});

	it.each([
		[404, 'wrong model (404)'],
		[400, 'bad key or permission (400)'],
		[403, 'bad key or permission (403)'],
		[429, 'quota (429)'],
		[503, 'Google is busy (503)'],
		[504, 'Google is busy (504)'],
	])('reports a %s from the hello request in plain words, with exit code 1', async (status, text) => {
		const generate = jest.fn().mockRejectedValue(new AiProviderError('failed', status, 'ApiError'));
		const { code, out } = await run(env(), listing('gemini-2.5-flash'), generate);
		expect(code).toBe(1);
		expect(out).toContain(text);
		expect(out).not.toContain(KEY);
	});

	it('reports a timeout', async () => {
		const generate = jest.fn().mockRejectedValue(new AiProviderError('timeout', undefined, 'TimeoutError'));
		const { code, out } = await run(env(), listing('gemini-2.5-flash'), generate);
		expect(code).toBe(1);
		expect(out).toContain('timed out');
	});

	it('warns but still tests the model when the list call is refused', async () => {
		const generate = jest.fn().mockResolvedValue({ text: 'hi', model: 'm' });
		const { code, out } = await run(env(), { ok: false, status: 403, json: async () => ({}) }, generate);
		expect(code).toBe(0);
		expect(out).toContain('could not list the models: bad key or permission (403)');
	});

	it('fails without a key and does not call Google', async () => {
		const generate = jest.fn();
		const { code, out, fetchFn } = await run(env({ GEMINI_API_KEY: '' }), listing(), generate);
		expect(code).toBe(1);
		expect(out).toContain('GEMINI_API_KEY: NOT set');
		expect(fetchFn).not.toHaveBeenCalled();
		expect(generate).not.toHaveBeenCalled();
	});

	it('only says set / not set for the key, and warns about a fallback that is not listed', async () => {
		const generate = jest.fn().mockResolvedValue({ text: 'hi', model: 'm' });
		const { out } = await run(env({ GEMINI_FALLBACK_MODEL: 'gemini-nope' }), listing('gemini-2.5-flash'), generate);
		expect(out).toContain('WARNING: GEMINI_FALLBACK_MODEL "gemini-nope" is not in the list');
	});

	it('helpers', () => {
		expect(closestModels('gemini-3-flash', ['gpt', 'gemini-3-flash-preview', 'gemini-2-flash'], 2)).toEqual(['gemini-3-flash-preview', 'gemini-2-flash']);
		expect(explainStatus(undefined)).toContain('network');
	});
});
