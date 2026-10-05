import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Ticket, Tickets } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TicketStatus } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { lookupEvent, lookupTicketType, shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class TicketService {
	constructor(
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
	) {}

	public async getMyTickets(memberId: ObjectId, input: OrdinaryInquiry): Promise<Tickets> {
		const match: T = { ownerId: shapeIntoMongoObjectId(memberId) };

		const result = await this.ticketModel
			.aggregate([
				{ $match: match },
				{ $sort: { createdAt: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupEvent,
							{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
							lookupTicketType,
							{ $unwind: { path: '$ticketTypeData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
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
				{ new: true },
			)
			.exec();
		if (!result) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		return result;
	}
}
