/**
 * Sliding window limiter kept in this process' memory (no Redis here, see the project rules).
 * With several API instances each one counts on its own, so the real limit is `limit` per instance: scaling the API
 * past one instance needs a shared store (MongoDB, as `AiUsageService` does for the AI cap, or Redis).
 * The memory is bounded: when more than 5000 keys exist, keys without a recent attempt are dropped.
 */
export class RateLimiter {
	private readonly hits = new Map<string, number[]>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
	) {}

	/** records an attempt and returns false when `key` already used up its `limit` in the window */
	public tryConsume(key: string, now: number = Date.now()): boolean {
		return this.consume(key, now).allowed;
	}

	/** like tryConsume, and when the attempt is refused, how many whole seconds until the oldest attempt leaves the window */
	public consume(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
		if (this.hits.size > 5000) this.sweep(now);

		const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
		if (recent.length >= this.limit) {
			this.hits.set(key, recent);
			return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) };
		}
		recent.push(now);
		this.hits.set(key, recent);
		return { allowed: true, retryAfterSeconds: 0 };
	}

	private sweep(now: number): void {
		for (const [key, times] of this.hits) {
			if (!times.some((time) => now - time < this.windowMs)) this.hits.delete(key);
		}
	}
}
