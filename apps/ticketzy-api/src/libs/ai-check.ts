import { AiConfig, getAiConfig } from './env.validation';
import { AiMessage, AiProvider, AiProviderError } from '../components/ai/providers/ai-provider';
import { ASSISTANT_MAX_TOKENS, buildAssistantSystemPrompt } from '../components/ai/ai-assistant.service';
import { ASSISTANT_TOOLS } from '../components/ai/ai-tools.service';
import { MODERATION_SYSTEM_PROMPT } from '../components/ai/ai-moderation.service';
import { EventLocale } from './enums/event.enum';
import { AiProviderFactory } from '../components/ai/providers/create-ai-provider';

export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const MAX_LIST_PAGES = 10;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** a plain-words reason for an HTTP status or a timeout; never contains vendor text (it can echo the key) */
export const explainStatus = (status: number | string | undefined, timedOut = false): string => {
	const code = Number(status);
	if (timedOut) return 'the request timed out (Google did not answer in time, try again or raise AI_TIMEOUT_MS)';
	if (code === 404) return 'wrong model (404): Google does not know this model name, pick one from the list above';
	if (code === 400) return 'request refused (400): Google rejected the request itself (an option this model does not accept, or a bad key), see the reason';
	if (code === 401 || code === 403) return `bad key or permission (${code}): the API key is wrong, expired, restricted or has no access to this model`;
	if (code === 429) return 'quota (429): too many requests or the free quota is used up, wait or check your Google AI plan';
	if (code === 503 || code === 504) return `Google is busy (${code}): the model is overloaded, try again in a moment`;
	return status === undefined ? 'could not reach Google (network problem)' : `unexpected answer from Google (${status})`;
};

/** model IDs that support generateContent, without the "models/" prefix */
export const listGeminiModels = async (apiKey: string, timeoutMs: number, fetchFn: FetchLike): Promise<string[]> => {
	const ids: string[] = [];
	let pageToken = '';
	for (let page = 0; page < MAX_LIST_PAGES; page++) {
		const url = pageToken ? `${GEMINI_MODELS_URL}&pageToken=${encodeURIComponent(pageToken)}` : GEMINI_MODELS_URL;
		// the key goes in a header, never in the URL
		const response = await fetchFn(url, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(timeoutMs) });
		if (!response.ok) throw new AiProviderError('failed', response.status);
		const body = await response.json();
		for (const model of body?.models ?? []) {
			if (Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent')) {
				ids.push(String(model.name).replace(/^models\//, ''));
			}
		}
		pageToken = body?.nextPageToken ?? '';
		if (!pageToken) break;
	}
	return ids.sort();
};

const distance = (a: string, b: string): number => {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = row[j];
			row[j] = next;
		}
	}
	return row[b.length];
};

/** the IDs nearest to the wanted name: a name that contains it (or is contained) first, then by edit distance */
export const closestModels = (wanted: string, ids: string[], count = 5): string[] => {
	const score = (id: string) => (id.includes(wanted) || wanted.includes(id) ? 0 : 1) * 1000 + distance(wanted, id);
	return [...ids].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, count);
};

export interface AiCheckDeps {
	fetchFn: FetchLike;
	createProvider: AiProviderFactory;
	now?: () => number;
}

/** runs the whole check, printing line by line; returns the process exit code (0 ok, 1 failed). No secret is printed. */
export const runAiCheck = async (env: Record<string, any>, deps: AiCheckDeps, print: (line: string) => void): Promise<number> => {
	const now = deps.now ?? Date.now;
	let config: AiConfig;
	try {
		config = getAiConfig(env);
	} catch (err) {
		print(`FAILED: the AI settings are not valid: ${(err as Error).message}`);
		return 1;
	}
	const isGemini = config.provider === 'gemini';
	const modelVar = isGemini ? 'GEMINI_MODEL' : 'ANTHROPIC_MODEL';
	const keyVar = isGemini ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
	print(`AI_PROVIDER: ${String(env.AI_PROVIDER ?? '').trim() ? config.provider : `not set (default ${config.provider})`}`);
	print(`AI_ENABLED: ${config.enabled ? 'true' : 'false (the app keeps the AI off, this check still runs)'}`);
	print(`${keyVar}: ${config.apiKey ? 'set' : 'NOT set'}`);
	print(`${modelVar}: ${String(env[modelVar] ?? '').trim() ? config.model : `not set (default ${config.model})`}`);
	if (isGemini) print(`GEMINI_FALLBACK_MODEL: ${config.fallbackModel || 'not set (no fallback)'}`);
	print(`AI_TIMEOUT_MS: ${config.timeoutMs}`);
	if (!config.apiKey) {
		print(`FAILED: ${keyVar} is not set. Add it to .env and run this again.`);
		return 1;
	}

	let failed = false;
	if (isGemini) {
		print('');
		print('Models that support generateContent:');
		try {
			const ids = await listGeminiModels(config.apiKey, config.timeoutMs, deps.fetchFn);
			for (const id of ids) print(`  ${id}${id === config.model ? '   <-- GEMINI_MODEL' : ''}${config.fallbackModel && id === config.fallbackModel ? '   <-- GEMINI_FALLBACK_MODEL' : ''}`);
			if (!ids.length) print('  (none listed)');
			if (!ids.includes(config.model)) {
				failed = true;
				print(`PROBLEM: GEMINI_MODEL "${config.model}" is not in the list. Closest: ${closestModels(config.model, ids).join(', ') || 'none'}`);
			}
			if (config.fallbackModel && !ids.includes(config.fallbackModel)) {
				print(`WARNING: GEMINI_FALLBACK_MODEL "${config.fallbackModel}" is not in the list. Closest: ${closestModels(config.fallbackModel, ids).join(', ') || 'none'}`);
			}
		} catch (err) {
			const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
			const status = err instanceof AiProviderError ? err.status : undefined;
			print(`WARNING: could not list the models: ${explainStatus(status, timedOut)}`);
		}
	}

	const checks: [string, AiConfig][] = [['primary', config]];
	if (config.fallbackModel) checks.push(['fallback', { ...config, model: config.fallbackModel }]);
	for (const [role, modelConfig] of checks) {
		print('');
		print(`Checking the ${role} model ${modelConfig.model}:`);
		if (!(await checkModel(modelConfig, deps, print))) failed = true;
	}
	if (!config.fallbackModel && isGemini) print('\nNo fallback model is set, so only the primary model was checked.');
	return failed ? 1 : 0;
};

/** one line per request: `  label: OK in 250 ms` or `  label: FAILED after 250 ms: plain words [Google said: sanitized reason]` */
const timed = async (label: string, now: () => number, print: (line: string) => void, run: () => Promise<void>): Promise<boolean> => {
	const started = now();
	try {
		await run();
		print(`  ${label}: OK in ${now() - started} ms`);
		return true;
	} catch (err) {
		const status = err instanceof AiProviderError ? err.status : undefined;
		const timedOut = err instanceof AiProviderError && err.kind === 'timeout';
		const invalid = err instanceof AiProviderError && err.kind === 'invalid_response';
		const reason = err instanceof AiProviderError && err.reason ? ` [Google said: ${err.reason}]` : '';
		print(`  ${label}: FAILED after ${now() - started} ms: ${invalid ? 'the answer was not valid JSON' : explainStatus(status, timedOut)}${reason}`);
		return false;
	}
};

/**
 * Three requests built like the real ones, with fake data and the real system prompts, tools and limits:
 * a tiny hello, the assistant (system prompt + function declarations, then a fake tool result and a final turn without
 * tools) and the moderation style JSON answer. Nothing from the database or a member is sent.
 */
const checkModel = async (config: AiConfig, deps: AiCheckDeps, print: (line: string) => void): Promise<boolean> => {
	const now = deps.now ?? Date.now;
	const provider: AiProvider = deps.createProvider(config);
	let ok = true;
	ok = (await timed('tiny request', now, print, async () => void (await provider.generateText({ system: 'You are a friendly assistant.', messages: [{ role: 'user', text: 'Say hello' }], maxTokens: 64 })))) && ok;
	ok = (await timed('assistant request (system prompt, tools, tool result)', now, print, async () => {
		const system = buildAssistantSystemPrompt(EventLocale.EN);
		const messages: AiMessage[] = [{ role: 'user', text: 'What is your refund policy?' }];
		const first = await provider.chat({ system, messages, maxTokens: ASSISTANT_MAX_TOKENS, tools: ASSISTANT_TOOLS, toolChoice: 'auto' });
		if (!first.toolCalls.length) return;
		messages.push(first.assistantMessage, {
			role: 'tool',
			results: first.toolCalls.map((call) => ({ callId: call.id, name: call.name, content: JSON.stringify({ note: 'Refunds are possible until the day before the event.' }) })),
		});
		await provider.chat({ system, messages, maxTokens: ASSISTANT_MAX_TOKENS, tools: ASSISTANT_TOOLS, toolChoice: 'none' });
	})) && ok;
	ok = (await timed('moderation request (JSON answer)', now, print, async () => {
		const event = { title: 'Check concert', description: 'A fake event used only by the AI check.', ticketTypes: [{ name: 'General', price: 30000 }], otherEventTitles: [] };
		await provider.generateJson({ system: MODERATION_SYSTEM_PROMPT, messages: [{ role: 'user', text: JSON.stringify(event) }], maxTokens: 800 });
	})) && ok;
	return ok;
};
