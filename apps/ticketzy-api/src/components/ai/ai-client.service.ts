import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Message } from '../../libs/enums/common.enum';
import { RateLimiter } from '../../libs/rate-limiter';
import { AiConfig, getAiConfig, getAiStartupWarnings } from '../../libs/env.validation';
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

export const AI_RETRY_DELAY_MS = 1000;

/** the vendor said 503/504 (overloaded, gateway timeout) or our own per-request timeout hit: worth one more try */
const isRetryableError = (err: unknown): boolean =>
	err instanceof AiProviderError && (err.kind === 'timeout' || Number(err.status) === 503 || Number(err.status) === 504);

/** the user is told "busy": a retryable error, or 429 (quota) */
const isBusyError = (err: unknown): boolean => isRetryableError(err) || (err instanceof AiProviderError && Number(err.status) === 429);

/** 404 (unknown model), 429, 503, 504 and a timeout: the configured fallback model gets one try */
const FALLBACK_STATUSES = [404, 429, 503, 504];
const canFallBack = (err: unknown): boolean =>
	err instanceof AiProviderError && (err.kind === 'timeout' || FALLBACK_STATUSES.includes(Number(err.status)));

/**
 * The only place the AI services reach a model vendor (the browser never does), through the AiProvider of AI_PROVIDER.
 * Everything is read at call time, so a missing key or AI_ENABLED=false only turns the AI operations off:
 * they answer with a clear message and the rest of the app keeps working. The key and the prompts are never logged.
 */
@Injectable()
export class AiClientService implements OnModuleInit {
	private readonly logger = new Logger(AiClientService.name);
	private readonly providers = new Map<string, AiProvider>();
	private limiter: RateLimiter | null = null;
	private limiterSize = 0;

	constructor(@Inject(AI_PROVIDER_FACTORY) private readonly createProvider: AiProviderFactory) {}

	/** only reads the environment (no call to the vendor) and only warns, it never stops the app */
	public onModuleInit(): void {
		for (const warning of getAiStartupWarnings()) this.logger.warn(warning);
	}

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

	/** one retry, 1 second later, after a 503/504 or a timeout, then AI_BUSY */
	private async runWithRetry<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (err) {
			if (!isRetryableError(err)) throw err;
			await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAY_MS));
			return call();
		}
	}

	/**
	 * One model call. The main model gets one retry; when it still fails with 404/429/503/504/timeout and
	 * GEMINI_FALLBACK_MODEL is set, the fallback model gets exactly one try. Every failure becomes a clear Message,
	 * with only the error type, status and model name in the log (never the key or the prompt).
	 */
	private async run<T>(call: (provider: AiProvider) => Promise<T>): Promise<T> {
		const config = this.assertAvailable();
		let failure: unknown;
		try {
			return await this.runWithRetry(() => call(this.getProvider(config)));
		} catch (err) {
			failure = err;
			this.logFailure(config, config.model, err);
		}
		if (config.fallbackModel && canFallBack(failure)) {
			const fallback = { ...config, model: config.fallbackModel };
			try {
				const result = await call(this.getProvider(fallback));
				this.logger.warn(`AI fallback model answered: provider=${config.provider} model=${fallback.model}`);
				return result;
			} catch (err) {
				failure = err;
				this.logFailure(config, fallback.model, err);
			}
		}
		if (failure instanceof AiProviderError) {
			if (failure.kind === 'invalid_response') throw new BadRequestException(Message.AI_INVALID_RESPONSE);
			if (isBusyError(failure)) throw new ServiceUnavailableException(Message.AI_BUSY);
		}
		throw new ServiceUnavailableException(Message.AI_REQUEST_FAILED);
	}

	private logFailure(config: AiConfig, model: string, err: unknown): void {
		if (err instanceof AiProviderError) {
			this.logger.error(`AI request failed: provider=${config.provider} model=${model} ${err.kind} ${err.errorType} status=${err.status ?? 'none'}`);
		} else {
			this.logger.error(`AI request failed: provider=${config.provider} model=${model} ${(err as Error)?.constructor?.name ?? 'Error'}`);
		}
	}

	private getProvider(config: AiConfig): AiProvider {
		const key = `${config.provider}:${config.model}:${config.apiKey.length}:${config.apiKey.slice(-4)}:${config.timeoutMs}`;
		let provider = this.providers.get(key);
		if (!provider) {
			// a changed key or setting makes a new provider; keep the map small (main + fallback)
			if (this.providers.size >= 4) this.providers.clear();
			provider = this.createProvider(config);
			this.providers.set(key, provider);
		}
		return provider;
	}
}
