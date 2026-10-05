import { Schema } from 'mongoose';
import { OrderStatus } from '../enums/ticket.enum';

const OrderItemSchema = new Schema(
	{
		ticketTypeId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'TicketType',
		},

		quantity: {
			type: Number,
			required: true,
			min: 1,
		},

		unitPrice: {
			type: Number,
			required: true,
		},
	},
	{ _id: false },
);

const OrderSchema = new Schema(
	{
		orderNumber: {
			type: String,
			required: true,
			unique: true,
		},

		orderStatus: {
			type: String,
			enum: OrderStatus,
			default: OrderStatus.PENDING,
		},

		buyerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Event',
		},

		items: {
			type: [OrderItemSchema],
			required: true,
		},

		totalAmount: {
			type: Number,
			required: true,
		},

		expiresAt: {
			type: Date,
			required: true,
		},

		paidAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'orders' },
);

OrderSchema.index({ buyerId: 1, createdAt: -1 });
OrderSchema.index({ eventId: 1, orderStatus: 1 });
OrderSchema.index({ orderStatus: 1, expiresAt: 1 });

export default OrderSchema;
