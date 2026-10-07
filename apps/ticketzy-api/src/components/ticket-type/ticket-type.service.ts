import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { TicketTypeInput, TicketTypeUpdate } from '../../libs/dto/ticket-type/ticket-type.input';
import { Event } from '../../libs/dto/event/event';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { TicketTypeStatus } from '../../libs/enums/ticket.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Member } from '../../libs/dto/member/member';
import { T } from '../../libs/types/common';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class TicketTypeService {
	private readonly logger = new Logger(TicketTypeService.name);

	constructor(
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	public async createTicketType(memberId: ObjectId, memberType: MemberType, input: TicketTypeInput): Promise<TicketType> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		await this.assertCanManageEvent(eventId, memberId, memberType);

		try {
			const result = await this.ticketTypeModel.create({ ...input, eventId });
			await this.refreshEventMinPrice(eventId);
			return result;
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	public async updateTicketType(memberId: ObjectId, memberType: MemberType, input: TicketTypeUpdate): Promise<TicketType> {
		const target = await this.ticketTypeModel.findById(input._id).lean().exec();
		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		await this.assertCanManageEvent(target.eventId, memberId, memberType);

		const search: T = { _id: input._id };
		// total can never drop below what is already sold
		if (input.totalQuantity !== undefined) search.soldQuantity = { $lte: input.totalQuantity };

		const result = await this.ticketTypeModel.findOneAndUpdate(search, input, { new: true }).exec();
		if (!result) throw new BadRequestException(Message.UPDATE_FAILED);

		await this.refreshEventMinPrice(result.eventId);
		return result;
	}

	public async getTicketTypes(eventId: ObjectId): Promise<TicketType[]> {
		// the ticket types of an event whose organizer is not ACTIVE are hidden, like the event itself
		const event = await this.eventModel.findById(eventId).select('organizerId').lean().exec();
		const organizerActive =
			event && (await this.memberModel.exists({ _id: event.organizerId, memberStatus: MemberStatus.ACTIVE }));
		if (!organizerActive) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return await this.ticketTypeModel.find({ eventId: eventId }).sort({ ticketPrice: 1 }).exec();
	}

	public async getTicketType(ticketTypeId: ObjectId): Promise<TicketType> {
		const result = await this.ticketTypeModel.findById(ticketTypeId).exec();
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result;
	}

	/**
	 * Atomic stock reservation: one conditional update, so concurrent orders can never oversell.
	 * The filter also enforces ACTIVE status, the sale window and maxPerOrder.
	 * Returns null when the reservation is not possible.
	 */
	public async reserve(ticketTypeId: ObjectId, quantity: number): Promise<TicketType | null> {
		const now = new Date();
		const result = await this.ticketTypeModel
			.findOneAndUpdate(
				{
					_id: ticketTypeId,
					ticketTypeStatus: TicketTypeStatus.ACTIVE,
					maxPerOrder: { $gte: quantity },
					$expr: { $lte: [{ $add: ['$soldQuantity', quantity] }, '$totalQuantity'] },
					$and: [
						{ $or: [{ saleStartAt: null }, { saleStartAt: { $lte: now } }] },
						{ $or: [{ saleEndAt: null }, { saleEndAt: { $gte: now } }] },
					],
				},
				{ $inc: { soldQuantity: quantity } },
				{ new: true },
			)
			.exec();
		if (!result) return null;

		if (result.soldQuantity >= result.totalQuantity) {
			await this.ticketTypeModel
				.updateOne(
					{
						_id: ticketTypeId,
						ticketTypeStatus: TicketTypeStatus.ACTIVE,
						$expr: { $gte: ['$soldQuantity', '$totalQuantity'] },
					},
					{ ticketTypeStatus: TicketTypeStatus.SOLD_OUT },
				)
				.exec();
			await this.markEventSoldOutIfExhausted(result.eventId);
		}
		return result;
	}

	/** gives reserved stock back (cancelled or expired order) */
	public async release(ticketTypeId: ObjectId, quantity: number): Promise<void> {
		const result = await this.ticketTypeModel
			.findOneAndUpdate(
				{ _id: ticketTypeId, soldQuantity: { $gte: quantity } },
				{ $inc: { soldQuantity: -quantity } },
				{ new: true },
			)
			.exec();
		if (!result) return;

		await this.ticketTypeModel
			.updateOne(
				{
					_id: ticketTypeId,
					ticketTypeStatus: TicketTypeStatus.SOLD_OUT,
					$expr: { $lt: ['$soldQuantity', '$totalQuantity'] },
				},
				{ ticketTypeStatus: TicketTypeStatus.ACTIVE },
			)
			.exec();
		await this.eventModel
			.updateOne({ _id: result.eventId, eventStatus: EventStatus.SOLD_OUT }, { eventStatus: EventStatus.ON_SALE })
			.exec();
	}

	private async markEventSoldOutIfExhausted(eventId: ObjectId): Promise<void> {
		const available = await this.ticketTypeModel
			.countDocuments({ eventId: eventId, ticketTypeStatus: { $ne: TicketTypeStatus.SOLD_OUT } })
			.exec();
		if (available === 0) {
			await this.eventModel
				.updateOne({ _id: eventId, eventStatus: EventStatus.ON_SALE }, { eventStatus: EventStatus.SOLD_OUT })
				.exec();
		}
	}

	/** keeps events.eventMinPrice in step with the cheapest sellable ticket type */
	private async refreshEventMinPrice(eventId: ObjectId): Promise<void> {
		const [min] = await this.ticketTypeModel
			.aggregate([
				{ $match: { eventId: eventId, ticketTypeStatus: { $ne: TicketTypeStatus.PAUSED } } },
				{ $group: { _id: '$eventId', minPrice: { $min: '$ticketPrice' } } },
			])
			.exec();
		await this.eventModel.updateOne({ _id: eventId }, { eventMinPrice: min?.minPrice ?? 0 }).exec();
	}

	private async assertCanManageEvent(eventId: ObjectId, memberId: ObjectId, memberType: MemberType): Promise<void> {
		const search: T = { _id: eventId, eventStatus: { $ne: EventStatus.DELETE } };
		if (memberType !== MemberType.ADMIN) search.organizerId = memberId;

		const event = await this.eventModel.findOne(search).lean().exec();
		if (!event) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
	}
}
