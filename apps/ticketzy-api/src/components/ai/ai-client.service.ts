import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Message } from '../../libs/enums/common.enum';
import { RateLimiter } from '../../libs/rate-limiter';
import { AiConfig, getAiConfig } from '../../libs/env.validation';

export interface AiCompleteParams {
	system: string;
	messages: Anthropic.MessageParam[];
	maxTokens: number;
	tools?: Anthropic.Tool[];
	toolChoice?: Anthropic.ToolChoice;
}

/**
 * The only place that talks to the Anthropic API (the browser never does).
 * Everything is read at call time, so a missing key or AI_ENABLED=false only turns the AI operations off:
 * they answer with a clear message and the rest of the app keeps working. The key and the prompts are never logged.
 */
@Injectable()
export class AiClientService {
	private readonly logger = new Logger(AiClientService.name);
	private client: Anthropic | null = null;
	private clientKey = '';
	private limiter: RateLimiter | null = null;
	private limiterSize = 0;

	public getConfig(): AiConfig {
		return getAiConfig();
	}

	/** true when the AI operations can run */
	public isAvailable(): boolean {
		const config = this.getConfig();
		return config.enabled && !!config.apiKey;
	}

	/** throws a clear message when AI is off or has no key */
	public assertAvailable(): AiConfig {
		const config = this.getConfig();
		if (!config.enabled) throw new ServiceUnavailableException(Message.AI_DISABLED);
		if (!config.apiKey) throw new ServiceUnavailableException(Message.AI_NOT_CONFIGURED);
		return config;
	}

	/**
	 * Call once per AI operation (not per model call). `key` is the member id, or the caller's IP for a visitor.
	 * The limit is kept in this process' memory like the other limiters (no Redis in this project).
	 */
	public begin(key: string): AiConfig {
		const config = this.assertAvailable();
		if (!this.limiter || this.limiterSize !== config.rateLimitPerMinute) {
			this.limiter = new RateLimiter(config.rateLimitPerMinute, 60_000);
			this.limiterSize = config.rateLimitPerMinute;
		}
		if (!this.limiter.tryConsume(key)) throw new HttpException(Message.AI_RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
		return config;
	}

	/** one model call; every failure becomes a clear Message, with only the error type and status in the log */
	public async complete(params: AiCompleteParams): Promise<Anthropic.Message> {
		const config = this.assertAvailable();
		try {
			return await this.getClient(config).messages.create({
				model: config.model,
				max_tokens: params.maxTokens,
				system: params.system,
				messages: params.messages,
				...(params.tools ? { tools: params.tools } : {}),
				...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
			});
		} catch (err) {
			this.logger.error(`AI request failed: ${err?.constructor?.name ?? 'Error'} status=${err?.status ?? 'none'}`);
			if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ServiceUnavailableException(Message.AI_TIMEOUT);
			throw new ServiceUnavailableException(Message.AI_REQUEST_FAILED);
		}
	}

	/** the text blocks of an answer, joined */
	public getText(response: Anthropic.Message): string {
		return response.content
			.filter((block): block is Anthropic.TextBlock => block.type === 'text')
			.map((block) => block.text)
			.join('\n')
			.trim();
	}

	private getClient(config: AiConfig): Anthropic {
		const key = `${config.apiKey.length}:${config.apiKey.slice(-4)}:${config.timeoutMs}`;
		if (!this.client || this.clientKey !== key) {
			this.client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 1 });
			this.clientKey = key;
		}
		return this.client;
	}
}
