import { Schema } from 'mongoose';

const MessageSchema = new Schema(
	{
		conversationId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Conversation',
		},

		senderId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		body: {
			type: String,
			required: true,
			trim: true,
			maxlength: 2000,
		},

		readAt: {
			type: Date,
		},
	},
	{ timestamps: { createdAt: true, updatedAt: false }, collection: 'messages' },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

export default MessageSchema;
