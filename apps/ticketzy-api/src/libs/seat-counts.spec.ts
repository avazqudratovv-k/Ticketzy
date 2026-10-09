import { getSeatCounts } from './seat-counts';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('getSeatCounts', () => {
	it('sums the quantity of every ticket type (standing admission included) and the tickets of PAID orders', async () => {
		const ticketTypeModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ _id: 'e1', total: 1000 + 60 }])) };
		const orderModel: any = { aggregate: jest.fn().mockReturnValue(exec([{ _id: 'e1', sold: 7 }])) };

		const counts = await getSeatCounts(['e1', 'e2'] as any, ticketTypeModel, orderModel);

		expect(counts.get('e1')).toEqual({ eventTotalSeats: 1060, eventSoldSeats: 7 });
		expect(counts.get('e2')).toEqual({ eventTotalSeats: 0, eventSoldSeats: 0 });
	});

	it('asks for PAID orders only, so refunded tickets and holds are not sold, and groups by event in the database', async () => {
		const ticketTypeModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
		const orderModel: any = { aggregate: jest.fn().mockReturnValue(exec([])) };
		await getSeatCounts(['e1'] as any, ticketTypeModel, orderModel);

		const [match, group] = orderModel.aggregate.mock.calls[0][0];
		expect(match.$match.orderStatus).toBe('PAID');
		expect(group.$group._id).toBe('$eventId');
		expect(group.$group.sold).toEqual({ $sum: { $sum: '$items.quantity' } });
	});

	it('runs no query for no events', async () => {
		const ticketTypeModel: any = { aggregate: jest.fn() };
		const orderModel: any = { aggregate: jest.fn() };
		expect((await getSeatCounts([], ticketTypeModel, orderModel)).size).toBe(0);
		expect(ticketTypeModel.aggregate).not.toHaveBeenCalled();
		expect(orderModel.aggregate).not.toHaveBeenCalled();
	});
});
