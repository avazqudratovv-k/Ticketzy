import { AiProviderName } from '../../../libs/env.validation';

export { AiProviderName };

/** a tool the model may call; `parameters` is a JSON schema object */
export interface AiToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface AiToolCall {
	id: string;
	name: string;
	args: unknown;
}

export interface AiToolResult {
	callId: string;
	name: string;
	content: string;
	isError?: boolean;
}

/**
 * A provider neutral conversation. `providerState` on an assistant turn is opaque: the provider that made the turn
 * may store what it needs to replay it (for example Gemini thought signatures) and the caller only hands it back.
 */
export type AiMessage =
	| { role: 'user'; text: string }
	| { role: 'assistant'; text: string; toolCalls?: AiToolCall[]; providerState?: unknown }
	| { role: 'tool'; results: AiToolResult[] };

export interface AiTextRequest {
	system: string;
	messages: AiMessage[];
	maxTokens: number;
}

export interface AiChatRequest extends AiTextRequest {
	tools: AiToolDefinition[];
	/** 'none' forces a plain answer (the tool round limit is used up); default 'auto' */
	toolChoice?: 'auto' | 'none';
}

export interface AiTextResult {
	text: string;
	model: string;
}

/** `data` is parsed JSON that is NOT validated yet: the caller runs its strict parser on it */
export interface AiJsonResult {
	data: unknown;
	model: string;
}

export interface AiChatResult {
	text: string;
	toolCalls: AiToolCall[];
	model: string;
	/** push this into the conversation before the tool results */
	assistantMessage: Extract<AiMessage, { role: 'assistant' }>;
}

/** what went wrong, without any provider text (that can hold the key or the prompt) */
export type AiProviderErrorKind = 'timeout' | 'failed' | 'invalid_response';

export class AiProviderError extends Error {
	constructor(
		public readonly kind: AiProviderErrorKind,
		public readonly status?: number | string,
		public readonly errorType = 'Error',
	) {
		super(kind);
	}
}

/** The only thing the moderation, translation and assistant services know about a model vendor. */
export interface AiProvider {
	readonly name: AiProviderName;
	generateText(request: AiTextRequest): Promise<AiTextResult>;
	/** the answer must be one JSON value; throws AiProviderError('invalid_response') when it is not */
	generateJson(request: AiTextRequest): Promise<AiJsonResult>;
	/** one turn of a tool calling chat; the caller runs the tools and loops */
	chat(request: AiChatRequest): Promise<AiChatResult>;
}

export interface AiProviderSettings {
	apiKey: string;
	model: string;
	timeoutMs: number;
}
