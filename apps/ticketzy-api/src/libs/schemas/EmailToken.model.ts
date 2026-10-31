import { Schema } from 'mongoose';
import { EmailTokenPurpose } from '../enums/email-token.enum';

/**
 * One-time links sent by email (DECISIONS #135). Only the SHA-256 hash of the token is stored, never the token. A token is
 * usable while `usedAt` and `revokedAt` are empty and `expiresAt` is in the future; using it is one conditional update.
 */
const EmailTokenSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },

		purpose: { type: String, enum: EmailTokenPurpose, required: true },

		tokenHash: { type: String, required: true, unique: true },

		expiresAt: { type: Date, required: true },

		usedAt: { type: Date, default: null },

		/** set when a newer token of the same purpose replaced this one */
		revokedAt: { type: Date, default: null },

		/** CHANGE_EMAIL only: the address the member wants; it replaces memberEmail when the link is opened */
		newEmail: { type: String, lowercase: true, trim: true },
	},
	{ timestamps: true, collection: 'email_tokens' },
);

// finding the open tokens of a member to replace them
EmailTokenSchema.index({ memberId: 1, purpose: 1 });
// rows disappear two days after they expire
EmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

export default EmailTokenSchema;
