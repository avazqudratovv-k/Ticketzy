import { ObjectId } from 'bson';
import { FakeModel } from '../../test/fake-model';
import { MemberType } from './enums/member.enum';
import { DemoModels, removeDemoData } from './demo-manifest';
import { KEEP_LINKED_ENV, LINKED_COLLECTIONS, assertNoLinkedRecords, findLinkedRecords, formatLinkCounts, isKeepLinked } from './demo-links';

const names = ['manifest', 'member', 'venue', 'event', 'ticketType', 'eventSeat', 'order', 'ticket', 'payment', 'refund', 'payout', 'comment', 'like', 'view', 'follow', 'conversation', 'message', 'notification', 'auditLog'] as const;
const id = () => new ObjectId();
const models = (m: Record<string, FakeModel>) => m as unknown as DemoModels;

/** a seeded world (an organizer, a buyer, a venue, an event, an order with tickets) plus an admin and one real person */
const world = () => {
	const m = Object.fromEntries(names.map((name) => [name, new FakeModel()])) as Record<(typeof names)[number], FakeModel>;
	const admin = { _id: id(), memberEmail: 'admin@example.com', memberType: MemberType.ADMIN };
	const organizer = { _id: id(), memberEmail: 'organizer@ticketzy.demo', memberType: MemberType.ORGANIZER };
	const buyer = { _id: id(), memberEmail: 'buyer@ticketzy.demo', memberType: MemberType.USER };
	const real = { _id: id(), memberEmail: 'fan@example.org', memberType: MemberType.USER };
	const realOrganizer = { _id: id(), memberEmail: 'promoter@example.org', memberType: MemberType.ORGANIZER };
	m.member.docs.push(admin, organizer, buyer, real, realOrganizer);
	const venue = { _id: id(), memberId: organizer._id };
	const event = { _id: id(), organizerId: organizer._id, venueId: venue._id };
	m.venue.docs.push(venue);
	m.event.docs.push(event);
	for (const [recordType, recordId] of [['Member', organizer._id], ['Member', buyer._id], ['Venue', venue._id], ['Event', event._id]] as const) m.manifest.docs.push({ _id: id(), recordType, recordId });
	const order = { _id: id(), buyerId: buyer._id, eventId: event._id };
	m.order.docs.push(order);
	m.ticket.docs.push({ _id: id(), orderId: order._id, eventId: event._id, ownerId: buyer._id });
	m.payment.docs.push({ _id: id(), orderId: order._id });
	const conversation = { _id: id(), organizerId: organizer._id };
	m.conversation.docs.push(conversation);
	// what the seed itself writes: the admin talks to the organizer, notifications between the admin and the demo accounts
	m.message.docs.push({ _id: id(), conversationId: conversation._id, senderId: admin._id }, { _id: id(), conversationId: conversation._id, senderId: organizer._id });
	m.notification.docs.push({ _id: id(), receiverId: organizer._id, authorId: admin._id, eventId: event._id }, { _id: id(), receiverId: admin._id, authorId: buyer._id, orderId: order._id });
	m.comment.docs.push({ _id: id(), memberId: buyer._id, commentRefId: event._id });
	m.like.docs.push({ _id: id(), memberId: buyer._id, likeRefId: event._id });
	m.view.docs.push({ _id: id(), memberId: buyer._id, viewRefId: organizer._id });
	return { m, admin, organizer, buyer, real, realOrganizer, venue, event, order, conversation };
};

describe('records of other accounts that point at demo data (DECISIONS #132)', () => {
	it('finds nothing in a world that only the seed and its admin wrote in', async () => {
		const { m } = world();
		const links = await findLinkedRecords(models(m));
		expect(links.total).toBe(0);
		expect(Object.keys(links.counts).sort()).toEqual([...LINKED_COLLECTIONS].sort());
		expect(links.eventIds).toEqual([]);
	});

	it('finds nothing when no seed ever ran (empty manifest), whatever else is in the database', async () => {
		const { m, real, event } = world();
		m.manifest.docs = [];
		m.order.docs.push({ _id: id(), buyerId: real._id, eventId: event._id });
		expect((await findLinkedRecords(models(m))).total).toBe(0);
	});

	it('counts each kind of record per collection', async () => {
		const { m, real, realOrganizer, organizer, venue, event, conversation } = world();
		const order = { _id: id(), buyerId: real._id, eventId: event._id };
		m.order.docs.push(order);
		m.ticket.docs.push({ _id: id(), orderId: order._id, eventId: event._id, ownerId: real._id }, { _id: id(), orderId: order._id, eventId: event._id, ownerId: real._id });
		m.payment.docs.push({ _id: id(), orderId: order._id });
		m.refund.docs.push({ _id: id(), orderId: order._id, eventId: event._id, buyerId: real._id });
		m.comment.docs.push({ _id: id(), memberId: real._id, commentRefId: event._id });
		m.like.docs.push({ _id: id(), memberId: real._id, likeRefId: event._id }, { _id: id(), memberId: real._id, likeRefId: organizer._id });
		m.view.docs.push({ _id: id(), memberId: real._id, viewRefId: event._id });
		m.message.docs.push({ _id: id(), conversationId: conversation._id, senderId: real._id });
		m.notification.docs.push({ _id: id(), receiverId: real._id, authorId: organizer._id, orderId: order._id }, { _id: id(), receiverId: organizer._id, authorId: real._id, eventId: event._id });
		m.event.docs.push({ _id: id(), organizerId: realOrganizer._id, venueId: venue._id });

		const links = await findLinkedRecords(models(m));
		expect(links.counts).toEqual({ orders: 1, tickets: 2, payments: 1, refunds: 1, comments: 1, likes: 2, views: 1, messages: 1, notifications: 2, events: 1 });
		expect(links.total).toBe(13);
		expect(links.eventIds.map(String)).toEqual([String(event._id)]);
		expect(links.venueIds.map(String)).toEqual([String(venue._id)]);
		expect(links.memberIds.map(String)).toEqual([String(organizer._id)]);
	});

	it.each([
		['an order', (w: ReturnType<typeof world>) => w.m.order.docs.push({ _id: id(), buyerId: w.real._id, eventId: w.event._id })],
		['a comment', (w: ReturnType<typeof world>) => w.m.comment.docs.push({ _id: id(), memberId: w.real._id, commentRefId: w.event._id })],
		['a like on an event', (w: ReturnType<typeof world>) => w.m.like.docs.push({ _id: id(), memberId: w.real._id, likeRefId: w.event._id })],
		['a like on an organizer', (w: ReturnType<typeof world>) => w.m.like.docs.push({ _id: id(), memberId: w.real._id, likeRefId: w.organizer._id })],
		['a chat message', (w: ReturnType<typeof world>) => w.m.message.docs.push({ _id: id(), conversationId: w.conversation._id, senderId: w.real._id })],
		['a notification', (w: ReturnType<typeof world>) => w.m.notification.docs.push({ _id: id(), receiverId: w.real._id, authorId: w.organizer._id, eventId: w.event._id })],
		['an event at a demo venue', (w: ReturnType<typeof world>) => w.m.event.docs.push({ _id: id(), organizerId: w.realOrganizer._id, venueId: w.venue._id })],
	])('counts %s, and a reset does not delete what it points at', async (_name, add) => {
		const w = world();
		add(w);
		const links = await findLinkedRecords(models(w.m));
		expect(links.total).toBeGreaterThan(0);
		await removeDemoData(models(w.m));
		// every demo root the real records need is still there
		for (const eventId of links.eventIds) expect(w.m.event.docs.some((doc) => String(doc._id) === String(eventId))).toBe(true);
		for (const venueId of links.venueIds) expect(w.m.venue.docs.some((doc) => String(doc._id) === String(venueId))).toBe(true);
		for (const memberId of links.memberIds) expect(w.m.member.docs.some((doc) => String(doc._id) === String(memberId))).toBe(true);
		expect(links.eventIds.length + links.venueIds.length + links.memberIds.length).toBeGreaterThan(0);
	});

	it('does not count admins, the demo accounts or ids that are missing', async () => {
		const { m, admin, organizer, event, conversation } = world();
		m.comment.docs.push({ _id: id(), commentRefId: event._id });
		m.message.docs.push({ _id: id(), conversationId: conversation._id });
		m.like.docs.push({ _id: id(), memberId: admin._id, likeRefId: event._id });
		m.notification.docs.push({ _id: id(), receiverId: organizer._id, eventId: event._id });
		expect((await findLinkedRecords(models(m))).total).toBe(0);
	});

	it('does not count what an account that no longer exists left on kept data (a demo buyer an earlier reset removed)', async () => {
		const { m, organizer, event, conversation } = world();
		const gone = id(); // no member document
		m.comment.docs.push({ _id: id(), memberId: gone, commentRefId: event._id });
		m.like.docs.push({ _id: id(), memberId: gone, likeRefId: event._id }, { _id: id(), memberId: gone, likeRefId: organizer._id });
		m.view.docs.push({ _id: id(), memberId: gone, viewRefId: organizer._id });
		m.message.docs.push({ _id: id(), conversationId: conversation._id, senderId: gone });
		m.notification.docs.push({ _id: id(), receiverId: gone, authorId: organizer._id, eventId: event._id });
		expect((await findLinkedRecords(models(m))).total).toBe(0);
	});

	it('is read-only', async () => {
		const { m, real, event } = world();
		m.order.docs.push({ _id: id(), buyerId: real._id, eventId: event._id });
		const snapshot = JSON.stringify(Object.values(m).map((model) => model.docs));
		await findLinkedRecords(models(m));
		expect(JSON.stringify(Object.values(m).map((model) => model.docs))).toBe(snapshot);
	});
});

describe('the gate before a reset and the dry run output', () => {
	const links = (counts: Record<string, number> = {}) => {
		const full = Object.fromEntries(LINKED_COLLECTIONS.map((name) => [name, counts[name] ?? 0]));
		return { counts: full, total: Object.values(full).reduce((sum, n) => sum + n, 0) };
	};

	it('passes when nothing points at demo data', () => {
		expect(() => assertNoLinkedRecords(links(), {}, 'seed')).not.toThrow();
	});

	it('stops with a clear error that names the counts, the dry run and the flag', () => {
		let message = '';
		try {
			assertNoLinkedRecords(links({ orders: 3, comments: 2 }), {}, 'seed');
		} catch (err) {
			message = err.message;
		}
		expect(message).toContain('5 record(s)');
		expect(message).toContain('orders: 3');
		expect(message).toContain('comments: 2');
		expect(message).not.toContain('likes: 0');
		expect(message).toContain('Nothing was changed');
		expect(message).toContain('npm run seed:demo -- --dry-run');
		expect(message).toContain(KEEP_LINKED_ENV);
	});

	it('names reset:demo when it is the reset that stops', () => {
		expect(() => assertNoLinkedRecords(links({ likes: 1 }), {}, 'reset')).toThrow('npm run reset:demo -- --dry-run');
	});

	it('goes on when the flag says to keep the linked demo records (only the exact word true)', () => {
		expect(() => assertNoLinkedRecords(links({ orders: 3 }), { [KEEP_LINKED_ENV]: 'true' }, 'seed')).not.toThrow();
		expect(() => assertNoLinkedRecords(links({ orders: 3 }), { [KEEP_LINKED_ENV]: ' TRUE ' }, 'seed')).not.toThrow();
		for (const value of ['false', '1', 'yes', '', undefined]) {
			expect(() => assertNoLinkedRecords(links({ orders: 3 }), { [KEEP_LINKED_ENV]: value }, 'seed')).toThrow();
			expect(isKeepLinked({ [KEEP_LINKED_ENV]: value })).toBe(false);
		}
	});

	it('prints one line per collection with counts only', () => {
		const text = formatLinkCounts(links({ orders: 3 }).counts);
		expect(text.split('\n')).toHaveLength(LINKED_COLLECTIONS.length);
		expect(text).toMatch(/orders\s+3/);
		expect(text).toMatch(/tickets\s+0/);
	});
});
