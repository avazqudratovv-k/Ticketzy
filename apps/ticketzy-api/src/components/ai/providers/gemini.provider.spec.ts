import { ApiError } from '@google/genai';
import { GeminiProvider } from './gemini.provider';
import { AiProviderError } from './ai-provider';

const settings = { apiKey: 'g-test', model: 'gemini-2.5-flash', timeoutMs: 1000 };
const make = (generateContent: jest.Mock) => new GeminiProvider(settings, { models: { generateContent } } as any);
const reply = (parts: any[], functionCalls?: any[]) => ({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { role: 'model', parts } }], functionCalls });

describe('GeminiProvider', () => {
	it('generateText sends system instruction, token limit and a timeout signal, and skips thought parts', async () => {
		const generateContent = jest.fn().mockResolvedValue(reply([{ text: 'thinking', thought: true }, { text: 'Hello ' }, { text: 'there' }]));
		const result = await make(generateContent).generateText({ system: 'sys', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }], maxTokens: 50 });

		expect(result).toEqual({ text: 'Hello there', model: 'gemini-2.5-flash' });
		const sent = generateContent.mock.calls[0][0];
		expect(sent.model).toBe('gemini-2.5-flash');
		expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }, { role: 'model', parts: [{ text: 'yo' }] }]);
		expect(sent.config).toMatchObject({ systemInstruction: 'sys', maxOutputTokens: 50 });
		expect(sent.config.abortSignal).toBeInstanceOf(AbortSignal);
	});

	it('generateJson asks for JSON, parses it, and rejects text that is not JSON', async () => {
		const generateContent = jest.fn().mockResolvedValueOnce(reply([{ text: '{"a":1}' }])).mockResolvedValueOnce(reply([{ text: 'sure!' }]));
		const provider = make(generateContent);
		const request = { system: 's', messages: [{ role: 'user' as const, text: 'x' }], maxTokens: 10 };
		await expect(provider.generateJson(request)).resolves.toEqual({ data: { a: 1 }, model: 'gemini-2.5-flash' });
		expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe('application/json');
		await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: 'invalid_response' });
	});

	it('chat declares functions, reads function calls, and replays the model turn with the tool results', async () => {
		const modelContent = { role: 'model', parts: [{ functionCall: { name: 'get_event', args: { eventId: 'e1' } }, thoughtSignature: 'sig' }] };
		const generateContent = jest.fn().mockResolvedValue({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: modelContent }], functionCalls: [{ name: 'get_event', args: { eventId: 'e1' } }] });
		const provider = make(generateContent);
		const tools = [{ name: 'get_event', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false } }];

		const result = await provider.chat({ system: 's', messages: [{ role: 'user', text: 'q' }], maxTokens: 10, tools });

		expect(result.toolCalls).toEqual([{ id: 'call_0', name: 'get_event', args: { eventId: 'e1' } }]);
		const first = generateContent.mock.calls[0][0].config;
		expect(first.tools).toEqual([{ functionDeclarations: [{ name: 'get_event', description: 'd', parametersJsonSchema: tools[0].parameters }] }]);
		expect(first.toolConfig.functionCallingConfig.mode).toBe('AUTO');

		generateContent.mockResolvedValue(reply([{ text: 'done' }]));
		const final = await provider.chat({
			system: 's',
			maxTokens: 10,
			tools,
			toolChoice: 'none',
			messages: [{ role: 'user', text: 'q' }, result.assistantMessage, { role: 'tool', results: [{ callId: 'call_0', name: 'get_event', content: '{"x":1}' }, { callId: 'call_1', name: 'get_event', content: 'bad', isError: true }] }],
		});

		expect(final.text).toBe('done');
		const second = generateContent.mock.calls[1][0];
		expect(second.config.toolConfig.functionCallingConfig.mode).toBe('NONE');
		expect(second.contents[1]).toBe(modelContent); // thought signature kept
		expect(second.contents[2]).toEqual({
			role: 'user',
			parts: [
				{ functionResponse: { id: undefined, name: 'get_event', response: { output: '{"x":1}' } } },
				{ functionResponse: { id: undefined, name: 'get_event', response: { error: 'bad' } } },
			],
		});
	});

	it('turns SDK errors into AiProviderError without the SDK message', async () => {
		const failed = await make(jest.fn().mockRejectedValue(new ApiError({ message: 'API key g-test SECRET', status: 429 })))
			.generateText({ system: 's', messages: [], maxTokens: 1 })
			.catch((err) => err);
		expect(failed).toBeInstanceOf(AiProviderError);
		expect(failed).toMatchObject({ kind: 'failed', status: 429 });
		expect(failed.message).toBe('failed');

		const timeout = await make(jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'TimeoutError' })))
			.generateText({ system: 's', messages: [], maxTokens: 1 })
			.catch((err) => err);
		expect(timeout).toMatchObject({ kind: 'timeout' });
	});

	describe('per-model config and errors', () => {
		const request = { system: 's', messages: [{ role: 'user' as const, text: 'hi' }], maxTokens: 10 };
		const sentConfig = async (model: string) => {
			const generateContent = jest.fn().mockResolvedValue(reply([{ text: 'ok' }]));
			await new GeminiProvider({ ...settings, model }, { models: { generateContent } } as any).generateText(request);
			return generateContent.mock.calls[0][0].config;
		};

		it('sends thinkingLevel (never thinkingBudget) to Gemini 3 models and the -latest aliases', async () => {
			for (const model of ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest']) {
				const config = await sentConfig(model);
				expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
			}
		});

		it('sends thinkingBudget 0 to 2.5 Flash, nothing to 2.5 Pro or unknown models', async () => {
			expect((await sentConfig('gemini-2.5-flash')).thinkingConfig).toEqual({ thinkingBudget: 0 });
			expect((await sentConfig('gemini-2.5-pro')).thinkingConfig).toBeUndefined();
			expect((await sentConfig('some-other-model')).thinkingConfig).toBeUndefined();
		});

		it('keeps tools and the guardrail system prompt for every model', async () => {
			const generateContent = jest.fn().mockResolvedValue(reply([{ text: 'ok' }]));
			const provider = new GeminiProvider({ ...settings, model: 'gemini-3.1-flash-lite' }, { models: { generateContent } } as any);
			await provider.chat({ ...request, tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }] });
			const config = generateContent.mock.calls[0][0].config;
			expect(config.systemInstruction).toBe('s');
			expect(config.tools[0].functionDeclarations).toHaveLength(1);
		});

		it('keeps the sanitized vendor reason on the error: no key, no long quoted text, 300 characters at most', async () => {
			const body = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: `bad key g-test and AIzaSyA1234567890abcdefghijkl "${'secret prompt words '.repeat(5)}" ${'x'.repeat(400)}` } });
			const generateContent = jest.fn().mockRejectedValue(new ApiError({ message: body, status: 400 }));
			const error = await make(generateContent).generateText(request).catch((e) => e);
			expect(error).toBeInstanceOf(AiProviderError);
			expect(error.status).toBe(400);
			expect(error.reason.startsWith('INVALID_ARGUMENT: bad key [redacted] and [redacted]')).toBe(true);
			expect(error.reason).not.toMatch(/g-test|AIza|secret prompt/);
			expect(error.reason.length).toBeLessThanOrEqual(300);
		});
	});
});
