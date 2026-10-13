import { Schema } from 'mongoose';
import { PaymentProvider, PaymentStatus } from '../enums/ticket.enum';

const PaymentSchema = new Schema(
	{
		orderId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Order',
		},

		paymentProvider: {
			type: String,
			enum: PaymentProvider,
			required: true,
		},

		providerRef: {
			type: String,
			required: true,
			unique: true,
		},

		paymentStatus: {
			type: String,
			enum: PaymentStatus,
			default: PaymentStatus.INITIATED,
		},

		amount: {
			type: Number,
			required: true,
		},
	},
	{ timestamps: true, collection: 'payments' },
);

// refunds and deleteRecords look a payment up by its order
PaymentSchema.index({ orderId: 1, paymentStatus: 1 });

export default PaymentSchema;
