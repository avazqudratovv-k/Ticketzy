import { AiConfig } from '../../../libs/env.validation';
import { AiProvider } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';

/** Injection token: a function that builds the provider of the current settings (tests replace it with a mock). */
export const AI_PROVIDER_FACTORY = 'AI_PROVIDER_FACTORY';
export type AiProviderFactory = (config: AiConfig) => AiProvider;

export const createAiProvider: AiProviderFactory = (config) => {
	const settings = { apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs };
	return config.provider === 'gemini' ? new GeminiProvider(settings) : new AnthropicProvider(settings);
};
