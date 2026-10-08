import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.provider';
import { AiProviderError } from './ai-provider';

const settings = { apiKey: 'sk-test', model: 'claude-haiku-4-5', timeoutMs: 1000 };
const make = (create: jest.Mock) => new AnthropicProvider(settings, { messages: { create } } as any);
const reply = (content: any[]) => ({ model: 'claude-haiku-4-5', stop_reason: 'end_turn', content });

describe('AnthropicProvider', () => {
	it('generateText sends the neutral messages and joins the text blocks', async () => {
		const create = jest.fn().mockResolvedValue(reply([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]));
		const result = await make(create).generateText({ system: 'sys', messages: [{ role: 'user', text: 'hi' }], maxTokens: 50 });

		expect(result).toEqual({ text: 'a\nb', model: 'claude-haiku-4-5' });
		expect(create).toHaveBeenCalledWith({ model: 'claude-haiku-4-5', max_tokens: 50, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
	});

	it('generateJson parses a fenced answer and rejects text that is not JSON', async () => {
		const create = jest.fn().mockResolvedValueOnce(reply([{ type: 'text', text: '```json\n{"a":1}\n```' }])).mockResolvedValueOnce(reply([{ type: 'text', text: 'sure!' }]));
		const provider = make(create);
		const request = { system: 's', messages: [{ role: 'user' as const, text: 'x' }], maxTokens: 10 };
		await expect(provider.generateJson(request)).resolves.toEqual({ data: { a: 1 }, model: 'claude-haiku-4-5' });
		await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: 'invalid_response' });
	});

	it('chat maps tools, tool calls and tool results, and forces a plain answer with toolChoice none', async () => {
		const create = jest.fn().mockResolvedValue(reply([{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 't1', name: 'get_event', input: { eventId: 'e1' } }]));
		const provider = make(create);
		const tools = [{ name: 'get_event', description: 'd', parameters: { type: 'object', properties: {} } }];

		const result = await provider.chat({ system: 's', messages: [{ role: 'user', text: 'q' }], maxTokens: 10, tools, toolChoice: 'none' });

		expect(result.toolCalls).toEqual([{ id: 't1', name: 'get_event', args: { eventId: 'e1' } }]);
		expect(result.text).toBe('checking');
		const sent = create.mock.calls[0][0];
		expect(sent.tools).toEqual([{ name: 'get_event', description: 'd', input_schema: tools[0].parameters }]);
		expect(sent.tool_choice).toEqual({ type: 'none' });

		await provider.chat({
			system: 's',
			maxTokens: 10,
			tools,
			messages: [{ role: 'user', text: 'q' }, result.assistantMessage, { role: 'tool', results: [{ callId: 't1', name: 'get_event', content: '{}', isError: true }] }],
		});
		const second = create.mock.calls[1][0];
		expect(second.tool_choice).toBeUndefined();
		expect(second.messages[1]).toEqual({
			role: 'assistant',
			content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 't1', name: 'get_event', input: { eventId: 'e1' } }],
		});
		expect(second.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}', is_error: true }] });
	});

	it('turns SDK errors into AiProviderError without the SDK message', async () => {
		const failed = await make(jest.fn().mockRejectedValue(Object.assign(new Error('401 sk-test SECRET'), { status: 401 })))
			.generateText({ system: 's', messages: [], maxTokens: 1 })
			.catch((err) => err);
		expect(failed).toBeInstanceOf(AiProviderError);
		expect(failed).toMatchObject({ kind: 'failed', status: 401 });
		expect(failed.message).toBe('failed');

		const timeout = await make(jest.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError()))
			.generateText({ system: 's', messages: [], maxTokens: 1 })
			.catch((err) => err);
		expect(timeout).toMatchObject({ kind: 'timeout' });
	});
});
