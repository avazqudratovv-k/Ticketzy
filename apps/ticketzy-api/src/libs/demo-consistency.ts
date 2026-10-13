/**
 * The consistency check of the demo data (`npm run check:demo`, and the last step of `seed:demo`). `evaluateDemoConsistency`
 * is pure: it compares numbers that were read from the database (see demo-snapshot.ts), so every rule has a unit test.
 * A failing rule is an error; the coverage rules ("the home hero has candidates", "one event is sold out") only describe what
 * the seed creates, so check:demo reports them as warnings because real use changes them.
 */
import { getCommissionRate } from './commission';
import { EventStatus } from './enums/event.enum';
import { MemberStatus, MemberType } from './enums/member.enum';
import { PayoutStatus } from './enums/payout.enum';
import { OrderStatus, TicketStatus, TicketTypeStatus } from './enums/ticket.enum';

export interface SnapMember {
	_id: string;
	memberType: MemberType;
	memberStatus: MemberStatus;
	completedEvents: number;
	memberEvents: number;
	memberFollowers: number;
	memberFollowings: number;
	memberLikes: number;
	memberViews: number;
	memberRank: number;
}

export interface SnapEvent {
	_id: string;
	organizerId: string;
	eventStatus: EventStatus;
	eventLikes: number;
	eventViews: number;
	eventComments: number;
	eventRank: number;
	startAt: Date;
	endAt: Date;
	saleStartAt?: Date;
	rejectReason?: string;
	cancelReason?: string;
	imageCount: number;
}

export interface SnapTicketType {
	eventId: string;
	totalQuantity: number;
	soldQuantity: number;
	ticketTypeStatus: TicketTypeStatus;
}

export interface SnapCount {
	/** event, member or conversation id the count belongs to */
	id: string;
	status?: string;
	count: number;
}

export interface DemoSnapshot {
	now: Date;
	members: SnapMember[];
	venueCount: number;
	events: SnapEvent[];
	ticketTypes: SnapTicketType[];
	/** orders per event and order status; `count` is the number of orders, `tickets` the quantity on them */
	orders: (SnapCount & { tickets: number })[];
	seats: SnapCount[];
	tickets: SnapCount[];
	/** PAID or REFUNDED orders whose total differs from the subtotal or whose commission is not the rate applied to it */
	badMoneyOrders: number;
	paidOrdersWithoutPayment: number;
	/** commission rates of an organizer's paid and refunded orders, oldest first */
	rates: { organizerId: string; rates: number[] }[];
	payouts: { eventId: string; eventStatus: EventStatus; gross: number; commission: number; net: number }[];
	/** payout statuses the real pipeline computes for each organizer */
	payoutStatuses: { organizerId: string; statuses: PayoutStatus[] }[];
	eventLikes: SnapCount[];
	memberLikes: SnapCount[];
	eventViews: SnapCount[];
	memberViews: SnapCount[];
	activeComments: SnapCount[];
	followers: SnapCount[];
	followings: SnapCount[];
	conversations: {
		id: string;
		unreadForOrganizer: number;
		unreadForAdmin: number;
		unreadFromAdmin: number;
		unreadFromOrganizer: number;
	}[];
	/** the organizer whose history must be rich, by id */
	richOrganizerId?: string;
}

export interface Finding {
	name: string;
	ok: boolean;
	/** counts only */
	detail: string;
	kind: 'invariant' | 'coverage';
}

const sum = (rows: SnapCount[], filter: (row: SnapCount) => boolean = () => true): number =>
	rows.filter(filter).reduce((total, row) => total + row.count, 0);
const countFor = (rows: SnapCount[], id: string): number => sum(rows, (row) => row.id === id);
const VALID_RATES = [10, 7, 5];

export const evaluateDemoConsistency = (snapshot: DemoSnapshot): Finding[] => {
	const findings: Finding[] = [];
	const check = (kind: Finding['kind'], name: string, bad: number, detail: string, okDetail = 'ok'): void => {
		findings.push({ kind, name, ok: bad === 0, detail: bad === 0 ? okDetail : `${bad} ${detail}` });
	};
	const { events, members, now } = snapshot;
	const ticketTypesOf = (eventId: string) => snapshot.ticketTypes.filter((type) => type.eventId === eventId);
	const ticketsOfOrders = (eventId: string, status: OrderStatus): number =>
		snapshot.orders.filter((row) => row.id === eventId && row.status === status).reduce((total, row) => total + row.tickets, 0);

	// stock: what the ticket types say is sold is what the paid orders hold
	const soldMismatch = events.filter(
		(event) => ticketTypesOf(event._id).reduce((total, type) => total + type.soldQuantity, 0) !== ticketsOfOrders(event._id, OrderStatus.PAID),
	).length;
	check('invariant', 'sold counters equal the tickets of paid orders', soldMismatch, 'event(s) where soldQuantity differs from the paid orders');

	const oversold = snapshot.ticketTypes.filter((type) => type.soldQuantity > type.totalQuantity || type.soldQuantity < 0).length;
	check('invariant', 'no ticket type is oversold', oversold, 'ticket type(s) sold more than their stock');

	const soldOutWrong = snapshot.ticketTypes.filter(
		(type) => type.totalQuantity > 0 && (type.soldQuantity >= type.totalQuantity) !== (type.ticketTypeStatus === TicketTypeStatus.SOLD_OUT),
	).length;
	check('invariant', 'SOLD_OUT matches the stock', soldOutWrong, 'ticket type(s) whose SOLD_OUT flag does not match their sold count');

	// seats: reserved events only (they have seat rows)
	const reservedMismatch = events.filter((event) => {
		const rows = snapshot.seats.filter((row) => row.id === event._id);
		if (!rows.length) return false;
		const soldSeats = sum(rows, (row) => row.status === 'SOLD');
		const valid = sum(snapshot.tickets, (row) => row.id === event._id && (row.status === TicketStatus.VALID || row.status === TicketStatus.USED));
		return soldSeats !== valid || soldSeats !== ticketsOfOrders(event._id, OrderStatus.PAID);
	}).length;
	check('invariant', 'sold seats equal the live tickets and the paid orders', reservedMismatch, 'reserved event(s) where seats, tickets and orders disagree');

	const heldSeats = sum(snapshot.seats, (row) => row.status === 'HELD');
	check('invariant', 'no seat is still held', heldSeats, 'seat(s) still held');
	const pendingOrders = sum(snapshot.orders, (row) => row.status === OrderStatus.PENDING_PAYMENT);
	check('invariant', 'no checkout is left open', pendingOrders, 'order(s) still waiting for payment');

	// tickets
	const ticketMismatch = events.filter((event) => {
		const live = sum(snapshot.tickets, (row) => row.id === event._id && (row.status === TicketStatus.VALID || row.status === TicketStatus.USED));
		const refunded = sum(snapshot.tickets, (row) => row.id === event._id && row.status === TicketStatus.REFUNDED);
		return live !== ticketsOfOrders(event._id, OrderStatus.PAID) || refunded !== ticketsOfOrders(event._id, OrderStatus.REFUNDED);
	}).length;
	check('invariant', 'tickets match their orders', ticketMismatch, 'event(s) where tickets differ from paid and refunded orders');

	const cancelledNotRefunded = events.filter(
		(event) => event.eventStatus === EventStatus.CANCELLED && ticketsOfOrders(event._id, OrderStatus.PAID) > 0,
	).length;
	check('invariant', 'a cancelled event has no paid order left', cancelledNotRefunded, 'cancelled event(s) with paid orders');

	const usedWrong = events.filter((event) => {
		const used = sum(snapshot.tickets, (row) => row.id === event._id && row.status === TicketStatus.USED);
		return used > 0 && (event.eventStatus !== EventStatus.ENDED || event.startAt.getTime() > now.getTime());
	}).length;
	check('invariant', 'only events that already happened have checked-in tickets', usedWrong, 'event(s) with checked-in tickets that did not happen yet');

	const noSalesEvents = events.filter(
		(event) =>
			[EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED].includes(event.eventStatus) &&
			(snapshot.orders.some((row) => row.id === event._id) || ticketTypesOf(event._id).some((type) => type.soldQuantity > 0)),
	).length;
	check('invariant', 'drafts, pending and rejected events have no sales', noSalesEvents, 'event(s) with sales that were never approved');

	// dates
	const staleApproved = events.filter((event) => event.eventStatus === EventStatus.APPROVED && event.endAt.getTime() <= now.getTime()).length;
	const earlyEnded = events.filter((event) => event.eventStatus === EventStatus.ENDED && event.endAt.getTime() > now.getTime()).length;
	check('invariant', 'event dates agree with their status', staleApproved + earlyEnded, 'event(s) whose dates and status disagree');

	// money
	check('invariant', 'order amounts and commissions are right', snapshot.badMoneyOrders, 'order(s) with a wrong total or commission');
	check('invariant', 'every paid order has a captured payment', snapshot.paidOrdersWithoutPayment, 'paid order(s) without a captured payment');

	const badRates = snapshot.rates.filter(
		(row) => row.rates.some((rate) => !VALID_RATES.includes(rate)) || row.rates.some((rate, index) => index > 0 && rate > row.rates[index - 1]),
	).length;
	check('invariant', 'commission follows the tiers (10, 7, 5 percent) and never rises', badRates, 'organizer(s) with an impossible commission history');

	const finalTierWrong = members.filter((member) => {
		if (member.memberType !== MemberType.ORGANIZER) return false;
		const row = snapshot.rates.find((item) => item.organizerId === member._id);
		if (!row?.rates.length) return false;
		return row.rates[row.rates.length - 1] < getCommissionRate({ completedEvents: member.completedEvents });
	}).length;
	check('invariant', 'no order was sold at a lower commission than the organizer earned', finalTierWrong, 'organizer(s) with a too low commission');

	const eventById = new Map(events.map((event) => [event._id, event]));
	const badPayouts = snapshot.payouts.filter(
		(payout) => payout.net !== payout.gross - payout.commission || payout.net < 1 || payout.eventStatus !== EventStatus.ENDED || !eventById.has(payout.eventId),
	).length;
	check('invariant', 'payout records add up and belong to finished events', badPayouts, 'payout(s) that do not add up');

	// counters of social records
	const likeMismatch = events.filter((event) => event.eventLikes !== countFor(snapshot.eventLikes, event._id)).length;
	const viewMismatch = events.filter((event) => event.eventViews !== countFor(snapshot.eventViews, event._id)).length;
	const commentMismatch = events.filter((event) => event.eventComments !== countFor(snapshot.activeComments, event._id)).length;
	check('invariant', 'event like, view and comment counters match their records', likeMismatch + viewMismatch + commentMismatch, 'counter(s) that differ from the records');

	const memberMismatch = members.filter(
		(member) =>
			member.memberLikes !== countFor(snapshot.memberLikes, member._id) ||
			member.memberViews !== countFor(snapshot.memberViews, member._id) ||
			member.memberFollowers !== countFor(snapshot.followers, member._id) ||
			member.memberFollowings !== countFor(snapshot.followings, member._id),
	).length;
	check('invariant', 'member like, view and follow counters match their records', memberMismatch, 'member(s) with a counter that differs from the records');

	const organizerCounters = members.filter((member) => {
		if (member.memberType !== MemberType.ORGANIZER) return false;
		const own = events.filter((event) => event.organizerId === member._id);
		const created = own.filter((event) => event.eventStatus !== EventStatus.CANCELLED).length;
		return member.memberEvents !== created || member.completedEvents !== own.filter((event) => event.eventStatus === EventStatus.ENDED).length;
	}).length;
	check('invariant', 'organizer event counters match their events', organizerCounters, 'organizer(s) with a wrong memberEvents or completedEvents');

	// ranks, as the batch job computes them
	const rankWrong =
		events.filter((event) => event.eventStatus === EventStatus.APPROVED && event.eventRank !== event.eventLikes * 2 + event.eventViews).length +
		members.filter(
			(member) =>
				member.memberType === MemberType.ORGANIZER &&
				member.memberStatus === MemberStatus.ACTIVE &&
				member.memberRank !== member.memberEvents * 5 + member.memberLikes * 2 + member.memberViews,
		).length;
	check('invariant', 'ranks are the ones the rank job computes', rankWrong, 'rank(s) that differ from the rank formula');

	const unreadWrong = snapshot.conversations.filter(
		(row) => row.unreadForOrganizer !== row.unreadFromAdmin || row.unreadForAdmin !== row.unreadFromOrganizer,
	).length;
	check('invariant', 'chat unread counters match the unread messages', unreadWrong, 'conversation(s) with a wrong unread counter');

	// coverage: what the seed is meant to create
	const buyers = members.filter((member) => member.memberType === MemberType.USER).length;
	const organizers = members.filter((member) => member.memberType === MemberType.ORGANIZER);
	const inRange = (value: number, min: number, max: number): number => (value >= min && value <= max ? 0 : 1);
	check('coverage', '40 to 60 buyers', inRange(buyers, 40, 60), 'buyer count out of range', `${buyers} buyers`);
	check('coverage', '40 to 60 events', inRange(events.length, 40, 60), 'event count out of range', `${events.length} events`);
	check('coverage', '10 venues', snapshot.venueCount === 10 ? 0 : 1, 'venue count is not 10', '10 venues');
	check(
		'coverage',
		'organizers in every state',
		[MemberStatus.ACTIVE, MemberStatus.PENDING, MemberStatus.REJECTED].filter((status) => !organizers.some((member) => member.memberStatus === status)).length,
		'organizer status(es) missing',
		`${organizers.length} organizers`,
	);

	const status = (value: EventStatus) => events.filter((event) => event.eventStatus === value);
	check('coverage', 'events in every status', Object.values(EventStatus).filter((value) => !status(value).length).length, 'event status(es) missing');
	check('coverage', 'a rejected event has a reason and a cancelled event has a reason', status(EventStatus.REJECTED).filter((e) => !e.rejectReason).length + status(EventStatus.CANCELLED).filter((e) => !e.cancelReason).length, 'event(s) without a reason');

	const hero = events.filter(
		(event) =>
			event.eventStatus === EventStatus.APPROVED &&
			event.imageCount > 0 &&
			event.startAt.getTime() > now.getTime() &&
			event.startAt.getTime() < now.getTime() + 7 * 24 * 60 * 60 * 1000,
	).length;
	check('coverage', 'at least 5 events with images start within 7 days', hero >= 5 ? 0 : 1, 'too few home hero candidates', `${hero} hero candidates`);

	const fill = (event: SnapEvent): number => {
		const types = ticketTypesOf(event._id);
		const total = types.reduce((value, type) => value + type.totalQuantity, 0);
		return total ? types.reduce((value, type) => value + type.soldQuantity, 0) / total : 0;
	};
	const approved = status(EventStatus.APPROVED);
	check('coverage', 'at least 2 sold out events', approved.filter((event) => fill(event) >= 1).length >= 2 ? 0 : 1, 'too few sold out events');
	check('coverage', 'at least 2 events about 90 percent sold', approved.filter((event) => fill(event) >= 0.85 && fill(event) < 1).length >= 2 ? 0 : 1, 'too few events near sold out');
	check('coverage', 'at least 2 events whose sales have not opened', approved.filter((event) => event.saleStartAt && event.saleStartAt.getTime() > now.getTime()).length >= 2 ? 0 : 1, 'too few events with sales not open yet');

	const rich = snapshot.richOrganizerId;
	if (rich) {
		const paidOrders = snapshot.orders
			.filter((row) => eventById.get(row.id)?.organizerId === rich && row.status === OrderStatus.PAID)
			.reduce((total, row) => total + row.count, 0);
		check('coverage', 'the rich organizer has more than 150 paid orders', paidOrders > 150 ? 0 : 1, 'paid orders are not above 150', `${paidOrders} paid orders`);
		const statuses = new Set(snapshot.payoutStatuses.find((row) => row.organizerId === rich)?.statuses ?? []);
		const missing = [PayoutStatus.NOT_YET_DUE, PayoutStatus.DUE, PayoutStatus.NOTHING_TO_PAY, PayoutStatus.PAID_OUT].filter((value) => !statuses.has(value));
		check('coverage', 'the rich organizer has every payout status', missing.length, 'payout status(es) missing');
	}
	return findings;
};

/** the report: counts only, one line per rule */
export const formatFindings = (findings: Finding[]): string =>
	findings.map((finding) => `  ${finding.ok ? 'ok  ' : finding.kind === 'coverage' ? 'warn' : 'FAIL'}  ${finding.name}: ${finding.detail}`).join('\n');

export const getInvariantFailures = (findings: Finding[], includeCoverage = false): Finding[] =>
	findings.filter((finding) => !finding.ok && (finding.kind === 'invariant' || includeCoverage));
