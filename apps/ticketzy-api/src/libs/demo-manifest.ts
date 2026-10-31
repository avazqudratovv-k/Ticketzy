/**
 * How the demo seed knows what it created (DECISIONS #108). Three kinds of root documents are written to the
 * `demo_seed_records` collection BEFORE they are created: members, venues and events. Everything else (ticket types, seats,
 * orders, tickets, payments, refunds, payouts, social records, chats, notifications, audit entries) hangs off those roots,
 * so reset derives it from them.
 *
 * Reset removes a document only when it belongs to the seed:
 * - a member only when its id is in the manifest AND its email is on the demo domain (a real visitor cannot sign up as
 *   someone@ticketzy.demo and be deleted by a reset), and never an ADMIN;
 * - a social record (comment, like, view, follow) only when its author is a removed member AND its target is a removed record;
 * - an event that somebody else bought tickets for stays, with its organizer, venue and orders, and is reported.
 * Nothing is counted down on documents that stay.
 */
import { MemberType } from './enums/member.enum';
import { findLinkedRecords, findOwned } from './demo-links';

export type DemoRecordType = 'Member' | 'Venue' | 'Event';

/** the little of a Mongoose model that the cleanup needs, so tests can use an in-memory stand-in */
export interface DemoModel {
	find(filter: any): any;
	deleteMany(filter: any): any;
	countDocuments(filter: any): any;
}

export interface DemoModels {
	manifest: DemoModel;
	member: DemoModel;
	venue: DemoModel;
	event: DemoModel;
	ticketType: DemoModel;
	eventSeat: DemoModel;
	order: DemoModel;
	ticket: DemoModel;
	payment: DemoModel;
	refund: DemoModel;
	payout: DemoModel;
	comment: DemoModel;
	like: DemoModel;
	view: DemoModel;
	follow: DemoModel;
	conversation: DemoModel;
	message: DemoModel;
	notification: DemoModel;
	auditLog: DemoModel;
}

export type DemoCounts = Record<string, number>;

const idsOf = (docs: { _id: unknown }[]): unknown[] => docs.map((doc) => doc._id);
const unique = (ids: unknown[]): unknown[] => [...new Map(ids.map((id) => [String(id), id])).values()];
const without = (ids: unknown[], removed: unknown[]): unknown[] => {
	const gone = new Set(removed.map(String));
	return ids.filter((id) => !gone.has(String(id)));
};

/** ids the manifest holds for one kind of root */
export const getTrackedIds = async (models: DemoModels, type: DemoRecordType): Promise<unknown[]> => {
	const rows: { recordId: unknown }[] = await models.manifest.find({ recordType: type }).lean().exec();
	return rows.map((row) => row.recordId);
};

/** how many documents the seed did not create; ADMIN accounts do not count */
export const countForeignData = async (models: DemoModels) => {
	const [members, venues, events] = await Promise.all([
		getTrackedIds(models, 'Member'),
		getTrackedIds(models, 'Venue'),
		getTrackedIds(models, 'Event'),
	]);
	const [foreignMembers, foreignVenues, foreignEvents, foreignOrders] = await Promise.all([
		models.member.countDocuments({ _id: { $nin: members }, memberType: { $ne: MemberType.ADMIN } }).exec(),
		models.venue.countDocuments({ _id: { $nin: venues }, memberId: { $nin: members } }).exec(),
		models.event.countDocuments({ _id: { $nin: events }, organizerId: { $nin: members } }).exec(),
		models.order.countDocuments({ eventId: { $nin: events }, buyerId: { $nin: members } }).exec(),
	]);
	return { members: foreignMembers, venues: foreignVenues, events: foreignEvents, orders: foreignOrders };
};

export interface DemoScope {
	/** members, venues and events the cleanup removes */
	memberIds: unknown[];
	venueIds: unknown[];
	eventIds: unknown[];
	orderIds: unknown[];
	/** what stays because somebody else depends on it */
	kept: { members: number; venues: number; events: number; orders: number };
}

/**
 * Works out what a reset may remove. Owned = in the manifest (members also need the demo email domain). Then the
 * dependencies of other people are taken out (DECISIONS #108, #132): an owned event that an account outside the seed bought
 * tickets for, commented on, liked, viewed or got a notification about stays with its organizer and venue; so does an
 * organizer others liked, viewed or wrote to, and a venue another organizer's event uses. Nothing is deleted under a record
 * that someone else still points at, whatever the flags of the scripts say.
 */
export const findDemoScope = async (models: DemoModels): Promise<DemoScope> => {
	const empty: DemoScope = { memberIds: [], venueIds: [], eventIds: [], orderIds: [], kept: { members: 0, venues: 0, events: 0, orders: 0 } };
	const owned = await findOwned(models);
	if (owned.empty) return empty;
	const ownedMembers = owned.memberIds;
	const ownedEvents = owned.eventIds;
	const ownedVenues = owned.venueIds;
	const orders = owned.orders as any[];
	const links = await findLinkedRecords(models, owned);

	const events = await models.event.find({ _id: { $in: ownedEvents } }).lean().exec();
	const venues = await models.venue.find({ _id: { $in: ownedVenues } }).lean().exec();

	// an owned event somebody else bought tickets for, wrote about or liked stays, and so do its organizer, venue and the orders on it
	const keptEvents = unique([
		...orders.filter((order: any) => !ownedMembers.some((id) => String(id) === String(order.buyerId))).map((order: any) => order.eventId),
		...links.eventIds,
	]);
	// a seeded buyer's order on an event that stays or is not owned keeps the buyer
	const keptOrders = orders.filter(
		(order: any) => keptEvents.some((id) => String(id) === String(order.eventId)) || !ownedEvents.some((id) => String(id) === String(order.eventId)),
	);
	const keptEventDocs = events.filter((event: any) => keptEvents.some((id) => String(id) === String(event._id)));
	let keptMembers = unique([...keptEventDocs.map((event: any) => event.organizerId), ...keptOrders.map((order: any) => order.buyerId), ...links.memberIds]);
	const removableEvents = without(ownedEvents, keptEvents);

	// a venue that an event outside the removable set uses stays, and one that another organizer's event uses
	const stillUsed: any[] = await models.event.find({ venueId: { $in: ownedVenues }, _id: { $nin: removableEvents } }).lean().exec();
	const keptVenues = unique([...stillUsed.map((event) => event.venueId), ...links.venueIds]);
	// the owner of a venue that stays stays too
	keptMembers = unique([...keptMembers, ...venues.filter((venue: any) => keptVenues.some((id) => String(id) === String(venue._id))).map((venue: any) => venue.memberId)]);

	return {
		memberIds: without(ownedMembers, keptMembers),
		venueIds: without(ownedVenues, keptVenues),
		eventIds: removableEvents,
		orderIds: without(idsOf(orders), idsOf(keptOrders)),
		kept: {
			members: keptMembers.filter((id) => ownedMembers.some((owned) => String(owned) === String(id))).length,
			venues: keptVenues.filter((id) => ownedVenues.some((owned) => String(owned) === String(id))).length,
			events: keptEvents.filter((id) => ownedEvents.some((owned) => String(owned) === String(id))).length,
			orders: keptOrders.length,
		},
	};
};

/** Removes what an earlier seed created and nothing else; returns what was removed and what stayed. */
export const removeDemoData = async (
	models: DemoModels,
): Promise<{ removed: DemoCounts; kept: DemoScope['kept']; leftBehind: DemoCounts }> => {
	const scope = await findDemoScope(models);
	const { memberIds, venueIds, eventIds, orderIds } = scope;
	const removed: DemoCounts = {};
	if (!memberIds.length && !venueIds.length && !eventIds.length) return { removed, kept: scope.kept, leftBehind: {} };

	const conversations = await models.conversation.find({ organizerId: { $in: memberIds } }).lean().exec();
	const conversationIds = idsOf(conversations);
	const comments = await models.comment.find({ memberId: { $in: memberIds }, commentRefId: { $in: eventIds } }).lean().exec();

	const remove = async (name: string, model: DemoModel, filter: any): Promise<void> => {
		const result = await model.deleteMany(filter).exec();
		removed[name] = result?.deletedCount ?? 0;
	};

	// children first, so a run that dies half way leaves its roots (and their manifest rows) behind and the next run finds the rest again
	await remove('tickets', models.ticket, { $or: [{ orderId: { $in: orderIds } }, { eventId: { $in: eventIds } }] });
	await remove('payments', models.payment, { orderId: { $in: orderIds } });
	await remove('refunds', models.refund, { $or: [{ orderId: { $in: orderIds } }, { eventId: { $in: eventIds } }] });
	await remove('payouts', models.payout, { eventId: { $in: eventIds } });
	await remove('eventSeats', models.eventSeat, { eventId: { $in: eventIds } });
	await remove('orders', models.order, { _id: { $in: orderIds } });
	await remove('ticketTypes', models.ticketType, { eventId: { $in: eventIds } });
	await remove('comments', models.comment, { _id: { $in: idsOf(comments) } });
	await remove('likes', models.like, { memberId: { $in: memberIds }, likeRefId: { $in: [...eventIds, ...memberIds] } });
	await remove('views', models.view, { memberId: { $in: memberIds }, viewRefId: { $in: [...eventIds, ...memberIds] } });
	await remove('follows', models.follow, { followerId: { $in: memberIds }, followingId: { $in: memberIds } });
	await remove('messages', models.message, { conversationId: { $in: conversationIds } });
	await remove('conversations', models.conversation, { _id: { $in: conversationIds } });
	await remove('notifications', models.notification, {
		$or: [
			{ receiverId: { $in: memberIds } },
			{ eventId: { $in: eventIds } },
			{ orderId: { $in: orderIds } },
			{ conversationId: { $in: conversationIds } },
		],
	});
	await remove('auditLogs', models.auditLog, {
		$or: [{ actorId: { $in: memberIds } }, { targetId: { $in: [...memberIds, ...eventIds, ...orderIds, ...conversationIds, ...idsOf(comments)] } }],
	});
	await remove('events', models.event, { _id: { $in: eventIds } });
	await remove('venues', models.venue, { _id: { $in: venueIds } });
	await remove('members', models.member, { _id: { $in: memberIds }, memberType: { $ne: MemberType.ADMIN } });
	await remove('manifestRows', models.manifest, { recordId: { $in: [...memberIds, ...venueIds, ...eventIds] } });
	return { removed, kept: scope.kept, leftBehind: await countLeftBehind(models, scope) };
};

/**
 * A reset never counts down on accounts that stay (#108), so an organizer kept because other accounts use it still carries
 * `memberEvents` and `completedEvents` of events that were removed. This sets both from the events that really exist, the way
 * the consistency check reads them (not CANCELLED, and ENDED), so the commission tier and the rank of the next seed start right.
 */
export const reconcileOrganizerCounters = async (models: DemoModels): Promise<number> => {
	const owned = await findOwned(models);
	if (owned.empty || !owned.memberIds.length) return 0;
	const organizers: any[] = await models.member.find({ _id: { $in: owned.memberIds }, memberType: MemberType.ORGANIZER }).lean().exec();
	let changed = 0;
	for (const organizer of organizers) {
		const events: any[] = await models.event.find({ organizerId: organizer._id }).lean().exec();
		const memberEvents = events.filter((event) => event.eventStatus !== 'CANCELLED').length;
		const completedEvents = events.filter((event) => event.eventStatus === 'ENDED').length;
		if (organizer.memberEvents === memberEvents && organizer.completedEvents === completedEvents) continue;
		await (models.member as any).updateOne({ _id: organizer._id }, { $set: { memberEvents, completedEvents } }, { timestamps: false }).exec();
		changed++;
	}
	return changed;
};

/** documents that stay behind a removal because somebody else wrote them (reported, never touched) */
export const countLeftBehind = async (models: DemoModels, scope: Pick<DemoScope, 'memberIds' | 'eventIds'>): Promise<DemoCounts> => {
	const targets = [...scope.eventIds, ...scope.memberIds];
	const [comments, likes, views, follows] = await Promise.all([
		models.comment.countDocuments({ commentRefId: { $in: scope.eventIds } }).exec(),
		models.like.countDocuments({ likeRefId: { $in: targets } }).exec(),
		models.view.countDocuments({ viewRefId: { $in: targets } }).exec(),
		models.follow.countDocuments({ followingId: { $in: scope.memberIds } }).exec(),
	]);
	return { comments, likes, views, follows };
};
