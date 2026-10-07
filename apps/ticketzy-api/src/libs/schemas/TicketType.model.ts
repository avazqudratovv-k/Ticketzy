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

		/** links the ticket type to the SEATED sections of the venue layout with this tier key */
		tierKey: {
			type: String,
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
// one ticket type per tier, so every seat has exactly one ticket type
TicketTypeSchema.index({ eventId: 1, tierKey: 1 }, { unique: true, partialFilterExpression: { tierKey: { $type: 'string' } } });

export default TicketTypeSchema;
