import { Schema } from 'mongoose';

/**
 * Written only by `npm run seed:demo`: one row per root document (member, venue, event) that the demo seed created.
 * `reset:demo` removes exactly what these rows point at, plus what hangs off it (DECISIONS #108). The API never reads it.
 */
const DemoSeedRecordSchema = new Schema(
	{
		/** which run created it, for the report only */
		runId: { type: String, required: true },
		recordType: { type: String, enum: ['Member', 'Venue', 'Event'], required: true },
		recordId: { type: Schema.Types.ObjectId, required: true },
	},
	{ timestamps: { createdAt: true, updatedAt: false }, collection: 'demo_seed_records' },
);
DemoSeedRecordSchema.index({ recordType: 1, recordId: 1 }, { unique: true });
export default DemoSeedRecordSchema;
