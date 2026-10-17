import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Event } from '../../libs/dto/event/event';
import { PayoutRow, Payouts } from '../../libs/dto/payout/payout';
import { MarkPayoutPaidInput, PayoutsByAdminInquiry, PayoutsInquiry } from '../../libs/dto/payout/payout.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { PayoutStatus } from '../../libs/enums/payout.enum';
import { PayoutPipelineOptions, buildPayoutPipeline, shapePayoutTotals } from '../../libs/payout';
import { escapeRegExp, shapeIntoMongoObjectId } from '../../libs/config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationService } from '../notification/notification.service';

const DUPLICATE_KEY = 11000;

/**
 * Mock payouts to organizers: one per event, due 3 days after the event ends. The list and the numbers are computed from
 * the PAID orders (and the commission stored on each); a Payout document exists only after an admin marked the event as paid.
 */
@Injectable()
export class PayoutService {
	private readonly logger = new Logger(PayoutService.name);

	constructor(
		@InjectModel('Payout') private readonly payoutModel: Model<any>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		private readonly notificationService: NotificationService,
		private readonly auditLogService: AuditLogService,
	) {}

	/** the organizer's own events only: the organizer id always comes from the token */
	public async getMyPayouts(organizerId: ObjectId, input: PayoutsInquiry): Promise<Payouts> {
		return await this.list({
			now: new Date(),
			organizerId: shapeIntoMongoObjectId(organizerId),
			payoutStatus: input.payoutStatus,
			direction: this.direction(input),
			page: { skip: (input.page - 1) * input.limit, limit: input.limit },
		});
	}

	/**
	 * Account deletion (#123): the organizer's payouts that are not finished, NOT_YET_DUE and DUE (NOTHING_TO_PAY and PAID_OUT
	 * do not count). Same pipeline and same status rule as the payout list, so the two always agree. Count is the full number,
	 * titles are the first rows.
	 */
	public async getOpenPayoutsOf(organizerId: ObjectId, titleLimit: number): Promise<{ count: number; eventNames: string[] }> {
		const now = new Date();
		const owner = shapeIntoMongoObjectId(organizerId);
		const read = async (payoutStatus: PayoutStatus) =>
			await this.list({ now, organizerId: owner, payoutStatus, direction: 1, page: { skip: 0, limit: titleLimit } });
		const [notYetDue, due] = await Promise.all([read(PayoutStatus.NOT_YET_DUE), read(PayoutStatus.DUE)]);
		return {
			count: (notYetDue.metaCounter?.[0]?.total ?? 0) + (due.metaCounter?.[0]?.total ?? 0),
			eventNames: [...due.list, ...notYetDue.list].map((row) => row.eventTitle),
		};
	}

	public async getPayoutsByAdmin(input: PayoutsByAdminInquiry): Promise<Payouts> {
		if (input.dateFrom && input.dateTo && input.dateFrom.getTime() > input.dateTo.getTime()) {
			throw new BadRequestException(Message.PAYOUT_INVALID_DATE_RANGE);
		}
		const text = input.text?.trim();
		return await this.list({
			now: new Date(),
			organizerId: input.organizerId ? shapeIntoMongoObjectId(input.organizerId) : undefined,
			titleRegex: text ? new RegExp(escapeRegExp(text), 'i') : undefined,
			dateFrom: input.dateFrom,
			dateTo: input.dateTo,
			payoutStatus: input.payoutStatus,
			direction: this.direction(input),
			page: { skip: (input.page - 1) * input.limit, limit: input.limit },
			withOrganizer: true,
		});
	}

	/**
	 * Refusals, in this order: unknown event, already paid out, payout date not reached, nothing to pay. The amount is
	 * computed again right here and stored as a snapshot. The unique index on eventId decides a race between two admins:
	 * the loser gets PAYOUT_ALREADY_PAID and sends no second notification.
	 */
	public async markPayoutPaidByAdmin(adminId: ObjectId, input: MarkPayoutPaidInput): Promise<PayoutRow> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		const exists = await this.eventModel.exists({ _id: eventId });
		if (!exists) throw new BadRequestException(Message.PAYOUT_EVENT_NOT_FOUND);

		const now = new Date();
		const [row] = (await this.list({ now, eventId })).list;
		if (row?.payoutStatus === PayoutStatus.PAID_OUT) throw new BadRequestException(Message.PAYOUT_ALREADY_PAID);
		// a DRAFT, PENDING or REJECTED event has no payout row at all
		if (!row) throw new BadRequestException(Message.PAYOUT_NOTHING_TO_PAY);
		if (new Date(row.payoutDate).getTime() > now.getTime()) throw new BadRequestException(Message.PAYOUT_NOT_DUE_YET);
		if (row.payoutStatus !== PayoutStatus.DUE) throw new BadRequestException(Message.PAYOUT_NOTHING_TO_PAY);

		const note = input.note?.trim() || undefined;
		let payout: any;
		try {
			payout = await this.payoutModel.create({
				eventId: eventId,
				organizerId: row.organizerId,
				gross: row.gross,
				commission: row.commission,
				net: row.net,
				orderCount: row.orderCount,
				paidAt: now,
				paidBy: adminId,
				note: note,
			});
		} catch (err) {
			if (err?.code === DUPLICATE_KEY) throw new BadRequestException(Message.PAYOUT_ALREADY_PAID);
			this.logger.error(`Error, PayoutService.markPayoutPaidByAdmin: ${err.message}`);
			throw new InternalServerErrorException(Message.CREATE_FAILED);
		}

		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.PAYOUT_MARKED_PAID,
			targetType: AuditTargetType.EVENT,
			targetId: eventId,
			meta: { reason: note, payoutId: payout._id, organizerId: row.organizerId, gross: row.gross, commission: row.commission, net: row.net, orderCount: row.orderCount },
		});
		await this.notificationService.createNotification({
			notificationType: NotificationType.PAYOUT_PAID,
			notificationGroup: NotificationGroup.EVENT,
			notificationTitle: 'Your payout was marked as paid',
			notificationDesc: `${row.eventTitle}: ${row.net.toLocaleString('en-US')} KRW`,
			authorId: adminId,
			receiverId: row.organizerId,
			eventId: eventId,
		});

		return { ...row, payoutId: payout._id, payoutStatus: PayoutStatus.PAID_OUT, paidAt: now, paidBy: adminId, note: note };
	}

	private direction(input: PayoutsInquiry): 1 | -1 {
		return (input.direction ?? Direction.DESC) as 1 | -1;
	}

	private async list(options: PayoutPipelineOptions): Promise<Payouts> {
		const [result] = await this.eventModel.aggregate(buildPayoutPipeline(options)).exec();
		return {
			list: result?.list ?? [],
			metaCounter: result?.metaCounter ?? [],
			totals: shapePayoutTotals(result?.totals),
		};
	}
}
