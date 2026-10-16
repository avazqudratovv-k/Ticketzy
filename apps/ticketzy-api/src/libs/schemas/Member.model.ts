import { Schema } from 'mongoose';
import { MemberAuthType, MemberStatus, MemberType } from '../enums/member.enum';

const CommissionOverrideSchema = new Schema(
	{
		rate: { type: Number, min: 0, max: 100, required: true },
		endsAt: { type: Date },
		reason: { type: String, required: true },
	},
	{ _id: false },
);

const MemberSchema = new Schema(
	{
		memberType: {
			type: String,
			enum: MemberType,
			default: MemberType.USER,
		},

		memberStatus: {
			type: String,
			enum: MemberStatus,
			default: MemberStatus.ACTIVE,
		},

		memberAuthType: {
			type: String,
			enum: MemberAuthType,
			default: MemberAuthType.EMAIL,
		},

		memberEmail: {
			type: String,
			index: { unique: true },
			required: true,
			lowercase: true,
			trim: true,
			match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		},

		memberPhone: {
			type: String,
			index: { unique: true, sparse: true },
		},

		memberNick: {
			type: String,
			index: { unique: true, sparse: true },
		},

		memberPassword: {
			type: String,
			select: false,
			required: true,
		},

		memberFullName: {
			type: String,
		},

		memberImage: {
			type: String,
			default: '',
		},

		memberAddress: {
			type: String,
		},

		memberDesc: {
			type: String,
		},

		memberEvents: {
			type: Number,
			default: 0,
		},

		completedEvents: {
			type: Number,
			default: 0,
		},

		memberFollowers: {
			type: Number,
			default: 0,
		},

		memberFollowings: {
			type: Number,
			default: 0,
		},

		memberLikes: {
			type: Number,
			default: 0,
		},

		memberViews: {
			type: Number,
			default: 0,
		},

		memberComments: {
			type: Number,
			default: 0,
		},

		memberRank: {
			type: Number,
			default: 0,
		},

		rejectReason: {
			type: String,
		},

		/**
		 * true from the moment an admin approves the organizer (PENDING or REJECTED to ACTIVE) until the organizer marks the
		 * celebration as seen; missing or false for every other account (DECISIONS #120). Read only by the member themselves.
		 */
		approvalCelebrationPending: {
			type: Boolean,
			default: false,
		},

		/** commission percentage (0 to 100) that replaces the platform default for this organizer, optionally until endsAt */
		commissionOverride: {
			type: CommissionOverrideSchema,
		},

		memberWarnings: {
			type: Number,
			default: 0,
		},

		memberBlocks: {
			type: Number,
			default: 0,
		},

		deletedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'members' },
);

// organizer lists (getOrganizers, getOrganizersByAdmin, the rank job) filter by type and status
MemberSchema.index({ memberType: 1, memberStatus: 1, createdAt: -1 });

export default MemberSchema;
