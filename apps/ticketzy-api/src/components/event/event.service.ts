import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import * as moment from 'moment';
import { Event, Events } from '../../libs/dto/event/event';
import { Direction, Message } from '../../libs/enums/common.enum';
import { OrganizerEventsInquiry, EventsByAdminInquiry, EventInput, EventReasonInput, EventsInquiry } from '../../libs/dto/event/event.input';
import { EventUpdate } from '../../libs/dto/event/event.update';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { MemberService } from '../member/member.service';
import { StatisticModifier, T } from '../../libs/types/common';
import {
	EventStatus,
	VenueStatus,
	closedEventStatuses,
	editableEventStatuses,
	eventTransitions,
	publicEventStatus,
} from '../../libs/enums/event.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Member } from '../../libs/dto/member/member';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
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

/** audit action, notification and wording of each admin transition */
const adminTransitionRecords: Record<
	'approve' | 'reject' | 'cancel',
	{ audit: AuditAction; notification: NotificationType; title: string }
> = {
	approve: { audit: AuditAction.EVENT_APPROVED, notification: NotificationType.EVENT_APPROVED, title: 'Your event was approved' },
	reject: { audit: AuditAction.EVENT_REJECTED, notification: NotificationType.EVENT_REJECTED, title: 'Your event was rejected' },
	cancel: { audit: AuditAction.EVENT_CANCELLED, notification: NotificationType.EVENT_CANCELLED, title: 'Your event was cancelled' },
};

/**
 * The first reason an event cannot be submitted for approval, or null when it can.
 * Pure on purpose: the service passes in what it looked up.
 */
export const getEventSubmitError = (
	event: Pick<Event, 'eventTitle' | 'eventImages' | 'startAt' | 'endAt'>,
	venueUsable: boolean,
	ticketTypeCount: number,
	now: Date = new Date(),
): Message | null => {
	if (!event.eventTitle?.trim()) return Message.EVENT_SUBMIT_TITLE_REQUIRED;
	if (!event.eventImages?.length) return Message.EVENT_SUBMIT_IMAGE_REQUIRED;
	if (!(moment(event.startAt).isAfter(now) && moment(event.endAt).isAfter(now))) return Message.EVENT_SUBMIT_DATES_IN_PAST;
	if (!venueUsable) return Message.EVENT_SUBMIT_VENUE_REQUIRED;
	if (ticketTypeCount < 1) return Message.EVENT_SUBMIT_TICKET_TYPE_REQUIRED;
	return null;
};

@Injectable()
export class EventService {
	private readonly logger = new Logger(EventService.name);

	constructor(
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Venue') private readonly venueModel: Model<Venue>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		private memberService: MemberService,
		private viewService: ViewService,
		private likeService: LikeService,
		private notificationService: NotificationService,
		private auditLogService: AuditLogService,
	) {}

	public async createEvent(input: EventInput): Promise<Event> {
		this.assertValidDates(input.startAt, input.endAt, input.saleStartAt, input.saleEndAt);
		await this.assertVenueUsable(input.venueId);

		try {
			const result = await this.eventModel.create({ ...input, eventStatus: EventStatus.DRAFT });
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

	/**
	 * Everyone sees APPROVED events of ACTIVE organizers. The owner and admins can open their event in any status.
	 * A hidden event answers NO_DATA_FOUND, the same as a missing one.
	 */
	public async getEvent(authMember: Member | null, eventId: ObjectId): Promise<Event> {
		const memberId = authMember?._id;
		const targetEvent: Event = await this.eventModel.findOne({ _id: eventId }).lean().exec();
		if (!targetEvent) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const isAdmin = authMember?.memberType === MemberType.ADMIN;
		const isOwner = !!memberId && String(memberId) === String(targetEvent.organizerId);
		const isPublic = targetEvent.eventStatus === publicEventStatus;
		if (!isPublic && !isOwner && !isAdmin) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (isOwner || isAdmin) {
			targetEvent.memberData = await this.memberModel.findById(targetEvent.organizerId).lean().exec();
		} else {
			// an event whose organizer is not ACTIVE is hidden: getMember throws NO_DATA_FOUND for such members,
			// and this runs before any view is recorded
			targetEvent.memberData = await this.memberService.getMember(null, targetEvent.organizerId);
		}

		if (memberId) {
			if (isPublic) {
				const viewInput = { memberId: memberId, viewRefId: eventId, viewGroup: ViewGroup.EVENT };
				const newView = await this.viewService.recordView(viewInput);
				if (newView) {
					await this.eventStatsEditor({ _id: eventId, targetKey: 'eventViews', modifier: 1 });
					targetEvent.eventViews++;
				}
			}

			const likeInput = { memberId: memberId, likeRefId: eventId, likeGroup: LikeGroup.EVENT };
			targetEvent.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}

		targetEvent.venueData = await this.venueModel.findById(targetEvent.venueId).lean().exec();
		return targetEvent;
	}

	/** DRAFT and REJECTED stay as they are; an APPROVED event goes back to PENDING; PENDING, CANCELLED and ENDED are locked */
	public async updateEvent(memberId: ObjectId, input: EventUpdate): Promise<Event> {
		return await this.applyUpdate({ _id: input._id, organizerId: memberId }, input, true);
	}

	public async getEvents(memberId: ObjectId, input: EventsInquiry): Promise<Events> {
		const match: T = { eventStatus: publicEventStatus };
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

	public async getMyEvents(memberId: ObjectId, input: OrganizerEventsInquiry): Promise<Events> {
		const { eventStatus } = input.search;

		const match: T = { organizerId: shapeIntoMongoObjectId(memberId) };
		if (eventStatus) match.eventStatus = eventStatus;
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

	public async submitEventForApproval(memberId: ObjectId, eventId: ObjectId): Promise<Event> {
		const event: Event = await this.eventModel.findOne({ _id: eventId, organizerId: memberId }).lean().exec();
		if (!event) throw new BadRequestException(Message.NO_DATA_FOUND);

		const { from, to } = eventTransitions.submit;
		if (!from.includes(event.eventStatus)) throw new BadRequestException(Message.INVALID_EVENT_TRANSITION);

		const [venueUsable, ticketTypeCount] = await Promise.all([
			this.venueModel.exists({ _id: event.venueId, venueStatus: VenueStatus.ACTIVE }),
			this.ticketTypeModel.countDocuments({ eventId: event._id }).exec(),
		]);
		const error = getEventSubmitError(event, !!venueUsable, ticketTypeCount);
		if (error) throw new BadRequestException(error);

		// conditional on the status we validated, so a concurrent edit or submit cannot slip through
		const result = await this.eventModel
			.findOneAndUpdate(
				{ _id: eventId, organizerId: memberId, eventStatus: event.eventStatus },
				{ $set: { eventStatus: to }, $unset: { rejectReason: '' } },
				{ new: true },
			)
			.exec();
		if (!result) throw new BadRequestException(Message.INVALID_EVENT_TRANSITION);
		return result;
	}

	public async likeTargetEvent(memberId: ObjectId, likeRefId: ObjectId): Promise<Event> {
		const target: Event = await this.eventModel
			.findOne({ _id: likeRefId, eventStatus: publicEventStatus })
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

	public async getEventsByAdmin(input: EventsByAdminInquiry): Promise<Events> {
		const { eventStatus, eventCategoryList, organizerId, text } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (eventStatus) match.eventStatus = eventStatus;
		if (eventCategoryList && eventCategoryList.length) match.eventCategory = { $in: eventCategoryList };
		if (organizerId) match.organizerId = shapeIntoMongoObjectId(organizerId);
		if (text) {
			const regex = { $regex: new RegExp(escapeRegExp(text), 'i') };
			match.$or = [{ eventTitle: regex }, { 'eventTranslations.title': regex }];
		}

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

	/** content edit by an admin: never changes the status (approving is its own operation) */
	public async updateEventByAdmin(input: EventUpdate): Promise<Event> {
		return await this.applyUpdate({ _id: input._id }, input, false);
	}

	/** only a DRAFT can be removed: it was never public, so it has no orders */
	public async removeEventByAdmin(eventId: ObjectId): Promise<Event> {
		const result = await this.eventModel.findOneAndDelete({ _id: eventId, eventStatus: EventStatus.DRAFT }).exec();
		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);

		await this.ticketTypeModel.deleteMany({ eventId: eventId }).exec();
		await this.memberService.memberStatsEditor({ _id: result.organizerId, targetKey: 'memberEvents', modifier: -1 });
		return result;
	}

	public async approveEventByAdmin(adminId: ObjectId, eventId: ObjectId): Promise<Event> {
		return await this.changeStatusByAdmin(adminId, eventId, 'approve');
	}

	public async rejectEventByAdmin(adminId: ObjectId, input: EventReasonInput): Promise<Event> {
		const reason = this.requireReason(input.reason, Message.EVENT_REJECT_REASON_REQUIRED);
		return await this.changeStatusByAdmin(adminId, input.eventId, 'reject', reason);
	}

	public async cancelEventByAdmin(adminId: ObjectId, input: EventReasonInput): Promise<Event> {
		const reason = this.requireReason(input.reason, Message.EVENT_CANCEL_REASON_REQUIRED);
		const result = await this.changeStatusByAdmin(adminId, input.eventId, 'cancel', reason);

		// the organizer's active event counter drops once, when an event is cancelled
		try {
			await this.memberService.memberStatsEditor({ _id: result.organizerId, targetKey: 'memberEvents', modifier: -1 });
		} catch (err) {
			this.logger.error(`memberEvents NOT DECREMENTED for cancelled event ${result._id}: ${err.message}`);
		}
		await this.refundOrdersForCancelledEvent(result);
		return result;
	}

	/**
	 * Hook for the refund flow (a later task): cancelling only marks the event CANCELLED for now.
	 * It runs after the status change is committed and must never throw.
	 */
	protected async refundOrdersForCancelledEvent(event: Event): Promise<void> {
		this.logger.warn(`Event ${event._id} cancelled: refunds for its PAID orders are not implemented yet`);
	}

	/**
	 * One conditional update: it only matches when the event is in a status the action may start from,
	 * so two admins acting at once cannot both succeed. Audit and notification run after it and never throw.
	 */
	private async changeStatusByAdmin(
		adminId: ObjectId,
		eventId: ObjectId,
		action: 'approve' | 'reject' | 'cancel',
		reason?: string,
	): Promise<Event> {
		const { from, to } = eventTransitions[action];
		const update: T = { $set: { eventStatus: to } };
		if (action === 'reject') update.$set.rejectReason = reason;
		if (action === 'cancel') update.$set.cancelReason = reason;
		if (action === 'approve') update.$unset = { rejectReason: '' };

		const filter: T = { _id: eventId, eventStatus: { $in: from } };
		if (action === 'approve') filter.organizerId = { $ne: adminId }; // nobody approves their own event

		const result = await this.eventModel.findOneAndUpdate(filter, update, { new: true }).exec();
		if (!result) {
			const current = await this.eventModel.findById(eventId).lean().exec();
			if (!current) throw new BadRequestException(Message.NO_DATA_FOUND);
			if (action === 'approve' && String(current.organizerId) === String(adminId)) {
				throw new BadRequestException(Message.CANNOT_APPROVE_OWN_EVENT);
			}
			throw new BadRequestException(Message.INVALID_EVENT_TRANSITION);
		}

		const record = adminTransitionRecords[action];
		await this.auditLogService.record({
			actorId: adminId,
			action: record.audit,
			targetType: AuditTargetType.EVENT,
			targetId: result._id,
			meta: { fromEventStatus: from[0], toEventStatus: to, ...(reason ? { reason } : {}) },
		});
		await this.notificationService.createNotification({
			notificationType: record.notification,
			notificationGroup: NotificationGroup.EVENT,
			notificationTitle: record.title,
			notificationDesc: reason ?? result.eventTitle,
			authorId: adminId,
			receiverId: result.organizerId,
			eventId: result._id,
		});
		return result;
	}

	private requireReason(reason: string | undefined, message: Message): string {
		const trimmed = reason?.trim();
		if (!trimmed) throw new BadRequestException(message);
		return trimmed;
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

	/**
	 * shared by updateEvent and updateEventByAdmin.
	 * sendApprovedBackToPending: an organizer's edit of an APPROVED event needs a new review.
	 */
	private async applyUpdate(search: T, input: EventUpdate, sendApprovedBackToPending: boolean): Promise<Event> {
		const before: Event = await this.eventModel.findOne(search).lean().exec();
		if (!before) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		const editable = sendApprovedBackToPending
			? editableEventStatuses
			: Object.values(EventStatus).filter((status) => !closedEventStatuses.includes(status));
		if (!editable.includes(before.eventStatus)) throw new BadRequestException(Message.EVENT_NOT_EDITABLE);

		this.assertValidDates(
			input.startAt ?? before.startAt,
			input.endAt ?? before.endAt,
			input.saleStartAt ?? before.saleStartAt,
			input.saleEndAt ?? before.saleEndAt,
		);
		if (input.venueId) await this.assertVenueUsable(input.venueId);

		const { _id, ...fields } = input;
		const update: T = { ...fields };
		if (sendApprovedBackToPending && before.eventStatus === EventStatus.APPROVED) {
			update.eventStatus = eventTransitions.submit.to;
		}

		// conditional on the status we checked, so it cannot race with an approval, a rejection or a cancellation
		const result = await this.eventModel
			.findOneAndUpdate({ ...search, eventStatus: before.eventStatus }, update, { new: true })
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
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
