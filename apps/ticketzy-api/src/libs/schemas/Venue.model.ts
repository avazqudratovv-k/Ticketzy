import { Schema } from 'mongoose';
import { FocalAreaType, SectionKind, SectionSpacing, VenueStatus, VenueType } from '../enums/event.enum';

const VenueSectionSchema = new Schema(
	{
		key: { type: String, required: true },
		name: { type: String, required: true },
		kind: { type: String, enum: SectionKind, required: true },
		rows: { type: Number, required: true, min: 1, max: 100 },
		seatsPerRow: { type: Number, required: true, min: 1, max: 100 },
		capacity: { type: Number, min: 1 },
		x: { type: Number, default: 0 },
		y: { type: Number, default: 0 },
		rotation: { type: Number, default: 0 },
		spacing: { type: String, enum: SectionSpacing, default: SectionSpacing.NORMAL },
		tierKey: { type: String },
		/** 0 floor, 1 lower tier, 2 upper tier; missing on old sections means 0 (DECISIONS #128) */
		level: { type: Number, min: 0, max: 2, default: 0 },
	},
	{ _id: false },
);

/** the one stage or pitch of a layout; missing on old layouts, which read as the default stage (libs/focal-area.ts) */
const FocalAreaSchema = new Schema(
	{
		type: { type: String, enum: FocalAreaType, required: true },
		x: { type: Number, required: true },
		y: { type: Number, required: true },
		width: { type: Number, required: true },
		height: { type: Number, required: true },
	},
	{ _id: false },
);

const VenueSchema = new Schema(
	{
		venueName: {
			type: String,
			required: true,
		},

		venueType: {
			type: String,
			enum: VenueType,
			required: true,
		},

		venueCity: {
			type: String,
			required: true,
		},

		venueAddress: {
			type: String,
			required: true,
		},

		venueCoordinates: {
			type: [Number],
		},

		venueTimezone: {
			type: String,
			default: 'Asia/Seoul',
		},

		/** optional: venues created before layouts have none, and then only host GENERAL events */
		venueLayout: {
			type: new Schema({ sections: { type: [VenueSectionSchema], default: [] }, focalArea: { type: FocalAreaSchema } }, { _id: false }),
		},

		/** computed from venueLayout by the server */
		venueCapacity: {
			type: Number,
			required: true,
		},

		venueImages: {
			type: [String],
			default: [],
		},

		venueStatus: {
			type: String,
			enum: VenueStatus,
			default: VenueStatus.ACTIVE,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'venues' },
);

VenueSchema.index({ venueCity: 1, venueName: 1, venueAddress: 1 }, { unique: true });
// getVenues: ACTIVE venues filtered by city
VenueSchema.index({ venueStatus: 1, venueCity: 1 });

export default VenueSchema;
