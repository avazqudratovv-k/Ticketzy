import { AiConfig, getAiConfig } from './env.validation';
import { AiProviderError } from '../components/ai/providers/ai-provider';
import { AiProviderFactory } from '../components/ai/providers/create-ai-provider';

export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const MAX_LIST_PAGES = 10;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** a plain-words reason for an HTTP status or a timeout; never contains vendor text (it can echo the key) */
export const explainStatus = (status: number | string | undefined, timedOut = false): string => {
	const code = Number(status);
	if (timedOut) return 'the request timed out (Google did not answer in time, try again or raise AI_TIMEOUT_MS)';
	if (code === 404) return 'wrong model (404): Google does not know this model name, pick one from the list above';
	if (code === 400 || code === 401 || code === 403) return `bad key or permission (${code}): the API key is wrong, expired, restricted or has no access to this model`;
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

	print('');
	print(`Sending one tiny request to ${config.model} ...`);
	const started = now();
	try {
		await deps.createProvider(config).generateText({ system: 'You are a friendly assistant.', messages: [{ role: 'user', text: 'Say hello' }], maxTokens: 64 });
		print(`OK in ${now() - started} ms`);
	} catch (err) {
		failed = true;
		const status = err instanceof AiProviderError ? err.status : undefined;
		print(`FAILED after ${now() - started} ms: ${explainStatus(status, err instanceof AiProviderError && err.kind === 'timeout')}`);
	}
	return failed ? 1 : 0;
};
