/**
 * Sliding window limiter kept in this process' memory (no Redis here, see the project rules).
 * With several API instances each one counts on its own, so the real limit is `limit` per instance.
 */
export class RateLimiter {
	private readonly hits = new Map<string, number[]>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
	) {}

	/** records an attempt and returns false when `key` already used up its `limit` in the window */
	public tryConsume(key: string, now: number = Date.now()): boolean {
		if (this.hits.size > 5000) this.sweep(now);

		const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
		if (recent.length >= this.limit) {
			this.hits.set(key, recent);
			return false;
		}
		recent.push(now);
		this.hits.set(key, recent);
		return true;
	}

	private sweep(now: number): void {
		for (const [key, times] of this.hits) {
			if (!times.some((time) => now - time < this.windowMs)) this.hits.delete(key);
		}
	}
}
