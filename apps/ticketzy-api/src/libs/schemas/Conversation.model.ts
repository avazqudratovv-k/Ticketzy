import { Schema } from 'mongoose';

const ConversationSchema = new Schema(
	{
		/** absent for the general support conversation */
		eventId: {
			type: Schema.Types.ObjectId,
			ref: 'Event',
		},

		isSupport: {
			type: Boolean,
			default: false,
		},

		organizerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		/** the first admin who replied; later admins can still write, the id does not change */
		adminId: {
			type: Schema.Types.ObjectId,
			default: null,
			ref: 'Member',
		},

		lastMessageAt: {
			type: Date,
			default: Date.now,
		},

		unreadForOrganizer: {
			type: Number,
			default: 0,
			min: 0,
		},

		/** shared by all admins: whichever admin reads the conversation clears it */
		unreadForAdmin: {
			type: Number,
			default: 0,
			min: 0,
		},
	},
	{ timestamps: true, collection: 'conversations' },
);

/** one conversation per event; the partial filter keeps support conversations (no eventId) out of the index */
ConversationSchema.index({ eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $type: 'objectId' } } });
/** one general support conversation per organizer */
ConversationSchema.index({ organizerId: 1 }, { unique: true, partialFilterExpression: { isSupport: true } });
ConversationSchema.index({ organizerId: 1, lastMessageAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

export default ConversationSchema;
