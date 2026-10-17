import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Like, MeLiked } from '../../libs/dto/like/like';
import { Model, ObjectId } from 'mongoose';
import { LikeInput } from '../../libs/dto/like/like.input';
import { Message } from '../../libs/enums/common.enum';
import { T } from '../../libs/types/common';
import { LikeGroup } from '../../libs/enums/like.enum';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { Events } from '../../libs/dto/event/event';
import { publicEventFilterAt } from '../../libs/event-visibility';
import { lookupFavorite } from '../../libs/config';
import { MemberStatus } from '../../libs/enums/member.enum';

@Injectable()
export class LikeService {
	private readonly logger = new Logger(LikeService.name);

    constructor(@InjectModel('Like') private readonly likeModel: Model<Like>) {}

    public async toggleLike(input: LikeInput): Promise<number> {
        const search: T = { memberId: input.memberId, likeRefId: input.likeRefId, likeGroup: input.likeGroup };
        const exist = await this.likeModel.findOne(search).exec();
        let modifier = 1;

        if (exist) {
            await this.likeModel.findOneAndDelete(search).exec();
            modifier = -1;
        } else {
            try {
                await this.likeModel.create(input);
            } catch (err) {
                this.logger.error(`Error, Service.model: ${err.message}`);
                throw new BadRequestException(Message.CREATE_FAILED);
            }
        }

        this.logger.log(`- Like modifier ${modifier} -`);
        return modifier;
    }

    public async checkLikeExistence(input: LikeInput): Promise<MeLiked[]> {
        const { memberId, likeRefId, likeGroup } = input;
        const result = await this.likeModel
            .findOne({ memberId: memberId, likeRefId: likeRefId, likeGroup: likeGroup })
            .exec();
        return result ? [{ memberId: memberId, likeRefId: likeRefId, myFavorite: true }] : [];
    }

    public async getFavoriteEvents(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
        const { page, limit } = input;
        const match: T = { likeGroup: LikeGroup.EVENT, memberId: memberId };

        const data: T = await this.likeModel
        .aggregate([
            { $match: match },
            { $sort: { updatedAt: -1 } },
            {
              $lookup: {
                    from: 'events',
                    localField: 'likeRefId',
                    foreignField: '_id',
                    as: 'favoriteEvent',
                },
            },
            { $unwind: '$favoriteEvent' },
            // only public events (APPROVED and not ended, #121)
            { $match: publicEventFilterAt('favoriteEvent') },
            lookupFavorite,
            { $unwind: '$favoriteEvent.memberData' },
            // events of an organizer that is not ACTIVE are hidden
            { $match: { 'favoriteEvent.memberData.memberStatus': MemberStatus.ACTIVE } },
            {
              $facet: {
                    list: [
                        { $skip: (page - 1) * limit }, 
                        { $limit: limit }, 
                        // every row of this list is a like of the caller, so the heart is on
                        { $set: { 'favoriteEvent.meLiked': [{ memberId: '$memberId', likeRefId: '$likeRefId', myFavorite: true }] } },
                    ],
                    metaCounter: [{ $count: 'total' }]
                },
            },

        ])
        .exec();

        const result: Events = { list: [], metaCounter: data[0]?.metaCounter ?? [] };
        result.list = (data[0]?.list ?? []).map((ele) => ele.favoriteEvent);
        return result;
    }


}

