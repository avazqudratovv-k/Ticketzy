import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event } from '../../libs/dto/event/event';
import { Member } from '../../libs/dto/member/member';
import { Ticket } from '../../libs/dto/ticket/ticket';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { Venue } from '../../libs/dto/venue/venue';
import { Message } from '../../libs/enums/common.enum';
import { EventCategory, publicEventStatus } from '../../libs/enums/event.enum';
import { TicketStatus, TicketTypeStatus } from '../../libs/enums/ticket.enum';
import { escapeRegExp, lookupActiveOrganizer, lookupEvent, lookupSeat, lookupTicketType, lookupVenue, shapeIntoMongoObjectId } from '../../libs/config';
import { getRefundPolicyText } from '../../libs/refund-policy';
import { clip } from '../../libs/ai';
import { T } from '../../libs/types/common';
import { AiToolDefinition } from './providers/ai-provider';

export const MAX_SEARCH_RESULTS = 5;
export const MAX_MY_TICKETS = 10;

export interface ToolOutcome {
	/** what the model reads (JSON text) */
	content: string;
	isError?: boolean;
	/** public events to show as cards */
	events?: Event[];
}

export const ASSISTANT_TOOLS: AiToolDefinition[] = [
	{
		name: 'search_events',
		description:
			'Search upcoming public events. Every filter is optional. Returns at most 5 events. Use it to find events by category, city, date range, price or words in the title.',
		parameters: {
			type: 'object',
			properties: {
				category: { type: 'string', enum: Object.values(EventCategory) },
				dateFrom: { type: 'string', description: 'ISO date, events starting on or after it (default: now)' },
				dateTo: { type: 'string', description: 'ISO date, events starting on or before it' },
				city: { type: 'string' },
				maxPrice: { type: 'number', description: 'highest cheapest-ticket price' },
				text: { type: 'string', description: 'words from the event title' },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'get_event',
		description: 'Details of one public event: description, venue, dates and ticket types with prices and availability.',
		parameters: {
			type: 'object',
			properties: { eventId: { type: 'string', description: 'the id returned by search_events' } },
			required: ['eventId'],
			additionalProperties: false,
		},
	},
	{
		name: 'get_refund_policy',
		description: 'The refund rules of the platform.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'get_my_tickets',
		description: 'The tickets of the person who is chatting (needs a logged in user). Takes no input: it always means the current user.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
	},
];

/**
 * The backend tools of the assistant. They follow the visibility rules of the normal queries (APPROVED events of ACTIVE
 * organizers) and never take a member id from the model: the caller is passed in by the service.
 */
@Injectable()
export class AiToolsService {
	private readonly logger = new Logger(AiToolsService.name);

	constructor(
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Venue') private readonly venueModel: Model<Venue>,
		@InjectModel('TicketType') private readonly ticketTypeModel: Model<TicketType>,
		@InjectModel('Ticket') private readonly ticketModel: Model<Ticket>,
	) {}

	public async execute(name: string, input: unknown, authMember: Member | null): Promise<ToolOutcome> {
		const args = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
		try {
			switch (name) {
				case 'search_events':
					return await this.searchEvents(args);
				case 'get_event':
					return await this.getEvent(args);
				case 'get_refund_policy':
					return { content: getRefundPolicyText() };
				case 'get_my_tickets':
					return await this.getMyTickets(authMember);
				default:
					return this.fail('Unknown tool.');
			}
		} catch (err) {
			this.logger.error(`Assistant tool ${name} failed: ${err?.message}`);
			return this.fail('The tool failed.');
		}
	}

	private fail(message: string): ToolOutcome {
		return { content: JSON.stringify({ error: message }), isError: true };
	}

	private async searchEvents(args: Record<string, unknown>): Promise<ToolOutcome> {
		const match: T = { eventStatus: publicEventStatus };

		if (args.category !== undefined) {
			if (!Object.values(EventCategory).includes(args.category as EventCategory)) return this.fail('Unknown category.');
			match.eventCategory = args.category;
		}

		const from = args.dateFrom === undefined ? new Date() : new Date(String(args.dateFrom));
		const range: T = { $gte: from };
		if (args.dateTo !== undefined) range.$lte = new Date(String(args.dateTo));
		if (Number.isNaN(from.getTime()) || (range.$lte && Number.isNaN(range.$lte.getTime()))) return this.fail('Dates must be ISO dates.');
		match.startAt = range;

		if (args.maxPrice !== undefined) {
			if (typeof args.maxPrice !== 'number' || !Number.isFinite(args.maxPrice) || args.maxPrice < 0) return this.fail('maxPrice must be a number.');
			match.eventMinPrice = { $lte: args.maxPrice };
		}
		if (args.text !== undefined) match.eventTitle = { $regex: new RegExp(escapeRegExp(clip(args.text, 100)), 'i') };
		if (args.city !== undefined) {
			const venueIds = await this.venueModel.distinct('_id', {
				venueCity: { $regex: new RegExp(`^${escapeRegExp(clip(args.city, 100).trim())}$`, 'i') },
			});
			match.venueId = { $in: venueIds };
		}

		const events: Event[] = await this.eventModel
			.aggregate([
				{ $match: match },
				...lookupActiveOrganizer,
				{ $sort: { startAt: 1 } },
				{ $limit: MAX_SEARCH_RESULTS },
				lookupVenue,
				{ $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
			])
			.exec();

		return {
			content: JSON.stringify({
				events: events.map((event) => ({
					id: String(event._id),
					title: clip(event.eventTitle, 200),
					category: event.eventCategory,
					startAt: event.startAt,
					city: event.venueData?.venueCity,
					venue: clip(event.venueData?.venueName, 200),
					cheapestTicketPrice: event.eventMinPrice,
				})),
			}),
			events,
		};
	}

	private async getEvent(args: Record<string, unknown>): Promise<ToolOutcome> {
		if (typeof args.eventId !== 'string' || !/^[a-f0-9]{24}$/i.test(args.eventId)) return this.fail('eventId is not valid.');

		const [event]: Event[] = await this.eventModel
			.aggregate([
				{ $match: { _id: shapeIntoMongoObjectId(args.eventId), eventStatus: publicEventStatus } },
				...lookupActiveOrganizer,
				lookupVenue,
				{ $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
			])
			.exec();
		if (!event) return this.fail(Message.NO_DATA_FOUND);

		const ticketTypes = await this.ticketTypeModel
			.find({ eventId: event._id, ticketTypeStatus: { $in: [TicketTypeStatus.ACTIVE, TicketTypeStatus.SOLD_OUT] } })
			.lean()
			.exec();

		return {
			content: JSON.stringify({
				id: String(event._id),
				title: clip(event.eventTitle, 200),
				description: clip(event.eventDesc, 1500),
				category: event.eventCategory,
				startAt: event.startAt,
				endAt: event.endAt,
				venue: event.venueData
					? { name: clip(event.venueData.venueName, 200), city: event.venueData.venueCity, address: clip(event.venueData.venueAddress, 300) }
					: null,
				ticketTypes: ticketTypes.map((ticketType) => ({
					name: clip(ticketType.ticketTypeName, 100),
					price: ticketType.ticketPrice,
					currency: ticketType.ticketCurrency,
					remaining: Math.max(0, ticketType.totalQuantity - ticketType.soldQuantity),
					status: ticketType.ticketTypeStatus,
				})),
			}),
			events: [event],
		};
	}

	/** only the logged in caller's own tickets; no QR token is ever returned */
	private async getMyTickets(authMember: Member | null): Promise<ToolOutcome> {
		if (!authMember?._id) return this.fail(Message.AI_LOGIN_REQUIRED);

		const tickets: any[] = await this.ticketModel
			.aggregate([
				{ $match: { ownerId: shapeIntoMongoObjectId(authMember._id), ticketStatus: { $ne: TicketStatus.CANCELLED } } },
				{ $sort: { createdAt: -1 } },
				{ $limit: MAX_MY_TICKETS },
				lookupEvent,
				{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
				lookupTicketType,
				{ $unwind: { path: '$ticketTypeData', preserveNullAndEmptyArrays: true } },
				lookupSeat,
				{ $unwind: { path: '$seatData', preserveNullAndEmptyArrays: true } },
			])
			.exec();

		return {
			content: JSON.stringify({
				tickets: tickets.map((ticket) => ({
					status: ticket.ticketStatus,
					eventTitle: clip(ticket.eventData?.eventTitle, 200),
					startAt: ticket.eventData?.startAt,
					ticketType: clip(ticket.ticketTypeData?.ticketTypeName, 100),
					seat: ticket.seatData ? `${ticket.seatData.sectionKey} row ${ticket.seatData.row} seat ${ticket.seatData.number}` : undefined,
				})),
			}),
		};
	}
}
