import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

export interface AiUsageResult {
	allowed: boolean;
	/** the counter after this call (the cap itself when refused) */
	count: number;
}

const DAY_MS = 86_400_000;

/** the UTC day of an instant, YYYY-MM-DD */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** whole seconds until 00:00 UTC, at least 1 */
export const secondsUntilUtcMidnight = (now: Date): number => {
	const nextMidnight = Date.parse(`${utcDay(now)}T00:00:00.000Z`) + DAY_MS;
	return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
};

/**
 * The daily AI counters, stored in MongoDB so they survive a restart and are shared by every API instance (the free host
 * restarts and sleeps; an in-memory counter would reset the budget each time). Counting is one conditional upsert:
 * the filter `count < cap` is the cap, and an upsert that would create a second document for a full counter fails with a
 * duplicate key, which means "at the cap". Only counts and keys are stored, never a prompt.
 */
@Injectable()
export class AiUsageService {
	constructor(@InjectModel('AiUsage') private readonly usageModel: Model<any>) {}

	/** counts one use of `usageKey` for the UTC day of `now` when it is still under `cap`; a cap of 0 refuses everything */
	public async consume(usageKey: string, cap: number, now: Date = new Date()): Promise<AiUsageResult> {
		if (cap <= 0) return { allowed: false, count: 0 };

		const day = utcDay(now);
		const fullKey = `${usageKey}:${day}`;
		const expireAt = new Date(Date.parse(`${day}T00:00:00.000Z`) + 3 * DAY_MS);
		// two requests creating the first counter of the day at once: one insert loses with a duplicate key, so try once more
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const doc = (await this.usageModel
					.findOneAndUpdate(
						{ usageKey: fullKey, count: { $lt: cap } },
						{ $inc: { count: 1 }, $setOnInsert: { day, expireAt } },
						{ upsert: true, new: true },
					)
					.lean()
					.exec()) as { count?: number } | null;
				return { allowed: true, count: doc?.count ?? 1 };
			} catch (err) {
				if ((err as { code?: number })?.code !== 11000) throw err;
			}
		}
		return { allowed: false, count: cap };
	}
}
