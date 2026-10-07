import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Notification, Notifications } from '../../libs/dto/notification/notification';
import { NotificationCreate, NotificationsInquiry } from '../../libs/dto/notification/notification.input';
import { Message } from '../../libs/enums/common.enum';
import { NotificationStatus, NotificationType } from '../../libs/enums/notification.enum';
import { T } from '../../libs/types/common';
import { shapeIntoMongoObjectId } from '../../libs/config';

/** people are not told about their own likes and comments; system messages (e.g. ORDER_PAID) may go to the author */
const selfNotifiedTypes = [NotificationType.LIKE, NotificationType.COMMENT, NotificationType.NEW_MESSAGE];

@Injectable()
export class NotificationService {
	private readonly logger = new Logger(NotificationService.name);

	constructor(@InjectModel('Notification') private readonly notificationModel: Model<Notification>) {}

	/**
	 * Called by other services after their own work succeeded.
	 * It never throws: a failed notification must not break a like, a comment or a payment.
	 */
	public async createNotification(input: NotificationCreate): Promise<void> {
		try {
			if (selfNotifiedTypes.includes(input.notificationType) && String(input.authorId) === String(input.receiverId)) return;
			await this.notificationModel.create(input);
		} catch (err) {
			this.logger.error(`Error, NotificationService.createNotification: ${err.message}`);
		}
	}

	public async getMyNotifications(memberId: ObjectId, input: NotificationsInquiry): Promise<Notifications> {
		const match: T = { receiverId: shapeIntoMongoObjectId(memberId) };
		if (input.unreadOnly) match.notificationStatus = NotificationStatus.WAIT;
		else if (input.notificationStatus) match.notificationStatus = input.notificationStatus;

		const result = await this.notificationModel
			.aggregate([
				{ $match: match },
				{ $sort: { createdAt: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $lookup: { from: 'members', localField: 'authorId', foreignField: '_id', as: 'authorData' } },
							{ $unwind: { path: '$authorData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	public async markNotificationRead(memberId: ObjectId, notificationId: ObjectId): Promise<Notification> {
		const result = await this.notificationModel
			.findOneAndUpdate(
				{ _id: notificationId, receiverId: memberId },
				{ notificationStatus: NotificationStatus.READ },
				{ new: true },
			)
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	public async getUnreadNotificationCount(memberId: ObjectId): Promise<number> {
		return await this.notificationModel
			.countDocuments({ receiverId: shapeIntoMongoObjectId(memberId), notificationStatus: NotificationStatus.WAIT })
			.exec();
	}

	/** returns how many notifications were unread and are now read */
	public async markAllNotificationsRead(memberId: ObjectId): Promise<number> {
		const result = await this.notificationModel
			.updateMany(
				{ receiverId: shapeIntoMongoObjectId(memberId), notificationStatus: NotificationStatus.WAIT },
				{ notificationStatus: NotificationStatus.READ },
			)
			.exec();
		return result.modifiedCount;
	}
}
