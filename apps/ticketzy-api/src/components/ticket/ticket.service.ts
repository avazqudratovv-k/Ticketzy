import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId, PipelineStage } from 'mongoose';
import { Ticket, Tickets } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { TicketsInquiry } from '../../libs/dto/ticket/ticket.input';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TicketStatus, TicketTimeFilter } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { lookupEvent, lookupSeat, lookupTicketType, shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class TicketService {
	constructor(
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
	) {}

	/** the owner's tickets with event, ticket type and seat; UPCOMING means the event has not ended yet */
	public async getMyTickets(memberId: ObjectId, input: TicketsInquiry): Promise<Tickets> {
		const unwindEvent: PipelineStage.Unwind = { $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } };
		const details: PipelineStage.FacetPipelineStage[] = [
			lookupTicketType,
			{ $unwind: { path: '$ticketTypeData', preserveNullAndEmptyArrays: true } },
			lookupSeat,
			{ $unwind: { path: '$seatData', preserveNullAndEmptyArrays: true } },
		];

		const stages: PipelineStage[] = [{ $match: { ownerId: shapeIntoMongoObjectId(memberId) } }];
		let listStages: PipelineStage.FacetPipelineStage[];
		if (input.timeFilter) {
			// the event is needed before paging, so the filter is applied to the right page
			const upcoming = input.timeFilter === TicketTimeFilter.UPCOMING;
			stages.push(
				lookupEvent,
				unwindEvent,
				{ $match: { 'eventData.endAt': upcoming ? { $gte: new Date() } : { $lt: new Date() } } },
				{ $sort: { 'eventData.startAt': upcoming ? 1 : -1, createdAt: -1 } },
			);
			listStages = [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...details];
		} else {
			stages.push({ $sort: { createdAt: -1 } });
			listStages = [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, lookupEvent, unwindEvent, ...details];
		}

		const result = await this.ticketModel
			.aggregate([...stages, { $facet: { list: listStages, metaCounter: [{ $count: 'total' }] } }])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	/** one ticket of the caller, with its qrToken; other members' tickets answer NO_DATA_FOUND */
	public async getTicket(memberId: ObjectId, ticketId: ObjectId): Promise<Ticket> {
		const result = await this.ticketModel
			.aggregate([
				{ $match: { _id: shapeIntoMongoObjectId(ticketId), ownerId: shapeIntoMongoObjectId(memberId) } },
				lookupEvent,
				{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
				lookupTicketType,
				{ $unwind: { path: '$ticketTypeData', preserveNullAndEmptyArrays: true } },
				lookupSeat,
				{ $unwind: { path: '$seatData', preserveNullAndEmptyArrays: true } },
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	/** Gate scan: the event's organizer (or an ADMIN) turns a VALID ticket into USED, exactly once. */
	public async checkInTicket(memberId: ObjectId, memberType: MemberType, ticketCode: string): Promise<Ticket> {
		const ticket = await this.ticketModel.findOne({ ticketCode: ticketCode }).lean().exec();
		if (!ticket) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (memberType !== MemberType.ADMIN) {
			const event = await this.eventModel.findOne({ _id: ticket.eventId, organizerId: memberId }).lean().exec();
			if (!event) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		}

		const result = await this.ticketModel
			.findOneAndUpdate(
				{ _id: ticket._id, ticketStatus: TicketStatus.VALID },
				{ ticketStatus: TicketStatus.USED, checkedInAt: new Date() },
				{ new: true, projection: { qrToken: 0 } },
			)
			.exec();
		if (!result) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		return result;
	}
}
