import { Schema } from 'mongoose';
import { VenueStatus, VenueType } from '../enums/event.enum';

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

export default VenueSchema;
