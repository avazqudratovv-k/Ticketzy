import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { EventService } from '../event/event.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { Comments, Comment } from '../../libs/dto/comment/comment';
import { lookupMember } from '../../libs/config';
import { T } from '../../libs/types/common';


@Injectable()
export class CommentService {
	private readonly logger = new Logger(CommentService.name);

    constructor(
        @InjectModel('Comment') private readonly commentModel: Model<Comment>,
        private readonly eventService: EventService,
        private readonly notificationService: NotificationService,
    ) {}

    public async createComment(memberId: ObjectId, input: CommentInput): Promise<Comment> {
        input.memberId = memberId;

        let result = null;
        try {
            result = await this.commentModel.create(input);
        } catch (err) {
            this.logger.error(`Error, Service.model: ${err.message}`);
            throw new BadRequestException(Message.CREATE_FAILED);
        }
        if (!result) throw new InternalServerErrorException(Message.CREATE_FAILED);

        const notice = {
            notificationType: NotificationType.COMMENT,
            notificationTitle: 'New comment',
            notificationDesc: input.commentContent,
            authorId: memberId,
        };

        // comments exist on events only (CommentGroup has a single value)
        const event = await this.eventService.eventStatsEditor({
            _id: input.commentRefId,
            targetKey: 'eventComments',
            modifier: 1,
        });
        if (event)
            await this.notificationService.createNotification({
                ...notice,
                notificationGroup: NotificationGroup.EVENT,
                receiverId: event.organizerId,
                eventId: input.commentRefId,
            });
        return result;
    }

    public async updateComment(memberId: ObjectId, input: CommentUpdate): Promise<Comment> {
    const { _id } = input;
    const result = await this.commentModel.findOneAndUpdate(
        {
            _id: _id,
            memberId: memberId,
            commentStatus: CommentStatus.ACTIVE,
        },
        input,
        {
            new: true,
        },
    );
        if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
        return result;
    }

    public async getComments(memberId: ObjectId, input: CommentsInquiry): Promise<Comments> {
    const { commentRefId } = input.search;
    const match: T = { commentGroup: CommentGroup.EVENT, commentRefId: commentRefId, commentStatus: CommentStatus.ACTIVE };
    const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

    const result: Comments[] = await this.commentModel.aggregate([
        { $match: match },
        { $sort: sort },
        {
            $facet: {
                list: [
                    { $skip: (input.page - 1) * input.limit },
                    { $limit: input.limit },
                    // meLiked
                    lookupMember,
                    { $unwind: '$memberData' },
                ],
                metaCounter: [{ $count: 'total' }],
            },
        },
    ]).exec();
    if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

    return result[0];
    }

    /** ADMIN */

    public async removeCommentByAdmin(input: ObjectId): Promise<Comment> {
    const result = await this.commentModel.findByIdAndDelete(input).exec();
    if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);
    return result;
    }
}