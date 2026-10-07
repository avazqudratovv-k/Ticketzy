import { InternalServerErrorException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { TicketService } from './ticket.service';
import { TicketTimeFilter } from '../../libs/enums/ticket.enum';
import { MemberType } from '../../libs/enums/member.enum';

const ME = new ObjectId();
const TICKET = new ObjectId();
const query = (value: any) => ({ exec: jest.fn().mockResolvedValue(value), lean: jest.fn().mockReturnThis() });

describe('TicketService', () => {
	let ticketModel: any;
	let eventModel: any;
	let service: TicketService;

	beforeEach(() => {
		ticketModel = { aggregate: jest.fn().mockReturnValue(query([{ list: [], metaCounter: [] }])), findOne: jest.fn(), findOneAndUpdate: jest.fn() };
		eventModel = { findOne: jest.fn() };
		service = new TicketService(ticketModel, eventModel);
	});

	const stages = () => ticketModel.aggregate.mock.calls[0][0];
	const facet = () => stages().find((stage) => stage.$facet).$facet;

	describe('getMyTickets', () => {
		it('only reads the caller\'s tickets and joins event, ticket type and seat', async () => {
			await service.getMyTickets(ME as any, { page: 1, limit: 5 });
			expect(String(stages()[0].$match.ownerId)).toBe(String(ME));
			const lookups = facet().list.filter((s) => s.$lookup).map((s) => s.$lookup.from);
			expect(lookups).toEqual(['events', 'ticketTypes', 'eventSeats']);
			expect(facet().list.find((s) => s.$skip !== undefined).$skip).toBe(0);
		});

		it('UPCOMING keeps events that have not ended, soonest first, before paging', async () => {
			await service.getMyTickets(ME as any, { page: 2, limit: 5, timeFilter: TicketTimeFilter.UPCOMING });
			const match = stages().find((s) => s.$match && s.$match['eventData.endAt']);
			expect(match.$match['eventData.endAt'].$gte).toBeInstanceOf(Date);
			expect(stages().find((s) => s.$sort).$sort['eventData.startAt']).toBe(1);
			expect(stages().indexOf(match)).toBeLessThan(stages().findIndex((s) => s.$facet));
			expect(facet().list.find((s) => s.$skip !== undefined).$skip).toBe(5);
		});

		it('PAST keeps events that ended, most recent first', async () => {
			await service.getMyTickets(ME as any, { page: 1, limit: 5, timeFilter: TicketTimeFilter.PAST });
			const match = stages().find((s) => s.$match && s.$match['eventData.endAt']);
			expect(match.$match['eventData.endAt'].$lt).toBeInstanceOf(Date);
			expect(stages().find((s) => s.$sort).$sort['eventData.startAt']).toBe(-1);
		});
	});

	describe('getTicket', () => {
		it('matches on both the ticket and its owner, so another member\'s ticket is not found', async () => {
			ticketModel.aggregate.mockReturnValue(query([]));
			await expect(service.getTicket(new ObjectId() as any, TICKET as any)).rejects.toBeInstanceOf(InternalServerErrorException);
			expect(String(stages()[0].$match._id)).toBe(String(TICKET));
			expect(String(stages()[0].$match.ownerId)).not.toBe(String(ME));
		});

		it('returns the ticket with its qrToken, event and seat to the owner', async () => {
			ticketModel.aggregate.mockReturnValue(query([{ _id: 't1', qrToken: 'abc', eventData: {}, seatData: { row: 1 } }]));
			const ticket = await service.getTicket(ME as any, TICKET as any);
			expect(ticket.qrToken).toBe('abc');
		});
	});

	it('does not hand the qrToken to the organizer who scans the ticket', async () => {
		ticketModel.findOne.mockReturnValue(query({ _id: 't1', eventId: 'e1' }));
		eventModel.findOne.mockReturnValue(query({ _id: 'e1' }));
		ticketModel.findOneAndUpdate.mockReturnValue(query({ _id: 't1' }));

		await service.checkInTicket('org' as any, MemberType.ORGANIZER, 'CODE');

		expect(ticketModel.findOneAndUpdate.mock.calls[0][2].projection).toEqual({ qrToken: 0 });
	});
});
