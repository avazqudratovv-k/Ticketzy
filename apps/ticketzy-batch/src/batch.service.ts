import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Member } from 'apps/ticketzy-api/src/libs/dto/member/member';
import { Event } from 'apps/ticketzy-api/src/libs/dto/event/event';
import { Order } from 'apps/ticketzy-api/src/libs/dto/order/order';
import { TicketType } from 'apps/ticketzy-api/src/libs/dto/ticket-type/ticket-type';
import { MemberStatus, MemberType } from 'apps/ticketzy-api/src/libs/enums/member.enum';
import { eventTransitions, publicEventStatus } from 'apps/ticketzy-api/src/libs/enums/event.enum';
import { EventSeat } from 'apps/ticketzy-api/src/libs/dto/event/event-seat';
import { SeatStatus } from 'apps/ticketzy-api/src/libs/enums/event.enum';
import { OrderStatus, TicketTypeStatus } from 'apps/ticketzy-api/src/libs/enums/ticket.enum';
import { Model } from 'mongoose';
import { Notification } from 'apps/ticketzy-api/src/libs/dto/notification/notification';
import { NotificationGroup, NotificationType } from 'apps/ticketzy-api/src/libs/enums/notification.enum';
import { PayoutStatus } from 'apps/ticketzy-api/src/libs/enums/payout.enum';
import { buildPayoutPipeline } from 'apps/ticketzy-api/src/libs/payout';
import { getEventRank, getOrganizerRank } from './lib/rank';
import { expireStaleOrders, releaseExpiredSeatHolds } from 'apps/ticketzy-api/src/libs/order-expiry';

const RANK_WRITE_CHUNK = 500;
/** a payout that became due longer ago than this is only marked as notified, never announced (DECISIONS #119) */
export const PAYOUT_NOTICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PAYOUT_NOTICE_PAGE = 200;
const PAYOUT_NOTICE_MAX_PAGES = 20;

@Injectable()
export class BatchService {
	private readonly logger = new Logger('BatchService');

	constructor(
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('EventSeat') private readonly eventSeatModel: Model<EventSeat>,
		@InjectModel('Notification') private readonly notificationModel: Model<Notification>,
	) {}

	/**
	 * Ranks are computed first and written after, so a rank is never zero in between (DECISIONS #96; the old rollback job
	 * zeroed every rank and the top jobs refilled them 20 and 40 minutes later). Only documents whose rank changed are written.
	 */
	public async batchTopEvents(): Promise<void> {
		const events = await this.eventModel
			.find({ eventStatus: publicEventStatus })
			.select('_id eventLikes eventViews eventRank')
			.lean()
			.exec();

		const operations = events
			.map((ele) => ({ _id: ele._id, rank: getEventRank(ele), current: ele.eventRank }))
			.filter((item) => item.rank !== item.current)
			.map((item) => ({ updateOne: { filter: { _id: item._id }, update: { $set: { eventRank: item.rank } } } }));
		await this.writeInChunks(this.eventModel, operations);
	}

	public async batchTopOrganizers(): Promise<void> {
		const organizers = await this.memberModel
			.find({ memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE })
			.select('_id memberEvents memberLikes memberViews memberRank')
			.lean()
			.exec();

		const operations = organizers
			.map((ele) => ({ _id: ele._id, rank: getOrganizerRank(ele), current: ele.memberRank }))
			.filter((item) => item.rank !== item.current)
			.map((item) => ({ updateOne: { filter: { _id: item._id }, update: { $set: { memberRank: item.rank } } } }));
		await this.writeInChunks(this.memberModel, operations);
	}

	private async writeInChunks(model: Model<any>, operations: any[]): Promise<void> {
		for (let start = 0; start < operations.length; start += RANK_WRITE_CHUNK) {
			await model.bulkWrite(operations.slice(start, start + RANK_WRITE_CHUNK), { ordered: false });
		}
	}

	/**
	 * PENDING_PAYMENT orders past expiresAt become EXPIRED and give their seats or stock back, then every seat whose
	 * hold has run out goes back to AVAILABLE. The code is shared with the API (`libs/order-expiry.ts`), which runs it
	 * lazily when this app is asleep (DECISIONS #102); the status flip is a conditional update, so an order is only ever
	 * released once even if the API, this job, a buyer paying or a cancel happen at the same moment.
	 */
	public async batchExpireOrders(): Promise<void> {
		const models = { orderModel: this.orderModel, ticketTypeModel: this.ticketTypeModel, eventSeatModel: this.eventSeatModel };
		await expireStaleOrders(models);
		await releaseExpiredSeatHolds(models);
	}

	/**
	 * APPROVED events whose endAt has passed become ENDED, and the organizer's completedEvents goes up by one.
	 * The status flip is a conditional update, so an event is only counted once even if two batch runs overlap.
	 * `onlyEventIds` limits the run to those events; the demo seed uses it so that it never ends someone else's event.
	 */
	public async batchEndEvents(onlyEventIds?: unknown[]): Promise<void> {
		const { from, to } = eventTransitions.end;
		const due = await this.eventModel
			.find({ eventStatus: { $in: from }, endAt: { $lte: new Date() }, ...(onlyEventIds ? { _id: { $in: onlyEventIds } } : {}) })
			.select('_id')
			.limit(500)
			.lean()
			.exec();

		let ended = 0;
		for (const candidate of due) {
			const event = await this.eventModel
				.findOneAndUpdate(
					{ _id: candidate._id, eventStatus: { $in: from }, endAt: { $lte: new Date() } },
					{ eventStatus: to },
					{ new: true },
				)
				.exec();
			if (!event) continue;
			ended++;

			try {
				await this.memberModel.updateOne({ _id: event.organizerId }, { $inc: { completedEvents: 1 } }).exec();
			} catch (err) {
				this.logger.error(`completedEvents NOT INCREMENTED for organizer ${event.organizerId} (event ${event._id}): ${err.message}`);
			}
		}
		if (ended) this.logger.debug(`Ended ${ended} event(s)`);
	}

	/**
	 * "Payout is due" notices (DECISIONS #119). The payout status is computed, not stored (#77), so nothing happens when an event
	 * becomes DUE; this job finds DUE events that were never claimed. The claim is one conditional update on the event
	 * (`payoutDueNotifiedAt` still missing): only the run that wins it writes notifications, so two runs or two instances send
	 * one notice per event. A payout that became due more than 7 days ago is claimed but not announced, which is also what
	 * keeps the first run (and old demo data) from sending a burst. A notification that fails after the claim is lost, as
	 * everywhere else (#22).
	 */
	public async batchNotifyDuePayouts(now: Date = new Date()): Promise<number> {
		const oldestToAnnounce = now.getTime() - PAYOUT_NOTICE_MAX_AGE_MS;
		let adminIds: unknown[] | undefined;
		let announced = 0;

		for (let page = 0; page < PAYOUT_NOTICE_MAX_PAGES; page++) {
			const [result] = await this.eventModel
				.aggregate(
					buildPayoutPipeline({ now, payoutStatus: PayoutStatus.DUE, notNotifiedOnly: true, direction: -1, page: { skip: 0, limit: PAYOUT_NOTICE_PAGE } }),
				)
				.exec();
			const rows: any[] = result?.list ?? [];

			for (const row of rows) {
				const claim = await this.eventModel
					.updateOne({ _id: row.eventId, payoutDueNotifiedAt: null }, { $set: { payoutDueNotifiedAt: now } }, { timestamps: false })
					.exec();
				if (claim.modifiedCount !== 1) continue; // another run got it
				if (new Date(row.payoutDate).getTime() < oldestToAnnounce) continue;

				adminIds ??= (await this.memberModel.find({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE }).select('_id').lean().exec()).map((admin) => admin._id);
				try {
					await this.notificationModel.insertMany(this.duePayoutNotifications(row, adminIds));
					announced++;
				} catch (err) {
					this.logger.error(`Payout due notice NOT SENT for event ${row.eventId}: ${err.message}`);
				}
			}
			if (rows.length < PAYOUT_NOTICE_PAGE) break;
		}
		if (announced) this.logger.debug(`Announced ${announced} due payout(s)`);
		return announced;
	}

	/** the organizer is the author of both kinds (a job has no actor), so an admin's inbox shows whose payout it is */
	private duePayoutNotifications(row: any, adminIds: unknown[]): Record<string, unknown>[] {
		const net = Number(row.net).toLocaleString('en-US');
		const base = { notificationType: NotificationType.PAYOUT_DUE, notificationGroup: NotificationGroup.EVENT, authorId: row.organizerId, eventId: row.eventId };
		return [
			{ ...base, receiverId: row.organizerId, notificationTitle: 'Your payout is due', notificationDesc: `Payout for ${row.eventTitle} is due: ${net} KRW` },
			...adminIds.map((adminId) => ({ ...base, receiverId: adminId, notificationTitle: 'A payout is due', notificationDesc: `Payout for ${row.eventTitle} is due: ${net} KRW` })),
		];
	}

	public getHello(): string {
		return 'Welcome to Ticketzy BATCH Server!';
	}
}
