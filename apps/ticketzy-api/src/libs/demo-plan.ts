/**
 * The shape of the demo data, as plain values (DECISIONS #108). `buildDemoPlan(now)` turns the table below into dated events:
 * every date is `now` plus or minus a number of days, so the data never looks stale (run the seed again to refresh it).
 * Nothing here touches a database or a service; the seeder walks the plan and uses the real services for each step.
 */
import { EventCategory, EventStatus, SeatingType } from './enums/event.enum';
import {
	CATEGORY_PRICES,
	DEMO_BASES,
	DEMO_LOCALES,
	DEMO_VENUES,
	DemoBase,
	DemoLocale,
	GA_QUANTITIES,
	OrganizerKey,
	TIER_FACTORS,
	TIER_NAMES,
	VenueKey,
	demoImage,
} from './demo-data';
import { getSeatedSections } from './venue-layout';

/** RANDOM NUMBERS: a fixed seed, so the same day gives the same shape of data */

export type Rng = () => number;

export const createRng = (seed: number): Rng => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export const randomInt = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
export const pickOne = <T>(rng: Rng, items: T[]): T => items[Math.floor(rng() * items.length)];
export const shuffled = <T>(rng: Rng, items: T[]): T[] => {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

/** THE PLAN */

export type PayoutPlan = 'paid' | 'due' | 'notYetDue' | 'nothing' | 'none';
export type BuyerOutcome = 'paid' | 'refunded' | 'cancelled' | 'failed';

export interface PlanTicketType {
	name: string;
	price: number;
	maxPerOrder: number;
	/** RESERVED events: the quantity comes from the seats of the tier */
	tierKey?: string;
	/** GENERAL events */
	quantity?: number;
}

export interface PlanEvent {
	key: string;
	organizer: OrganizerKey;
	venue: VenueKey;
	baseId: string;
	category: EventCategory;
	seating: SeatingType;
	/** the status the seed brings the event to */
	status: EventStatus;
	/** final dates; an ENDED event lies in the past */
	startAt: Date;
	endAt: Date;
	/**
	 * Days the event is created later than its final date. The API only creates events in the future, so a past event is
	 * created `shiftDays` ahead, sold, and then moved back by the same number of days (which keeps every venue slot free).
	 */
	shiftDays: number;
	saleStartAt?: Date;
	createdAt: Date;
	approvedAt: Date;
	/** when it was rejected or cancelled */
	decidedAt?: Date;
	title: string;
	desc: string;
	translations: { locale: DemoLocale; title: string; description: string }[];
	images: string[];
	ticketTypes: PlanTicketType[];
	/** orders range, or the share of the whole stock to sell (1 is sold out) */
	orders: [number, number];
	fill?: number;
	noSales: boolean;
	refundShare: number;
	refundAll: boolean;
	adminRefunds: number;
	checkInShare: number;
	popularity: number;
	hero: boolean;
	payout: PayoutPlan;
	reason?: string;
	buyerOrders: { quantity: number; outcome: BuyerOutcome; checkIn?: boolean }[];
}

interface Row {
	org: OrganizerKey;
	base: string;
	venue: VenueKey;
	/** days from now; negative is the past */
	day: number;
	status?: EventStatus;
	seating?: SeatingType;
	hour?: number;
	hours?: number;
	orders?: [number, number];
	fill?: number;
	saleOpensInDays?: number;
	gaQty?: [number, number];
	reason?: string;
	payout?: PayoutPlan;
	refundAll?: boolean;
	adminRefunds?: number;
	pop?: number;
	buyerOrders?: PlanEvent['buyerOrders'];
}

const { RESERVED, GENERAL } = SeatingType;
const { APPROVED, PENDING, REJECTED, CANCELLED, DRAFT } = EventStatus;

/** venues whose events are general admission unless the row says otherwise */
const GENERAL_VENUES: VenueKey[] = ['openair', 'livehouse', 'arena'];

/** days ago of the 21 finished events of the organizer with the rich history; the order of the shows below */
const HANBIT_ENDED_DAYS = [1, 8, 15, 24, 31, 40, 52, 63, 74, 86, 98, 111, 125, 140, 156, 173, 192, 212, 233, 256, 280];
const HANBIT_ENDED_SHOWS: [string, VenueKey, Partial<Row>?][] = [
	['lanterns', 'hall'],
	['derby1', 'stadium'],
	['latenight', 'club'],
	['webtoon', 'expo', { seating: GENERAL, refundAll: true, orders: [3, 5] }],
	['acoustic', 'jeju', { buyerOrders: [{ quantity: 2, outcome: 'paid', checkIn: true }] }],
	['derby2', 'fortress', { adminRefunds: 1 }],
	['rising', 'playhouse', { buyerOrders: [{ quantity: 3, outcome: 'paid', checkIn: true }] }],
	['rockfest', 'openair'],
	['gugak', 'hall', { buyerOrders: [{ quantity: 2, outcome: 'paid', checkIn: true }] }],
	['derby3', 'fortress'],
	['improv', 'club'],
	['vinyl', 'livehouse'],
	['symphony', 'hall'],
	['derby4', 'stadium'],
	['jazz', 'playhouse'],
	['founders', 'expo', { seating: GENERAL }],
	['electronic', 'arena'],
	['bilingual', 'club'],
	['choir', 'jeju'],
	['indiegame', 'arena'],
	['pop', 'hall'],
];

const CANCEL_REASON = 'The headline performers are unavailable because of illness. All tickets are refunded in full.';
const REJECT_REASON = 'The description is too short and the line-up is missing. Please add the confirmed players and the charity partner, then resubmit.';

const buildRows = (): Row[] => {
	const rows: Row[] = HANBIT_ENDED_SHOWS.map(([base, venue, extra], index) => ({
		org: 'hanbit' as OrganizerKey,
		base,
		venue,
		day: -HANBIT_ENDED_DAYS[index],
		orders: [5, 9] as [number, number],
		...extra,
	}));
	// the payout of the first two finished events: one not due yet (index 0), the others fall out of the days above;
	// index 2 stays unpaid on purpose so that the admin has more than one payout to mark as paid
	rows[2].payout = 'due';

	rows.push(
		// upcoming events of the organizer with the rich history; the first four start within a week (the home hero)
		{ org: 'hanbit', base: 'lanterns', venue: 'hall', day: 2, orders: [8, 14], pop: 0.95, buyerOrders: [{ quantity: 2, outcome: 'paid' }] },
		{ org: 'hanbit', base: 'latenight', venue: 'club', day: 3, orders: [6, 9], pop: 0.9 },
		{ org: 'hanbit', base: 'derby1', venue: 'stadium', day: 5, orders: [10, 14], pop: 0.9, buyerOrders: [{ quantity: 2, outcome: 'failed' }] },
		{ org: 'hanbit', base: 'webtoon', venue: 'expo', day: 6, seating: GENERAL, orders: [6, 10], pop: 0.8 },
		{ org: 'hanbit', base: 'rising', venue: 'club', day: 12, fill: 1 },
		{ org: 'hanbit', base: 'bilingual', venue: 'club', day: 19, fill: 0.9 },
		{ org: 'hanbit', base: 'electronic', venue: 'livehouse', day: 27, fill: 0.9, gaQty: [90, 20], buyerOrders: [{ quantity: 2, outcome: 'cancelled' }] },
		{ org: 'hanbit', base: 'symphony', venue: 'jeju', day: 41, saleOpensInDays: 9 },
		{ org: 'hanbit', base: 'cup', venue: 'fortress', day: 58, orders: [8, 12], adminRefunds: 1, buyerOrders: [{ quantity: 2, outcome: 'refunded' }] },
		// an event waiting for the review, one that was rejected, one that was cancelled after it sold, and a draft
		{ org: 'hanbit', base: 'jazz', venue: 'hall', day: 35, status: PENDING },
		{ org: 'hanbit', base: 'charity', venue: 'stadium', day: 44, status: REJECTED, reason: REJECT_REASON },
		{ org: 'hanbit', base: 'choir', venue: 'expo', day: 22, status: CANCELLED, orders: [5, 8], reason: CANCEL_REASON, buyerOrders: [{ quantity: 2, outcome: 'paid' }] },
		{ org: 'hanbit', base: 'esports', venue: 'arena', day: 70, status: DRAFT },

		// the other organizers
		{ org: 'mirae', base: 'jazz', venue: 'playhouse', day: -20, orders: [5, 8] },
		{ org: 'mirae', base: 'pop', venue: 'hall', day: 4, orders: [8, 12], pop: 0.85 },
		{ org: 'mirae', base: 'acoustic', venue: 'jeju', day: 16, orders: [5, 9] },
		{ org: 'mirae', base: 'lanterns', venue: 'expo', day: 50, status: PENDING },

		{ org: 'harbor', base: 'derby2', venue: 'fortress', day: -12, orders: [6, 10] },
		{ org: 'harbor', base: 'derby3', venue: 'stadium', day: -45, orders: [6, 10] },
		{ org: 'harbor', base: 'derby4', venue: 'fortress', day: 1, orders: [10, 14], pop: 0.95, buyerOrders: [{ quantity: 4, outcome: 'paid' }] },
		{ org: 'harbor', base: 'cup', venue: 'stadium', day: 9, orders: [10, 15] },

		{ org: 'cellar', base: 'rising', venue: 'club', day: -6, orders: [5, 8] },
		{ org: 'cellar', base: 'improv', venue: 'playhouse', day: 3, orders: [8, 12], pop: 0.8, buyerOrders: [{ quantity: 2, outcome: 'paid' }] },
		{ org: 'cellar', base: 'latenight', venue: 'club', day: 14, fill: 1 },
		{ org: 'cellar', base: 'bilingual', venue: 'club', day: 25, saleOpensInDays: 6 },

		{ org: 'camellia', base: 'vinyl', venue: 'livehouse', day: -33, orders: [4, 7] },
		{ org: 'camellia', base: 'indiegame', venue: 'arena', day: 6, orders: [6, 10], pop: 0.75 },
		{ org: 'camellia', base: 'webtoon', venue: 'expo', day: 60, status: PENDING, seating: GENERAL },

		{ org: 'nomad', base: 'gugak', venue: 'hall', day: -60, orders: [5, 8] },
		{ org: 'nomad', base: 'founders', venue: 'expo', day: 10, seating: GENERAL, fill: 1, gaQty: [40, 10] },
		{ org: 'nomad', base: 'rockfest', venue: 'openair', day: 37, orders: [8, 12] },

		{ org: 'neon', base: 'electronic', venue: 'livehouse', day: -4, orders: [4, 7] },
		{ org: 'neon', base: 'pop', venue: 'livehouse', day: 18, fill: 0.9, gaQty: [90, 20] },

		{ org: 'jeju', base: 'lanterns', venue: 'jeju', day: -80, orders: [5, 8] },
		{ org: 'jeju', base: 'acoustic', venue: 'jeju', day: 46, orders: [6, 10] },
	);
	return rows;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** the API creates events in the future only; a past event is created this many days late and moved back (see PlanEvent.shiftDays) */
export const PAST_EVENT_SHIFT_DAYS = 3650;

/** start hour (UTC) and length in hours of a show of this category; Seoul is UTC+9 */
const SHOW_TIMES: Record<string, { hour: number; hours: number }> = {
	[EventCategory.CONCERT]: { hour: 10, hours: 3 },
	[EventCategory.FOOTBALL]: { hour: 6, hours: 2 },
	[EventCategory.COMEDY]: { hour: 11, hours: 2 },
	[EventCategory.OTHER]: { hour: 5, hours: 4 },
};

const roundPrice = (value: number): number => Math.round(value / 1000) * 1000;

const buildTicketTypes = (row: Row, base: DemoBase, seating: SeatingType): PlanTicketType[] => {
	const standard = CATEGORY_PRICES[base.category];
	if (seating === GENERAL) {
		const [general, premium] = row.gaQty ?? GA_QUANTITIES[row.venue];
		return [
			{ name: 'General Admission', price: roundPrice(standard * 1.2), maxPerOrder: 6, quantity: general },
			{ name: 'VIP Zone', price: roundPrice(standard * 2.6), maxPerOrder: 4, quantity: premium },
		];
	}
	const venue = DEMO_VENUES.find((item) => item.key === row.venue);
	const tiers = [...new Set(getSeatedSections({ sections: venue.sections }).map((section) => section.tierKey))];
	return tiers.map((tierKey) => ({
		name: TIER_NAMES[tierKey] ?? tierKey,
		price: roundPrice(standard * (TIER_FACTORS[tierKey] ?? 1)),
		maxPerOrder: base.category === EventCategory.COMEDY ? 6 : 8,
		tierKey,
	}));
};

const getPayoutPlan = (row: Row, status: EventStatus): PayoutPlan => {
	if (status !== EventStatus.ENDED) return 'none';
	if (row.payout) return row.payout;
	if (row.refundAll) return 'nothing';
	if (row.day >= -2) return 'notYetDue';
	return row.day >= -13 ? 'due' : 'paid';
};

export interface DemoPlan {
	events: PlanEvent[];
	/** the moment every date of the plan is relative to */
	now: Date;
}

/**
 * The events, sorted by their final start date: the seeder walks them in this order, so an organizer's finished events are
 * counted (and the commission tier moves from 10 to 7 to 5 percent) before the later ones are sold.
 */
export const buildDemoPlan = (now: Date = new Date()): DemoPlan => {
	const rng = createRng(20260101);
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const rows = buildRows().sort((a, b) => a.day - b.day);

	// a show that appears more than once gets "Vol. n" in chronological order
	const uses = new Map<string, number>();
	for (const row of rows) uses.set(row.base, (uses.get(row.base) ?? 0) + 1);
	const seen = new Map<string, number>();

	const events = rows.map((row, index): PlanEvent => {
		const base = DEMO_BASES.find((item) => item.id === row.base);
		if (!base) throw new Error(`Unknown demo show ${row.base}`);
		const edition = (seen.get(row.base) ?? 0) + 1;
		seen.set(row.base, edition);
		const suffix = uses.get(row.base) > 1 ? ` Vol. ${edition}` : '';

		const status = row.status ?? (row.day < 0 ? EventStatus.ENDED : APPROVED);
		const seating = row.seating ?? (GENERAL_VENUES.includes(row.venue) ? GENERAL : RESERVED);
		const times = SHOW_TIMES[base.category];
		const startAt = new Date(today + row.day * DAY_MS + (row.hour ?? times.hour) * HOUR_MS);
		const endAt = new Date(startAt.getTime() + (row.hours ?? times.hours) * HOUR_MS);
		const past = row.day < 0;

		const createdAt = past
			? new Date(startAt.getTime() - randomInt(rng, 40, 70) * DAY_MS)
			: new Date(now.getTime() - (status === PENDING ? randomInt(rng, 1, 6) : status === DRAFT ? 2 : randomInt(rng, 12, 45)) * DAY_MS);
		const approvedAt = new Date(createdAt.getTime() + randomInt(rng, 1, 2) * DAY_MS + randomInt(rng, 1, 8) * HOUR_MS);
		const decidedAt =
			status === CANCELLED ? new Date(now.getTime() - 2 * DAY_MS) : status === REJECTED ? new Date(createdAt.getTime() + 2 * DAY_MS) : undefined;

		return {
			key: `${row.org}-${String(index + 1).padStart(2, '0')}-${row.base}`,
			organizer: row.org,
			venue: row.venue,
			baseId: row.base,
			category: base.category,
			seating,
			status,
			startAt,
			endAt,
			shiftDays: past ? PAST_EVENT_SHIFT_DAYS : 0,
			saleStartAt: row.saleOpensInDays ? new Date(now.getTime() + row.saleOpensInDays * DAY_MS) : undefined,
			createdAt,
			approvedAt,
			decidedAt,
			title: `${base.title.en}${suffix}`,
			desc: base.desc.en,
			translations: DEMO_LOCALES.map((locale) => ({ locale, title: `${base.title[locale]}${suffix}`, description: base.desc[locale] })),
			images: [demoImage(`event-${row.org}-${row.base}-${edition}`), demoImage(`event-${row.org}-${row.base}-${edition}-b`)],
			ticketTypes: buildTicketTypes(row, base, seating),
			orders: row.orders ?? [4, 12],
			fill: row.fill,
			noSales: !!row.saleOpensInDays || status === PENDING || status === REJECTED || status === DRAFT,
			refundShare: row.refundAll ? 1 : 0.1,
			refundAll: !!row.refundAll,
			adminRefunds: row.adminRefunds ?? 0,
			checkInShare: 0.88,
			popularity: row.pop ?? 0.15 + rng() * 0.75,
			hero: row.day >= 1 && row.day <= 6 && status === APPROVED && !row.saleOpensInDays,
			payout: getPayoutPlan(row, status),
			reason: row.reason,
			buyerOrders: row.buyerOrders ?? [],
		};
	});
	return { events, now };
};

/** ORDERS: which seats or tickets one order takes. Pure, so the shapes (runs of neighbouring seats, a full sell-out) are tested. */

export interface PlanSeat {
	id: string;
	sectionKey: string;
	row: number;
	number: number;
}

export interface StockLimit {
	/** this many orders... */
	orders?: number;
	/** ...or this many tickets in total (the last order is cut to fit) */
	tickets?: number;
}

const RUN_SIZES = [1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6];

/**
 * Groups of neighbouring seats (same section and row, consecutive numbers), one group per order, in a random order.
 * A group never has more than `maxPerOrder` seats, and every seat belongs to exactly one group, so taking them all sells every seat.
 */
export const buildSeatRuns = (seats: PlanSeat[], maxPerOrder: number, rng: Rng): string[][] => {
	const rows = new Map<string, PlanSeat[]>();
	for (const seat of seats) {
		const key = `${seat.sectionKey}|${seat.row}`;
		rows.set(key, [...(rows.get(key) ?? []), seat]);
	}
	const runs: string[][] = [];
	for (const key of [...rows.keys()].sort()) {
		const rowSeats = rows.get(key).sort((a, b) => a.number - b.number);
		let current: PlanSeat[] = [];
		let size = Math.min(maxPerOrder, pickOne(rng, RUN_SIZES));
		for (const seat of rowSeats) {
			const adjacent = !current.length || seat.number === current[current.length - 1].number + 1;
			if (!adjacent || current.length >= size) {
				runs.push(current.map((item) => item.id));
				current = [];
				size = Math.min(maxPerOrder, pickOne(rng, RUN_SIZES));
			}
			current.push(seat);
		}
		if (current.length) runs.push(current.map((item) => item.id));
	}
	return shuffled(rng, runs);
};

/** takes groups from the front: that many orders, or until that many seats are covered (the last group is shortened) */
export const takeSeatRuns = (runs: string[][], limit: StockLimit): string[][] => {
	if (limit.orders !== undefined) return runs.slice(0, limit.orders);
	const chosen: string[][] = [];
	let total = 0;
	for (const run of runs) {
		if (total >= (limit.tickets ?? 0)) break;
		const take = run.slice(0, (limit.tickets ?? 0) - total);
		chosen.push(take);
		total += take.length;
	}
	return chosen;
};

/** removes and returns a group of exactly `quantity` seats (a longer group is cut); the longest group is cut short when none is long enough */
export const takeRunOfSize = (runs: string[][], quantity: number): string[] => {
	let index = runs.findIndex((run) => run.length >= quantity);
	if (index < 0) index = runs.reduce((best, run, i) => (run.length > runs[best].length ? i : best), 0);
	const [run] = runs.splice(index, 1);
	return run.slice(0, quantity);
};

export interface PlanStock {
	id: string;
	remaining: number;
	maxPerOrder: number;
}

export interface PlanQuantityOrder {
	ticketTypeId: string;
	quantity: number;
}

/** quantity orders for general admission events: one ticket type per order, 1 to 5 tickets, until the limit or the stock is used up */
export const planQuantityOrders = (stock: PlanStock[], limit: StockLimit, rng: Rng): PlanQuantityOrder[] => {
	const left = stock.map((item) => ({ ...item }));
	const orders: PlanQuantityOrder[] = [];
	let tickets = 0;
	for (;;) {
		if (limit.orders !== undefined && orders.length >= limit.orders) break;
		if (limit.tickets !== undefined && tickets >= limit.tickets) break;
		const open = left.filter((item) => item.remaining > 0);
		if (!open.length) break;

		const total = open.reduce((sum, item) => sum + item.remaining, 0);
		let pick = rng() * total;
		let type = open[open.length - 1];
		for (const item of open) {
			pick -= item.remaining;
			if (pick < 0) {
				type = item;
				break;
			}
		}
		const wanted = limit.tickets !== undefined ? Math.min(randomInt(rng, 1, 5), limit.tickets - tickets) : randomInt(rng, 1, 4);
		const quantity = Math.max(1, Math.min(wanted, type.maxPerOrder, type.remaining));
		type.remaining -= quantity;
		tickets += quantity;
		orders.push({ ticketTypeId: type.id, quantity });
	}
	return orders;
};

/** the buyer index of each order: random, never the same buyer twice in a row; index 0 is the demo buyer and is only used on purpose */
export const pickBuyers = (count: number, buyerCount: number, rng: Rng): number[] => {
	const picks: number[] = [];
	for (let i = 0; i < count; i++) {
		let next = randomInt(rng, 1, buyerCount - 1);
		if (picks.length && next === picks[picks.length - 1]) next = (next % (buyerCount - 1)) + 1;
		picks.push(next);
	}
	return picks;
};
