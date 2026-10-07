import { BatchService } from './batch.service';
import { EventStatus } from 'apps/ticketzy-api/src/libs/enums/event.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const finder = (value: any) => {
	const chain: any = {};
	chain.select = () => chain;
	chain.limit = () => chain;
	chain.lean = () => chain;
	chain.exec = jest.fn().mockResolvedValue(value);
	return chain;
};

describe('BatchService.batchEndEvents', () => {
	let eventModel: any;
	let memberModel: any;
	let service: BatchService;

	beforeEach(() => {
		eventModel = { find: jest.fn(), findOneAndUpdate: jest.fn() };
		memberModel = { updateOne: jest.fn().mockReturnValue(exec({})) };
		service = new BatchService(eventModel, memberModel, {} as any, {} as any);
	});

	it('looks only at APPROVED events whose endAt has passed', async () => {
		eventModel.find.mockReturnValue(finder([]));
		await service.batchEndEvents();
		const filter = eventModel.find.mock.calls[0][0];
		expect(filter.eventStatus).toEqual({ $in: [EventStatus.APPROVED] });
		expect(filter.endAt.$lte).toBeInstanceOf(Date);
	});

	it('moves each due event to ENDED with a conditional update and counts it for the organizer', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }, { _id: 'e2' }]));
		eventModel.findOneAndUpdate
			.mockReturnValueOnce(exec({ _id: 'e1', organizerId: 'org1' }))
			.mockReturnValueOnce(exec({ _id: 'e2', organizerId: 'org1' }));

		await service.batchEndEvents();

		const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
		expect(filter).toMatchObject({ _id: 'e1', eventStatus: { $in: [EventStatus.APPROVED] } });
		expect(update).toEqual({ eventStatus: EventStatus.ENDED });
		expect(memberModel.updateOne).toHaveBeenCalledTimes(2);
		expect(memberModel.updateOne).toHaveBeenCalledWith({ _id: 'org1' }, { $inc: { completedEvents: 1 } });
	});

	it('does not count an event another run (or a cancellation) already changed', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }]));
		eventModel.findOneAndUpdate.mockReturnValue(exec(null));

		await service.batchEndEvents();

		expect(memberModel.updateOne).not.toHaveBeenCalled();
	});

	it('keeps going when the counter update fails', async () => {
		eventModel.find.mockReturnValue(finder([{ _id: 'e1' }, { _id: 'e2' }]));
		eventModel.findOneAndUpdate
			.mockReturnValueOnce(exec({ _id: 'e1', organizerId: 'org1' }))
			.mockReturnValueOnce(exec({ _id: 'e2', organizerId: 'org2' }));
		memberModel.updateOne.mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(new Error('db')) }).mockReturnValueOnce(exec({}));

		await expect(service.batchEndEvents()).resolves.toBeUndefined();
		expect(memberModel.updateOne).toHaveBeenCalledTimes(2);
	});
});
