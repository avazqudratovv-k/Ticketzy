import { Schema } from 'mongoose';
import { TicketStatus } from '../enums/ticket.enum';

const TicketSchema = new Schema(
	{
		ticketCode: {
			type: String,
			required: true,
			unique: true,
		},

		ticketStatus: {
			type: String,
			enum: TicketStatus,
			default: TicketStatus.VALID,
		},

		orderId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Order',
		},

		ticketTypeId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'TicketType',
		},

		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Event',
		},

		ownerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		checkedInAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'tickets' },
);

TicketSchema.index({ ownerId: 1, createdAt: -1 });
TicketSchema.index({ eventId: 1, ticketStatus: 1 });

export default TicketSchema;
