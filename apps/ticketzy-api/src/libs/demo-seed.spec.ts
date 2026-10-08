import { ObjectId } from 'bson';
import { FakeModel } from '../../test/fake-model';
import {
	assertDemoSeedAllowed,
	DEFAULT_DEMO_PASSWORD,
	DEMO_ACCOUNTS,
	DEMO_EVENTS,
	DEMO_VENUES,
	DemoCleanupModels,
	DemoSummary,
	formatDemoSummary,
	getDemoPassword,
	pickSeatBlocks,
	removeDemoData,
	runDemoSeed,
} from './demo-seed';
import { EventCategory, EventStatus, SeatingType, SectionKind } from './enums/event.enum';
import { MemberType } from './enums/member.enum';
import { getMissingTierKeys, getVenueLayoutError } from './venue-layout';

describe('demo seed: production guard', () => {
	it('refuses to run in production without ALLOW_DEMO_SEED', () => {
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production' })).toThrow(/ALLOW_DEMO_SEED=true/);
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'false' })).toThrow();
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: '1' })).toThrow();
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: '' })).toThrow();
	});

	it('runs in production only with ALLOW_DEMO_SEED=true, and anywhere else without it', () => {
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' })).not.toThrow();
		expect(() => assertDemoSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
		expect(() => assertDemoSeedAllowed({})).not.toThrow();
	});

	it('does not clean up or create anything when the guard refuses', async () => {
		const cleanup = jest.fn();
		const create = jest.fn();
		await expect(runDemoSeed({ env: { NODE_ENV: 'production' }, cleanup, create })).rejects.toThrow(/Refusing/);
		expect(cleanup).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});

describe('demo seed: password', () => {
	it('uses the documented default and DEMO_PASSWORD when set', () => {
		expect(getDemoPassword({})).toBe(DEFAULT_DEMO_PASSWORD);
		expect(DEFAULT_DEMO_PASSWORD).toBe('Demo1234!');
		expect(getDemoPassword({ DEMO_PASSWORD: '  Another-Pass1  ' })).toBe('Another-Pass1');
		expect(getDemoPassword({ DEMO_PASSWORD: '   ' })).toBe(DEFAULT_DEMO_PASSWORD);
	});

	it('rejects a password the API itself would not accept', () => {
		expect(() => getDemoPassword({ DEMO_PASSWORD: 'short' })).toThrow(/DEMO_PASSWORD/);
	});
});

describe('demo seed: data definitions', () => {
	it('has the requested accounts, all on the demo domain', () => {
		const byKey = Object.fromEntries(DEMO_ACCOUNTS.map((account) => [account.key, account]));
		expect(byKey.buyer.email).toBe('buyer@ticketzy.demo');
		expect(byKey.buyer.memberType).toBe(MemberType.USER);
		expect(byKey.organizer.email).toBe('organizer@ticketzy.demo');
		expect(byKey.organizer.outcome).toBe('verify');
		expect(byKey.pending.email).toBe('pending@ticketzy.demo');
		expect(byKey.pending.outcome).toBeUndefined(); // stays PENDING
		expect(byKey.rejected.email).toBe('rejected@ticketzy.demo');
		expect(byKey.rejected.outcome).toBe('reject');
		expect(byKey.rejected.rejectReason).toBeTruthy();
		for (const account of DEMO_ACCOUNTS) expect(account.email).toMatch(/@ticketzy\.demo$/);
	});

	it('has a stadium with standing and seated sections, a hall and a small club, all valid layouts', () => {
		expect(DEMO_VENUES.map((venue) => venue.key).sort()).toEqual(['club', 'hall', 'stadium']);
		for (const venue of DEMO_VENUES) {
			expect(getVenueLayoutError({ sections: venue.sections })).toBeNull();
			expect(venue.city).toBeTruthy();
		}
		const stadium = DEMO_VENUES.find((venue) => venue.key === 'stadium');
		expect(stadium.sections.filter((s) => s.kind === SectionKind.SEATED).length).toBeGreaterThanOrEqual(3);
		expect(stadium.sections.some((s) => s.kind === SectionKind.STANDING)).toBe(true);
		const club = DEMO_VENUES.find((venue) => venue.key === 'club');
		expect(club.sections.reduce((sum, s) => sum + s.rows * s.seatsPerRow, 0)).toBeLessThan(100);
	});

	it('has the requested mix of categories and statuses', () => {
		const count = (status: EventStatus) => DEMO_EVENTS.filter((event) => event.status === status).length;
		expect(DEMO_EVENTS.length).toBeGreaterThanOrEqual(12);
		expect(count(EventStatus.APPROVED)).toBeGreaterThan(DEMO_EVENTS.length / 2);
		expect(count(EventStatus.PENDING)).toBe(2);
		expect(count(EventStatus.DRAFT)).toBe(1);
		expect(count(EventStatus.REJECTED)).toBe(1);
		expect(count(EventStatus.CANCELLED)).toBe(1);
		expect(count(EventStatus.ENDED)).toBe(1);
		for (const status of [EventStatus.REJECTED, EventStatus.CANCELLED]) {
			expect(DEMO_EVENTS.find((event) => event.status === status).reason).toBeTruthy();
		}
		const categories = new Set(DEMO_EVENTS.map((event) => event.category));
		for (const category of [EventCategory.CONCERT, EventCategory.FOOTBALL, EventCategory.COMEDY, EventCategory.OTHER]) {
			expect(categories.has(category)).toBe(true);
		}
	});

	it('spreads the upcoming events over the next one to three months', () => {
		const upcoming = DEMO_EVENTS.filter((event) => event.status !== EventStatus.ENDED);
		for (const event of upcoming) {
			expect(event.daysFromNow).toBeGreaterThanOrEqual(30);
			expect(event.daysFromNow).toBeLessThanOrEqual(90);
		}
	});

	it('translates every event into en, ko, ru and uz', () => {
		for (const event of DEMO_EVENTS) {
			for (const locale of ['en', 'ko', 'ru', 'uz'] as const) {
				expect(event.translations[locale].title.length).toBeGreaterThanOrEqual(3);
				expect(event.translations[locale].description.length).toBeGreaterThanOrEqual(5);
			}
			expect(event.translations.en.title).toBe(event.title);
		}
	});

	it('gives every RESERVED event a ticket type for each seated tier and no client quantity, and GENERAL events a quantity', () => {
		for (const event of DEMO_EVENTS) {
			const venue = DEMO_VENUES.find((v) => v.key === event.venue);
			expect(event.ticketTypes.length).toBeGreaterThan(0);
			for (const type of event.ticketTypes) expect(type.price).toBeGreaterThan(0);
			if (event.seating === SeatingType.RESERVED) {
				expect(getMissingTierKeys({ sections: venue.sections }, event.ticketTypes.map((t) => t.tierKey))).toEqual([]);
				for (const type of event.ticketTypes) expect(type.quantity).toBeUndefined();
			} else {
				for (const type of event.ticketTypes) expect(type.quantity).toBeGreaterThan(0);
			}
		}
	});

	it('has the events the buyer needs in a state that allows the purchases', () => {
		const get = (key: string) => DEMO_EVENTS.find((event) => event.key === key);
		expect(get('football-incheon-seoul').status).toBe(EventStatus.APPROVED);
		expect(get('comedy-busan-late-night').status).toBe(EventStatus.APPROVED);
		expect(get('comedy-spring-showcase').status).toBe(EventStatus.ENDED);
		expect(get('concert-midnight-jazz').status).toBe(EventStatus.PENDING); // the event conversation is about it
	});
});

/** a stand-in for what the real create step makes: demo members and their documents, linked by ids like the real ones */
const buildStore = () => {
	const models = {
		member: new FakeModel(),
		venue: new FakeModel(),
		event: new FakeModel(),
		ticketType: new FakeModel(),
		eventSeat: new FakeModel(),
		order: new FakeModel(),
		ticket: new FakeModel(),
		payment: new FakeModel(),
		refund: new FakeModel(),
		conversation: new FakeModel(),
		message: new FakeModel(),
		notification: new FakeModel(),
		auditLog: new FakeModel(),
	};

	const create = async (): Promise<DemoSummary> => {
		const admin = models.member.docs.find((member) => member.memberType === MemberType.ADMIN);
		const [buyer, organizer] = await Promise.all(
			['buyer', 'organizer'].map((name) =>
				models.member.create({ memberEmail: `${name}@ticketzy.demo`, memberType: name === 'buyer' ? MemberType.USER : MemberType.ORGANIZER }),
			),
		);
		const venue = await models.venue.create({ memberId: organizer._id, venueName: 'Demo Hall' });
		const event = await models.event.create({ organizerId: organizer._id, venueId: venue._id });
		await models.ticketType.create({ eventId: event._id });
		await models.eventSeat.insertMany([{ eventId: event._id }, { eventId: event._id }]);
		const order = await models.order.create({ buyerId: buyer._id, eventId: event._id });
		await models.ticket.create({ orderId: order._id, eventId: event._id, ownerId: buyer._id });
		await models.payment.create({ orderId: order._id });
		await models.refund.create({ orderId: order._id, eventId: event._id });
		const conversation = await models.conversation.create({ organizerId: organizer._id });
		await models.message.create({ conversationId: conversation._id, senderId: admin._id });
		await models.notification.create({ receiverId: organizer._id, authorId: admin._id, eventId: event._id });
		await models.notification.create({ receiverId: admin._id, authorId: buyer._id, orderId: order._id });
		await models.auditLog.create({ actorId: admin._id, targetId: event._id });
		return { emails: [{ label: 'buyer', email: buyer.memberEmail }], counts: { events: 1 } };
	};

	const total = () => Object.values(models).reduce((sum, model) => sum + model.docs.length, 0);
	return { models, create, total };
};

describe('demo seed: idempotency', () => {
	const addRealData = (models: ReturnType<typeof buildStore>['models']) => {
		const admin = { _id: new ObjectId(), memberEmail: 'admin@example.com', memberType: MemberType.ADMIN };
		// an admin on the demo domain must survive too: only non-admin demo members are removed
		const demoAdmin = { _id: new ObjectId(), memberEmail: 'boss@ticketzy.demo', memberType: MemberType.ADMIN };
		const realOrganizer = { _id: new ObjectId(), memberEmail: 'real@example.com', memberType: MemberType.ORGANIZER };
		const realBuyer = { _id: new ObjectId(), memberEmail: 'fan@example.org', memberType: MemberType.USER };
		models.member.docs.push(admin, demoAdmin, realOrganizer, realBuyer);
		const venue = { _id: new ObjectId(), memberId: realOrganizer._id };
		const event = { _id: new ObjectId(), organizerId: realOrganizer._id, venueId: venue._id };
		const order = { _id: new ObjectId(), buyerId: realBuyer._id, eventId: event._id };
		models.venue.docs.push(venue);
		models.event.docs.push(event);
		models.order.docs.push(order);
		models.ticket.docs.push({ _id: new ObjectId(), orderId: order._id, eventId: event._id, ownerId: realBuyer._id });
		models.notification.docs.push({ _id: new ObjectId(), receiverId: realBuyer._id, authorId: realOrganizer._id, eventId: event._id });
		models.notification.docs.push({ _id: new ObjectId(), receiverId: admin._id, authorId: admin._id });
		models.auditLog.docs.push({ _id: new ObjectId(), actorId: admin._id, targetId: realOrganizer._id });
		models.conversation.docs.push({ _id: new ObjectId(), organizerId: realOrganizer._id, isSupport: true });
	};

	const run = (store: ReturnType<typeof buildStore>, env: Record<string, string> = {}) =>
		runDemoSeed({ env, cleanup: () => removeDemoData(store.models as unknown as DemoCleanupModels), create: store.create });

	it('creating twice leaves exactly one copy of the demo data', async () => {
		const store = buildStore();
		addRealData(store.models);
		const baseline = store.total();

		await run(store);
		const afterFirst = store.total();
		expect(afterFirst).toBeGreaterThan(baseline);
		const demoMembers = () => store.models.member.docs.filter((m) => /@ticketzy\.demo$/.test(m.memberEmail) && m.memberType !== MemberType.ADMIN);
		expect(demoMembers()).toHaveLength(2);

		const second = await run(store);
		expect(store.total()).toBe(afterFirst);
		expect(demoMembers()).toHaveLength(2);
		expect(second.removed.members).toBe(2);
		expect(second.removed.events).toBe(1);

		await run(store);
		expect(store.total()).toBe(afterFirst);
	});

	it('removes only demo documents and keeps admins and real data untouched', async () => {
		const store = buildStore();
		addRealData(store.models);
		const snapshot = Object.fromEntries(Object.entries(store.models).map(([name, model]) => [name, model.docs.map((doc) => String(doc._id))]));

		await run(store);
		await run(store);

		for (const [name, ids] of Object.entries(snapshot)) {
			const remaining = (store.models as any)[name].docs.map((doc: any) => String(doc._id));
			for (const id of ids) expect(remaining).toContain(id);
		}
		// and nothing else of the real data was created or changed: the real organizer still has exactly one event
		const realOrganizer = store.models.member.docs.find((member) => member.memberEmail === 'real@example.com');
		expect(store.models.event.docs.filter((event) => String(event.organizerId) === String(realOrganizer._id))).toHaveLength(1);
	});

	it('removes nothing when no demo data exists, and does not need the admin', async () => {
		const store = buildStore();
		store.models.member.docs.push({ _id: new ObjectId(), memberEmail: 'admin@example.com', memberType: MemberType.ADMIN });
		const counts = await removeDemoData(store.models as unknown as DemoCleanupModels);
		expect(counts).toEqual({ members: 0 });
		expect(store.models.member.docs).toHaveLength(1);
	});

	it('cleans up before it creates, in that order, every time', async () => {
		const calls: string[] = [];
		const steps = {
			env: {},
			cleanup: jest.fn(async () => (calls.push('cleanup'), {})),
			create: jest.fn(async () => (calls.push('create'), { emails: [], counts: {} })),
		};
		await runDemoSeed(steps);
		await runDemoSeed(steps);
		expect(calls).toEqual(['cleanup', 'create', 'cleanup', 'create']);
	});

	it('does not create when the cleanup fails', async () => {
		const create = jest.fn();
		await expect(runDemoSeed({ env: {}, cleanup: async () => Promise.reject(new Error('db down')), create })).rejects.toThrow('db down');
		expect(create).not.toHaveBeenCalled();
	});
});

describe('demo seed: seat blocks', () => {
	const grid = () => {
		const seats = [];
		for (const sectionKey of ['A', 'B', 'C']) {
			for (let row = 1; row <= 8; row++) {
				for (let number = 1; number <= 20; number++) seats.push({ _id: `${sectionKey}-${row}-${number}`, sectionKey, row, number });
			}
		}
		return seats;
	};
	const parse = (id: unknown) => String(id).split('-');

	it('returns blocks of neighbouring seats in one row, never reusing a seat', () => {
		const blocks = pickSeatBlocks(grid(), [8, 4, 6, 2, 8, 3, 5, 8, 4, 2, 6, 3]);
		expect(blocks).toHaveLength(12);
		const seen = new Set<unknown>();
		for (const block of blocks) {
			const [section, row] = parse(block[0]);
			block.forEach((id, i) => {
				expect(parse(id).slice(0, 2)).toEqual([section, row]);
				expect(Number(parse(id)[2])).toBe(Number(parse(block[0])[2]) + i);
				expect(seen.has(id)).toBe(false);
				seen.add(id);
			});
		}
	});

	it('spreads the blocks over every section and respects the maximum size', () => {
		const blocks = pickSeatBlocks(grid(), [8, 8, 8, 8, 8, 8], 5);
		expect(new Set(blocks.map((block) => parse(block[0])[0])).size).toBe(3);
		for (const block of blocks) expect(block.length).toBeLessThanOrEqual(5);
	});

	it('returns fewer blocks when the free seats run out, and handles no seats at all', () => {
		const few = grid().filter((seat) => seat.sectionKey === 'A' && seat.row === 1 && seat.number <= 3);
		expect(pickSeatBlocks(few, [8, 8]).length).toBe(0);
		expect(pickSeatBlocks(few, [3]).length).toBe(1);
		expect(() => pickSeatBlocks([], [4])).not.toThrow();
	});
});

describe('demo seed: summary', () => {
	it('lists logins by email and the password variable name, never a password value', () => {
		const text = formatDemoSummary(
			{
				emails: [
					{ label: 'ADMIN (existing)', email: 'admin@example.com' },
					{ label: 'USER buyer', email: 'buyer@ticketzy.demo' },
				],
				counts: { events: 13 },
			},
			{ members: 5 },
		);
		expect(text).toContain('admin@example.com');
		expect(text).toContain('buyer@ticketzy.demo');
		expect(text).toContain('DEMO_PASSWORD');
		expect(text).not.toContain(DEFAULT_DEMO_PASSWORD);
		expect(text).toContain('Removed 5');
	});
});
