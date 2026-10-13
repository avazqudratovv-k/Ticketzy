import { Schema } from 'mongoose';
import { SectionKind, SectionSpacing, VenueStatus, VenueType } from '../enums/event.enum';

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
			type: new Schema({ sections: { type: [VenueSectionSchema], default: [] } }, { _id: false }),
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
