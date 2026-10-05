import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Member } from 'apps/ticketzy-api/src/libs/dto/member/member';
import { Event } from 'apps/ticketzy-api/src/libs/dto/event/event';
import { Order } from 'apps/ticketzy-api/src/libs/dto/order/order';
import { TicketType } from 'apps/ticketzy-api/src/libs/dto/ticket-type/ticket-type';
import { MemberStatus, MemberType } from 'apps/ticketzy-api/src/libs/enums/member.enum';
import { EventStatus, listedEventStatuses } from 'apps/ticketzy-api/src/libs/enums/event.enum';
import { OrderStatus, TicketTypeStatus } from 'apps/ticketzy-api/src/libs/enums/ticket.enum';
import { Model } from 'mongoose';

@Injectable()
export class BatchService {
	private readonly logger = new Logger('BatchService');

	constructor(
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Order') private readonly orderModel: Model<Order>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
	) {}

	public async batchRollback(): Promise<void> {
		await this.eventModel
			.updateMany(
				{
					eventStatus: { $in: listedEventStatuses },
				},
				{ eventRank: 0 },
			)
			.exec();

		await this.memberModel
			.updateMany(
				{
					memberStatus: MemberStatus.ACTIVE,
					memberType: MemberType.AGENT,
				},
				{ memberRank: 0 },
			)
			.exec();
	}

	public async batchTopEvents(): Promise<void> {
		const events: Event[] = await this.eventModel
			.find({
				eventStatus: { $in: listedEventStatuses },
				eventRank: 0,
			})
			.exec();

		const promisedList = events.map(async (ele: Event) => {
			const { _id, eventLikes, eventViews } = ele;
			const rank = eventLikes * 2 + eventViews * 1;
			return await this.eventModel.findByIdAndUpdate(_id, { eventRank: rank });
		});
		await Promise.all(promisedList);
	}

	public async batchTopAgents(): Promise<void> {
		const agents: Member[] = await this.memberModel
			.find({
				memberType: MemberType.AGENT,
				memberStatus: MemberStatus.ACTIVE,
				memberRank: 0,
			})
			.exec();

		const promisedList = agents.map(async (ele: Member) => {
			const { _id, memberEvents, memberLikes, memberArticles, memberViews } = ele;
			const rank = memberEvents * 5 + memberArticles * 3 + memberLikes * 2 + memberViews * 1;
			return await this.memberModel.findByIdAndUpdate(_id, { memberRank: rank });
		});
		await Promise.all(promisedList);
	}

	/**
	 * PENDING orders past expiresAt become EXPIRED and give their stock back.
	 * The status flip is a conditional update, so an order is only ever released once
	 * even if a buyer pays or cancels at the same moment.
	 */
	public async batchExpireOrders(): Promise<void> {
		const expired = await this.orderModel
			.find({ orderStatus: OrderStatus.PENDING, expiresAt: { $lte: new Date() } })
			.limit(200)
			.lean()
			.exec();

		for (const candidate of expired) {
			const order = await this.orderModel
				.findOneAndUpdate(
					{ _id: candidate._id, orderStatus: OrderStatus.PENDING, expiresAt: { $lte: new Date() } },
					{ orderStatus: OrderStatus.EXPIRED },
					{ new: true },
				)
				.exec();
			if (!order) continue;

			for (const item of order.items) {
				const ticketType = await this.ticketTypeModel
					.findOneAndUpdate(
						{ _id: item.ticketTypeId, soldQuantity: { $gte: item.quantity } },
						{ $inc: { soldQuantity: -item.quantity } },
						{ new: true },
					)
					.exec();
				if (!ticketType) continue;

				await this.ticketTypeModel
					.updateOne(
						{
							_id: ticketType._id,
							ticketTypeStatus: TicketTypeStatus.SOLD_OUT,
							$expr: { $lt: ['$soldQuantity', '$totalQuantity'] },
						},
						{ ticketTypeStatus: TicketTypeStatus.ACTIVE },
					)
					.exec();
				await this.eventModel
					.updateOne({ _id: ticketType.eventId, eventStatus: EventStatus.SOLD_OUT }, { eventStatus: EventStatus.ON_SALE })
					.exec();
			}
		}
		if (expired.length) this.logger.debug(`Checked ${expired.length} expired order(s)`);
	}

	public getHello(): string {
		return 'Welcome to Ticketzy BATCH Server!';
	}
}
