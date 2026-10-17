import { EventStatus } from './enums/event.enum';
import { MemberStatus, MemberType } from './enums/member.enum';
import { PayoutStatus } from './enums/payout.enum';
import { OrderStatus, TicketStatus, TicketTypeStatus } from './enums/ticket.enum';
import { DemoSnapshot, Finding, evaluateDemoConsistency, formatFindings, getInvariantFailures } from './demo-consistency';

const now = new Date('2026-10-13T08:00:00Z');
const DAY = 86400000;

/** a small, correct world: one active organizer with one finished and one upcoming event, one buyer */
const good = (): DemoSnapshot => ({
	now,
	members: [
		{ _id: 'org', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, completedEvents: 1, memberEvents: 2, memberLikes: 0, memberViews: 1, memberRank: 11 },
		{ _id: 'buyer', memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, completedEvents: 0, memberEvents: 0, memberLikes: 0, memberViews: 0, memberRank: 0 },
	],
	venueCount: 10,
	events: [
		{ _id: 'past', organizerId: 'org', eventStatus: EventStatus.ENDED, eventLikes: 0, eventViews: 0, eventComments: 0, eventRank: 0, startAt: new Date(now.getTime() - 5 * DAY), endAt: new Date(now.getTime() - 5 * DAY + 3600000), imageCount: 2 },
		{ _id: 'next', organizerId: 'org', eventStatus: EventStatus.APPROVED, eventLikes: 1, eventViews: 1, eventComments: 1, eventRank: 3, startAt: new Date(now.getTime() + 2 * DAY), endAt: new Date(now.getTime() + 2 * DAY + 3600000), imageCount: 2 },
	],
	ticketTypes: [
		{ eventId: 'past', totalQuantity: 10, soldQuantity: 3, ticketTypeStatus: TicketTypeStatus.ACTIVE },
		{ eventId: 'next', totalQuantity: 4, soldQuantity: 4, ticketTypeStatus: TicketTypeStatus.SOLD_OUT },
	],
	orders: [
		{ id: 'past', status: OrderStatus.PAID, count: 1, tickets: 3 },
		{ id: 'past', status: OrderStatus.REFUNDED, count: 1, tickets: 2 },
		{ id: 'next', status: OrderStatus.PAID, count: 2, tickets: 4 },
	],
	seats: [{ id: 'next', status: 'SOLD', count: 4 }],
	tickets: [
		{ id: 'past', status: TicketStatus.USED, count: 3 },
		{ id: 'past', status: TicketStatus.REFUNDED, count: 2 },
		{ id: 'next', status: TicketStatus.VALID, count: 4 },
	],
	badMoneyOrders: 0,
	paidOrdersWithoutPayment: 0,
	rates: [{ organizerId: 'org', rates: [10, 10] }],
	payouts: [{ eventId: 'past', eventStatus: EventStatus.ENDED, gross: 100, commission: 10, net: 90 }],
	payoutStatuses: [{ organizerId: 'org', statuses: [PayoutStatus.DUE, PayoutStatus.PAID_OUT] }],
	eventLikes: [{ id: 'next', count: 1 }],
	memberLikes: [],
	eventViews: [{ id: 'next', count: 1 }],
	memberViews: [{ id: 'org', count: 1 }],
	activeComments: [{ id: 'next', count: 1 }],
	conversations: [{ id: 'c', unreadForOrganizer: 1, unreadForAdmin: 0, unreadFromAdmin: 1, unreadFromOrganizer: 0 }],
});

const failing = (snapshot: DemoSnapshot): string[] => getInvariantFailures(evaluateDemoConsistency(snapshot)).map((finding) => finding.name);

describe('demo consistency check', () => {
	it('passes a correct world', () => {
		expect(failing(good())).toEqual([]);
	});

	it('catches a sold counter that differs from the paid orders', () => {
		const snapshot = good();
		snapshot.ticketTypes[0].soldQuantity = 4;
		expect(failing(snapshot)).toContain('sold counters equal the tickets of paid orders');
	});

	it('catches an oversold ticket type and a wrong SOLD_OUT flag', () => {
		const snapshot = good();
		snapshot.ticketTypes[1].soldQuantity = 5;
		expect(failing(snapshot)).toContain('no ticket type is oversold');
		const flag = good();
		flag.ticketTypes[1].ticketTypeStatus = TicketTypeStatus.ACTIVE;
		expect(failing(flag)).toContain('SOLD_OUT matches the stock');
	});

	it('catches seats that disagree with tickets, held seats and open checkouts', () => {
		const seats = good();
		seats.seats = [{ id: 'next', status: 'SOLD', count: 3 }];
		expect(failing(seats)).toContain('sold seats equal the live tickets and the paid orders');
		const held = good();
		held.seats.push({ id: 'next', status: 'HELD', count: 1 });
		expect(failing(held)).toContain('no seat is still held');
		const open = good();
		open.orders.push({ id: 'next', status: OrderStatus.PENDING_PAYMENT, count: 1, tickets: 1 });
		expect(failing(open)).toContain('no checkout is left open');
	});

	it('catches tickets that do not match refunded orders, and a cancelled event with paid orders', () => {
		const snapshot = good();
		snapshot.tickets[1].count = 1;
		expect(failing(snapshot)).toContain('tickets match their orders');
		const cancelled = good();
		cancelled.events[1].eventStatus = EventStatus.CANCELLED;
		expect(failing(cancelled)).toContain('a cancelled event has no paid order left');
	});

	it('catches checked-in tickets on an event that has not happened and sales on an unapproved event', () => {
		const used = good();
		used.tickets[2] = { id: 'next', status: TicketStatus.USED, count: 4 };
		expect(failing(used)).toContain('only events that already happened have checked-in tickets');
		const pending = good();
		pending.events[1].eventStatus = EventStatus.PENDING;
		expect(failing(pending)).toContain('drafts, pending and rejected events have no sales');
	});

	it('catches dates that disagree with the status', () => {
		const snapshot = good();
		snapshot.events[0].eventStatus = EventStatus.APPROVED;
		expect(failing(snapshot)).toContain('event dates agree with their status');
	});

	it('catches wrong money, a missing payment and a commission that rises', () => {
		const money = good();
		money.badMoneyOrders = 2;
		expect(failing(money)).toContain('order amounts and commissions are right');
		const payment = good();
		payment.paidOrdersWithoutPayment = 1;
		expect(failing(payment)).toContain('every paid order has a captured payment');
		const rising = good();
		rising.rates = [{ organizerId: 'org', rates: [7, 10] }];
		expect(failing(rising)).toContain('commission follows the tiers (10, 7, 5 percent) and never rises');
		const odd = good();
		odd.rates = [{ organizerId: 'org', rates: [12] }];
		expect(failing(odd)).toContain('commission follows the tiers (10, 7, 5 percent) and never rises');
		const low = good();
		low.members[0].completedEvents = 0;
		low.rates = [{ organizerId: 'org', rates: [5] }];
		expect(failing(low)).toContain('no order was sold at a lower commission than the organizer earned');
	});

	it('catches a payout that does not add up', () => {
		const snapshot = good();
		snapshot.payouts[0].net = 95;
		expect(failing(snapshot)).toContain('payout records add up and belong to finished events');
	});

	it('catches counters that differ from their records, organizer counters and ranks', () => {
		const likes = good();
		likes.events[1].eventLikes = 2;
		expect(failing(likes)).toContain('event like, view and comment counters match their records');
		const memberLikes = good();
		memberLikes.members[0].memberLikes = 5;
		expect(failing(memberLikes)).toContain('member like and view counters match their records');
		const organizer = good();
		organizer.members[0].completedEvents = 0;
		expect(failing(organizer)).toContain('organizer event counters match their events');
		const rank = good();
		rank.events[1].eventRank = 99;
		expect(failing(rank)).toContain('ranks are the ones the rank job computes');
	});

	it('catches a wrong chat unread counter', () => {
		const snapshot = good();
		snapshot.conversations[0].unreadForOrganizer = 4;
		expect(failing(snapshot)).toContain('chat unread counters match the unread messages');
	});

	it('reports missing coverage as warnings, not failures', () => {
		const findings = evaluateDemoConsistency(good());
		const coverage = findings.filter((finding: Finding) => finding.kind === 'coverage' && !finding.ok);
		expect(coverage.length).toBeGreaterThan(0);
		expect(getInvariantFailures(findings)).toHaveLength(0);
		expect(getInvariantFailures(findings, true).length).toBe(coverage.length);
		expect(formatFindings(findings)).toMatch(/warn {2}/);
	});

	it('names the offending event and the numbers compared (the cancelled reserved event of the first real run)', () => {
		const snapshot = good();
		snapshot.events.push({ ...snapshot.events[1], _id: 'cancelled1', title: 'Winter Choir', eventStatus: EventStatus.CANCELLED, cancelReason: 'ill', eventLikes: 0, eventViews: 0, eventComments: 0, eventRank: 0 });
		snapshot.ticketTypes.push({ eventId: 'cancelled1', totalQuantity: 10, soldQuantity: 2, ticketTypeStatus: TicketTypeStatus.ACTIVE });
		snapshot.orders.push({ id: 'cancelled1', status: OrderStatus.REFUNDED, count: 1, tickets: 2 });
		snapshot.seats.push({ id: 'cancelled1', status: 'SOLD', count: 2 });
		snapshot.tickets.push({ id: 'cancelled1', status: TicketStatus.REFUNDED, count: 2 });

		const findings = evaluateDemoConsistency(snapshot);
		const stock = findings.find((finding) => finding.name === 'sold counters equal the tickets of paid orders');
		const seats = findings.find((finding) => finding.name === 'sold seats equal the live tickets and the paid orders');
		expect(stock?.ok).toBe(false);
		expect(stock?.lines).toEqual(['cancelled1 "Winter Choir" [CANCELLED]: soldQuantity 2 (per ticket type: 2), tickets on paid orders 0, on refunded orders 2']);
		expect(seats?.lines).toEqual([
			'cancelled1 "Winter Choir" [CANCELLED]: sold seats 2, live tickets (valid or used) 0, tickets on paid orders 0, refunded tickets 2, soldQuantity 2',
		]);
		const text = formatFindings(findings);
		expect(text).toContain('FAIL  sold counters equal the tickets of paid orders: 1 event(s)');
		expect(text).toContain('        - cancelled1 "Winter Choir"');
		expect(failing(snapshot)).toEqual(['sold counters equal the tickets of paid orders', 'sold seats equal the live tickets and the paid orders']);
	});

	it('lists no lines for a passing rule, and caps the lines of a failing one', () => {
		expect(evaluateDemoConsistency(good()).every((finding) => !finding.lines)).toBe(true);
		const snapshot = good();
		for (let i = 0; i < 30; i++) {
			snapshot.events.push({ ...snapshot.events[1], _id: `e${i}`, title: `Event ${i}`, eventLikes: 0, eventViews: 0, eventComments: 0, eventRank: 0 });
			snapshot.ticketTypes.push({ eventId: `e${i}`, totalQuantity: 10, soldQuantity: 1, ticketTypeStatus: TicketTypeStatus.ACTIVE });
		}
		const stock = evaluateDemoConsistency(snapshot).find((finding) => finding.name === 'sold counters equal the tickets of paid orders');
		expect(stock?.detail).toBe('30 event(s) where soldQuantity differs from the paid orders');
		expect(stock?.lines).toHaveLength(20);
	});

	it('prints counts and names only', () => {
		const text = formatFindings(evaluateDemoConsistency(good()));
		expect(text).not.toMatch(/mongodb|password|token/i);
	});
});
