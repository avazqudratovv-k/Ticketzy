import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Message } from '../../libs/enums/common.enum';
import { RateLimiter } from '../../libs/rate-limiter';
import { AiConfig, getAiConfig } from '../../libs/env.validation';
import {
	AiChatRequest,
	AiChatResult,
	AiJsonResult,
	AiProvider,
	AiProviderError,
	AiTextRequest,
	AiTextResult,
} from './providers/ai-provider';
import { AI_PROVIDER_FACTORY, AiProviderFactory } from './providers/create-ai-provider';

export const AI_RETRY_DELAY_MS = 800;

/** the vendor said 503/504: overloaded or gateway timeout, worth one more try */
const isBusyError = (err: unknown): boolean => err instanceof AiProviderError && (Number(err.status) === 503 || Number(err.status) === 504);

/**
 * The only place the AI services reach a model vendor (the browser never does), through the AiProvider of AI_PROVIDER.
 * Everything is read at call time, so a missing key or AI_ENABLED=false only turns the AI operations off:
 * they answer with a clear message and the rest of the app keeps working. The key and the prompts are never logged.
 */
@Injectable()
export class AiClientService {
	private readonly logger = new Logger(AiClientService.name);
	private provider: AiProvider | null = null;
	private providerKey = '';
	private limiter: RateLimiter | null = null;
	private limiterSize = 0;

	constructor(@Inject(AI_PROVIDER_FACTORY) private readonly createProvider: AiProviderFactory) {}

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

	public generateText(request: AiTextRequest): Promise<AiTextResult> {
		return this.run((provider) => provider.generateText(request));
	}

	/** parsed but NOT validated JSON: the caller runs its strict parser. Not JSON at all means AI_INVALID_RESPONSE. */
	public generateJson(request: AiTextRequest): Promise<AiJsonResult> {
		return this.run((provider) => provider.generateJson(request));
	}

	public chat(request: AiChatRequest): Promise<AiChatResult> {
		return this.run((provider) => provider.chat(request));
	}

	/** one retry after a 503/504 (the model is overloaded), then AI_BUSY */
	private async runWithRetry<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (err) {
			if (!isBusyError(err)) throw err;
			await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAY_MS));
			return call();
		}
	}

	/** one model call; every failure becomes a clear Message, with only the error type and status in the log */
	private async run<T>(call: (provider: AiProvider) => Promise<T>): Promise<T> {
		const config = this.assertAvailable();
		try {
			return await this.runWithRetry(() => call(this.getProvider(config)));
		} catch (err) {
			if (err instanceof AiProviderError) {
				this.logger.error(`AI request failed: provider=${config.provider} ${err.kind} ${err.errorType} status=${err.status ?? 'none'}`);
				if (err.kind === 'invalid_response') throw new BadRequestException(Message.AI_INVALID_RESPONSE);
				if (isBusyError(err)) throw new ServiceUnavailableException(Message.AI_BUSY);
				throw new ServiceUnavailableException(err.kind === 'timeout' ? Message.AI_TIMEOUT : Message.AI_REQUEST_FAILED);
			}
			this.logger.error(`AI request failed: provider=${config.provider} ${err?.constructor?.name ?? 'Error'}`);
			throw new ServiceUnavailableException(Message.AI_REQUEST_FAILED);
		}
	}

	private getProvider(config: AiConfig): AiProvider {
		const key = `${config.provider}:${config.model}:${config.apiKey.length}:${config.apiKey.slice(-4)}:${config.timeoutMs}`;
		if (!this.provider || this.providerKey !== key) {
			this.provider = this.createProvider(config);
			this.providerKey = key;
		}
		return this.provider;
	}
}
