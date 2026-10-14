import { GenerateContentConfig, ThinkingLevel } from '@google/genai';

/**
 * Every model specific option of a Gemini request lives here, so a model is never sent an option it rejects.
 * Model names change and models come and go: run `npm run ai:check` after changing GEMINI_MODEL or
 * GEMINI_FALLBACK_MODELS, it sends a tiny request (or with `-- --full` the same requests as the real assistant) to the primary and each fallback model.
 *
 * - Gemini 3.x (and the `-latest` aliases, which point at it): thinking is set with `thinkingLevel`; `thinkingBudget`
 *   is the 2.5 way and is not sent. LOW keeps the short answers of the assistant fast and cheap.
 * - Gemini 2.5: `thinkingBudget`. 0 switches thinking off, but only Flash and Flash-Lite allow it (2.5 Pro does not).
 * - Anything else (unknown or older names): no thinking option at all.
 */
export type GeminiFamily = 'gemini-3' | 'gemini-2.5-switchable' | 'gemini-2.5-pro' | 'other';

export const getGeminiFamily = (model: string): GeminiFamily => {
	const name = model.toLowerCase().replace(/^models\//, '');
	if (/^gemini-3(\.\d+)?-/.test(name) || /^gemini-(flash|flash-lite|pro)-latest$/.test(name)) return 'gemini-3';
	if (/^gemini-2\.5-pro/.test(name)) return 'gemini-2.5-pro';
	if (/^gemini-2\.5-flash/.test(name)) return 'gemini-2.5-switchable';
	return 'other';
};

/** the options that depend on the model only (not on the request) */
export const getGeminiModelConfig = (model: string): GenerateContentConfig => {
	switch (getGeminiFamily(model)) {
		case 'gemini-3':
			return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
		case 'gemini-2.5-switchable':
			return { thinkingConfig: { thinkingBudget: 0 } };
		default:
			return {};
	}
};
