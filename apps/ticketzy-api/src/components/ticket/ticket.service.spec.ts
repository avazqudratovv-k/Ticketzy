import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { TicketService } from './ticket.service';
import { TicketStatus, TicketTimeFilter } from '../../libs/enums/ticket.enum';
import { EventStatus } from '../../libs/enums/event.enum';
import { Message } from '../../libs/enums/common.enum';
import { buildQrToken, signQrToken } from '../../libs/qr-token';
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
		service = new TicketService(ticketModel, eventModel, {} as any, {} as any, {} as any);
	});

	const stages = () => ticketModel.aggregate.mock.calls[0][0];
	const facet = () => stages().find((stage) => stage.$facet).$facet;

	const expectVenueInEventLookup = (pipeline: any[]) => {
		const lookup = pipeline.find((s) => s.$lookup && s.$lookup.from === 'events').$lookup;
		expect(lookup.as).toBe('eventData');
		expect(lookup.pipeline.find((s) => s.$lookup).$lookup).toMatchObject({ from: 'venues', localField: 'venueId', as: 'venueData' });
	};

	describe('getMyTickets', () => {
		it('only reads the caller\'s tickets and joins event, ticket type and seat', async () => {
			await service.getMyTickets(ME as any, { page: 1, limit: 5 });
			expect(String(stages()[0].$match.ownerId)).toBe(String(ME));
			const lookups = facet().list.filter((s) => s.$lookup).map((s) => s.$lookup.from);
			expect(lookups).toEqual(['events', 'ticketTypes', 'eventSeats']);
			expect(facet().list.find((s) => s.$skip !== undefined).$skip).toBe(0);
		});

		it('joins the event\'s venue inside the same event lookup, for every page', async () => {
			await service.getMyTickets(ME as any, { page: 1, limit: 5 });
			expectVenueInEventLookup(facet().list);
			ticketModel.aggregate.mockClear();
			await service.getMyTickets(ME as any, { page: 1, limit: 5, timeFilter: TicketTimeFilter.UPCOMING });
			expectVenueInEventLookup(stages());
			expect(ticketModel.aggregate).toHaveBeenCalledTimes(1);
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

		it('joins the event\'s venue in the single aggregation', async () => {
			ticketModel.aggregate.mockReturnValue(query([{ _id: 't1' }]));
			await service.getTicket(ME as any, TICKET as any);
			expectVenueInEventLookup(stages());
			expect(ticketModel.aggregate).toHaveBeenCalledTimes(1);
		});

		it('returns the ticket with its qrToken, event and seat to the owner', async () => {
			ticketModel.aggregate.mockReturnValue(query([{ _id: 't1', qrToken: 'abc', eventData: {}, seatData: { row: 1 } }]));
			const ticket = await service.getTicket(ME as any, TICKET as any);
			expect(ticket.qrToken).toBe('abc');
		});
	});

});

describe('TicketService check-in', () => {
	const ORG = new ObjectId();
	const OTHER_ORG = new ObjectId();
	const ADMIN = new ObjectId();
	const BUYER = new ObjectId();
	const EVENT = new ObjectId();
	const OTHER_EVENT = new ObjectId();
	const TYPE = new ObjectId();
	const SEAT = new ObjectId();
	const TICKET_ID = new ObjectId();

	let tickets: FakeModel;
	let events: FakeModel;
	let service: TicketService;

	beforeAll(() => {
		process.env.QR_SECRET = 'test-qr-secret';
	});

	beforeEach(() => {
		tickets = new FakeModel([
			{ _id: TICKET_ID, ticketCode: 'CODE1', ticketStatus: TicketStatus.VALID, qrToken: buildQrToken(TICKET_ID), eventId: EVENT, ownerId: BUYER, ticketTypeId: TYPE, seatId: SEAT },
		]);
		events = new FakeModel([
			{ _id: EVENT, organizerId: ORG, eventStatus: EventStatus.APPROVED },
			{ _id: OTHER_EVENT, organizerId: OTHER_ORG, eventStatus: EventStatus.APPROVED },
		]);
		const members = new FakeModel([{ _id: BUYER, memberFullName: 'Ada Lovelace', memberNick: 'ada' }]);
		const types = new FakeModel([{ _id: TYPE, ticketTypeName: 'VIP' }]);
		const seats = new FakeModel([{ _id: SEAT, sectionKey: 'A', row: 3, number: 7 }]);
		service = new TicketService(tickets as any, events as any, members as any, types as any, seats as any);
	});

	const token = () => tickets.docs[0].qrToken;
	const scan = (qr = token(), member: any = ORG, type = MemberType.ORGANIZER, eventId?: any) =>
		service.checkInTicket(member, type, qr, eventId);
	const rejects = async (promise: Promise<any>, message: Message) => {
		await expect(promise).rejects.toBeInstanceOf(BadRequestException);
		await expect(promise).rejects.toThrow(message);
	};

	describe('signature', () => {
		it('rejects a forged or garbled token before any database lookup', async () => {
			const findOne = jest.spyOn(tickets, 'findOne');
			const forged = `${TICKET_ID}.${'0'.repeat(64)}`;
			const wrongSecretOfOtherTicket = `${TICKET_ID}.${signQrToken(new ObjectId())}`;

			for (const bad of [forged, wrongSecretOfOtherTicket, 'garbage', '', `${TICKET_ID}`, signQrToken(TICKET_ID), null as any]) {
				await rejects(scan(bad), Message.QR_INVALID);
				await rejects(service.checkInPreview(ORG as any, MemberType.ORGANIZER, bad), Message.QR_INVALID);
			}
			expect(findOne).not.toHaveBeenCalled();
			expect(tickets.docs[0].ticketStatus).toBe(TicketStatus.VALID);
		});

		it('rejects a genuine signature whose ticket does not exist or whose stored token differs', async () => {
			await rejects(scan(buildQrToken(new ObjectId())), Message.QR_INVALID);
			tickets.docs[0].qrToken = 'something-else';
			await rejects(scan(buildQrToken(TICKET_ID)), Message.QR_INVALID);
		});
	});

	describe('checkInTicket', () => {
		it('marks the ticket USED with checkedInAt and returns ticket, seat, buyer name and status without the qrToken', async () => {
			const result: any = await scan();

			expect(result.ticketStatus).toBe(TicketStatus.USED);
			expect(result.buyerName).toBe('Ada Lovelace');
			expect(result.ticketTypeName).toBe('VIP');
			expect(result.seat).toEqual({ sectionKey: 'A', row: 3, number: 7 });
			expect(result.ticket.checkedInAt).toBeInstanceOf(Date);
			expect(tickets.docs[0]).toMatchObject({ ticketStatus: TicketStatus.USED });
			expect(tickets.docs[0].checkedInAt).toBeInstanceOf(Date);
		});

		it('a double scan cannot succeed twice, also when both scans pass validation together', async () => {
			const results = await Promise.allSettled([scan(), scan()]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const failure: any = results.find((r) => r.status === 'rejected');
			expect(failure.reason.message).toBe(Message.TICKET_ALREADY_USED);

			await rejects(scan(), Message.TICKET_ALREADY_USED);
		});

		it('a REFUNDED ticket is rejected', async () => {
			tickets.docs[0].ticketStatus = TicketStatus.REFUNDED;
			await rejects(scan(), Message.TICKET_REFUNDED);
		});

		it('a ticket of another event is rejected when the gate is set to an event', async () => {
			await rejects(scan(token(), ORG, MemberType.ORGANIZER, OTHER_EVENT), Message.TICKET_WRONG_EVENT);
			expect(tickets.docs[0].ticketStatus).toBe(TicketStatus.VALID);
			await expect(scan(token(), ORG, MemberType.ORGANIZER, EVENT)).resolves.toBeDefined();
		});

		it('a ticket of another organizer is rejected, an admin may scan any', async () => {
			await rejects(scan(token(), OTHER_ORG), Message.TICKET_WRONG_ORGANIZER);
			expect(tickets.docs[0].ticketStatus).toBe(TicketStatus.VALID);
			await expect(scan(token(), ADMIN, MemberType.ADMIN)).resolves.toBeDefined();
		});

		it.each([EventStatus.CANCELLED, EventStatus.ENDED, EventStatus.PENDING])('is rejected while the event is %s', async (eventStatus) => {
			events.docs[0].eventStatus = eventStatus;
			await rejects(scan(), Message.EVENT_NOT_OPEN_FOR_CHECKIN);
			expect(tickets.docs[0].ticketStatus).toBe(TicketStatus.VALID);
		});
	});

	describe('checkInPreview', () => {
		it('validates without changing anything and applies the same rules', async () => {
			const result: any = await service.checkInPreview(ORG as any, MemberType.ORGANIZER, token());
			expect(result.ticketStatus).toBe(TicketStatus.VALID);
			expect(result.buyerName).toBe('Ada Lovelace');
			expect(result.ticket.qrToken).toBeUndefined();
			expect(tickets.docs[0].ticketStatus).toBe(TicketStatus.VALID);
			expect(tickets.docs[0].checkedInAt).toBeUndefined();

			await expect(service.checkInPreview(OTHER_ORG as any, MemberType.ORGANIZER, token())).rejects.toThrow(Message.TICKET_WRONG_ORGANIZER);
			await scan();
			await expect(service.checkInPreview(ORG as any, MemberType.ORGANIZER, token())).rejects.toThrow(Message.TICKET_ALREADY_USED);
		});
	});
});
