import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId, PipelineStage } from 'mongoose';
import { Ticket, Tickets } from '../../libs/dto/ticket/ticket';
import { Event } from '../../libs/dto/event/event';
import { Member } from '../../libs/dto/member/member';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { EventSeat } from '../../libs/dto/event/event-seat';
import { CheckInResult } from '../../libs/dto/ticket/check-in';
import { EventStatus } from '../../libs/enums/event.enum';
import { normalizeTicketCode, parseQrToken } from '../../libs/qr-token';
import { TicketsInquiry } from '../../libs/dto/ticket/ticket.input';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { TicketStatus, TicketTimeFilter } from '../../libs/enums/ticket.enum';
import { T } from '../../libs/types/common';
import { lookupEventWithVenue, lookupSeat, lookupTicketType, shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class TicketService {
	constructor(
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('EventSeat') private readonly eventSeatModel: Model<EventSeat>,
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
				lookupEventWithVenue,
				unwindEvent,
				{ $match: { 'eventData.endAt': upcoming ? { $gte: new Date() } : { $lt: new Date() } } },
				{ $sort: { 'eventData.startAt': upcoming ? 1 : -1, createdAt: -1 } },
			);
			listStages = [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...details];
		} else {
			stages.push({ $sort: { createdAt: -1 } });
			listStages = [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, lookupEventWithVenue, unwindEvent, ...details];
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
				lookupEventWithVenue,
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

	/** Gate scan: validates the QR code and turns a VALID ticket into USED, exactly once. */
	public async checkInTicket(memberId: ObjectId, memberType: MemberType, qrToken: string, eventId?: ObjectId): Promise<CheckInResult> {
		const ticket = await this.validateScan(memberId, memberType, qrToken, eventId);
		return await this.markUsed(ticket);
	}

	/** The same checks as checkInTicket, and nothing is changed. */
	public async checkInPreview(memberId: ObjectId, memberType: MemberType, qrToken: string, eventId?: ObjectId): Promise<CheckInResult> {
		const ticket = await this.validateScan(memberId, memberType, qrToken, eventId);
		return await this.buildPreview(ticket);
	}

	/** Gate fallback when the camera fails: the ticket code printed under the QR code, for one event (#116). Same rules and same update as the QR path. */
	public async checkInTicketByCode(memberId: ObjectId, memberType: MemberType, eventId: ObjectId, ticketCode: string): Promise<CheckInResult> {
		const ticket = await this.validateCodeScan(memberId, memberType, eventId, ticketCode);
		return await this.markUsed(ticket);
	}

	/** Preview by ticket code: the same checks as checkInTicketByCode, nothing is changed. */
	public async checkInPreviewByCode(memberId: ObjectId, memberType: MemberType, eventId: ObjectId, ticketCode: string): Promise<CheckInResult> {
		const ticket = await this.validateCodeScan(memberId, memberType, eventId, ticketCode);
		return await this.buildPreview(ticket);
	}

	/** one conditional update: of two simultaneous scans only one matches VALID */
	private async markUsed(ticket: Ticket): Promise<CheckInResult> {
		const result = await this.ticketModel
			.findOneAndUpdate(
				{ _id: ticket._id, ticketStatus: TicketStatus.VALID },
				{ ticketStatus: TicketStatus.USED, checkedInAt: new Date() },
				{ new: true, projection: { qrToken: 0 } },
			)
			.lean()
			.exec();
		if (!result) {
			const current = await this.ticketModel.findOne({ _id: ticket._id }).select('ticketStatus').lean().exec();
			throw new BadRequestException(this.statusMessage(current?.ticketStatus));
		}
		return await this.buildResult(result);
	}

	private async buildPreview(ticket: Ticket): Promise<CheckInResult> {
		const { qrToken: _hidden, ...visible } = ticket;
		return await this.buildResult(visible as Ticket);
	}

	/**
	 * The signature is verified first, with no database access, so forged or garbled codes never reach the database.
	 * Then: the ticket exists with this exact token, belongs to the scanner's event (and the event the gate is set to,
	 * when given), the event is APPROVED, and the ticket is VALID.
	 */
	private async validateScan(memberId: ObjectId, memberType: MemberType, qrToken: string, eventId?: ObjectId): Promise<Ticket> {
		const ticketId = parseQrToken(qrToken);
		if (!ticketId) throw new BadRequestException(Message.QR_INVALID);

		const ticket = await this.ticketModel.findOne({ _id: ticketId, qrToken: qrToken.trim() }).lean().exec();
		if (!ticket) throw new BadRequestException(Message.QR_INVALID);

		if (eventId && String(ticket.eventId) !== String(eventId)) throw new BadRequestException(Message.TICKET_WRONG_EVENT);
		return await this.assertScannable(ticket, memberId, memberType);
	}

	/**
	 * By ticket code the event comes first: the scanner must own it (or be an admin), otherwise the answer is the same
	 * generic not-found as for a bad format, an unknown code or a code of another event, so nothing reveals whether a code
	 * exists. The remaining rules are the ones of the QR path.
	 */
	private async validateCodeScan(memberId: ObjectId, memberType: MemberType, eventId: ObjectId, ticketCode: string): Promise<Ticket> {
		const code = normalizeTicketCode(ticketCode);
		if (!code) throw new BadRequestException(Message.TICKET_CODE_NOT_FOUND);

		const event = await this.eventModel.findOne({ _id: eventId }).select('organizerId').lean().exec();
		if (!event || (memberType !== MemberType.ADMIN && String(event.organizerId) !== String(memberId))) {
			throw new BadRequestException(Message.TICKET_CODE_NOT_FOUND);
		}

		const ticket = await this.ticketModel.findOne({ ticketCode: code, eventId }).lean().exec();
		if (!ticket) throw new BadRequestException(Message.TICKET_CODE_NOT_FOUND);
		return await this.assertScannable(ticket, memberId, memberType);
	}

	/** the rules both paths share: owning organizer (or admin), event APPROVED, ticket VALID */
	private async assertScannable(ticket: Ticket, memberId: ObjectId, memberType: MemberType): Promise<Ticket> {
		const event = await this.eventModel.findOne({ _id: ticket.eventId }).lean().exec();
		if (!event) throw new BadRequestException(Message.QR_INVALID);
		if (memberType !== MemberType.ADMIN && String(event.organizerId) !== String(memberId)) {
			throw new BadRequestException(Message.TICKET_WRONG_ORGANIZER);
		}
		if (event.eventStatus !== EventStatus.APPROVED) throw new BadRequestException(Message.EVENT_NOT_OPEN_FOR_CHECKIN);
		if (ticket.ticketStatus !== TicketStatus.VALID) throw new BadRequestException(this.statusMessage(ticket.ticketStatus));
		return ticket;
	}

	private statusMessage(status?: TicketStatus): Message {
		if (status === TicketStatus.USED) return Message.TICKET_ALREADY_USED;
		if (status === TicketStatus.REFUNDED) return Message.TICKET_REFUNDED;
		return Message.TICKET_NOT_VALID;
	}

	private async buildResult(ticket: Ticket): Promise<CheckInResult> {
		const [buyer, ticketType, seat] = await Promise.all([
			this.memberModel.findOne({ _id: ticket.ownerId }).select('memberFullName memberNick').lean().exec(),
			this.ticketTypeModel.findOne({ _id: ticket.ticketTypeId }).select('ticketTypeName').lean().exec(),
			ticket.seatId ? this.eventSeatModel.findOne({ _id: ticket.seatId }).select('sectionKey row number').lean().exec() : null,
		]);
		return {
			ticket: ticket,
			seat: seat ? { sectionKey: seat.sectionKey, row: seat.row, number: seat.number } : undefined,
			buyerName: buyer?.memberFullName || buyer?.memberNick || '',
			ticketTypeName: ticketType?.ticketTypeName,
			ticketStatus: ticket.ticketStatus,
		};
	}
}
