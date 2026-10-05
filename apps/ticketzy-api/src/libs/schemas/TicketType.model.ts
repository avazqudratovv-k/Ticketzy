import { Schema } from 'mongoose';
import { TicketCurrency, TicketTypeStatus } from '../enums/ticket.enum';

const TicketTypeSchema = new Schema(
	{
		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Event',
		},

		ticketTypeName: {
			type: String,
			required: true,
		},

		ticketPrice: {
			type: Number,
			required: true,
			min: 0,
		},

		ticketCurrency: {
			type: String,
			enum: TicketCurrency,
			required: true,
		},

		totalQuantity: {
			type: Number,
			required: true,
			min: 0,
		},

		soldQuantity: {
			type: Number,
			default: 0,
			min: 0,
		},

		maxPerOrder: {
			type: Number,
			required: true,
			min: 1,
		},

		saleStartAt: {
			type: Date,
		},

		saleEndAt: {
			type: Date,
		},

		ticketTypeStatus: {
			type: String,
			enum: TicketTypeStatus,
			default: TicketTypeStatus.ACTIVE,
		},
	},
	{ timestamps: true, collection: 'ticketTypes' },
);

TicketTypeSchema.index({ eventId: 1, ticketTypeName: 1 }, { unique: true });

export default TicketTypeSchema;
