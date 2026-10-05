import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { OrderService } from './order.service';
import { EventStatus } from '../../libs/enums/event.enum';
import { OrderStatus } from '../../libs/enums/ticket.enum';

const E = '64b7f0000000000000000001';
const A = '64b7f0000000000000000002';
const B = '64b7f0000000000000000003';
const oid = (id: string) => new ObjectId(id);

const query = (value: any) => ({ exec: jest.fn().mockResolvedValue(value), lean: jest.fn().mockReturnThis() });

const futureEvent = () => ({
	_id: E,
	eventStatus: EventStatus.ON_SALE,
	endAt: new Date(Date.now() + 86400000),
});

describe('OrderService', () => {
	let orderModel: any;
	let eventModel: any;
	let ticketModel: any;
	let paymentModel: any;
	let ticketTypeService: any;
	let service: OrderService;

	beforeEach(() => {
		orderModel = { create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn().mockReturnValue(query({})) };
		eventModel = { findOne: jest.fn().mockReturnValue(query(futureEvent())) };
		ticketModel = { insertMany: jest.fn(), deleteMany: jest.fn().mockReturnValue(query({})) };
		paymentModel = { create: jest.fn(), deleteMany: jest.fn().mockReturnValue(query({})) };
		ticketTypeService = { reserve: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
		service = new OrderService(orderModel, eventModel, ticketModel, paymentModel, ticketTypeService);
	});

	const input = (items: { ticketTypeId: string; quantity: number }[]) => ({ eventId: E, items }) as any;
	const reserved = (id: string, price: number) => ({ _id: id, eventId: E, ticketPrice: price, ticketCurrency: 'USD' });

	describe('createOrder', () => {
		it('snapshots unit prices, totals the order and holds it as PENDING', async () => {
			ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(reserved(B, 120));
			orderModel.create.mockImplementation(async (doc) => doc);

			const order: any = await service.createOrder('m1' as any, input([
				{ ticketTypeId: A, quantity: 2 },
				{ ticketTypeId: B, quantity: 1 },
			]));

			expect(order.totalAmount).toBe(220);
			expect(order.items.map((i) => i.unitPrice)).toEqual([50, 120]);
			expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now());
			expect(ticketTypeService.release).not.toHaveBeenCalled();
		});

		it('releases earlier reservations when a later item cannot be reserved', async () => {
			ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(null);

			await expect(
				service.createOrder('m1' as any, input([
					{ ticketTypeId: A, quantity: 2 },
					{ ticketTypeId: B, quantity: 1 },
				])),
			).rejects.toBeInstanceOf(BadRequestException);

			expect(ticketTypeService.release).toHaveBeenCalledTimes(1);
			expect(ticketTypeService.release).toHaveBeenCalledWith(oid(A), 2);
			expect(orderModel.create).not.toHaveBeenCalled();
		});

		it('releases stock when saving the order fails', async () => {
			ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50));
			orderModel.create.mockRejectedValue(new Error('db down'));

			await expect(service.createOrder('m1' as any, input([{ ticketTypeId: A, quantity: 3 }]))).rejects.toBeInstanceOf(
				BadRequestException,
			);
			expect(ticketTypeService.release).toHaveBeenCalledWith(oid(A), 3);
		});

		it('rejects a ticket type that belongs to a different event, and releases it', async () => {
			ticketTypeService.reserve.mockResolvedValueOnce({ ...reserved(A, 50), eventId: 'other' });

			await expect(service.createOrder('m1' as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(
				BadRequestException,
			);
			expect(ticketTypeService.release).toHaveBeenCalledWith(oid(A), 1);
		});

		it('rejects mixed currencies in one order', async () => {
			ticketTypeService.reserve
				.mockResolvedValueOnce(reserved(A, 50))
				.mockResolvedValueOnce({ ...reserved(B, 10), ticketCurrency: 'EUR' });

			await expect(
				service.createOrder('m1' as any, input([
					{ ticketTypeId: A, quantity: 1 },
					{ ticketTypeId: B, quantity: 1 },
				])),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(ticketTypeService.release).toHaveBeenCalledTimes(2);
		});

		it('rejects duplicate ticket types before reserving anything', async () => {
			await expect(
				service.createOrder('m1' as any, input([
					{ ticketTypeId: A, quantity: 1 },
					{ ticketTypeId: A, quantity: 1 },
				])),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(ticketTypeService.reserve).not.toHaveBeenCalled();
		});

		it('rejects events that are not on sale or already over', async () => {
			eventModel.findOne.mockReturnValue(query(null));
			await expect(service.createOrder('m1' as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(
				BadRequestException,
			);

			eventModel.findOne.mockReturnValue(query({ ...futureEvent(), endAt: new Date(Date.now() - 1000) }));
			await expect(service.createOrder('m1' as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(
				BadRequestException,
			);
			expect(ticketTypeService.reserve).not.toHaveBeenCalled();
		});
	});

	describe('payOrder', () => {
		const pendingOrder = {
			_id: 'o1',
			orderNumber: 'TZ-1',
			buyerId: 'm1',
			eventId: 'e1',
			totalAmount: 140,
			items: [
				{ ticketTypeId: A, quantity: 2, unitPrice: 50 },
				{ ticketTypeId: B, quantity: 1, unitPrice: 40 },
			],
		};

		it('only pays an unexpired PENDING order of the buyer, via one conditional update', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(query(pendingOrder));
			ticketModel.insertMany.mockResolvedValue([]);

			await service.payOrder('m1' as any, 'o1' as any);

			const [filter, update] = orderModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toMatchObject({ _id: 'o1', buyerId: 'm1', orderStatus: OrderStatus.PENDING });
			expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
			expect(update.orderStatus).toBe(OrderStatus.PAID);
		});

		it('issues one unique ticket per purchased seat', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(query(pendingOrder));
			ticketModel.insertMany.mockResolvedValue([]);

			await service.payOrder('m1' as any, 'o1' as any);

			const tickets = ticketModel.insertMany.mock.calls[0][0];
			expect(tickets).toHaveLength(3);
			expect(new Set(tickets.map((t) => t.ticketCode)).size).toBe(3);
			expect(tickets.every((t) => t.ownerId === 'm1' && t.eventId === 'e1')).toBe(true);
		});

		it('rejects an order that is expired, already paid or not the buyer\'s', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(query(null));
			await expect(service.payOrder('m1' as any, 'o1' as any)).rejects.toBeInstanceOf(BadRequestException);
			expect(ticketModel.insertMany).not.toHaveBeenCalled();
		});

		it('rolls the order back to PENDING if ticket issuing fails', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(query(pendingOrder));
			ticketModel.insertMany.mockRejectedValue(new Error('db down'));

			await expect(service.payOrder('m1' as any, 'o1' as any)).rejects.toThrow();

			expect(ticketModel.deleteMany).toHaveBeenCalled();
			expect(orderModel.updateOne).toHaveBeenCalledWith(
				{ _id: 'o1', orderStatus: OrderStatus.PAID },
				expect.objectContaining({ orderStatus: OrderStatus.PENDING }),
			);
		});
	});

	describe('cancelOrder', () => {
		it('releases every item of a cancelled PENDING order', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(
				query({
					items: [
						{ ticketTypeId: A, quantity: 2 },
						{ ticketTypeId: B, quantity: 1 },
					],
				}),
			);

			await service.cancelOrder('m1' as any, 'o1' as any);

			expect(ticketTypeService.release).toHaveBeenCalledWith(A, 2);
			expect(ticketTypeService.release).toHaveBeenCalledWith(B, 1);
		});

		it('does nothing for an order that is not PENDING', async () => {
			orderModel.findOneAndUpdate.mockReturnValue(query(null));
			await expect(service.cancelOrder('m1' as any, 'o1' as any)).rejects.toBeInstanceOf(BadRequestException);
			expect(ticketTypeService.release).not.toHaveBeenCalled();
		});
	});
});
