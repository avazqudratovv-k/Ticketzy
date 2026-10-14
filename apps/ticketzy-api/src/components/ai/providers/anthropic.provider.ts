import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements AiProvider {
	public readonly name = 'anthropic' as const;
	private readonly client: Anthropic;

	/** `client` is only passed by tests */
	constructor(
		private readonly settings: AiProviderSettings,
		client?: Anthropic,
	) {
		this.client = client ?? new Anthropic({ apiKey: settings.apiKey, timeout: settings.timeoutMs, maxRetries: 0 });
	}

	public async generateText(request: AiTextRequest): Promise<AiTextResult> {
		const response = await this.create(request);
		return { text: this.getText(response), model: response.model ?? this.settings.model };
	}

	public async generateJson(request: AiTextRequest): Promise<AiJsonResult> {
		const { text, model } = await this.generateText(request);
		try {
			return { data: extractJson(text), model };
		} catch {
			throw new AiProviderError('invalid_response');
		}
	}

	public async chat(request: AiChatRequest): Promise<AiChatResult> {
		const response = await this.create(request, {
			tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as Anthropic.Tool.InputSchema })),
			...(request.toolChoice === 'none' ? { tool_choice: { type: 'none' as const } } : {}),
		});
		const toolCalls: AiToolCall[] = response.content
			.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
			.map((block) => ({ id: block.id, name: block.name, args: block.input }));
		const text = this.getText(response);
		return { text, toolCalls, model: response.model ?? this.settings.model, assistantMessage: { role: 'assistant', text, toolCalls } };
	}

	private async create(request: AiTextRequest, extra: Partial<Anthropic.MessageCreateParamsNonStreaming> = {}): Promise<Anthropic.Message> {
		try {
			const body: Anthropic.MessageCreateParamsNonStreaming = {
				model: this.settings.model,
				max_tokens: request.maxTokens,
				system: request.system,
				messages: request.messages.map((message) => this.toAnthropic(message)),
				...extra,
			};
			// the attempt's own timeout (shortened by the total budget) beats the client-wide one
			return await (request.timeoutMs ? this.client.messages.create(body, { timeout: request.timeoutMs }) : this.client.messages.create(body));
		} catch (err) {
			throw new AiProviderError(err instanceof Anthropic.APIConnectionTimeoutError ? 'timeout' : 'failed', err?.status, err?.constructor?.name);
		}
	}

	private toAnthropic(message: AiMessage): Anthropic.MessageParam {
		if (message.role === 'user') return { role: 'user', content: message.text };
		if (message.role === 'tool') {
			return {
				role: 'user',
				content: message.results.map((result) => ({
					type: 'tool_result' as const,
					tool_use_id: result.callId,
					content: result.content,
					...(result.isError ? { is_error: true } : {}),
				})),
			};
		}
		const blocks: Anthropic.ContentBlockParam[] = [];
		if (message.text) blocks.push({ type: 'text', text: message.text });
		for (const call of message.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
		return { role: 'assistant', content: blocks.length ? blocks : '' };
	}

	private getText(response: Anthropic.Message): string {
		return response.content
			.filter((block): block is Anthropic.TextBlock => block.type === 'text')
			.map((block) => block.text)
			.join('\n')
			.trim();
	}
}
