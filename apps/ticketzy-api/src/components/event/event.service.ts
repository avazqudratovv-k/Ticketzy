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
	EventCategory,
	EventStatus,
	SeatStatus,
	SeatingType,
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
import { CodedException } from '../../libs/coded-exception';
import { EventSeat, EventSeatMap, TakenSeat } from '../../libs/dto/event/event-seat';
import {
	VenueLayout,
	countTierSeats,
	getMissingTierKeys,
	getSeatedSections,
	listLayoutSeats,
} from '../../libs/venue-layout';
import { NotificationService } from '../notification/notification.service';
import { RefundService } from '../refund/refund.service';
import { AiModerationService } from '../ai/ai-moderation.service';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import {
	escapeRegExp,
	lookupActiveOrganizer,
	lookupAuthMemberLiked,
	lookupOrganizer,
	lookupVenue,
	shapeIntoMongoObjectId,
} from '../../libs/config';

import { getSalesWindowError } from '../../libs/sales-window';
import { attachSeatCounts } from '../../libs/seat-counts';
import { attachPossibleVenueConflicts, buildVenueClashFilter, formatVenueBookedMessage } from '../../libs/venue-conflicts';

const SEAT_BULK_SIZE = 5000;

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
	event: Pick<Event, 'eventTitle' | 'eventImages' | 'startAt' | 'endAt' | 'saleStartAt' | 'saleEndAt'> & { seatingType?: SeatingType },
	venueUsable: boolean,
	ticketTypeCount: number,
	now: Date = new Date(),
	seating?: { venueLayout?: VenueLayout | null; tierKeys: (string | undefined)[] },
): Message | null => {
	if (!event.eventTitle?.trim()) return Message.EVENT_SUBMIT_TITLE_REQUIRED;
	if (!event.eventImages?.length) return Message.EVENT_SUBMIT_IMAGE_REQUIRED;
	if (!(moment(event.startAt).isAfter(now) && moment(event.endAt).isAfter(now))) return Message.EVENT_SUBMIT_DATES_IN_PAST;
	const salesError = getSalesWindowError(event.endAt, event.saleStartAt, event.saleEndAt);
	if (salesError) return salesError;
	if (!venueUsable) return Message.EVENT_SUBMIT_VENUE_REQUIRED;
	if (ticketTypeCount < 1) return Message.EVENT_SUBMIT_TICKET_TYPE_REQUIRED;
	// the layout is optional for GENERAL events; a RESERVED event needs every SEATED section covered by a ticket type
	if (event.seatingType === SeatingType.RESERVED) {
		if (!getSeatedSections(seating?.venueLayout).length) return Message.EVENT_SUBMIT_LAYOUT_REQUIRED;
		if (getMissingTierKeys(seating.venueLayout, seating.tierKeys).length) return Message.SEAT_TIER_MISSING;
	}
	return null;
};

/** no seat map to show (#114): the code the frontend already reads (`NO_DATA_FOUND`), as a 404 and not a server error */
const noSeatMap = (): CodedException => new CodedException(Message.NO_DATA_FOUND, 'NO_DATA_FOUND', 404);

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
		@InjectModel('EventSeat') private readonly eventSeatModel: Model<EventSeat>,
		private refundService: RefundService,
		private aiModerationService: AiModerationService,
		@InjectModel('Order') private readonly orderModel: Model<any>,
	) {}

	public async createEvent(input: EventInput): Promise<Event> {
		this.assertValidDates(input.startAt, input.endAt, input.saleStartAt, input.saleEndAt);
		await this.assertVenueUsable(input.venueId);
		await this.assertVenueFree(input.venueId, input.startAt, input.endAt);

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
		await this.addSeatCounts([targetEvent]);
		if (isAdmin) await attachPossibleVenueConflicts([targetEvent], this.venueModel, this.eventModel);
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
		this.logger.debug(`match built (${Object.keys(match).join(", ")})`);

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

		await this.addSeatCounts(result[0].list);
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

		if (text) {
			const regex = new RegExp(escapeRegExp(text), 'i');
			const [venueIds, organizerIds] = await Promise.all([
				this.venueModel.distinct('_id', { $or: [{ venueName: regex }, { venueCity: regex }] }),
				this.memberModel.distinct('_id', {
					memberType: MemberType.ORGANIZER,
					$or: [{ memberNick: regex }, { memberFullName: regex }],
				}),
			]);
			// $or keeps the separate venueId / cityList filters above intact
			match.$or = [
				{ eventTitle: regex },
				{ 'eventTranslations.title': regex },
				{ eventCategory: { $in: Object.values(EventCategory).filter((category) => regex.test(category)) } },
				{ venueId: { $in: venueIds } },
				{ organizerId: { $in: organizerIds } },
			];
		}
	}

	public async getFavorites(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
		const result = await this.likeService.getFavoriteEvents(memberId, input);
		await this.addSeatCounts(result?.list);
		return result;
	}

	public async getVisited(memberId: ObjectId, input: OrdinaryInquiry): Promise<Events> {
		const result = await this.viewService.getVisitedEvents(memberId, input);
		await this.addSeatCounts(result?.list);
		return result;
	}

	/** seat totals for a whole page in two queries (libs/seat-counts.ts), never one query per event */
	private async addSeatCounts(events: Array<{ _id: ObjectId }> | undefined): Promise<void> {
		if (events?.length) await attachSeatCounts(events, this.ticketTypeModel, this.orderModel);
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

		await this.addSeatCounts(result[0].list);
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
		let seating: { venueLayout?: VenueLayout; tierKeys: string[] } | undefined;
		if (event.seatingType === SeatingType.RESERVED) {
			const [venue, ticketTypes] = await Promise.all([
				this.venueModel.findOne({ _id: event.venueId, venueStatus: VenueStatus.ACTIVE }).select('venueLayout').lean().exec(),
				this.ticketTypeModel.find({ eventId: event._id }).select('tierKey').lean().exec(),
			]);
			seating = { venueLayout: venue?.venueLayout as VenueLayout, tierKeys: ticketTypes.map((ticketType) => ticketType.tierKey) };
		}
		const error = getEventSubmitError(event, !!venueUsable, ticketTypeCount, new Date(), seating);
		if (error) throw new BadRequestException(error);
		await this.assertVenueFree(event.venueId, event.startAt, event.endAt, event._id);

		// conditional on the status we validated, so a concurrent edit or submit cannot slip through
		const result = await this.eventModel
			.findOneAndUpdate(
				{ _id: eventId, organizerId: memberId, eventStatus: event.eventStatus },
				{ $set: { eventStatus: to }, $unset: { rejectReason: '' } },
				{ new: true },
			)
			.exec();
		if (!result) throw new BadRequestException(Message.INVALID_EVENT_TRANSITION);

		// the AI check runs once in the background: it never blocks, approves or rejects (moderateEvent never throws)
		void this.aiModerationService.moderateEvent(result._id).catch((err) => this.logger.error(`Moderation not started: ${err.message}`));
		return result;
	}

	/** the event if it is public (APPROVED, organizer ACTIVE, #28, #30), otherwise NO_DATA_FOUND, the same answer as a missing event */
	public async assertPublicEvent(eventId: ObjectId): Promise<Event> {
		const target: Event = await this.eventModel.findOne({ _id: eventId, eventStatus: publicEventStatus }).lean().exec();
		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		await this.memberService.getMember(null, target.organizerId); // hidden when the organizer is not ACTIVE
		return target;
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

		// an empty list (or a page past the end) is an empty result, not an error (DECISIONS #101)
		const page = result[0] ?? { list: [], metaCounter: [] };
		if (!page.list.length) return page;

		await this.addSeatCounts(page.list);
		await attachPossibleVenueConflicts(page.list, this.venueModel, this.eventModel); // two queries for the whole page
		return page;
	}

	/** content edit by an admin: never changes the status (approving is its own operation) */
	public async updateEventByAdmin(adminId: ObjectId, input: EventUpdate): Promise<Event> {
		const result = await this.applyUpdate({ _id: input._id }, input, false);
		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.EVENT_UPDATED_BY_ADMIN,
			targetType: AuditTargetType.EVENT,
			targetId: result._id,
			meta: { changedFields: Object.keys(input).filter((key) => key !== '_id' && (input as any)[key] !== undefined) },
		});
		return result;
	}

	/** only a DRAFT can be removed: it was never public, so it has no orders */
	public async removeEventByAdmin(adminId: ObjectId, eventId: ObjectId): Promise<Event> {
		const result = await this.eventModel.findOneAndDelete({ _id: eventId, eventStatus: EventStatus.DRAFT }).exec();
		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);

		await this.ticketTypeModel.deleteMany({ eventId: eventId }).exec();
		await this.memberService.memberStatsEditor({ _id: result.organizerId, targetKey: 'memberEvents', modifier: -1 });
		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.EVENT_REMOVED_BY_ADMIN,
			targetType: AuditTargetType.EVENT,
			targetId: result._id,
			meta: { organizerId: result.organizerId, eventTitle: result.eventTitle },
		});
		return result;
	}

	/**
	 * A RESERVED event gets its seats before the status changes, so a layout problem fails the approval with nothing changed.
	 * Seat generation is idempotent: when the status change then loses a race or fails, a retry creates no duplicates.
	 */
	public async approveEventByAdmin(adminId: ObjectId, eventId: ObjectId): Promise<Event> {
		const event: Event = await this.eventModel.findById(eventId).lean().exec();
		const approvable = event && eventTransitions.approve.from.includes(event.eventStatus) && String(event.organizerId) !== String(adminId);
		// the slot is checked again here: another event may have taken it while this one waited for the review
		if (approvable) await this.assertVenueFree(event.venueId, event.startAt, event.endAt, event._id);
		if (approvable && event.seatingType === SeatingType.RESERVED) await this.generateEventSeats(event);

		return await this.changeStatusByAdmin(adminId, eventId, 'approve');
	}

	/**
	 * One EventSeat per seat of every SEATED section, linked to the ticket type with the section's tier key.
	 * Upserts with $setOnInsert, so seats that already exist (even HELD or SOLD ones) are never touched or duplicated.
	 * The ticket type quantities are brought in line with the seats.
	 */
	private async generateEventSeats(event: Event): Promise<void> {
		const [venue, ticketTypes] = await Promise.all([
			this.venueModel.findById(event.venueId).lean().exec(),
			this.ticketTypeModel.find({ eventId: event._id }).select('tierKey').lean().exec(),
		]);
		const layout = venue?.venueLayout as VenueLayout;
		if (!getSeatedSections(layout).length) throw new BadRequestException(Message.EVENT_SUBMIT_LAYOUT_REQUIRED);

		const missing = getMissingTierKeys(layout, ticketTypes.map((ticketType) => ticketType.tierKey));
		if (missing.length) throw new BadRequestException(`${Message.SEAT_TIER_MISSING} Missing: ${missing.join(', ')}`);

		const ticketTypeByTier = new Map<string, TicketType>();
		for (const ticketType of ticketTypes) {
			if (!ticketType.tierKey) continue;
			if (ticketTypeByTier.has(ticketType.tierKey)) throw new BadRequestException(Message.SEAT_TIER_DUPLICATE);
			ticketTypeByTier.set(ticketType.tierKey, ticketType);
		}

		const operations = listLayoutSeats(layout).map((seat) => ({
			updateOne: {
				filter: { eventId: event._id, sectionKey: seat.sectionKey, row: seat.row, number: seat.number },
				update: { $setOnInsert: { ticketTypeId: ticketTypeByTier.get(seat.tierKey)._id, seatStatus: SeatStatus.AVAILABLE } },
				upsert: true,
			},
		}));

		try {
			for (let start = 0; start < operations.length; start += SEAT_BULK_SIZE) {
				await this.eventSeatModel.bulkWrite(operations.slice(start, start + SEAT_BULK_SIZE) as any, { ordered: false });
			}
			await this.ticketTypeModel.bulkWrite(
				[...ticketTypeByTier].map(([tierKey, ticketType]) => ({
					updateOne: { filter: { _id: ticketType._id }, update: { $set: { totalQuantity: countTierSeats(layout, tierKey) } } },
				})) as any,
			);
		} catch (err) {
			this.logger.error(`Seat generation failed for event ${event._id}: ${err.message}`);
			throw new InternalServerErrorException(Message.SEAT_GENERATION_FAILED);
		}
	}

	/**
	 * "No seat map" (#114) is the expected answer for a missing, hidden, cancelled, ended or general admission event and for
	 * a venue without a layout: a `NO_DATA_FOUND` CodedException (404, logged as a warning), never a 500.
	 * public: APPROVED events of ACTIVE organizers; only seats that are not free are listed, and never who holds them.
	 * A hold that has run out counts as free. A logged-in caller's own active holds carry mine and holdExpiresAt.
	 */
	public async getEventSeatMap(eventId: ObjectId, memberId: ObjectId | null = null): Promise<EventSeatMap> {
		const event: Event = await this.eventModel.findOne({ _id: eventId, eventStatus: publicEventStatus }).lean().exec();
		if (!event || event.seatingType !== SeatingType.RESERVED) throw noSeatMap();
		// hidden when the organizer is not ACTIVE: getMember says so with a plain 500, which is not what a client should see here
		await this.memberService.getMember(null, event.organizerId).catch((err) => {
			throw err instanceof InternalServerErrorException && err.message === Message.NO_DATA_FOUND ? noSeatMap() : err;
		});

		const venue = await this.venueModel.findById(event.venueId).lean().exec();
		if (!venue?.venueLayout) throw noSeatMap();

		const now = new Date();
		const seats = await this.eventSeatModel
			.find({
				eventId: event._id,
				$or: [
					{ seatStatus: SeatStatus.SOLD },
					{ seatStatus: SeatStatus.HELD, heldUntil: { $gt: now } }, // an expired hold is a free seat
				],
			})
			.select('sectionKey row number seatStatus heldBy heldUntil -_id')
			.lean()
			.exec();

		return {
			eventId: event._id,
			venueTimezone: venue.venueTimezone,
			venueLayout: venue.venueLayout as VenueLayout,
			seats: seats.map(({ sectionKey, row, number, seatStatus, heldBy, heldUntil }) => {
				const taken: TakenSeat = { sectionKey, row, number, seatStatus };
				if (memberId && seatStatus === SeatStatus.HELD && heldBy && String(heldBy) === String(memberId)) {
					taken.mine = true;
					taken.holdExpiresAt = heldUntil;
				}
				return taken;
			}),
		};
	}

	public async rejectEventByAdmin(adminId: ObjectId, input: EventReasonInput): Promise<Event> {
		const reason = this.requireReason(input.reason, Message.EVENT_REJECT_REASON_REQUIRED);
		return await this.changeStatusByAdmin(adminId, input.eventId, 'reject', reason);
	}

	public async cancelEventByAdmin(adminId: ObjectId, input: EventReasonInput): Promise<Event> {
		return await this.cancelEvent(adminId, input);
	}

	/**
	 * An ACTIVE organizer (the resolver guards that) cancels their own event: same transition, refunds, notifications
	 * and audit log as the admin path. Somebody else's event looks the same as a missing one.
	 */
	public async cancelMyEvent(organizerId: ObjectId, input: EventReasonInput): Promise<Event> {
		return await this.cancelEvent(organizerId, input, organizerId);
	}

	/** shared by both cancel mutations; ownerId is set when the caller may only cancel their own event */
	private async cancelEvent(actorId: ObjectId, input: EventReasonInput, ownerId?: ObjectId): Promise<Event> {
		const reason = this.requireReason(input.reason, Message.EVENT_CANCEL_REASON_REQUIRED);
		const result = await this.changeStatusByAdmin(actorId, input.eventId, 'cancel', reason, ownerId);

		// the organizer's active event counter drops once, when an event is cancelled
		try {
			await this.memberService.memberStatsEditor({ _id: result.organizerId, targetKey: 'memberEvents', modifier: -1 });
		} catch (err) {
			this.logger.error(`memberEvents NOT DECREMENTED for cancelled event ${result._id}: ${err.message}`);
		}
		await this.refundOrdersForCancelledEvent(result, actorId);
		return result;
	}

	/**
	 * Refunds every PAID order of the cancelled event (RefundService works in batches and counts failures).
	 * It runs after the status change is committed and must never throw; a failed order stays PAID and
	 * retryEventRefundsByAdmin finishes it.
	 */
	protected async refundOrdersForCancelledEvent(event: Event, adminId: ObjectId): Promise<void> {
		try {
			const summary = await this.refundService.refundOrdersForCancelledEvent(adminId, event);
			this.logger.log(`Event ${event._id} cancelled: ${summary.refundedCount} order(s) refunded, ${summary.failedCount} failed`);
		} catch (err) {
			this.logger.error(`REFUNDS NOT PROCESSED for cancelled event ${event._id}: ${err.message}`);
		}
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
		ownerId?: ObjectId,
	): Promise<Event> {
		const { from, to } = eventTransitions[action];
		const update: T = { $set: { eventStatus: to } };
		if (action === 'reject') update.$set.rejectReason = reason;
		if (action === 'cancel') update.$set.cancelReason = reason;
		if (action === 'approve') update.$unset = { rejectReason: '' };

		const filter: T = { _id: eventId, eventStatus: { $in: from } };
		if (action === 'approve') filter.organizerId = { $ne: adminId }; // nobody approves their own event
		if (ownerId) filter.organizerId = ownerId;

		const result = await this.eventModel.findOneAndUpdate(filter, update, { new: true }).exec();
		if (!result) {
			const current = await this.eventModel.findById(eventId).lean().exec();
			if (ownerId && (!current || String(current.organizerId) !== String(ownerId))) {
				throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
			}
			if (!current) throw new BadRequestException(Message.NO_DATA_FOUND);
			if (ownerId && action === 'cancel' && closedEventStatuses.includes(current.eventStatus)) {
				throw new BadRequestException(Message.EVENT_ALREADY_CLOSED);
			}
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
		await this.assertSeatLayoutUnlocked(before, input);
		if (input.venueId) await this.assertVenueUsable(input.venueId);
		// only when the slot moves: an unrelated edit of an event that already overlaps (old data) is not blocked
		if (input.venueId || input.startAt || input.endAt) {
			await this.assertVenueFree(input.venueId ?? before.venueId, input.startAt ?? before.startAt, input.endAt ?? before.endAt, before._id);
		}

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

	/**
	 * `venueId` and `seatingType` decide the seat layout (#117). Changing either is refused once the event is APPROVED, and
	 * also while EventSeat rows exist (an event that was approved, edited and then rejected keeps its seats). DRAFT,
	 * REJECTED without seats and (not editable anyway) PENDING may change them. Sending the current value is not a change.
	 */
	private async assertSeatLayoutUnlocked(before: Event, input: EventUpdate): Promise<void> {
		const venueChanges = input.venueId !== undefined && String(input.venueId) !== String(before.venueId);
		const seatingChanges = input.seatingType !== undefined && input.seatingType !== before.seatingType;
		if (!venueChanges && !seatingChanges) return;
		if (before.eventStatus === EventStatus.APPROVED) throw new BadRequestException(Message.EVENT_LAYOUT_LOCKED);
		const seat = await this.eventSeatModel.findOne({ eventId: before._id }).select('_id').lean().exec();
		if (seat) throw new BadRequestException(Message.EVENT_LAYOUT_LOCKED);
	}

	private assertValidDates(startAt: Date, endAt: Date, saleStartAt?: Date, saleEndAt?: Date): void {
		if (moment(endAt).isBefore(startAt)) throw new BadRequestException(Message.BAD_REQUEST);
		const salesError = getSalesWindowError(endAt, saleStartAt, saleEndAt);
		if (salesError) throw new BadRequestException(salesError);
	}

	private async assertVenueUsable(venueId: ObjectId): Promise<void> {
		const venue = await this.venueModel
			.findOne({ _id: shapeIntoMongoObjectId(venueId), venueStatus: VenueStatus.ACTIVE })
			.lean()
			.exec();
		if (!venue) throw new BadRequestException(Message.NO_DATA_FOUND);
	}

	/**
	 * Two events of the same venue record must not overlap in [startAt, endAt) (compared as instants).
	 * DRAFT, REJECTED and CANCELLED events do not block. excludeEventId keeps an event from clashing with itself.
	 * Check then write, so two simultaneous requests could both pass (no transaction without a replica set, decision #83).
	 */
	private async assertVenueFree(venueId: ObjectId, startAt: Date, endAt: Date, excludeEventId?: ObjectId): Promise<void> {
		if (!moment(endAt).isAfter(startAt)) return; // an empty range cannot overlap anything
		const [clash] = await this.eventModel
			.find(buildVenueClashFilter(venueId, startAt, endAt, excludeEventId))
			.sort({ startAt: 1 })
			.limit(1)
			.select('eventTitle startAt endAt')
			.lean()
			.exec();
		if (!clash) return;

		const venue = await this.venueModel.findById(venueId).select('venueTimezone').lean().exec();
		throw new BadRequestException(formatVenueBookedMessage(clash, venue?.venueTimezone));
	}
}
