import { DemoSeeder } from './demo-seeder';
import { RefundPolicyType } from './libs/enums/event.enum';

const NON_REFUNDABLE = { policyType: RefundPolicyType.NON_REFUNDABLE, daysBefore: 0 };
const REFUNDABLE = { policyType: RefundPolicyType.REFUNDABLE, daysBefore: 3 };

const seeder = (): any => {
	const instance: any = Object.create(DemoSeeder.prototype);
	instance.organizers = { hanbit: { _id: 'org1' } };
	instance.venues = { hall: { _id: 'venue1' } };
	instance.keptEvents = [];
	instance.skippedEvents = new Set();
	instance.created = new Map();
	instance.track = jest.fn(async () => undefined);
	instance.eventService = { createEvent: jest.fn(async () => ({ _id: 'new' })), submitEventForApproval: jest.fn() };
	instance.ticketTypeService = { createTicketType: jest.fn() };
	return instance;
};
const planEvent = (over: any = {}): any => ({
	key: 'hanbit-01-lanterns',
	organizer: 'hanbit',
	venue: 'hall',
	category: 'CONCERT',
	seating: 'RESERVED',
	status: 'DRAFT',
	title: 'Dalbit Parade Live Vol. 1',
	desc: 'A concert',
	translations: [],
	images: [],
	ticketTypes: [],
	shiftDays: 0,
	startAt: new Date('2026-12-01T10:00:00Z'),
	endAt: new Date('2026-12-01T13:00:00Z'),
	refundPolicy: REFUNDABLE,
	...over,
});

describe('DemoSeeder with DEMO_SEED_KEEP_LINKED (DECISIONS #132)', () => {
	it('does not create an event again when a kept event has the same organizer, venue and title, and does not track or touch it', async () => {
		const s = seeder();
		s.keptEvents = [{ _id: 'old', organizerId: 'org1', venueId: 'venue1', eventTitle: 'Dalbit Parade Live Vol. 1' }];
		await s.processEvent(planEvent());
		expect(s.eventService.createEvent).not.toHaveBeenCalled();
		expect(s.track).not.toHaveBeenCalled();
		expect([...s.skippedEvents]).toEqual(['hanbit-01-lanterns']);
	});

	it('creates an event that no kept event matches (another title, organizer or venue)', async () => {
		for (const kept of [
			{ organizerId: 'org1', venueId: 'venue1', eventTitle: 'Another show' },
			{ organizerId: 'other', venueId: 'venue1', eventTitle: 'Dalbit Parade Live Vol. 1' },
			{ organizerId: 'org1', venueId: 'other', eventTitle: 'Dalbit Parade Live Vol. 1' },
		]) {
			const s = seeder();
			s.keptEvents = [kept];
			await s.processEvent(planEvent());
			expect(s.eventService.createEvent).toHaveBeenCalledTimes(1);
			expect(s.skippedEvents.size).toBe(0);
		}
	});

	it('sends the refund policy of the plan with the event', async () => {
		const s = seeder();
		await s.processEvent(planEvent({ refundPolicy: NON_REFUNDABLE }));
		expect(s.eventService.createEvent.mock.calls[0][0].refundPolicy).toEqual(NON_REFUNDABLE);
	});

	it('does not like or touch the time of an organizer that was kept (a like is a toggle)', async () => {
		const s = seeder();
		s.newOrganizers = new Set();
		s.buyers = [{ _id: 'b' }];
		s.memberService = { getMember: jest.fn(), likeTargetMember: jest.fn() };
		await s.likeOrganizers();
		expect(s.memberService.getMember).not.toHaveBeenCalled();
		expect(s.memberService.likeTargetMember).not.toHaveBeenCalled();
	});
});

describe('DemoSeeder buys non-refundable tickets like the app does (DECISIONS #129)', () => {
	const buyerOrder = async (policy: any) => {
		const s = seeder();
		s.seatService = { holdSeats: jest.fn() };
		s.orderService = {
			createCheckout: jest.fn(async () => ({ _id: 'order1' })),
			payOrder: jest.fn(async () => ({ orderStatus: 'PAID' })),
		};
		const result = await s.placeOrder({ _id: 'buyer1' }, { _id: 'event1' }, { items: [{ ticketTypeId: 't', quantity: 1 }] }, planEvent({ refundPolicy: policy }));
		return { s, result };
	};

	it('acknowledges a non-refundable event', async () => {
		const { s } = await buyerOrder(NON_REFUNDABLE);
		expect(s.orderService.createCheckout.mock.calls[0][1].acknowledgeNonRefundable).toBe(true);
	});

	it('does not send the flag for a refundable event', async () => {
		const { s } = await buyerOrder(REFUNDABLE);
		expect(s.orderService.createCheckout.mock.calls[0][1].acknowledgeNonRefundable).toBeUndefined();
	});
});
