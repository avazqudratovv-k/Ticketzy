import { ObjectId } from 'bson';
import { FakeModel } from '../../test/fake-model';
import { MemberType } from './enums/member.enum';
import { DemoModels, countForeignData, removeDemoData } from './demo-manifest';

const names = ['manifest', 'member', 'venue', 'event', 'ticketType', 'eventSeat', 'order', 'ticket', 'payment', 'refund', 'payout', 'comment', 'like', 'view', 'follow', 'conversation', 'message', 'notification', 'auditLog'] as const;
const build = () => Object.fromEntries(names.map((name) => [name, new FakeModel()])) as unknown as Record<(typeof names)[number], FakeModel>;
const id = () => new ObjectId();
const total = (models: Record<string, FakeModel>) => Object.values(models).reduce((sum, model) => sum + model.docs.length, 0);
const ids = (model: FakeModel) => model.docs.map((doc) => String(doc._id));

/** seeded data as the seed writes it (manifest rows for members, venues and events) plus data of other people */
const world = () => {
	const m = build();
	const admin = { _id: id(), memberEmail: 'admin@example.com', memberType: MemberType.ADMIN };
	const demoAdmin = { _id: id(), memberEmail: 'boss@ticketzy.demo', memberType: MemberType.ADMIN };
	const organizer = { _id: id(), memberEmail: 'organizer@ticketzy.demo', memberType: MemberType.ORGANIZER };
	const buyer = { _id: id(), memberEmail: 'buyer@ticketzy.demo', memberType: MemberType.USER };
	// somebody who signed up with a demo address through the API: not in the manifest, so never removed
	const impostor = { _id: id(), memberEmail: 'sneaky@ticketzy.demo', memberType: MemberType.USER };
	const realOrganizer = { _id: id(), memberEmail: 'real@example.com', memberType: MemberType.ORGANIZER };
	const realBuyer = { _id: id(), memberEmail: 'fan@example.org', memberType: MemberType.USER };
	m.member.docs.push(admin, demoAdmin, organizer, buyer, impostor, realOrganizer, realBuyer);

	const venue = { _id: id(), memberId: organizer._id };
	const event = { _id: id(), organizerId: organizer._id, venueId: venue._id };
	const realVenue = { _id: id(), memberId: realOrganizer._id };
	const realEvent = { _id: id(), organizerId: realOrganizer._id, venueId: realVenue._id };
	m.venue.docs.push(venue, realVenue);
	m.event.docs.push(event, realEvent);
	for (const [recordType, recordId] of [['Member', organizer._id], ['Member', buyer._id], ['Member', demoAdmin._id], ['Venue', venue._id], ['Event', event._id]] as const) {
		m.manifest.docs.push({ _id: id(), recordType, recordId });
	}

	const order = { _id: id(), buyerId: buyer._id, eventId: event._id };
	const realOrder = { _id: id(), buyerId: realBuyer._id, eventId: realEvent._id };
	m.order.docs.push(order, realOrder);
	m.ticketType.docs.push({ _id: id(), eventId: event._id }, { _id: id(), eventId: realEvent._id });
	m.eventSeat.docs.push({ _id: id(), eventId: event._id }, { _id: id(), eventId: realEvent._id });
	m.ticket.docs.push({ _id: id(), orderId: order._id, eventId: event._id }, { _id: id(), orderId: realOrder._id, eventId: realEvent._id });
	m.payment.docs.push({ _id: id(), orderId: order._id }, { _id: id(), orderId: realOrder._id });
	m.refund.docs.push({ _id: id(), orderId: order._id, eventId: event._id });
	m.payout.docs.push({ _id: id(), eventId: event._id }, { _id: id(), eventId: realEvent._id });
	const conversation = { _id: id(), organizerId: organizer._id };
	const realConversation = { _id: id(), organizerId: realOrganizer._id };
	m.conversation.docs.push(conversation, realConversation);
	m.message.docs.push({ _id: id(), conversationId: conversation._id }, { _id: id(), conversationId: realConversation._id });
	m.notification.docs.push(
		{ _id: id(), receiverId: organizer._id, authorId: admin._id },
		{ _id: id(), receiverId: admin._id, authorId: buyer._id, orderId: order._id },
		{ _id: id(), receiverId: admin._id, authorId: admin._id },
		{ _id: id(), receiverId: realBuyer._id, authorId: realOrganizer._id, eventId: realEvent._id },
	);
	m.auditLog.docs.push({ _id: id(), actorId: admin._id, targetId: event._id }, { _id: id(), actorId: admin._id, targetId: realEvent._id });
	m.comment.docs.push({ _id: id(), memberId: buyer._id, commentRefId: event._id }, { _id: id(), memberId: realBuyer._id, commentRefId: realEvent._id });
	m.like.docs.push({ _id: id(), memberId: buyer._id, likeRefId: event._id }, { _id: id(), memberId: realBuyer._id, likeRefId: realEvent._id });
	m.view.docs.push({ _id: id(), memberId: buyer._id, viewRefId: organizer._id }, { _id: id(), memberId: realBuyer._id, viewRefId: realOrganizer._id });
	m.follow.docs.push({ _id: id(), followerId: buyer._id, followingId: organizer._id }, { _id: id(), followerId: realBuyer._id, followingId: realOrganizer._id });
	return { m, admin, demoAdmin, organizer, buyer, impostor, realOrganizer, realBuyer, venue, event, realEvent, order, realOrder };
};

describe('demo reset', () => {
	it('removes only what the manifest tracks and what hangs off it', async () => {
		const { m, admin, demoAdmin, impostor, realOrganizer, realBuyer, realEvent, realOrder, event } = world();
		const before = Object.fromEntries(Object.entries(m).map(([name, model]) => [name, ids(model)]));
		const { removed, kept } = await removeDemoData(m as unknown as DemoModels);

		expect(kept).toEqual({ members: 0, venues: 0, events: 0, orders: 0 });
		expect(removed).toMatchObject({ members: 2, venues: 1, events: 1, orders: 1, tickets: 1, payments: 1, refunds: 1, payouts: 1, eventSeats: 1, ticketTypes: 1, conversations: 1, messages: 1, comments: 1, likes: 1, views: 1, follows: 1 });
		expect(ids(m.member).sort()).toEqual([admin._id, demoAdmin._id, impostor._id, realOrganizer._id, realBuyer._id].map(String).sort());
		expect(m.event.docs.map((doc) => String(doc._id))).toEqual([String(realEvent._id)]);
		expect(m.order.docs.map((doc) => String(doc._id))).toEqual([String(realOrder._id)]);
		expect(m.manifest.docs.map((doc) => String(doc.recordId))).toEqual([String(demoAdmin._id)]); // the demo admin was never removed
		// audit and notifications of the removed event are gone; the admin's own and the real ones stay
		expect(m.auditLog.docs.map((doc) => String(doc.targetId))).not.toContain(String(event._id));
		expect(m.auditLog.docs).toHaveLength(1);
		expect(m.notification.docs).toHaveLength(2);
		// nothing that existed and is not demo data was touched
		for (const name of ['venue', 'conversation', 'message', 'payout', 'ticket', 'payment', 'comment', 'like', 'view', 'follow', 'eventSeat', 'ticketType']) {
			expect((m as any)[name].docs.length).toBe(before[name].length - 1);
		}
	});

	it('is safe to run twice and leaves nothing to do the second time', async () => {
		const { m } = world();
		await removeDemoData(m as unknown as DemoModels);
		const afterFirst = total(m);
		const second = await removeDemoData(m as unknown as DemoModels);
		expect(total(m)).toBe(afterFirst);
		expect(Object.values(second.removed).reduce((sum, count) => sum + count, 0)).toBe(0);
	});

	it('removes nothing when the manifest is empty, whatever the email addresses look like', async () => {
		const { m } = world();
		m.manifest.docs = [];
		const before = total(m);
		const { removed } = await removeDemoData(m as unknown as DemoModels);
		expect(removed).toEqual({});
		expect(total(m)).toBe(before);
	});

	it('keeps an event that another account bought tickets for, with its organizer, venue and orders, and reports it', async () => {
		const { m, organizer, venue, event, realBuyer } = world();
		const foreignOrder = { _id: id(), buyerId: realBuyer._id, eventId: event._id };
		m.order.docs.push(foreignOrder);
		const { kept, removed } = await removeDemoData(m as unknown as DemoModels);

		expect(kept).toMatchObject({ events: 1, members: 2, venues: 1 }); // the organizer, and the seeded buyer whose order stays
		expect(ids(m.event)).toContain(String(event._id));
		expect(ids(m.member)).toContain(String(organizer._id));
		expect(ids(m.venue)).toContain(String(venue._id));
		expect(ids(m.order)).toContain(String(foreignOrder._id));
		expect(removed.orders ?? 0).toBe(0);
	});

	it('keeps a venue that an event of someone else uses', async () => {
		const { m, venue, realOrganizer } = world();
		m.event.docs.push({ _id: id(), organizerId: realOrganizer._id, venueId: venue._id });
		const { kept } = await removeDemoData(m as unknown as DemoModels);
		expect(kept.venues).toBe(1);
		expect(ids(m.venue)).toContain(String(venue._id));
	});

	it('leaves comments and likes that others wrote about removed demo data, and counts them', async () => {
		const { m, event, realBuyer } = world();
		m.comment.docs.push({ _id: id(), memberId: realBuyer._id, commentRefId: event._id });
		m.like.docs.push({ _id: id(), memberId: realBuyer._id, likeRefId: event._id });
		const { leftBehind } = await removeDemoData(m as unknown as DemoModels);
		expect(leftBehind).toMatchObject({ comments: 1, likes: 1 });
		expect(m.comment.docs.some((doc) => String(doc.memberId) === String(realBuyer._id) && String(doc.commentRefId) === String(event._id))).toBe(true);
	});
});

describe('demo database check', () => {
	it('counts only data the seed did not create, and ignores admins', async () => {
		const { m } = world();
		expect(await countForeignData(m as unknown as DemoModels)).toEqual({ members: 3, venues: 1, events: 1, orders: 1 });
		await removeDemoData(m as unknown as DemoModels);
		expect(await countForeignData(m as unknown as DemoModels)).toEqual({ members: 3, venues: 1, events: 1, orders: 1 });
		const empty = build();
		empty.member.docs.push({ _id: id(), memberEmail: 'admin@example.com', memberType: MemberType.ADMIN });
		expect(await countForeignData(empty as unknown as DemoModels)).toEqual({ members: 0, venues: 0, events: 0, orders: 0 });
	});
});
