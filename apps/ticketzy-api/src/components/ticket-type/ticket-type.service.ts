import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { TicketTypeInput, TicketTypeUpdate } from '../../libs/dto/ticket-type/ticket-type.input';
import { Event } from '../../libs/dto/event/event';
import { Venue } from '../../libs/dto/venue/venue';
import { EventSeat } from '../../libs/dto/event/event-seat';
import { Message } from '../../libs/enums/common.enum';
import { SeatingType, closedEventStatuses } from '../../libs/enums/event.enum';
import { TicketTypeStatus } from '../../libs/enums/ticket.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Member } from '../../libs/dto/member/member';
import { T } from '../../libs/types/common';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { countTierSeats } from '../../libs/venue-layout';

@Injectable()
export class TicketTypeService {
	private readonly logger = new Logger(TicketTypeService.name);

	constructor(
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Venue') private readonly venueModel: Model<Venue>,
		@InjectModel('EventSeat') private readonly eventSeatModel: Model<EventSeat>,
	) {}

	public async createTicketType(memberId: ObjectId, memberType: MemberType, input: TicketTypeInput): Promise<TicketType> {
		const eventId = shapeIntoMongoObjectId(input.eventId);
		const event = await this.assertCanManageEvent(eventId, memberId, memberType);
		const totalQuantity = await this.resolveTotalQuantity(event, input.tierKey, input.totalQuantity);

		try {
			const result = await this.ticketTypeModel.create({ ...input, eventId, totalQuantity });
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
		const event = await this.assertCanManageEvent(target.eventId, memberId, memberType);

		const update: T = { ...input };
		if (event.seatingType === SeatingType.RESERVED) {
			if (input.tierKey !== undefined && input.tierKey !== target.tierKey) {
				if (await this.eventSeatModel.exists({ eventId: event._id })) throw new BadRequestException(Message.TICKET_TYPE_TIER_LOCKED);
				update.totalQuantity = await this.resolveTotalQuantity(event, input.tierKey, input.totalQuantity);
			} else if (input.totalQuantity !== undefined) {
				throw new BadRequestException(Message.TICKET_TYPE_QUANTITY_FROM_SEATS);
			}
		}

		const search: T = { _id: input._id };
		// total can never drop below what is already sold
		if (update.totalQuantity !== undefined) search.soldQuantity = { $lte: update.totalQuantity };

		const result = await this.ticketTypeModel.findOneAndUpdate(search, update, { new: true }).exec();
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

	/**
	 * GENERAL events: the client sets the quantity. RESERVED events: it is the number of seats of the SEATED sections
	 * with the ticket type's tier key, and the client cannot set it.
	 */
	private async resolveTotalQuantity(event: Event, tierKey: string | undefined, totalQuantity: number | undefined): Promise<number> {
		if (event.seatingType !== SeatingType.RESERVED) {
			if (totalQuantity === undefined || totalQuantity === null) throw new BadRequestException(Message.TICKET_TYPE_QUANTITY_REQUIRED);
			return totalQuantity;
		}

		if (totalQuantity !== undefined && totalQuantity !== null) throw new BadRequestException(Message.TICKET_TYPE_QUANTITY_FROM_SEATS);
		if (!tierKey) throw new BadRequestException(Message.TICKET_TYPE_TIER_KEY_REQUIRED);

		const venue = await this.venueModel.findById(event.venueId).lean().exec();
		const seats = countTierSeats(venue?.venueLayout, tierKey);
		if (seats < 1) throw new BadRequestException(Message.TICKET_TYPE_TIER_KEY_REQUIRED);
		return seats;
	}

	private async assertCanManageEvent(eventId: ObjectId, memberId: ObjectId, memberType: MemberType): Promise<Event> {
		const search: T = { _id: eventId, eventStatus: { $nin: closedEventStatuses } };
		if (memberType !== MemberType.ADMIN) search.organizerId = memberId;

		const event = await this.eventModel.findOne(search).lean().exec();
		if (!event) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		return event;
	}
}
