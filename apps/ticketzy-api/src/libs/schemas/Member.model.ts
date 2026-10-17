import { Schema } from 'mongoose';
import { MemberAuthType, MemberStatus, MemberType } from '../enums/member.enum';
import { MEMBER_EMAIL_INDEX, MEMBER_PHONE_INDEX } from '../member-indexes';

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

		// unique among live accounts only: see the compound index below (DECISIONS #123)
		memberEmail: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
			match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		},

		memberPhone: {
			type: String,
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

		/** set when the owner deletes the account (DECISIONS #123); a live account has none. Admin-only tag. */
		deletedAt: {
			type: Date,
		},

		/** deletedAt + 30 days: the first moment the email of a deleted account may open a new account. Admin-only tag. */
		emailReusableAt: {
			type: Date,
		},

		/** on a new account that reused the email of a deleted one: that deleted account. Admin-only tag. */
		previousAccountId: {
			type: Schema.Types.ObjectId,
		},

		/** on a deleted account whose email was reused: the new account. Admin-only tag. */
		reusedByMemberId: {
			type: Schema.Types.ObjectId,
		},
	},
	{ timestamps: true, collection: 'members' },
);

// one live member per email and per phone; deleted accounts keep theirs (DECISIONS #123, libs/member-indexes.ts)
MemberSchema.index(MEMBER_EMAIL_INDEX.key, { name: MEMBER_EMAIL_INDEX.name, unique: true });
MemberSchema.index(MEMBER_PHONE_INDEX.key, { name: MEMBER_PHONE_INDEX.name, unique: true, sparse: true });

// organizer lists (getOrganizers, getOrganizersByAdmin, the rank job) filter by type and status
MemberSchema.index({ memberType: 1, memberStatus: 1, createdAt: -1 });

export default MemberSchema;
