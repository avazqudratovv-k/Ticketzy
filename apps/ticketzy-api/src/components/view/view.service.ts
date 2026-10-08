import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { View } from '../../libs/dto/view/view';
import { ViewInput } from '../../libs/dto/view/view.input';
import { Events } from '../../libs/dto/event/event';
import { publicEventStatus } from '../../libs/enums/event.enum';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { T } from '../../libs/types/common';
import { ViewGroup } from '../../libs/enums/view.enum';
import { lookupVisit } from '../../libs/config';
import { MemberStatus } from '../../libs/enums/member.enum';

@Injectable()
export class ViewService {
	private readonly logger = new Logger(ViewService.name);

	constructor(@InjectModel('View') private readonly viewModel: Model<View>) {}

	/**
	 * Idempotent and safe under concurrent requests: one upsert on the unique key, so only the call that inserts gets a View.
	 * When two upserts race, the loser hits the duplicate key (11000); it retries once and then matches the existing view.
	 * It never throws: a failed view must not fail the request that asked for it.
	 */
	public async recordView(input: ViewInput): Promise<View | null> {
		const { memberId, viewRefId, viewGroup } = input;
		const filter = { memberId: memberId, viewRefId: viewRefId, viewGroup: viewGroup };

		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				const now = new Date();
				// timestamps are set by hand so that seeing a view again does not touch its updatedAt (the visited list sorts by it)
				const result = await this.viewModel
					.updateOne(filter, { $setOnInsert: { ...filter, createdAt: now, updatedAt: now } }, { upsert: true, timestamps: false })
					.exec();
				if (!result.upsertedCount) return null; // already seen
				this.logger.log('- New View Insert -');
				return { _id: result.upsertedId, ...filter } as unknown as View;
			} catch (err) {
				if (err?.code === 11000 && attempt === 1) continue;
				if (err?.code !== 11000) this.logger.error(`View NOT RECORDED: ${err.message}`);
				return null;
			}
		}
		return null;
	}

	public async getVisitedEvents(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
  		const { page, limit } = input;
  		const match: T = { viewGroup: ViewGroup.EVENT, memberId: memberId };

 		const data: T = await this.viewModel
    		.aggregate([
      			{ $match: match },
      			{ $sort: { updatedAt: -1 } },
      			{
        			$lookup: {
          				from: 'events',
          				localField: 'viewRefId',
          				foreignField: '_id',
          				as: 'visitedEvent',
        			},
      			},
      			{ $unwind: '$visitedEvent' },
      			// only APPROVED events are public
      			{ $match: { 'visitedEvent.eventStatus': publicEventStatus } },
      			lookupVisit,
      			{ $unwind: '$visitedEvent.memberData' },
      			// events of an organizer that is not ACTIVE are hidden
      			{ $match: { 'visitedEvent.memberData.memberStatus': MemberStatus.ACTIVE } },
      			{
        			$facet: {
          				list: [
            				{ $skip: (page - 1) * limit },
            				{ $limit: limit },
          				],
          		metaCounter: [{ $count: 'total' }],
        		},
      		},
    	])
    	.exec();

  		const result: Events = { list: [], metaCounter: data[0]?.metaCounter ?? [] };
  		result.list = (data[0]?.list ?? []).map((ele) => ele.visitedEvent);

  		return result;
	}

}
