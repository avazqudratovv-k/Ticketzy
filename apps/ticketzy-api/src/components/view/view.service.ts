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

	public async recordView(input: ViewInput): Promise<View | null> {
		const viewExist = await this.checkViewExistence(input);
		if (!viewExist) {
			this.logger.log('- New View Insert -');
			return await this.viewModel.create(input);
		} else return null;
	}

	private async checkViewExistence(input: ViewInput): Promise<View | null> {
		const { memberId, viewRefId, viewGroup } = input;
		const search = { memberId: memberId, viewRefId: viewRefId, viewGroup: viewGroup };
		return await this.viewModel.findOne(search).exec();
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
