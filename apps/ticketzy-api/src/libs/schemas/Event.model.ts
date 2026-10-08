import { Schema } from 'mongoose';
import { EventCategory, EventLocale, EventStatus, ModerationFlagType, SeatingType } from '../enums/event.enum';

const EventTranslationSchema = new Schema(
	{
		locale: { type: String, enum: EventLocale, required: true },
		title: { type: String, required: true },
		description: { type: String },
	},
	{ _id: false },
);

/** filled by the AI moderation on submit; `checked: false` means the check did not run or failed */
const EventModerationSchema = new Schema(
	{
		checked: { type: Boolean },
		flags: [
			new Schema(
				{
					type: { type: String, enum: ModerationFlagType, required: true },
					reason: { type: String },
					confidence: { type: Number, min: 0, max: 1 },
				},
				{ _id: false },
			),
		],
		reason: { type: String },
		confidence: { type: Number, min: 0, max: 1 },
		model: { type: String },
		checkedAt: { type: Date },
	},
	{ _id: false },
);

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

		seatingType: {
			type: String,
			enum: SeatingType,
			default: SeatingType.GENERAL,
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

		eventTranslations: {
			type: [EventTranslationSchema],
			default: [],
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

		rejectReason: {
			type: String,
		},

		cancelReason: {
			type: String,
		},

		eventModeration: {
			type: EventModerationSchema,
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
