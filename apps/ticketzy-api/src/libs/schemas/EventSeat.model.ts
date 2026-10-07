import { Schema } from 'mongoose';
import { SeatStatus } from '../enums/event.enum';

const EventSeatSchema = new Schema(
	{
		eventId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Event',
		},

		ticketTypeId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'TicketType',
		},

		sectionKey: {
			type: String,
			required: true,
		},

		row: {
			type: Number,
			required: true,
			min: 1,
		},

		number: {
			type: Number,
			required: true,
			min: 1,
		},

		seatStatus: {
			type: String,
			enum: SeatStatus,
			default: SeatStatus.AVAILABLE,
		},

		heldBy: {
			type: Schema.Types.ObjectId,
			ref: 'Member',
		},

		heldUntil: {
			type: Date,
		},

		orderId: {
			type: Schema.Types.ObjectId,
			ref: 'Order',
		},
	},
	{ timestamps: true, collection: 'eventSeats' },
);

EventSeatSchema.index({ eventId: 1, sectionKey: 1, row: 1, number: 1 }, { unique: true });
EventSeatSchema.index({ eventId: 1, seatStatus: 1 });
// the batch sweep that frees expired holds
EventSeatSchema.index({ seatStatus: 1, heldUntil: 1 });
EventSeatSchema.index({ eventId: 1, heldBy: 1 });

export default EventSeatSchema;
