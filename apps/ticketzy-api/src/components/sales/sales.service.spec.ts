import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { SalesService } from './sales.service';
import { Message } from '../../libs/enums/common.enum';
import { OrderStatus, TicketStatus } from '../../libs/enums/ticket.enum';

const ORG = new ObjectId();
const OTHER = new ObjectId();
const EVENT = new ObjectId();
const VIP = new ObjectId();
const STD = new ObjectId();
const query = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('SalesService', () => {
	let orderModel: any;
	let ticketModel: any;
	let events: FakeModel;
	let ticketTypes: FakeModel;
	let service: SalesService;

	beforeEach(() => {
		orderModel = { aggregate: jest.fn() };
		ticketModel = { aggregate: jest.fn() };
		events = new FakeModel([{ _id: EVENT, organizerId: ORG }]);
		ticketTypes = new FakeModel([
			{ _id: STD, eventId: EVENT, ticketTypeName: 'Standard', ticketCurrency: 'USD', ticketPrice: 20 },
			{ _id: VIP, eventId: EVENT, ticketTypeName: 'VIP', ticketCurrency: 'USD', ticketPrice: 100 },
		]);
		service = new SalesService(orderModel, ticketModel, events as any, ticketTypes as any);
	});

	describe('owner only', () => {
		it('rejects every query for an event of another organizer', async () => {
			await expect(service.getEventSales(OTHER as any, EVENT as any)).rejects.toThrow(Message.NOT_ALLOWED_REQUEST);
			await expect(service.getEventAttendees(OTHER as any, { eventId: EVENT as any, page: 1, limit: 10 })).rejects.toBeInstanceOf(BadRequestException);
			expect(orderModel.aggregate).not.toHaveBeenCalled();
			expect(ticketModel.aggregate).not.toHaveBeenCalled();
		});
	});

	describe('getEventSales', () => {
		it('counts PAID orders only and lists every ticket type, also the ones that sold nothing', async () => {
			orderModel.aggregate.mockReturnValue(query([]));
			const sales = await service.getEventSales(ORG as any, EVENT as any);

			expect(orderModel.aggregate.mock.calls[0][0][0].$match).toEqual({ eventId: EVENT, orderStatus: OrderStatus.PAID });
			expect(sales.ticketTypes.map((t) => [t.ticketTypeName, t.ticketsSold, t.revenue])).toEqual([
				['Standard', 0, 0],
				['VIP', 0, 0],
			]);
		});

		it('computes commission with the rate stored on each order and the net payout from it', async () => {
			orderModel.aggregate.mockReturnValue(
				query([
					{ _id: { ticketTypeId: VIP, commissionRate: 10, currency: 'USD' }, ticketsSold: 2, revenue: 200 },
					// the same ticket type, sold under a lower rate (the organizer reached a better tier in between)
					{ _id: { ticketTypeId: VIP, commissionRate: 7, currency: 'USD' }, ticketsSold: 1, revenue: 100 },
					{ _id: { ticketTypeId: STD, commissionRate: 10, currency: 'USD' }, ticketsSold: 3, revenue: 60 },
				]),
			);
			const sales = await service.getEventSales(ORG as any, EVENT as any);

			const vip = sales.ticketTypes.find((t) => t.ticketTypeName === 'VIP');
			expect(vip).toMatchObject({ ticketsSold: 3, revenue: 300, commission: 27, netPayout: 273, currency: 'USD' });
			const std = sales.ticketTypes.find((t) => t.ticketTypeName === 'Standard');
			expect(std).toMatchObject({ ticketsSold: 3, revenue: 60, commission: 6, netPayout: 54 });
		});
	});

	describe('getEventAttendees', () => {
		it('pages the tickets of the event, VALID and USED by default, without contact details', async () => {
			ticketModel.aggregate.mockReturnValue(query([{ list: [{ ticketId: 't1', buyerName: null }], metaCounter: [{ total: 1 }] }]));
			const result = await service.getEventAttendees(ORG as any, { eventId: EVENT as any, page: 3, limit: 20 });

			const stages = ticketModel.aggregate.mock.calls[0][0];
			expect(stages[0].$match).toEqual({ eventId: EVENT, ticketStatus: { $in: [TicketStatus.VALID, TicketStatus.USED] } });
			const list = stages.find((s) => s.$facet).$facet.list;
			expect(list.find((s) => s.$skip !== undefined).$skip).toBe(40);
			expect(list.find((s) => s.$limit !== undefined).$limit).toBe(20);
			const projected = Object.keys(list.find((s) => s.$project).$project);
			expect(projected).not.toEqual(expect.arrayContaining(['qrToken']));
			expect(projected).not.toEqual(expect.arrayContaining(['memberEmail']));
			expect(result.list[0].buyerName).toBe('');
		});

		it('can ask for one status', async () => {
			ticketModel.aggregate.mockReturnValue(query([{ list: [], metaCounter: [] }]));
			await service.getEventAttendees(ORG as any, { eventId: EVENT as any, page: 1, limit: 5, ticketStatus: TicketStatus.REFUNDED });
			expect(ticketModel.aggregate.mock.calls[0][0][0].$match.ticketStatus).toBe(TicketStatus.REFUNDED);
		});
	});

	describe('getMyEarnings', () => {
		it('is empty for an organizer without events', async () => {
			expect(await service.getMyEarnings(OTHER as any)).toEqual({ earnings: [] });
			expect(orderModel.aggregate).not.toHaveBeenCalled();
		});

		it('sums per currency, keeps refunds apart and never mixes currencies', async () => {
			orderModel.aggregate.mockReturnValue(
				query([
					{ _id: { currency: 'USD', commissionRate: 10, orderStatus: OrderStatus.PAID }, ordersCount: 2, amount: 300, ticketsSold: 5 },
					{ _id: { currency: 'USD', commissionRate: 7, orderStatus: OrderStatus.PAID }, ordersCount: 1, amount: 100, ticketsSold: 1 },
					{ _id: { currency: 'USD', commissionRate: 10, orderStatus: OrderStatus.REFUNDED }, ordersCount: 1, amount: 50, ticketsSold: 1 },
					{ _id: { currency: 'KRW', commissionRate: 10, orderStatus: OrderStatus.PAID }, ordersCount: 1, amount: 40000, ticketsSold: 2 },
				]),
			);
			const { earnings } = await service.getMyEarnings(ORG as any);

			expect(orderModel.aggregate.mock.calls[0][0][0].$match.orderStatus).toEqual({ $in: [OrderStatus.PAID, OrderStatus.REFUNDED] });
			expect(earnings).toHaveLength(2);
			expect(earnings.find((e) => e.currency === 'USD')).toEqual({
				currency: 'USD',
				ordersCount: 3,
				ticketsSold: 6,
				revenue: 400,
				commission: 37,
				netPayout: 363,
				refundedAmount: 50,
			});
			expect(earnings.find((e) => e.currency === 'KRW')).toMatchObject({ revenue: 40000, commission: 4000, netPayout: 36000, refundedAmount: 0 });
		});
	});
});
