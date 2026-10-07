import { Schema } from 'mongoose';
import { NotificationGroup, NotificationStatus, NotificationType } from '../enums/notification.enum';

const NotificationSchema = new Schema(
	{
		notificationType: {
			type: String,
			enum: NotificationType,
			required: true,
		},

		notificationStatus: {
			type: String,
			enum: NotificationStatus,
			default: NotificationStatus.WAIT,
		},

		notificationGroup: {
			type: String,
			enum: NotificationGroup,
			required: true,
		},

		notificationTitle: {
			type: String,
			required: true,
		},

		notificationDesc: {
			type: String,
		},

		authorId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		receiverId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		eventId: {
			type: Schema.Types.ObjectId,
			ref: 'Event',
		},

		orderId: {
			type: Schema.Types.ObjectId,
			ref: 'Order',
		},

		conversationId: {
			type: Schema.Types.ObjectId,
			ref: 'Conversation',
		},
	},
	{ timestamps: true, collection: 'notifications' },
);

NotificationSchema.index({ receiverId: 1, notificationStatus: 1, createdAt: -1 });

export default NotificationSchema;
