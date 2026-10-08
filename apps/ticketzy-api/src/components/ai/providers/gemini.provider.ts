import { ApiError, Content, FunctionCallingConfigMode, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, Part } from '@google/genai';
import { extractJson } from '../../../libs/ai';
import {
	AiChatRequest,
	AiChatResult,
	AiJsonResult,
	AiMessage,
	AiProvider,
	AiProviderError,
	AiProviderSettings,
	AiTextRequest,
	AiTextResult,
	AiToolCall,
} from './ai-provider';

/** Gemini through the official Google GenAI SDK, with function calling for the assistant. */
export class GeminiProvider implements AiProvider {
	public readonly name = 'gemini' as const;
	private readonly client: GoogleGenAI;

	/** `client` is only passed by tests */
	constructor(
		private readonly settings: AiProviderSettings,
		client?: GoogleGenAI,
	) {
		this.client = client ?? new GoogleGenAI({ apiKey: settings.apiKey, httpOptions: { timeout: settings.timeoutMs } });
	}

	public async generateText(request: AiTextRequest): Promise<AiTextResult> {
		const response = await this.generate(request, {});
		return { text: this.getText(response), model: response.modelVersion ?? this.settings.model };
	}

	public async generateJson(request: AiTextRequest): Promise<AiJsonResult> {
		const response = await this.generate(request, { responseMimeType: 'application/json' });
		try {
			return { data: extractJson(this.getText(response)), model: response.modelVersion ?? this.settings.model };
		} catch {
			throw new AiProviderError('invalid_response');
		}
	}

	public async chat(request: AiChatRequest): Promise<AiChatResult> {
		const response = await this.generate(request, {
			tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
			toolConfig: { functionCallingConfig: { mode: request.toolChoice === 'none' ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
		});
		const content = response.candidates?.[0]?.content;
		const toolCalls: AiToolCall[] = (response.functionCalls ?? []).map((call, index) => ({
			id: call.id || `call_${index}`,
			name: call.name ?? '',
			args: call.args ?? {},
		}));
		const text = this.getText(response);
		// the model's own parts go back unchanged on the next round (Gemini 3 needs the thought signatures)
		return { text, toolCalls, model: response.modelVersion ?? this.settings.model, assistantMessage: { role: 'assistant', text, toolCalls, providerState: content } };
	}

	private async generate(request: AiTextRequest, extra: GenerateContentConfig): Promise<GenerateContentResponse> {
		try {
			return await this.client.models.generateContent({
				model: this.settings.model,
				contents: this.toContents(request.messages),
				config: {
					systemInstruction: request.system,
					maxOutputTokens: request.maxTokens,
					abortSignal: AbortSignal.timeout(this.settings.timeoutMs),
					...extra,
				},
			});
		} catch (err) {
			const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
			throw new AiProviderError(timedOut ? 'timeout' : 'failed', err instanceof ApiError ? err.status : undefined, err?.constructor?.name);
		}
	}

	private toContents(messages: AiMessage[]): Content[] {
		return messages.map((message): Content => {
			if (message.role === 'user') return { role: 'user', parts: [{ text: message.text }] };
			if (message.role === 'tool') {
				return {
					role: 'user',
					parts: message.results.map(
						(result): Part => ({
							functionResponse: {
								id: result.callId.startsWith('call_') ? undefined : result.callId,
								name: result.name,
								response: result.isError ? { error: result.content } : { output: result.content },
							},
						}),
					),
				};
			}
			const replay = message.providerState as Content | undefined;
			if (replay?.parts?.length) return replay;
			const parts: Part[] = [];
			if (message.text) parts.push({ text: message.text });
			for (const call of message.toolCalls ?? []) parts.push({ functionCall: { id: call.id.startsWith('call_') ? undefined : call.id, name: call.name, args: call.args as Record<string, unknown> } });
			return { role: 'model', parts: parts.length ? parts : [{ text: '' }] };
		});
	}

	/** the text parts only (not thoughts), joined */
	private getText(response: GenerateContentResponse): string {
		return (response.candidates?.[0]?.content?.parts ?? [])
			.filter((part) => typeof part.text === 'string' && !part.thought)
			.map((part) => part.text)
			.join('')
			.trim();
	}
}
