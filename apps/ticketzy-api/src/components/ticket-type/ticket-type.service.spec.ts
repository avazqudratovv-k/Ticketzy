import { TicketTypeService } from './ticket-type.service';
import { TicketTypeStatus } from '../../libs/enums/ticket.enum';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus } from '../../libs/enums/member.enum';

const query = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('TicketTypeService.reserve', () => {
	let ticketTypeModel: any;
	let eventModel: any;
	let memberModel: any;
	let service: TicketTypeService;

	beforeEach(() => {
		ticketTypeModel = {
			findOneAndUpdate: jest.fn(),
			updateOne: jest.fn().mockReturnValue(query({})),
			countDocuments: jest.fn().mockReturnValue(query(1)),
		};
		eventModel = { updateOne: jest.fn().mockReturnValue(query({})) };
		memberModel = { exists: jest.fn() };
		service = new TicketTypeService(ticketTypeModel, eventModel, memberModel, {} as any, {} as any);
	});

	it('reserves with ONE conditional update that checks stock, status and maxPerOrder', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(
			query({ _id: 't1', eventId: 'e1', soldQuantity: 3, totalQuantity: 10 }),
		);

		const result = await service.reserve('t1' as any, 3);

		expect(result).not.toBeNull();
		expect(ticketTypeModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
		const [filter, update] = ticketTypeModel.findOneAndUpdate.mock.calls[0];
		expect(filter.ticketTypeStatus).toBe(TicketTypeStatus.ACTIVE);
		expect(filter.maxPerOrder).toEqual({ $gte: 3 });
		expect(filter.$expr).toEqual({ $lte: [{ $add: ['$soldQuantity', 3] }, '$totalQuantity'] });
		expect(update).toEqual({ $inc: { soldQuantity: 3 } });
	});

	it('returns null and changes nothing else when the conditional update matches no document', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(query(null));

		expect(await service.reserve('t1' as any, 5)).toBeNull();
		expect(ticketTypeModel.updateOne).not.toHaveBeenCalled();
		expect(eventModel.updateOne).not.toHaveBeenCalled();
	});

	it('flags the ticket type SOLD_OUT when the last ticket is taken, and leaves the event alone', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(
			query({ _id: 't1', eventId: 'e1', soldQuantity: 10, totalQuantity: 10 }),
		);

		await service.reserve('t1' as any, 2);

		expect(ticketTypeModel.updateOne).toHaveBeenCalledWith(
			expect.objectContaining({ _id: 't1', ticketTypeStatus: TicketTypeStatus.ACTIVE }),
			{ ticketTypeStatus: TicketTypeStatus.SOLD_OUT },
		);
		expect(eventModel.updateOne).not.toHaveBeenCalled();
	});

	it('release gives stock back only when enough was sold', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(query({ _id: 't1', eventId: 'e1' }));

		await service.release('t1' as any, 2);

		const [filter, update] = ticketTypeModel.findOneAndUpdate.mock.calls[0];
		expect(filter.soldQuantity).toEqual({ $gte: 2 });
		expect(update).toEqual({ $inc: { soldQuantity: -2 } });
	});
});

describe('TicketTypeService.getTicketTypes hides ticket types of organizers that are not ACTIVE', () => {
	const lean = (value: any) => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) }) });
	let ticketTypeModel: any;
	let eventModel: any;
	let memberModel: any;
	let service: TicketTypeService;

	beforeEach(() => {
		ticketTypeModel = { find: jest.fn().mockReturnValue({ sort: () => ({ exec: jest.fn().mockResolvedValue([{ _id: 't1' }]) }) }) };
		eventModel = { findById: jest.fn().mockReturnValue(lean({ organizerId: 'o1' })) };
		memberModel = { exists: jest.fn() };
		service = new TicketTypeService(ticketTypeModel, eventModel, memberModel, {} as any, {} as any);
	});

	it('returns the ticket types when the organizer is ACTIVE', async () => {
		memberModel.exists.mockResolvedValue({ _id: 'o1' });

		expect(await service.getTicketTypes('e1' as any)).toEqual([{ _id: 't1' }]);
		expect(memberModel.exists).toHaveBeenCalledWith({ _id: 'o1', memberStatus: MemberStatus.ACTIVE });
	});

	it('answers NO_DATA_FOUND when the organizer is not ACTIVE', async () => {
		memberModel.exists.mockResolvedValue(null);

		await expect(service.getTicketTypes('e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		expect(ticketTypeModel.find).not.toHaveBeenCalled();
	});

	it('answers NO_DATA_FOUND for an unknown event', async () => {
		eventModel.findById.mockReturnValue(lean(null));

		await expect(service.getTicketTypes('missing' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		expect(memberModel.exists).not.toHaveBeenCalled();
	});
});


describe('TicketTypeService quantity of RESERVED events', () => {
	const leanQuery = (value: any) => ({ lean: () => query(value) });
	const section = (over: any = {}) => ({ key: 'A', kind: 'SEATED', rows: 2, seatsPerRow: 5, tierKey: 'vip', ...over });
	const layout = { sections: [section(), section({ key: 'B', rows: 1, seatsPerRow: 4 }), section({ key: 'C', tierKey: 'regular' })] };
	const input = (over: any = {}): any => ({
		eventId: '64b7f0f2a1b2c3d4e5f60718',
		ticketTypeName: 'VIP',
		ticketPrice: 100,
		ticketCurrency: 'KRW',
		maxPerOrder: 4,
		...over,
	});

	let ticketTypeModel: any;
	let eventModel: any;
	let venueModel: any;
	let eventSeatModel: any;
	let service: TicketTypeService;

	const withEvent = (over: any = {}) =>
		eventModel.findOne.mockReturnValue(leanQuery({ _id: 'e1', venueId: 'v1', organizerId: 'm1', seatingType: 'RESERVED', ...over }));

	beforeEach(() => {
		ticketTypeModel = {
			create: jest.fn().mockImplementation(async (doc) => doc),
			exists: jest.fn().mockResolvedValue(null),
			findById: jest.fn(),
			findOneAndUpdate: jest.fn().mockReturnValue(query({ _id: 't1', eventId: 'e1' })),
			aggregate: jest.fn().mockReturnValue(query([])),
		};
		eventModel = { findOne: jest.fn(), updateOne: jest.fn().mockReturnValue(query({})) };
		venueModel = { findById: jest.fn().mockReturnValue(leanQuery({ _id: 'v1', venueLayout: layout })) };
		eventSeatModel = { exists: jest.fn().mockResolvedValue(null) };
		withEvent();
		service = new TicketTypeService(ticketTypeModel, eventModel, { exists: jest.fn() } as any, venueModel, eventSeatModel);
	});

	it('computes totalQuantity from the seats of every section of the tier', async () => {
		await service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'vip' }));
		expect(ticketTypeModel.create.mock.calls[0][0]).toMatchObject({ tierKey: 'vip', totalQuantity: 14 });
	});

	it('refuses a client-set quantity', async () => {
		await expect(
			service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'vip', totalQuantity: 500 })),
		).rejects.toThrow(Message.TICKET_TYPE_QUANTITY_FROM_SEATS);
		expect(ticketTypeModel.create).not.toHaveBeenCalled();
	});

	it('needs a tier key that matches a seated section', async () => {
		await expect(service.createTicketType('m1' as any, 'ORGANIZER' as any, input())).rejects.toThrow(Message.TICKET_TYPE_TIER_KEY_REQUIRED);
		await expect(service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'nope' }))).rejects.toThrow(
			Message.TICKET_TYPE_TIER_KEY_REQUIRED,
		);
		expect(ticketTypeModel.create).not.toHaveBeenCalled();
	});

	it('GENERAL events keep the client quantity, which is required', async () => {
		withEvent({ seatingType: 'GENERAL' });
		await service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ totalQuantity: 80 }));
		expect(ticketTypeModel.create.mock.calls[0][0].totalQuantity).toBe(80);
		await expect(service.createTicketType('m1' as any, 'ORGANIZER' as any, input())).rejects.toThrow(Message.TICKET_TYPE_QUANTITY_REQUIRED);
	});

	describe('update', () => {
		beforeEach(() => ticketTypeModel.findById.mockReturnValue(leanQuery({ _id: 't1', eventId: 'e1', tierKey: 'vip' })));

		it('refuses a client-set quantity', async () => {
			await expect(
				service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', totalQuantity: 5 } as any),
			).rejects.toThrow(Message.TICKET_TYPE_QUANTITY_FROM_SEATS);
			expect(ticketTypeModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('recomputes the quantity when the tier changes', async () => {
			await service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', tierKey: 'regular' } as any);
			const [filter, update] = ticketTypeModel.findOneAndUpdate.mock.calls[0];
			expect(update).toMatchObject({ tierKey: 'regular', totalQuantity: 10 });
			expect(filter.soldQuantity).toEqual({ $lte: 10 });
		});

		it('locks the tier once the seats of the event exist', async () => {
			eventSeatModel.exists.mockResolvedValue({ _id: 's1' });
			await expect(
				service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', tierKey: 'regular' } as any),
			).rejects.toThrow(Message.TICKET_TYPE_TIER_LOCKED);
		});

		it('still lets the price change', async () => {
			await service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', ticketPrice: 120 } as any);
			expect(ticketTypeModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ _id: 't1', ticketPrice: 120 });
		});
	});

	describe('one currency per event (KRW, DECISIONS #95)', () => {
		it.each(['USD', 'EUR', 'UZS'])('refuses to create a ticket type priced in %s', async (currency) => {
			await expect(
				service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'vip', ticketCurrency: currency })),
			).rejects.toThrow(Message.ONLY_KRW_TICKETS);
			expect(ticketTypeModel.create).not.toHaveBeenCalled();
		});

		it('creates a KRW ticket type on an event without other-currency types', async () => {
			await service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'vip' }));
			expect(ticketTypeModel.exists).toHaveBeenCalledWith(expect.objectContaining({ ticketCurrency: { $ne: 'KRW' } }));
			expect(ticketTypeModel.create).toHaveBeenCalledTimes(1);
		});

		it('refuses a new KRW type next to an existing other-currency type of the same event (old data) and changes nothing', async () => {
			ticketTypeModel.exists.mockResolvedValue({ _id: 'old-usd-type' });
			await expect(service.createTicketType('m1' as any, 'ORGANIZER' as any, input({ tierKey: 'vip' }))).rejects.toThrow(
				Message.EVENT_HAS_OTHER_CURRENCY,
			);
			expect(ticketTypeModel.create).not.toHaveBeenCalled();
		});

		it('refuses an update to another currency, before touching the database', async () => {
			ticketTypeModel.findById.mockReturnValue(leanQuery({ _id: 't1', eventId: 'e1', tierKey: 'vip', ticketCurrency: 'KRW' }));
			await expect(
				service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', ticketCurrency: 'USD' } as any),
			).rejects.toThrow(Message.ONLY_KRW_TICKETS);
			expect(ticketTypeModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('lets an old other-currency type without sales be moved to KRW, and refuses it once it sold tickets', async () => {
			ticketTypeModel.findById.mockReturnValue(leanQuery({ _id: 't1', eventId: 'e1', tierKey: 'vip', ticketCurrency: 'USD', soldQuantity: 0 }));
			await service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', ticketCurrency: 'KRW' } as any);
			expect(ticketTypeModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ _id: 't1', ticketCurrency: 'KRW' });

			ticketTypeModel.findOneAndUpdate.mockClear();
			ticketTypeModel.findById.mockReturnValue(leanQuery({ _id: 't1', eventId: 'e1', tierKey: 'vip', ticketCurrency: 'USD', soldQuantity: 3 }));
			await expect(
				service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', ticketCurrency: 'KRW' } as any),
			).rejects.toThrow(Message.TICKET_CURRENCY_LOCKED);
			expect(ticketTypeModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('an update that leaves the currency alone is not blocked on an old other-currency type', async () => {
			ticketTypeModel.findById.mockReturnValue(leanQuery({ _id: 't1', eventId: 'e1', tierKey: 'vip', ticketCurrency: 'USD', soldQuantity: 3 }));
			await service.updateTicketType('m1' as any, 'ORGANIZER' as any, { _id: 't1', ticketPrice: 9 } as any);
			expect(ticketTypeModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
		});
	});
});
