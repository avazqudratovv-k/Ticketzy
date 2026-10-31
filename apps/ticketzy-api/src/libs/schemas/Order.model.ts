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
			default: OrderStatus.PENDING_PAYMENT,
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

		/** reserved-seating orders: the seats held for this order */
		seatIds: {
			type: [Schema.Types.ObjectId],
			ref: 'EventSeat',
			default: [],
		},

		currency: {
			type: String,
		},

		subtotal: {
			type: Number,
			required: true,
		},

		/** percent, stored with the order so later rate changes never touch it */
		commissionRate: {
			type: Number,
			required: true,
		},

		commissionAmount: {
			type: Number,
			required: true,
		},

		/** what the buyer pays (the commission comes out of the organizer's share) */
		totalAmount: {
			type: Number,
			required: true,
		},

		expiresAt: {
			type: Date,
			required: true,
		},

		/** the refund policy of the event when the order was placed; later changes of the event do not touch it */
		refundPolicy: {
			type: new Schema({ policyType: { type: String, required: true }, daysBefore: { type: Number, default: 0 } }, { _id: false }),
		},

		/** set when the buyer confirmed a NON_REFUNDABLE event at checkout */
		nonRefundableAcknowledgedAt: {
			type: Date,
		},

		paidAt: {
			type: Date,
		},

		refundedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'orders' },
);

OrderSchema.index({ buyerId: 1, createdAt: -1 });
OrderSchema.index({ eventId: 1, orderStatus: 1 });
OrderSchema.index({ orderStatus: 1, expiresAt: 1 });

export default OrderSchema;
