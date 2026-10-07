import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Venue, Venues } from '../../libs/dto/venue/venue';
import { VenueInput, VenueUpdate, VenuesInquiry } from '../../libs/dto/venue/venue.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { VenueStatus } from '../../libs/enums/event.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { T } from '../../libs/types/common';
import { escapeRegExp } from '../../libs/config';
import { VenueLayout, computeLayoutCapacity, getVenueLayoutError, isValidTimezone } from '../../libs/venue-layout';

@Injectable()
export class VenueService {
	private readonly logger = new Logger(VenueService.name);

	constructor(@InjectModel('Venue') private readonly venueModel: Model<Venue>) {}

	/** throws for an invalid timezone or layout and returns the capacity the layout adds up to */
	private assertValidLayoutAndTimezone(timezone?: string, layout?: VenueLayout): number | undefined {
		if (timezone !== undefined && !isValidTimezone(timezone)) throw new BadRequestException(Message.INVALID_VENUE_TIMEZONE);
		if (!layout) return undefined;
		const error = getVenueLayoutError(layout);
		if (error) throw new BadRequestException(error);
		return computeLayoutCapacity(layout);
	}

	public async createVenue(input: VenueInput): Promise<Venue> {
		const venueCapacity = this.assertValidLayoutAndTimezone(input.venueTimezone, input.venueLayout as VenueLayout);
		try {
			return await this.venueModel.create({ ...input, venueCapacity });
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	public async getVenue(venueId: ObjectId): Promise<Venue> {
		const result = await this.venueModel.findOne({ _id: venueId, venueStatus: { $ne: VenueStatus.DELETE } }).exec();
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result;
	}

	/** the creator or an ADMIN can edit */
	public async updateVenue(memberId: ObjectId, memberType: MemberType, input: VenueUpdate): Promise<Venue> {
		const venueCapacity = this.assertValidLayoutAndTimezone(input.venueTimezone, input.venueLayout as VenueLayout);
		const search: T = { _id: input._id, venueStatus: { $ne: VenueStatus.DELETE } };
		if (memberType !== MemberType.ADMIN) search.memberId = memberId;

		const update: T = venueCapacity === undefined ? input : { ...input, venueCapacity };
		const result = await this.venueModel.findOneAndUpdate(search, update, { new: true }).exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	public async getVenues(input: VenuesInquiry): Promise<Venues> {
		const { cityList, typeList, text } = input.search;
		const match: T = { venueStatus: VenueStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (cityList && cityList.length) match.venueCity = { $in: cityList };
		if (typeList && typeList.length) match.venueType = { $in: typeList };
		if (text) match.venueName = { $regex: new RegExp(escapeRegExp(text), 'i') };

		const result = await this.venueModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}
}
