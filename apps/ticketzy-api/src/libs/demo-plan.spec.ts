import { EventCategory, EventStatus, SeatingType } from './enums/event.enum';
import { DEMO_BASES, DEMO_BUYERS, DEMO_LOCALES, DEMO_ORGANIZERS, DEMO_VENUES } from './demo-data';
import {
	PAST_EVENT_SHIFT_DAYS,
	buildDemoPlan,
	buildSeatRuns,
	createRng,
	pickBuyers,
	planQuantityOrders,
	takeRunOfSize,
	takeSeatRuns,
} from './demo-plan';
import { getMissingTierKeys, getVenueLayoutError } from './venue-layout';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-13T08:30:00Z');
const plan = buildDemoPlan(now);
const { events } = plan;
const count = (status: EventStatus) => events.filter((event) => event.status === status).length;

describe('demo data', () => {
	it('has 50 buyers with Korean, English, Russian and Uzbek names and 10 organizers', () => {
		expect(DEMO_BUYERS).toHaveLength(50);
		expect(new Set(DEMO_BUYERS.map((buyer) => buyer.email)).size).toBe(50);
		expect(new Set(DEMO_BUYERS.map((buyer) => buyer.nick)).size).toBe(50);
		expect(DEMO_BUYERS.some((buyer) => /[가-힣]/.test(buyer.fullName))).toBe(true);
		expect(DEMO_BUYERS.some((buyer) => /[а-яё]/i.test(buyer.fullName))).toBe(true);
		expect(DEMO_BUYERS[0].email).toBe('buyer@ticketzy.demo');
		expect(DEMO_ORGANIZERS.map((organizer) => organizer.key)).toEqual(expect.arrayContaining(['hanbit', 'pending', 'rejected']));
		expect(DEMO_ORGANIZERS.filter((organizer) => organizer.outcome === 'verify')).toHaveLength(8);
		for (const account of [...DEMO_BUYERS, ...DEMO_ORGANIZERS]) expect(account.email).toMatch(/@ticketzy\.demo$/);
	});

	it('has 10 venues in Korean cities with valid layouts, seated and standing', () => {
		expect(DEMO_VENUES).toHaveLength(10);
		for (const venue of DEMO_VENUES) expect(getVenueLayoutError({ sections: venue.sections })).toBeNull();
		expect(new Set(DEMO_VENUES.map((venue) => venue.city)).size).toBeGreaterThanOrEqual(9);
		expect(DEMO_VENUES.some((venue) => venue.sections.some((section) => section.kind === 'STANDING'))).toBe(true);
		expect(DEMO_VENUES.some((venue) => venue.sections.every((section) => section.kind === 'SEATED'))).toBe(true);
	});

	it('translates every show into en, ko, ru and uz', () => {
		for (const base of DEMO_BASES) {
			for (const locale of DEMO_LOCALES) {
				expect(base.title[locale].length).toBeGreaterThan(2);
				expect(base.desc[locale].length).toBeGreaterThan(10);
			}
		}
	});
});

describe('demo plan', () => {
	it('has 40 to 60 events across the four categories and every status', () => {
		expect(events.length).toBeGreaterThanOrEqual(40);
		expect(events.length).toBeLessThanOrEqual(60);
		for (const category of [EventCategory.CONCERT, EventCategory.FOOTBALL, EventCategory.COMEDY, EventCategory.OTHER]) {
			expect(events.some((event) => event.category === category)).toBe(true);
		}
		for (const status of Object.values(EventStatus)) expect(count(status)).toBeGreaterThan(0);
		expect(count(EventStatus.REJECTED)).toBe(1);
		expect(count(EventStatus.CANCELLED)).toBe(1);
		expect(count(EventStatus.PENDING)).toBeGreaterThanOrEqual(3);
		for (const event of events.filter((item) => item.status === EventStatus.REJECTED || item.status === EventStatus.CANCELLED)) expect(event.reason).toBeTruthy();
	});

	it('has hero candidates: approved events with images that start within 7 days', () => {
		const hero = events.filter((event) => event.hero);
		expect(hero.length).toBeGreaterThanOrEqual(5);
		for (const event of hero) {
			expect(event.status).toBe(EventStatus.APPROVED);
			expect(event.images.length).toBeGreaterThan(0);
			expect(event.images.every((url) => url.startsWith('https://picsum.photos/seed/'))).toBe(true);
			expect(event.startAt.getTime()).toBeGreaterThan(now.getTime());
			expect(event.startAt.getTime()).toBeLessThan(now.getTime() + 7 * DAY);
		}
	});

	it('has sold out, nearly sold out and not yet open events', () => {
		expect(events.filter((event) => event.fill === 1).length).toBeGreaterThanOrEqual(2);
		expect(events.filter((event) => event.fill === 0.9).length).toBeGreaterThanOrEqual(2);
		expect(events.filter((event) => event.saleStartAt && event.saleStartAt > now).length).toBeGreaterThanOrEqual(2);
	});

	it('keeps dates relative to now: ended events lie in the past, the others ahead, and a past event is created ahead of its date', () => {
		for (const event of events) {
			if (event.status === EventStatus.ENDED) {
				expect(event.endAt.getTime()).toBeLessThan(now.getTime());
				expect(event.shiftDays).toBe(PAST_EVENT_SHIFT_DAYS);
			} else {
				expect(event.startAt.getTime()).toBeGreaterThan(now.getTime());
				expect(event.shiftDays).toBe(0);
			}
			expect(event.createdAt.getTime()).toBeLessThan(now.getTime());
		}
		const later = buildDemoPlan(new Date(now.getTime() + 30 * DAY));
		expect(later.events[10].startAt.getTime() - events[10].startAt.getTime()).toBe(30 * DAY);
	});

	it('never books a venue twice at the same time, at the final and at the creation dates', () => {
		for (const offset of [0, PAST_EVENT_SHIFT_DAYS * DAY]) {
			const slots = events
				.filter((event) => event.shiftDays === offset || (offset === 0 && event.shiftDays === 0))
				.map((event) => ({ venue: event.venue, start: event.startAt.getTime() + event.shiftDays * DAY, end: event.endAt.getTime() + event.shiftDays * DAY }));
			for (const [index, a] of slots.entries()) {
				for (const b of slots.slice(index + 1)) {
					if (a.venue === b.venue) expect(a.end <= b.start || b.end <= a.start).toBe(true);
				}
			}
		}
		// ended events and upcoming ones, compared at their creation dates
		const created = events.map((event) => ({ venue: event.venue, start: event.startAt.getTime() + event.shiftDays * DAY, end: event.endAt.getTime() + event.shiftDays * DAY }));
		for (const [index, a] of created.entries()) {
			for (const b of created.slice(index + 1)) if (a.venue === b.venue) expect(a.end <= b.start || b.end <= a.start).toBe(true);
		}
	});

	it('gives RESERVED events a ticket type for every seated tier and GENERAL events a quantity', () => {
		for (const event of events) {
			const venue = DEMO_VENUES.find((item) => item.key === event.venue);
			expect(event.ticketTypes.length).toBeGreaterThan(0);
			for (const type of event.ticketTypes) {
				expect(type.price).toBeGreaterThan(0);
				expect(type.price % 1000).toBe(0);
			}
			if (event.seating === SeatingType.RESERVED) {
				expect(getMissingTierKeys({ sections: venue.sections }, event.ticketTypes.map((type) => type.tierKey))).toEqual([]);
				for (const type of event.ticketTypes) expect(type.quantity).toBeUndefined();
			} else {
				for (const type of event.ticketTypes) expect(type.quantity).toBeGreaterThan(0);
			}
		}
	});

	it('gives the organizer with the rich history 21 finished events, enough for the 10, 7 and 5 percent tiers', () => {
		const finished = events.filter((event) => event.organizer === 'hanbit' && event.status === EventStatus.ENDED);
		expect(finished).toHaveLength(21);
		expect(events.filter((event) => event.organizer === 'hanbit' && event.status === EventStatus.ENDED && !event.noSales && !event.refundAll).length).toBeGreaterThan(15);
		// events are sorted by date, so an organizer's earlier events are sold (and ended) before the later ones
		const dates = events.map((event) => event.startAt.getTime());
		expect([...dates].sort((a, b) => a - b)).toEqual(dates);
	});

	it('plans every payout status for the rich organizer, and no payout for an event that is not over', () => {
		const rich = events.filter((event) => event.organizer === 'hanbit');
		for (const payout of ['paid', 'due', 'notYetDue', 'nothing']) expect(rich.some((event) => event.payout === payout)).toBe(true);
		for (const event of events.filter((item) => item.status !== EventStatus.ENDED)) expect(event.payout).toBe('none');
		for (const event of events.filter((item) => item.payout === 'paid')) expect(event.endAt.getTime()).toBeLessThan(now.getTime() - 13 * DAY);
		expect(events.filter((item) => item.payout === 'notYetDue').every((item) => item.endAt.getTime() > now.getTime() - 3 * DAY)).toBe(true);
	});

	it('gives every shown event a unique title per organizer and venue', () => {
		const keys = events.map((event) => `${event.organizer}|${event.venue}|${event.title}|${event.startAt.toISOString()}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('is deterministic for the same moment', () => {
		expect(buildDemoPlan(now)).toEqual(plan);
	});
});

describe('order planners', () => {
	const seats = ['A', 'B'].flatMap((section) =>
		[1, 2, 3].flatMap((row) => Array.from({ length: 12 }, (_, i) => ({ id: `${section}${row}-${i + 1}`, sectionKey: section, row, number: i + 1 }))),
	);

	it('cuts rows into runs of neighbouring seats that cover every seat once', () => {
		const runs = buildSeatRuns(seats, 6, createRng(1));
		expect(runs.flat().sort()).toEqual(seats.map((seat) => seat.id).sort());
		for (const run of runs) {
			expect(run.length).toBeGreaterThanOrEqual(1);
			expect(run.length).toBeLessThanOrEqual(6);
			const numbers = run.map((id) => Number(id.split('-')[1]));
			expect(new Set(run.map((id) => id.split('-')[0])).size).toBe(1);
			numbers.forEach((value, i) => expect(value).toBe(numbers[0] + i));
		}
	});

	it('sells every seat for a sell out, and exactly the target otherwise', () => {
		const runs = buildSeatRuns(seats, 6, createRng(2));
		expect(takeSeatRuns(runs, { tickets: seats.length }).flat()).toHaveLength(seats.length);
		const ninety = takeSeatRuns(runs, { tickets: Math.ceil(seats.length * 0.9) }).flat();
		expect(ninety).toHaveLength(Math.ceil(seats.length * 0.9));
		expect(takeSeatRuns(runs, { orders: 5 })).toHaveLength(5);
	});

	it('takes a run of the wanted size out of the list', () => {
		const runs = buildSeatRuns(seats, 6, createRng(3));
		const before = runs.length;
		const run = takeRunOfSize(runs, 2);
		expect(run).toHaveLength(2);
		expect(runs).toHaveLength(before - 1);
	});

	it('plans quantity orders up to the stock and never past it', () => {
		const stock = [
			{ id: 'general', remaining: 40, maxPerOrder: 6 },
			{ id: 'vip', remaining: 10, maxPerOrder: 4 },
		];
		const all = planQuantityOrders(stock, { tickets: 50 }, createRng(4));
		expect(all.reduce((sum, order) => sum + order.quantity, 0)).toBe(50);
		for (const order of all) expect(order.quantity).toBeLessThanOrEqual(order.ticketTypeId === 'vip' ? 4 : 6);
		expect(planQuantityOrders(stock, { orders: 3 }, createRng(5))).toHaveLength(3);
		expect(planQuantityOrders(stock, { tickets: 999 }, createRng(6)).reduce((sum, order) => sum + order.quantity, 0)).toBe(50);
	});

	it('picks buyers other than the demo buyer, never the same one twice in a row', () => {
		const picks = pickBuyers(200, 50, createRng(7));
		expect(picks.every((index) => index >= 1 && index <= 49)).toBe(true);
		picks.slice(1).forEach((index, i) => expect(index).not.toBe(picks[i]));
	});
});
