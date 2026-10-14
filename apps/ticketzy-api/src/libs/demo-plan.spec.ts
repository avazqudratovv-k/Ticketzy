import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { EventCategory, EventStatus, SeatingType } from './enums/event.enum';
import {
	CATEGORY_PRICE_RANGE,
	DEMO_BASES,
	DEMO_BUYERS,
	DEMO_CLUBS,
	DEMO_IMAGE_COUNTS,
	DEMO_IMAGE_DIR,
	DEMO_LOCALES,
	DEMO_ORGANIZERS,
	DEMO_VENUES,
	FIXTURE_DISCLAIMER,
	getFixtureVenue,
} from './demo-data';
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
	it('has 50 buyers with Korean names and 10 organizers with Korean company names', () => {
		expect(DEMO_BUYERS).toHaveLength(50);
		expect(new Set(DEMO_BUYERS.map((buyer) => buyer.email)).size).toBe(50);
		expect(new Set(DEMO_BUYERS.map((buyer) => buyer.nick)).size).toBe(50);
		for (const account of [...DEMO_BUYERS, ...DEMO_ORGANIZERS]) expect(account.fullName).toMatch(/^[가-힣()\s]+$/);
		expect(DEMO_ORGANIZERS.every((organizer) => organizer.fullName.endsWith('(주)'))).toBe(true);
		expect(DEMO_BUYERS[0].email).toBe('buyer@ticketzy.demo');
		expect(DEMO_ORGANIZERS.map((organizer) => organizer.key)).toEqual(expect.arrayContaining(['hanbit', 'pending', 'rejected']));
		expect(DEMO_ORGANIZERS.filter((organizer) => organizer.outcome === 'verify')).toHaveLength(8);
		for (const account of [...DEMO_BUYERS, ...DEMO_ORGANIZERS]) expect(account.email).toMatch(/@ticketzy\.demo$/);
	});

	it('uses clearly fake phone numbers and district-only addresses without street numbers', () => {
		const accounts = [...DEMO_BUYERS, ...DEMO_ORGANIZERS];
		for (const account of accounts) {
			expect(account.phone).toMatch(/^010-0000-\d{4}$/);
			expect(account.address).not.toMatch(/\d/);
			expect(account.address).toMatch(/-(gu|si|dong)\b|, (Seoul|Busan|Incheon|Daegu|Daejeon|Gwangju|Jeonju|Ulsan|Jeju)/);
		}
		expect(new Set(accounts.map((account) => account.phone)).size).toBe(accounts.length);
		expect(DEMO_BUYERS.every((buyer) => buyer.address.endsWith(', Seoul'))).toBe(true);
	});

	it('keeps the four named demo accounts and gives the others romanized e-mail addresses', () => {
		expect(DEMO_BUYERS[0].email).toBe('buyer@ticketzy.demo');
		expect(DEMO_ORGANIZERS[0].email).toBe('organizer@ticketzy.demo');
		expect(DEMO_ORGANIZERS.find((organizer) => organizer.key === 'pending').email).toBe('pending@ticketzy.demo');
		expect(DEMO_ORGANIZERS.find((organizer) => organizer.key === 'rejected').email).toBe('rejected@ticketzy.demo');
		for (const account of [...DEMO_BUYERS, ...DEMO_ORGANIZERS]) {
			expect(account.email).toMatch(/^[a-z]+(\.[a-z]+)?@ticketzy\.demo$/);
			expect(account.email).toBe(account.email.toLowerCase());
		}
		// a buyer's e-mail is family.given and the nick is given_family
		for (const buyer of DEMO_BUYERS.slice(1)) {
			const [given, family] = buyer.nick.split('_');
			expect(buyer.email).toBe(`${family}.${given}@ticketzy.demo`);
		}
		expect(DEMO_BUYERS[1].email).toBe('kim.seoyeon@ticketzy.demo');
		expect(DEMO_ORGANIZERS.map((organizer) => organizer.email)).not.toEqual(expect.arrayContaining(['mirae.stage@ticketzy.demo', 'emily.carter@ticketzy.demo']));
		const all = [...DEMO_BUYERS, ...DEMO_ORGANIZERS].map((account) => account.email);
		expect(new Set(all).size).toBe(all.length);
	});

	it('has 10 venues in Korean cities with valid layouts, seated and standing', () => {
		expect(DEMO_VENUES).toHaveLength(10);
		expect(DEMO_VENUES.every((venue) => /[A-Za-z]/.test(venue.name) && !/\d/.test(venue.address))).toBe(true);
		for (const venue of DEMO_VENUES) expect(getVenueLayoutError({ sections: venue.sections })).toBeNull();
		expect(new Set(DEMO_VENUES.map((venue) => venue.city)).size).toBeGreaterThanOrEqual(8);
		for (const city of ['Seoul', 'Busan', 'Incheon', 'Goyang', 'Daegu', 'Daejeon', 'Gwangju', 'Jeonju']) expect(DEMO_VENUES.some((venue) => venue.city === city)).toBe(true);
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

describe('demo football', () => {
	const footballEvents = events.filter((event) => event.category === EventCategory.FOOTBALL);
	const clubKeys = DEMO_CLUBS.map((club) => club.key);

	it('plays invented fixtures between two different known clubs, one home and one away', () => {
		expect(footballEvents.length).toBeGreaterThanOrEqual(8);
		for (const event of footballEvents) {
			expect(event.fixture).toBeDefined();
			const { home, away } = event.fixture;
			expect(clubKeys).toContain(home);
			expect(clubKeys).toContain(away);
			expect(home).not.toBe(away);
		}
		// a club never plays itself in any title either, and every fixture of the data is used once
		const ids = footballEvents.map((event) => event.baseId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const base of DEMO_BASES.filter((item) => item.category === EventCategory.FOOTBALL)) {
			expect(base.fixture.home).not.toBe(base.fixture.away);
			for (const locale of DEMO_LOCALES) {
				const home = DEMO_CLUBS.find((club) => club.key === base.fixture.home).name[locale];
				const away = DEMO_CLUBS.find((club) => club.key === base.fixture.away).name[locale];
				expect(home).not.toBe(away);
				expect(base.title[locale]).toContain(home);
				expect(base.title[locale]).toContain(away);
			}
		}
	});

	it('plays at the home ground of the home club, in the right city', () => {
		const cities: Record<string, string> = { seoul: 'Seoul', incheon: 'Incheon', gwangju: 'Gwangju' };
		for (const event of footballEvents) {
			expect(event.venue).toBe(getFixtureVenue(event.fixture));
			const venue = DEMO_VENUES.find((item) => item.key === event.venue);
			expect(venue.city).toBe(cities[event.fixture.home]);
			expect(venue.type).toBe('STADIUM');
			expect(event.seating).toBe(SeatingType.RESERVED);
		}
		expect(new Set(footballEvents.map((event) => event.venue)).size).toBeGreaterThanOrEqual(3);
	});

	it('only uses clubs of the 2026 K League 1, never Suwon or Daegu', () => {
		expect([...clubKeys].sort()).toEqual(['daejeon', 'gwangju', 'incheon', 'jeju', 'jeonbuk', 'pohang', 'seoul', 'ulsan']);
		for (const club of DEMO_CLUBS) for (const locale of DEMO_LOCALES) expect(club.name[locale]).not.toMatch(/Suwon|Daegu|수원|대구/);
	});

	it('says that it is a demo listing in every language and names no player or logo', () => {
		for (const event of footballEvents) {
			for (const locale of DEMO_LOCALES) {
				const description = event.translations.find((item) => item.locale === locale).description;
				expect(description).toContain(FIXTURE_DISCLAIMER[locale]);
			}
			expect(event.desc).toContain('Demo listing, not an official fixture');
		}
	});
});

describe('demo images', () => {
	const dir = join(__dirname, '../../../../', DEMO_IMAGE_DIR);
	const prefixes: Record<string, string> = { CONCERT: 'concert', FOOTBALL: 'football', COMEDY: 'comedy', OTHER: 'other' };

	it('has every committed photo, small, and a credit line for each', () => {
		const files = readdirSync(dir).filter((file) => file.endsWith('.jpg'));
		const expected = Object.entries(DEMO_IMAGE_COUNTS).flatMap(([pool, count]) => Array.from({ length: count }, (_, i) => `${pool}-${String(i + 1).padStart(2, '0')}.jpg`));
		expect(files.sort()).toEqual(expected.sort());
		const credits = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
		for (const file of files) {
			expect(statSync(join(dir, file)).size).toBeLessThanOrEqual(260 * 1024);
			expect(credits).toContain(`| ${file} |`);
		}
	});

	it('gives every event the photos of its own category, and none of another or an external one', () => {
		for (const event of events) {
			expect(event.images).toHaveLength(2);
			expect(new Set(event.images).size).toBe(2);
			for (const image of event.images) {
				expect(image).toMatch(new RegExp(`^${DEMO_IMAGE_DIR}/${prefixes[event.category]}-\\d{2}\\.jpg$`));
				expect(existsSync(join(dir, '..', image))).toBe(true);
			}
		}
	});

	it('gives every venue two photos of the venue pool', () => {
		for (const venue of DEMO_VENUES) {
			expect(venue.images).toHaveLength(2);
			for (const image of venue.images) {
				expect(image).toMatch(new RegExp(`^${DEMO_IMAGE_DIR}/venue-\\d{2}\\.jpg$`));
				expect(existsSync(join(dir, '..', image))).toBe(true);
			}
		}
	});

	it('is deterministic: the same plan gives the same pictures', () => {
		expect(buildDemoPlan(now).events.map((event) => event.images)).toEqual(events.map((event) => event.images));
	});

	it('contains no Picsum or other external image address in the data', () => {
		const text = JSON.stringify({ events, DEMO_VENUES, DEMO_BUYERS, DEMO_ORGANIZERS });
		expect(text).not.toMatch(/picsum|https?:\/\//i);
	});
});

describe('demo prices', () => {
	it('keeps every ticket price of a category in its Korean won range', () => {
		for (const event of events) {
			const [min, max] = CATEGORY_PRICE_RANGE[event.category];
			for (const type of event.ticketTypes) {
				expect(type.price).toBeGreaterThanOrEqual(min);
				expect(type.price).toBeLessThanOrEqual(max);
			}
		}
		expect(CATEGORY_PRICE_RANGE).toEqual({ CONCERT: [55000, 165000], FOOTBALL: [15000, 60000], COMEDY: [25000, 55000], OTHER: [20000, 80000] });
	});

	it('uses the whole range for football and concerts, from the cheapest stand to the premium one', () => {
		const prices = (category: EventCategory) => events.filter((event) => event.category === category).flatMap((event) => event.ticketTypes.map((type) => type.price));
		expect(Math.min(...prices(EventCategory.FOOTBALL))).toBe(15000);
		expect(Math.max(...prices(EventCategory.FOOTBALL))).toBeLessThanOrEqual(60000);
		expect(Math.min(...prices(EventCategory.CONCERT))).toBe(55000);
		expect(Math.max(...prices(EventCategory.CONCERT))).toBe(165000);
	});
});

describe('demo texts', () => {
	it('uses invented artists, bands and comedians for the shows that are not football', () => {
		const names = DEMO_BASES.filter((base) => base.category !== EventCategory.FOOTBALL).map((base) => base.title.en);
		expect(names).toEqual(expect.arrayContaining(['Dalbit Parade Live', 'Haneul Seven Pop Night', 'Late Night Stand-Up with Oh Jae-mi']));
		expect(DEMO_BASES.filter((base) => base.category !== EventCategory.FOOTBALL).some((base) => base.fixture)).toBe(false);
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
