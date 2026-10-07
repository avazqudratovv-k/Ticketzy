import { Schema } from 'mongoose';
import { RefundSource, RefundStatus } from '../enums/ticket.enum';

const RefundSchema = new Schema(
	{
		/** unique: the refund unit is the whole order, and one refund record per order makes a double refund impossible */
		orderId: {
			type: Schema.Types.ObjectId,
			required: true,
			unique: true,
			ref: 'Order',
		},

		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Event',
		},

		buyerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		amount: {
			type: Number,
			required: true,
		},

		currency: {
			type: String,
		},

		refundStatus: {
			type: String,
			enum: RefundStatus,
			default: RefundStatus.PENDING,
		},

		refundSource: {
			type: String,
			enum: RefundSource,
			required: true,
		},

		reason: {
			type: String,
		},

		/** the buyer or the admin who asked; unset for the refunds of a cancelled event */
		requestedBy: {
			type: Schema.Types.ObjectId,
			ref: 'Member',
		},

		requestedAt: {
			type: Date,
			required: true,
		},

		completedAt: {
			type: Date,
		},

		/** the stock of the order went back on sale; checked and set in one update so it happens once */
		stockReleased: {
			type: Boolean,
			default: false,
		},

		/** set while a run owns the refund; a run that died leaves it behind and a later run may take over */
		lockedAt: {
			type: Date,
		},

		failureReason: {
			type: String,
		},
	},
	{ timestamps: true, collection: 'refunds' },
);

RefundSchema.index({ eventId: 1, refundStatus: 1 });

export default RefundSchema;
