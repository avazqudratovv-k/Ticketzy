import { Schema } from 'mongoose';

/** one document per event, created only when an admin marks the payout as paid; a mock record, no money moves */
const PayoutSchema = new Schema(
	{
		/** unique: an event can be paid out only once */
		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			unique: true,
			ref: 'Event',
		},

		organizerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		/** snapshot at the moment of marking, whole won */
		gross: {
			type: Number,
			required: true,
			min: 0,
		},

		commission: {
			type: Number,
			required: true,
			min: 0,
		},

		net: {
			type: Number,
			required: true,
			min: 1,
		},

		orderCount: {
			type: Number,
			required: true,
			min: 1,
		},

		paidAt: {
			type: Date,
			required: true,
		},

		paidBy: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		note: {
			type: String,
			maxlength: 300,
		},
	},
	{ timestamps: true, collection: 'payouts' },
);

PayoutSchema.index({ organizerId: 1, paidAt: -1 });

export default PayoutSchema;
