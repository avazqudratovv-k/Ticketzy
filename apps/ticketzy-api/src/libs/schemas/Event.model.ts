import { Schema } from 'mongoose';
import { EventCategory, EventStatus } from '../enums/event.enum';

const EventSchema = new Schema(
	{
		eventCategory: {
			type: String,
			enum: EventCategory,
			required: true,
		},

		eventStatus: {
			type: String,
			enum: EventStatus,
			default: EventStatus.DRAFT,
		},

		eventTitle: {
			type: String,
			required: true,
		},

		eventDesc: {
			type: String,
		},

		eventImages: {
			type: [String],
			required: true,
		},

		eventMinPrice: {
			type: Number,
			default: 0,
		},

		eventViews: {
			type: Number,
			default: 0,
		},

		eventLikes: {
			type: Number,
			default: 0,
		},

		eventComments: {
			type: Number,
			default: 0,
		},

		eventRank: {
			type: Number,
			default: 0,
		},

		organizerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		venueId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Venue',
		},

		startAt: {
			type: Date,
			required: true,
		},

		endAt: {
			type: Date,
			required: true,
		},

		saleStartAt: {
			type: Date,
		},

		saleEndAt: {
			type: Date,
		},

		deletedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'events' },
);

EventSchema.index({ organizerId: 1, venueId: 1, eventTitle: 1, startAt: 1 }, { unique: true });
EventSchema.index({ eventCategory: 1, eventStatus: 1, startAt: 1 });

export default EventSchema;
