import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { OrderService } from './order.service';
import { EventStatus, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus } from '../../libs/enums/ticket.enum';

const oid = () => new ObjectId();
const BUYER = oid();
const ORG = oid();
const E = oid();
const A = oid();
const B = oid();
const day = 86400000;

describe('OrderService.createCheckout (general admission)', () => {
	let members: FakeModel;
	let events: FakeModel;
	let orders: FakeModel;
	let ticketTypeService: any;
	let service: OrderService;

	beforeEach(() => {
		members = new FakeModel([
			{ _id: BUYER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER },
			{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, completedEvents: 0 },
		]);
		events = new FakeModel([
			{ _id: E, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: new Date(Date.now() + day), endAt: new Date(Date.now() + 2 * day) },
		]);
		orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
		ticketTypeService = { reserve: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
		service = new OrderService(orders as any, events as any, new FakeModel() as any, members as any, ticketTypeService, {} as any, {} as any, {} as any);
	});

	const input = (items: { ticketTypeId: ObjectId; quantity: number }[]) => ({ eventId: E, items }) as any;
	const reserved = (id: ObjectId, price: number) => ({ _id: id, eventId: E, ticketPrice: price, ticketCurrency: 'USD' });

	it('snapshots unit prices, totals the order and holds it as PENDING_PAYMENT', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(reserved(B, 120));

		const order: any = await service.createCheckout(BUYER as any, input([
			{ ticketTypeId: A, quantity: 2 },
			{ ticketTypeId: B, quantity: 1 },
		]));

		expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		expect(order.totalAmount).toBe(220);
		expect(order.subtotal).toBe(220);
		expect(order.commissionRate).toBe(10);
		expect(order.commissionAmount).toBe(22);
		expect(order.items.map((i) => i.unitPrice)).toEqual([50, 120]);
		expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now());
		expect(ticketTypeService.release).not.toHaveBeenCalled();
	});

	it('refuses an event whose organizer is not ACTIVE, before anything is reserved', async () => {
		members.docs[1].memberStatus = MemberStatus.SUSPENDED;
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
		expect(orders.docs).toHaveLength(0);
	});

	it('refuses a buyer who is not ACTIVE', async () => {
		members.docs[0].memberStatus = MemberStatus.SUSPENDED;
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});

	it('releases earlier reservations when a later item cannot be reserved', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce(null);
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 2 }, { ticketTypeId: B, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledTimes(1);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 2);
		expect(orders.docs).toHaveLength(0);
	});

	it('releases stock when saving the order fails', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50));
		orders.create = jest.fn().mockRejectedValue(new Error('db down'));
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 3 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 3);
	});

	it('rejects a ticket type of another event, and releases it', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce({ ...reserved(A, 50), eventId: oid() });
		await expect(service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]))).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledWith(A, 1);
	});

	it('rejects mixed currencies in one order', async () => {
		ticketTypeService.reserve.mockResolvedValueOnce(reserved(A, 50)).mockResolvedValueOnce({ ...reserved(B, 10), ticketCurrency: 'EUR' });
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }, { ticketTypeId: B, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.release).toHaveBeenCalledTimes(2);
	});

	it('rejects duplicate ticket types before reserving anything', async () => {
		await expect(
			service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }, { ticketTypeId: A, quantity: 1 }])),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});

	it('rejects events that are not APPROVED, already over, or outside their sale window', async () => {
		const attempt = () => service.createCheckout(BUYER as any, input([{ ticketTypeId: A, quantity: 1 }]));

		events.docs[0].eventStatus = EventStatus.PENDING;
		await expect(attempt()).rejects.toBeInstanceOf(BadRequestException);

		events.docs[0].eventStatus = EventStatus.APPROVED;
		events.docs[0].endAt = new Date(Date.now() - 1000);
		await expect(attempt()).rejects.toBeInstanceOf(BadRequestException);

		events.docs[0].endAt = new Date(Date.now() + day);
		events.docs[0].saleStartAt = new Date(Date.now() + day);
		await expect(attempt()).rejects.toBeInstanceOf(BadRequestException);
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
	});
});
