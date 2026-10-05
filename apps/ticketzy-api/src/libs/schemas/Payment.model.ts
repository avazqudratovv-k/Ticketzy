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

export default PaymentSchema;
