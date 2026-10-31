/**
 * Records of other people that point at demo data (DECISIONS #132). Before `seed:demo` or `reset:demo` removes anything, this
 * counts, per collection, what NON-demo accounts wrote about demo events, venues and organizers: their orders and tickets,
 * refunds and payments, comments, likes and views, chat messages, notifications and their own events at a demo venue.
 *
 * "Non-demo" means: not an owned (manifest) account and not an ADMIN. Admins are on the seed's side on purpose: the seed itself
 * drives the admin flows (approvals, support chats, refunds), so the admin's messages and notifications belong to the demo data.
 *
 * The result is read-only. It also names the demo events, venues and organizers that these records need; `findDemoScope`
 * (libs/demo-manifest.ts) never removes those, whatever the flags say, and the seed script decides whether to go on at all.
 */
import { MemberType } from './enums/member.enum';
import { DEMO_EMAIL_PATTERN } from './demo-guards';
import type { DemoCounts, DemoModels } from './demo-manifest';

export const KEEP_LINKED_ENV = 'DEMO_SEED_KEEP_LINKED';

const idsOf = (docs: { _id: unknown }[]): unknown[] => docs.map((doc) => doc._id);
export const uniqueIds = (ids: unknown[]): unknown[] => [...new Map(ids.filter((id) => id != null).map((id) => [String(id), id])).values()];

/** what the manifest says the seed owns, with the orders on it */
export interface OwnedData {
	/** nothing is tracked: no seed ever ran here */
	empty: boolean;
	memberIds: unknown[];
	eventIds: unknown[];
	venueIds: unknown[];
	/** every order on an owned event or by an owned buyer */
	orders: { _id: unknown; buyerId: unknown; eventId: unknown }[];
}

const emptyOwned = (): OwnedData => ({ empty: true, memberIds: [], eventIds: [], venueIds: [], orders: [] });

/** Owned = in the manifest (members also need the demo email domain, never an ADMIN); events and venues of owned accounts count as owned too. */
export const findOwned = async (models: DemoModels): Promise<OwnedData> => {
	const tracked = async (type: string): Promise<unknown[]> => {
		const rows: { recordId: unknown }[] = await models.manifest.find({ recordType: type }).lean().exec();
		return rows.map((row) => row.recordId);
	};
	const [trackedMembers, trackedVenues, trackedEvents] = await Promise.all([tracked('Member'), tracked('Venue'), tracked('Event')]);
	if (!trackedMembers.length && !trackedVenues.length && !trackedEvents.length) return emptyOwned();

	const members = await models.member
		.find({ _id: { $in: trackedMembers }, memberEmail: DEMO_EMAIL_PATTERN, memberType: { $ne: MemberType.ADMIN } })
		.lean()
		.exec();
	const memberIds = idsOf(members);
	const [events, venues] = await Promise.all([
		models.event.find({ $or: [{ _id: { $in: trackedEvents } }, { organizerId: { $in: memberIds } }] }).lean().exec(),
		models.venue.find({ $or: [{ _id: { $in: trackedVenues } }, { memberId: { $in: memberIds } }] }).lean().exec(),
	]);
	const eventIds = idsOf(events);
	const orders = await models.order.find({ $or: [{ eventId: { $in: eventIds } }, { buyerId: { $in: memberIds } }] }).lean().exec();
	return { empty: false, memberIds, eventIds, venueIds: idsOf(venues), orders };
};

export interface LinkedRecords {
	/** records of non-demo accounts that point at demo data, per collection (0 for none) */
	counts: DemoCounts;
	total: number;
	/** the owned demo roots those records need */
	eventIds: unknown[];
	venueIds: unknown[];
	memberIds: unknown[];
}

export const LINKED_COLLECTIONS = ['orders', 'tickets', 'payments', 'refunds', 'comments', 'likes', 'views', 'messages', 'notifications', 'events'] as const;

const noLinks = (): LinkedRecords => ({
	counts: Object.fromEntries(LINKED_COLLECTIONS.map((name) => [name, 0])),
	total: 0,
	eventIds: [],
	venueIds: [],
	memberIds: [],
});

export const findLinkedRecords = async (models: DemoModels, owned?: OwnedData): Promise<LinkedRecords> => {
	owned = owned ?? (await findOwned(models));
	const result = noLinks();
	if (owned.empty) return result;

	const admins = await models.member.find({ memberType: MemberType.ADMIN }).lean().exec();
	const seedSide = new Set([...owned.memberIds, ...idsOf(admins)].map(String));
	const ownedMembers = new Set(owned.memberIds.map(String));
	const ownedEvents = new Set(owned.eventIds.map(String));
	const ownedVenues = new Set(owned.venueIds.map(String));
	// A stranger is an account that still exists and is neither a demo account nor an admin. A missing id, or an id whose account
	// is gone (a demo buyer an earlier reset removed), is nobody: the records it left on kept data are not "other accounts".
	let existing = new Set<string>();
	const foreign = (id: unknown): boolean => id != null && existing.has(String(id)) && !seedSide.has(String(id));

	const linkedEvents: unknown[] = [];
	const linkedMembers: unknown[] = [];
	const linkedVenues: unknown[] = [];
	const count = (name: (typeof LINKED_COLLECTIONS)[number], n: number): void => {
		result.counts[name] += n;
	};

	// orders on owned events that a non-demo account placed
	const foreignOrders = owned.orders.filter((order) => ownedEvents.has(String(order.eventId)) && !ownedMembers.has(String(order.buyerId)));
	const foreignOrderIds = idsOf(foreignOrders);
	count('orders', foreignOrders.length);
	linkedEvents.push(...foreignOrders.map((order) => order.eventId));

	const ownedEventList = owned.eventIds;
	const [tickets, payments, refunds, comments, likes, views, conversations, notifications, foreignEvents] = await Promise.all([
		models.ticket.find({ $or: [{ orderId: { $in: foreignOrderIds } }, { eventId: { $in: ownedEventList } }] }).lean().exec(),
		models.payment.find({ orderId: { $in: foreignOrderIds } }).lean().exec(),
		models.refund.find({ $or: [{ orderId: { $in: foreignOrderIds } }, { eventId: { $in: ownedEventList } }] }).lean().exec(),
		models.comment.find({ commentRefId: { $in: ownedEventList } }).lean().exec(),
		models.like.find({ likeRefId: { $in: [...ownedEventList, ...owned.memberIds] } }).lean().exec(),
		models.view.find({ viewRefId: { $in: [...ownedEventList, ...owned.memberIds] } }).lean().exec(),
		models.conversation.find({ $or: [{ organizerId: { $in: owned.memberIds } }, { eventId: { $in: ownedEventList } }] }).lean().exec(),
		models.notification
			.find({ $or: [{ eventId: { $in: ownedEventList } }, { orderId: { $in: idsOf(owned.orders) } }, { receiverId: { $in: owned.memberIds } }] })
			.lean()
			.exec(),
		models.event.find({ venueId: { $in: owned.venueIds }, organizerId: { $nin: owned.memberIds } }).lean().exec(),
	]);

	const isForeignOrder = (orderId: unknown): boolean => foreignOrderIds.some((id) => String(id) === String(orderId));
	const authorIds = uniqueIds([
		...tickets.map((row: any) => row.ownerId),
		...refunds.map((row: any) => row.buyerId),
		...comments.map((row: any) => row.memberId),
		...likes.map((row: any) => row.memberId),
		...views.map((row: any) => row.memberId),
		...notifications.flatMap((row: any) => [row.receiverId, row.authorId]),
	]);
	const people: any[] = authorIds.length ? await models.member.find({ _id: { $in: authorIds } }).lean().exec() : [];
	existing = new Set(idsOf(people).map(String));

	const foreignTickets = tickets.filter((ticket: any) => isForeignOrder(ticket.orderId) || (ticket.ownerId && foreign(ticket.ownerId)));
	count('tickets', foreignTickets.length);
	linkedEvents.push(...foreignTickets.map((ticket: any) => ticket.eventId));

	count('payments', payments.length);
	const foreignRefunds = refunds.filter((refund: any) => isForeignOrder(refund.orderId) || (refund.buyerId && foreign(refund.buyerId)));
	count('refunds', foreignRefunds.length);
	linkedEvents.push(...foreignRefunds.map((refund: any) => refund.eventId));

	const foreignComments = comments.filter((comment: any) => foreign(comment.memberId));
	count('comments', foreignComments.length);
	linkedEvents.push(...foreignComments.map((comment: any) => comment.commentRefId));

	for (const [name, rows, refKey] of [['likes', likes, 'likeRefId'], ['views', views, 'viewRefId']] as const) {
		const mine = (rows as any[]).filter((row) => foreign(row.memberId));
		count(name, mine.length);
		for (const row of mine) (ownedEvents.has(String(row[refKey])) ? linkedEvents : linkedMembers).push(row[refKey]);
	}

	// chat messages written by somebody who is neither a demo account nor an admin, in a conversation of a demo organizer
	const conversationIds = idsOf(conversations);
	const messages: any[] = conversationIds.length ? await models.message.find({ conversationId: { $in: conversationIds } }).lean().exec() : [];
	const senders: any[] = messages.length ? await models.member.find({ _id: { $in: uniqueIds(messages.map((row) => row.senderId)) } }).lean().exec() : [];
	senders.forEach((sender) => existing.add(String(sender._id)));
	const foreignMessages = messages.filter((message) => foreign(message.senderId));
	count('messages', foreignMessages.length);
	for (const message of foreignMessages) {
		const conversation: any = conversations.find((item: any) => String(item._id) === String(message.conversationId));
		if (conversation?.organizerId) linkedMembers.push(conversation.organizerId);
		if (conversation?.eventId) linkedEvents.push(conversation.eventId);
	}

	// notifications between a real person and demo data: a real receiver, or a real author
	const foreignNotes = notifications.filter((note: any) => foreign(note.receiverId) || (note.authorId && foreign(note.authorId)));
	count('notifications', foreignNotes.length);
	for (const note of foreignNotes) {
		if (note.eventId) linkedEvents.push(note.eventId);
		if (ownedMembers.has(String(note.receiverId))) linkedMembers.push(note.receiverId);
	}

	// events of other organizers at a demo venue
	count('events', foreignEvents.length);
	linkedVenues.push(...foreignEvents.map((event: any) => event.venueId));

	result.eventIds = uniqueIds(linkedEvents).filter((id) => ownedEvents.has(String(id)));
	result.memberIds = uniqueIds(linkedMembers).filter((id) => ownedMembers.has(String(id)));
	result.venueIds = uniqueIds(linkedVenues).filter((id) => ownedVenues.has(String(id)));
	result.total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
	return result;
};

/** one line per collection that has a record, for the dry run and the error; counts only */
export const formatLinkCounts = (counts: DemoCounts): string =>
	LINKED_COLLECTIONS.map((name) => `  ${name.padEnd(14)} ${counts[name] ?? 0}`).join('\n');

type Env = Record<string, string | undefined>;
export const isKeepLinked = (env: Env): boolean => String(env[KEEP_LINKED_ENV] ?? '').trim().toLowerCase() === 'true';

/**
 * The gate before a reset: refuses while records of other accounts point at demo data, unless the operator chose to keep the
 * linked demo records. The message lists the counts, names the flag and says nothing was changed.
 */
export const assertNoLinkedRecords = (links: Pick<LinkedRecords, 'counts' | 'total'>, env: Env, action: 'seed' | 'reset'): void => {
	if (links.total === 0 || isKeepLinked(env)) return;
	const nonZero = LINKED_COLLECTIONS.filter((name) => links.counts[name]).map((name) => `${name}: ${links.counts[name]}`);
	throw new Error(
		`Refusing to ${action} demo data: ${links.total} record(s) written by other accounts point at demo events, venues or organizers (${nonZero.join(', ')}). ` +
			`Nothing was changed. Look at the numbers with \`npm run ${action}:demo -- --dry-run\`. ` +
			`To go on and leave the linked demo events, venues and organizers in place (they are not reset), set ${KEEP_LINKED_ENV}=true.`,
	);
};
