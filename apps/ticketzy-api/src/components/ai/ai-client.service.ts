import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Message } from '../../libs/enums/common.enum';
import { RateLimiter } from '../../libs/rate-limiter';
import { AiConfig, getAiCaps, getAiConfig, getAiStartupWarnings } from '../../libs/env.validation';
import { createRateLimitedError } from '../../libs/rate-limit';
import { CodedException } from '../../libs/coded-exception';
import { AiUsageService, secondsUntilUtcMidnight } from './ai-usage.service';
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

/** 400 (request refused, often a model specific option), 404 (unknown model), 429, 500, 503, 504 and a timeout: the fallback model gets one try. Never 401/403 (key problems) */
const FALLBACK_STATUSES = [400, 404, 429, 500, 503, 504];
const isKeyError = (err: unknown): boolean => err instanceof AiProviderError && [401, 403].includes(Number(err.status));
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

	private lastCapRefusalLog = 0;

	/** `usage` is injected by Nest; only unit tests build the client without it, and then there are no daily caps */
	constructor(
		@Inject(AI_PROVIDER_FACTORY) private readonly createProvider: AiProviderFactory,
		private readonly usage?: AiUsageService,
	) {}

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

	/**
	 * `begin` plus the daily limit of one member or IP (AI_PER_KEY_DAILY_CAP), counted in MongoDB. Call this once per AI
	 * operation. Fails closed: when the counter cannot be read the operation is refused, never let through.
	 */
	public async reserve(key: string): Promise<AiConfig> {
		const config = this.begin(key);
		if (!this.usage) return config;
		const { perKeyDailyCap } = getAiCaps();
		const result = await this.countOrFailClosed(`key:${key}`, perKeyDailyCap);
		if (!result.allowed) {
			this.logCapRefusal(`per-caller daily limit reached (${perKeyDailyCap}/day)`);
			throw createRateLimitedError(secondsUntilUtcMidnight(new Date()), Message.AI_USER_DAILY_LIMIT);
		}
		return config;
	}

	/** one model call of the whole app against AI_DAILY_CAP; a retry or the fallback model counts as a call too */
	private async chargeModelCall(): Promise<void> {
		if (!this.usage) return;
		const { dailyCap } = getAiCaps();
		const result = await this.countOrFailClosed('global', dailyCap);
		if (!result.allowed) {
			this.logCapRefusal(`daily cap reached (${dailyCap} model calls); refused until 00:00 UTC`);
			throw new CodedException(Message.AI_DAILY_CAP_REACHED, 'AI_DAILY_CAP_REACHED', 429);
		}
		// counts only, never a prompt: one line at 80 percent and one at the cap
		if (result.count === Math.ceil(dailyCap * 0.8) || result.count === dailyCap) {
			this.logger.warn(`AI daily usage: ${result.count}/${dailyCap} model calls (UTC day)`);
		}
	}

	private async countOrFailClosed(usageKey: string, cap: number) {
		try {
			return await this.usage.consume(usageKey, cap);
		} catch (err) {
			this.logger.error(`AI usage counter unavailable, refusing the request: ${(err as Error)?.constructor?.name ?? 'Error'}`);
			throw new CodedException(Message.SERVICE_TEMPORARILY_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 503);
		}
	}

	/** at most one refusal line per minute, so a flood does not flood the log */
	private logCapRefusal(text: string): void {
		const now = Date.now();
		if (now - this.lastCapRefusalLog < 60_000) return;
		this.lastCapRefusalLog = now;
		this.logger.warn(`AI request refused: ${text}`);
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
		// every attempt at the vendor, including the retry and the fallback model, is one model call against the daily cap
		const metered = async (provider: AiProvider): Promise<T> => {
			await this.chargeModelCall();
			return call(provider);
		};
		try {
			return await this.runWithRetry(() => metered(this.getProvider(config)));
		} catch (err) {
			if (err instanceof CodedException) throw err;
			failure = err;
			this.logFailure(config, config.model, err);
		}
		if (isKeyError(failure)) {
			this.logger.error(`AI key rejected (status ${(failure as AiProviderError).status}): check the API key and its permissions; the fallback model is not tried because the same key would fail`);
		} else if (config.fallbackModel && canFallBack(failure)) {
			const fallback = { ...config, model: config.fallbackModel };
			try {
				const result = await metered(this.getProvider(fallback));
				this.logger.warn(`AI fallback model answered: provider=${config.provider} model=${fallback.model}`);
				return result;
			} catch (err) {
				if (err instanceof CodedException) throw err;
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
			this.logger.error(`AI request failed: provider=${config.provider} model=${model} ${err.kind} ${err.errorType} status=${err.status ?? 'none'}${err.reason ? ` reason="${err.reason}"` : ''}`);
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
