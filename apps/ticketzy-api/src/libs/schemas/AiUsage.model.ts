import { Schema } from 'mongoose';

/**
 * One document per counter per UTC day: `global:<day>` (model calls of the whole app) and `key:<day>:<member or ip>`
 * (assistant operations of one caller). `count` only goes up through a conditional `$inc` (AiUsageService), so two API
 * instances or a restart can never lose or double a count. The TTL index removes a counter two days after its day ended.
 */
const AiUsageSchema = new Schema(
	{
		usageKey: {
			type: String,
			required: true,
			unique: true,
		},

		/** UTC day, YYYY-MM-DD */
		day: {
			type: String,
			required: true,
		},

		count: {
			type: Number,
			default: 0,
		},

		expireAt: {
			type: Date,
			required: true,
		},
	},
	{ timestamps: false, collection: 'ai_usage' },
);

AiUsageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default AiUsageSchema;
