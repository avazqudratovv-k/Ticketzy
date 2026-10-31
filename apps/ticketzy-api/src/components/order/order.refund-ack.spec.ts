import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { OrderService } from './order.service';
import { Message } from '../../libs/enums/common.enum';
import { EventStatus, RefundPolicyType, SeatingType } from '../../libs/enums/event.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { OrderStatus } from '../../libs/enums/ticket.enum';

const oid = () => new ObjectId();
const BUYER = oid();
const ORG = oid();
const E = oid();
const A = oid();
const day = 86400000;

/** DECISIONS #129: the server refuses an order for a non-refundable event unless the buyer confirmed it */
describe('OrderService.createCheckout: non-refundable acknowledgement', () => {
	let events: FakeModel;
	let orders: FakeModel;
	let ticketTypeService: any;
	let service: OrderService;

	const setup = (refundPolicy?: any) => {
		const members = new FakeModel([
			{ _id: BUYER, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER, emailVerifiedAt: new Date('2026-01-01') },
			{ _id: ORG, memberStatus: MemberStatus.ACTIVE, memberType: MemberType.ORGANIZER, completedEvents: 0 },
		]);
		events = new FakeModel([
			{ _id: E, eventStatus: EventStatus.APPROVED, seatingType: SeatingType.GENERAL, organizerId: ORG, startAt: new Date(Date.now() + 5 * day), endAt: new Date(Date.now() + 6 * day), ...(refundPolicy ? { refundPolicy } : {}) },
		]);
		orders = new FakeModel([], { orderStatus: OrderStatus.PENDING_PAYMENT });
		ticketTypeService = {
			reserve: jest.fn().mockResolvedValue({ _id: A, eventId: E, ticketPrice: 50, ticketCurrency: 'KRW' }),
			release: jest.fn().mockResolvedValue(undefined),
		};
		service = new OrderService(orders as any, events as any, new FakeModel() as any, members as any, ticketTypeService, {} as any, {} as any, {} as any);
	};
	const input = (over: any = {}) => ({ eventId: E, items: [{ ticketTypeId: A, quantity: 1 }], ...over }) as any;
	const NON_REFUNDABLE = { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 };

	it('rejects the order without the flag, before any stock is reserved', async () => {
		setup(NON_REFUNDABLE);
		await expect(service.createCheckout(BUYER as any, input())).rejects.toThrow(new BadRequestException(Message.NON_REFUNDABLE_ACK_REQUIRED));
		expect(ticketTypeService.reserve).not.toHaveBeenCalled();
		expect(orders.docs).toHaveLength(0);
	});

	it.each([false, undefined, null, 'true' as any, 1 as any])('rejects the flag %p (only an explicit true counts)', async (flag) => {
		setup(NON_REFUNDABLE);
		await expect(service.createCheckout(BUYER as any, input({ acknowledgeNonRefundable: flag }))).rejects.toThrow(Message.NON_REFUNDABLE_ACK_REQUIRED);
		expect(orders.docs).toHaveLength(0);
	});

	it('accepts the order with the flag and keeps the policy and the time of the confirmation on it', async () => {
		setup(NON_REFUNDABLE);
		const order: any = await service.createCheckout(BUYER as any, input({ acknowledgeNonRefundable: true }));
		expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
		expect(order.refundPolicy).toEqual(NON_REFUNDABLE);
		expect(order.nonRefundableAcknowledgedAt).toBeInstanceOf(Date);
	});

	it('does not ask for the flag when the event is refundable (also when it is left out of the input)', async () => {
		setup({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 3 });
		const order: any = await service.createCheckout(BUYER as any, input());
		expect(order.refundPolicy).toEqual({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 3 });
		expect(order.nonRefundableAcknowledgedAt).toBeUndefined();
	});

	it('treats an event saved before policies as refundable until the day before: no flag needed', async () => {
		setup();
		const order: any = await service.createCheckout(BUYER as any, input());
		expect(order.refundPolicy).toEqual({ policyType: RefundPolicyType.REFUNDABLE, daysBefore: 1 });
	});

	it('refuses a reserved-seating checkout of a non-refundable event without the flag too', async () => {
		setup(NON_REFUNDABLE);
		events.docs[0].seatingType = SeatingType.RESERVED;
		await expect(service.createCheckout(BUYER as any, { eventId: E, seatIds: [oid()] } as any)).rejects.toThrow(Message.NON_REFUNDABLE_ACK_REQUIRED);
	});
});
