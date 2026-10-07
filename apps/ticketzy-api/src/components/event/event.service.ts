import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import * as moment from 'moment';
import { Event, Events } from '../../libs/dto/event/event';
import { Direction, Message } from '../../libs/enums/common.enum';
import { OrganizerEventsInquiry, AllEventsInquiry, EventInput, EventsInquiry } from '../../libs/dto/event/event.input';
import { EventUpdate } from '../../libs/dto/event/event.update';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { MemberService } from '../member/member.service';
import { StatisticModifier, T } from '../../libs/types/common';
import { EventStatus, VenueStatus, listedEventStatuses, viewableEventStatuses } from '../../libs/enums/event.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ViewService } from '../view/view.service';
import { LikeService } from '../like/like.service';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { Venue } from '../../libs/dto/venue/venue';
import { NotificationService } from '../notification/notification.service';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import {
	escapeRegExp,
	lookupActiveOrganizer,
	lookupAuthMemberLiked,
	lookupOrganizer,
	lookupVenue,
	shapeIntoMongoObjectId,
} from '../../libs/config';

const closedStatuses = [EventStatus.DELETE, EventStatus.CANCELLED];

@Injectable()
export class EventService {
	private readonly logger = new Logger(EventService.name);

	constructor(
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Venue') private readonly venueModel: Model<Venue>,
		private memberService: MemberService,
		private viewService: ViewService,
		private likeService: LikeService,
		private notificationService: NotificationService,
	) {}

	public async createEvent(input: EventInput): Promise<Event> {
		this.assertValidDates(input.startAt, input.endAt, input.saleStartAt, input.saleEndAt);
		await this.assertVenueUsable(input.venueId);

		try {
			const result = await this.eventModel.create(input);
			await this.memberService.memberStatsEditor({
				_id: result.organizerId,
				targetKey: 'memberEvents',
				modifier: 1,
			});
			return result;
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	public async getEvent(memberId: ObjectId, eventId: ObjectId): Promise<Event> {
		const search: T = {
			_id: eventId,
			eventStatus: { $in: viewableEventStatuses },
		};

		const targetEvent: Event = await this.eventModel.findOne(search).lean().exec();
		if (!targetEvent) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		// an event whose organizer is not ACTIVE is hidden: getMember throws NO_DATA_FOUND for such members,
		// and this runs before any view is recorded
		targetEvent.memberData = await this.memberService.getMember(null, targetEvent.organizerId);

		if (memberId) {
			const viewInput = { memberId: memberId, viewRefId: eventId, viewGroup: ViewGroup.EVENT };
			const newView = await this.viewService.recordView(viewInput);
			if (newView) {
				await this.eventStatsEditor({ _id: eventId, targetKey: 'eventViews', modifier: 1 });
				targetEvent.eventViews++;
			}

			const likeInput = { memberId: memberId, likeRefId: eventId, likeGroup: LikeGroup.EVENT };
			targetEvent.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}

		targetEvent.venueData = await this.venueModel.findById(targetEvent.venueId).lean().exec();
		return targetEvent;
	}

	public async updateEvent(memberId: ObjectId, input: EventUpdate): Promise<Event> {
		const search: T = {
			_id: input._id,
			organizerId: memberId,
			eventStatus: { $ne: EventStatus.DELETE },
		};
		return await this.applyUpdate(search, input);
	}

	public async getEvents(memberId: ObjectId, input: EventsInquiry): Promise<Events> {
		const match: T = { eventStatus: { $in: listedEventStatuses } };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		await this.shapeMatchQuery(match, input);
		this.logger.log(`match: ${JSON.stringify(match)}`);

		const result = await this.eventModel
			.aggregate([
				{ $match: match },
				...lookupActiveOrganizer,
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupAuthMemberLiked(memberId),
							lookupVenue,
							{ $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	private async shapeMatchQuery(match: T, input: EventsInquiry): Promise<void> {
		const { organizerId, venueId, cityList, categoryList, periodsRange, pricesRange, text } = input.search;

		if (organizerId) match.organizerId = shapeIntoMongoObjectId(organizerId);
		if (categoryList && categoryList.length) match.eventCategory = { $in: categoryList };

		if (venueId) match.venueId = shapeIntoMongoObjectId(venueId);
		if (cityList && cityList.length) {
			const venueIds: ObjectId[] = await this.venueModel.distinct('_id', { venueCity: { $in: cityList } });
			if (match.venueId) {
				const wanted = String(match.venueId);
				match.venueId = { $in: venueIds.filter((id) => String(id) === wanted) };
			} else {
				match.venueId = { $in: venueIds };
			}
		}

		if (pricesRange) match.eventMinPrice = { $gte: pricesRange.start, $lte: pricesRange.end };
		if (periodsRange) match.startAt = { $gte: periodsRange.start, $lte: periodsRange.end };

		if (text) match.eventTitle = { $regex: new RegExp(escapeRegExp(text), 'i') };
	}

	public async getFavorites(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
		return await this.likeService.getFavoriteEvents(memberId, input);
	}

	public async getVisited(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
		return await this.viewService.getVisitedEvents(memberId, input);
	}

	public async getOrganizerEvents(memberId: ObjectId, input: OrganizerEventsInquiry): Promise<Events> {
		const { eventStatus } = input.search;
		if (eventStatus === EventStatus.DELETE) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		const match: T = {
			organizerId: shapeIntoMongoObjectId(memberId),
			eventStatus: eventStatus ?? { $ne: EventStatus.DELETE },
		};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		const result = await this.eventModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupOrganizer,
							{ $unwind: '$memberData' },
							lookupVenue,
							{ $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async likeTargetEvent(memberId: ObjectId, likeRefId: ObjectId): Promise<Event> {
		const target: Event = await this.eventModel
			.findOne({ _id: likeRefId, eventStatus: { $in: viewableEventStatuses } })
			.exec();
		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		await this.memberService.getMember(null, target.organizerId); // hidden when the organizer is not ACTIVE

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.EVENT,
		};

		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.eventStatsEditor({ _id: likeRefId, targetKey: 'eventLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);

		if (modifier === 1) {
			await this.notificationService.createNotification({
				notificationType: NotificationType.LIKE,
				notificationGroup: NotificationGroup.EVENT,
				notificationTitle: 'Someone liked your event',
				notificationDesc: target.eventTitle,
				authorId: memberId,
				receiverId: target.organizerId,
				eventId: likeRefId,
			});
		}
		return result;
	}

	/** ADMIN */

	public async getAllEventsByAdmin(input: AllEventsInquiry): Promise<Events> {
		const { eventStatus, eventCategoryList } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (eventStatus) match.eventStatus = eventStatus;
		if (eventCategoryList && eventCategoryList.length) match.eventCategory = { $in: eventCategoryList };

		const result = await this.eventModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupOrganizer,
							{ $unwind: '$memberData' },
							lookupVenue,
							{ $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result[0] || !result[0].list.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async updateEventByAdmin(input: EventUpdate): Promise<Event> {
		const search: T = {
			_id: input._id,
			eventStatus: { $ne: EventStatus.DELETE },
		};
		return await this.applyUpdate(search, input);
	}

	public async removeEventByAdmin(eventId: ObjectId): Promise<Event> {
		const search: T = { _id: eventId, eventStatus: EventStatus.DELETE };
		const result = await this.eventModel.findOneAndDelete(search).exec();
		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);

		return result;
	}

	public async eventStatsEditor(input: StatisticModifier): Promise<Event> {
		const { _id, targetKey, modifier } = input;
		return await this.eventModel
			.findByIdAndUpdate(
				_id,
				{ $inc: { [targetKey]: modifier } },
				{
					new: true,
				},
			)
			.exec();
	}

	/** shared by updateEvent and updateEventByAdmin */
	private async applyUpdate(search: T, input: EventUpdate): Promise<Event> {
		const before: Event = await this.eventModel.findOne(search).lean().exec();
		if (!before) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		this.assertValidDates(
			input.startAt ?? before.startAt,
			input.endAt ?? before.endAt,
			input.saleStartAt ?? before.saleStartAt,
			input.saleEndAt ?? before.saleEndAt,
		);
		if (input.venueId) await this.assertVenueUsable(input.venueId);

		if (input.eventStatus === EventStatus.DELETE) input.deletedAt = moment().toDate();

		const result = await this.eventModel.findOneAndUpdate(search, input, { new: true }).exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		// the organizer's active event counter drops once, when an event first becomes cancelled or deleted
		const wasCounted = !closedStatuses.includes(before.eventStatus);
		const nowClosed = input.eventStatus && closedStatuses.includes(input.eventStatus);
		if (wasCounted && nowClosed) {
			await this.memberService.memberStatsEditor({
				_id: result.organizerId,
				targetKey: 'memberEvents',
				modifier: -1,
			});
		}

		return result;
	}

	private assertValidDates(startAt: Date, endAt: Date, saleStartAt?: Date, saleEndAt?: Date): void {
		if (moment(endAt).isBefore(startAt)) throw new BadRequestException(Message.BAD_REQUEST);
		if (saleStartAt && saleEndAt && moment(saleEndAt).isBefore(saleStartAt))
			throw new BadRequestException(Message.BAD_REQUEST);
	}

	private async assertVenueUsable(venueId: ObjectId): Promise<void> {
		const venue = await this.venueModel
			.findOne({ _id: shapeIntoMongoObjectId(venueId), venueStatus: VenueStatus.ACTIVE })
			.lean()
			.exec();
		if (!venue) throw new BadRequestException(Message.NO_DATA_FOUND);
	}
}
