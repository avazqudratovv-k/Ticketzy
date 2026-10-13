import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { NotificationGroup, NotificationStatus, NotificationType } from '../../enums/notification.enum';
import { PageField, LimitField } from '../common/pagination';

/** internal: what other services pass to NotificationService.createNotification (not exposed in GraphQL) */
export interface NotificationCreate {
	notificationType: NotificationType;
	notificationGroup: NotificationGroup;
	notificationTitle: string;
	notificationDesc?: string;
	authorId: ObjectId;
	receiverId: ObjectId;
	eventId?: ObjectId;
	orderId?: ObjectId;
	conversationId?: ObjectId;
}

@InputType()
export class NotificationsInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@Field(() => NotificationStatus, { nullable: true })
	notificationStatus?: NotificationStatus;

	/** shortcut for notificationStatus WAIT; wins over notificationStatus when true */
	@IsOptional()
	@Field(() => Boolean, { nullable: true })
	unreadOnly?: boolean;
}
