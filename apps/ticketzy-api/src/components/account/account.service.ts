import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDeletionCheck, AccountDeletionResult } from '../../libs/dto/account/account';
import { Event } from '../../libs/dto/event/event';
import { Member } from '../../libs/dto/member/member';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { DeletionBlockReason } from '../../libs/enums/account.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { TicketStatus } from '../../libs/enums/ticket.enum';
import { AccountDeletionBlockedException } from '../../libs/coded-exception';
import { DeletionBlocker, MAX_BLOCKING_EVENT_NAMES, buildBlocker, getEmailReusableAt } from '../../libs/account-deletion';
import { lookupEvent } from '../../libs/config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OrderService } from '../order/order.service';
import { PayoutService } from '../payout/payout.service';
import { SeatService } from '../seat/seat.service';

/**
 * Soft delete of one's own account (DECISIONS #123). The member document, orders, tickets, events and comments all stay as
 * they are; the status becomes DELETE and two tags are added. Nothing is anonymized.
 */
@Injectable()
export class AccountService {
	private readonly logger = new Logger(AccountService.name);

	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		private readonly orderService: OrderService,
		private readonly seatService: SeatService,
		private readonly payoutService: PayoutService,
		private readonly auditLogService: AuditLogService,
	) {}

	/** the organizer's blocking reasons, or an empty list; a buyer is never blocked */
	public async getBlockers(member: Pick<Member, '_id' | 'memberType'>): Promise<DeletionBlocker[]> {
		if (member.memberType !== MemberType.ORGANIZER) return [];
		const now = new Date();
		const inReview = { organizerId: member._id, eventStatus: EventStatus.PENDING };
		// "not ended" is decided by the clock, like the public rule (#121), not by waiting for the batch job
		const notEnded = { organizerId: member._id, eventStatus: EventStatus.APPROVED, endAt: { $gt: now } };

		const [reviewCount, reviewRows, openCount, openRows, payouts] = await Promise.all([
			this.eventModel.countDocuments(inReview).exec(),
			this.eventModel.find(inReview).sort({ createdAt: 1 }).limit(MAX_BLOCKING_EVENT_NAMES).select('eventTitle').lean().exec(),
			this.eventModel.countDocuments(notEnded).exec(),
			this.eventModel.find(notEnded).sort({ startAt: 1 }).limit(MAX_BLOCKING_EVENT_NAMES).select('eventTitle').lean().exec(),
			this.payoutService.getOpenPayoutsOf(member._id, MAX_BLOCKING_EVENT_NAMES),
		]);

		return [
			buildBlocker(DeletionBlockReason.EVENTS_IN_REVIEW, reviewCount, reviewRows.map((row: any) => row.eventTitle)),
			buildBlocker(DeletionBlockReason.EVENTS_NOT_ENDED, openCount, openRows.map((row: any) => row.eventTitle)),
			buildBlocker(DeletionBlockReason.PAYOUTS_NOT_PAID, payouts.count, payouts.eventNames),
		].filter((blocker): blocker is DeletionBlocker => blocker !== null);
	}

	/** VALID tickets of the buyer for events that have not ended */
	public async countUnusedUpcomingTickets(member: Pick<Member, '_id' | 'memberType'>): Promise<number> {
		if (member.memberType !== MemberType.USER) return 0;
		const [row] = await this.ticketModel
			.aggregate([
				{ $match: { ownerId: member._id, ticketStatus: TicketStatus.VALID } },
				lookupEvent,
				{ $match: { 'eventData.endAt': { $gt: new Date() } } },
				{ $count: 'total' },
			])
			.exec();
		return row?.total ?? 0;
	}

	public async getDeletionCheck(member: Member): Promise<AccountDeletionCheck> {
		const [blockers, unusedUpcomingTickets] = await Promise.all([this.getBlockers(member), this.countUnusedUpcomingTickets(member)]);
		return { canDelete: blockers.length === 0, blockers, unusedUpcomingTickets };
	}

	/**
	 * Order: refuse an organizer who still has open business; flip the status with one conditional update (the lock: a repeat or
	 * a parallel call matches nothing); then, for a buyer, give back holds and cancel unpaid orders; then the audit entry.
	 * Paid tickets are not touched: they stay VALID and check in with the QR or the ticket code (the gate never reads the
	 * buyer's status). If giving back holds fails the account stays deleted: holds and unpaid orders run out by themselves.
	 */
	public async deleteAccount(member: Member): Promise<AccountDeletionResult> {
		const blockers = await this.getBlockers(member);
		if (blockers.length) throw new AccountDeletionBlockedException(Message.ACCOUNT_DELETE_BLOCKED, blockers);

		const deletedAt = new Date();
		const deleted = await this.memberModel
			.findOneAndUpdate(
				{
					_id: member._id,
					memberType: { $in: [MemberType.USER, MemberType.ORGANIZER] },
					memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] },
				},
				{ $set: { memberStatus: MemberStatus.DELETE, deletedAt, emailReusableAt: getEmailReusableAt(deletedAt) } },
				{ new: true },
			)
			.lean()
			.exec();
		if (!deleted) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);

		let releasedSeatHolds = 0;
		let cancelledPendingOrders = 0;
		if (member.memberType === MemberType.USER) {
			try {
				releasedSeatHolds = await this.seatService.releaseAllHoldsOf(member._id);
				cancelledPendingOrders = await this.orderService.cancelAllPendingOrdersOf(member._id);
			} catch (err) {
				this.logger.error(`Holds of deleted member ${member._id} not fully released: ${(err as Error)?.message ?? 'error'}`);
			}
		}

		await this.auditLogService.record({
			actorId: member._id,
			action: AuditAction.ACCOUNT_DELETED_BY_OWNER,
			targetType: AuditTargetType.MEMBER,
			targetId: member._id,
			meta: { memberType: member.memberType, releasedSeatHolds, cancelledPendingOrders },
		});
		return { deleted: true, releasedSeatHolds, cancelledPendingOrders };
	}
}
