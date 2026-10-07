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
		service = new TicketTypeService(ticketTypeModel, eventModel, memberModel);
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

	it('flags the ticket type SOLD_OUT, and the event once nothing is left, when the last ticket is taken', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(
			query({ _id: 't1', eventId: 'e1', soldQuantity: 10, totalQuantity: 10 }),
		);
		ticketTypeModel.countDocuments.mockReturnValue(query(0));

		await service.reserve('t1' as any, 2);

		expect(ticketTypeModel.updateOne).toHaveBeenCalledWith(
			expect.objectContaining({ _id: 't1', ticketTypeStatus: TicketTypeStatus.ACTIVE }),
			{ ticketTypeStatus: TicketTypeStatus.SOLD_OUT },
		);
		expect(eventModel.updateOne).toHaveBeenCalled();
	});

	it('does not mark the event sold out while another ticket type still has stock', async () => {
		ticketTypeModel.findOneAndUpdate.mockReturnValue(
			query({ _id: 't1', eventId: 'e1', soldQuantity: 10, totalQuantity: 10 }),
		);
		ticketTypeModel.countDocuments.mockReturnValue(query(1));

		await service.reserve('t1' as any, 2);

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
		service = new TicketTypeService(ticketTypeModel, eventModel, memberModel);
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

