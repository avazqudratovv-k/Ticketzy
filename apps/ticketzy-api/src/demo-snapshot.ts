/**
 * Reads the demo data out of MongoDB into the numbers `evaluateDemoConsistency` compares, and counts the documents for the
 * report. Read only. Every query is limited to the demo scope: members in the manifest with a demo email, their events, and
 * what hangs off those.
 */
import { Model } from 'mongoose';
import { DEMO_EMAIL_PATTERN } from './libs/demo-guards';
import { QA_NAME_PATTERNS } from './libs/demo-data';
import { DemoModels, getTrackedIds } from './libs/demo-manifest';
import { DemoSnapshot } from './libs/demo-consistency';
import { buildPayoutPipeline } from './libs/payout';
import { MemberType } from './libs/enums/member.enum';
import { OrderStatus, PaymentStatus } from './libs/enums/ticket.enum';
import { CommentStatus } from './libs/enums/comment.enum';
import { PayoutStatus } from './libs/enums/payout.enum';

export type DemoMongoModels = { [K in keyof DemoModels]: Model<any> };

const str = (value: unknown): string => String(value);

/** ids of what the demo owns right now */
export const findOwnedIds = async (models: DemoMongoModels) => {
	const tracked = await getTrackedIds(models, 'Member');
	const members: any[] = await models.member
		.find({ _id: { $in: tracked }, memberEmail: DEMO_EMAIL_PATTERN, memberType: { $ne: MemberType.ADMIN } })
		.lean()
		.exec();
	const memberIds = members.map((member) => member._id);
	const events: any[] = await models.event
		.find({ $or: [{ _id: { $in: await getTrackedIds(models, 'Event') } }, { organizerId: { $in: memberIds } }] })
		.lean()
		.exec();
	return { members, memberIds, events, eventIds: events.map((event) => event._id) };
};

export const loadDemoSnapshot = async (models: DemoMongoModels, now: Date = new Date()): Promise<DemoSnapshot> => {
	const { members, memberIds, events, eventIds } = await findOwnedIds(models);
	const targetIds = [...eventIds, ...memberIds];
	const organizerOf = new Map(events.map((event) => [str(event._id), str(event.organizerId)]));
	const venueIds = await getTrackedIds(models, 'Venue');

	const [ticketTypes, orderRows, seatRows, ticketRows, orderDocs, payouts, likeRows, viewRows, commentRows, followerRows, followingRows, conversations] =
		await Promise.all([
			models.ticketType.find({ eventId: { $in: eventIds } }).select('eventId totalQuantity soldQuantity ticketTypeStatus').lean().exec(),
			models.order
				.aggregate([
					{ $match: { eventId: { $in: eventIds } } },
					{ $group: { _id: { id: '$eventId', status: '$orderStatus' }, count: { $sum: 1 }, tickets: { $sum: { $sum: '$items.quantity' } } } },
				])
				.exec(),
			models.eventSeat.aggregate([{ $match: { eventId: { $in: eventIds } } }, { $group: { _id: { id: '$eventId', status: '$seatStatus' }, count: { $sum: 1 } } }]).exec(),
			models.ticket.aggregate([{ $match: { eventId: { $in: eventIds } } }, { $group: { _id: { id: '$eventId', status: '$ticketStatus' }, count: { $sum: 1 } } }]).exec(),
			models.order
				.find({ eventId: { $in: eventIds }, orderStatus: { $in: [OrderStatus.PAID, OrderStatus.REFUNDED] } })
				.select('eventId orderStatus subtotal totalAmount commissionRate commissionAmount paidAt')
				.sort({ paidAt: 1, _id: 1 })
				.lean()
				.exec(),
			models.payout.find({ eventId: { $in: eventIds } }).lean().exec(),
			models.like.aggregate([{ $match: { likeRefId: { $in: targetIds } } }, { $group: { _id: { id: '$likeRefId', status: '$likeGroup' }, count: { $sum: 1 } } }]).exec(),
			models.view.aggregate([{ $match: { viewRefId: { $in: targetIds } } }, { $group: { _id: { id: '$viewRefId', status: '$viewGroup' }, count: { $sum: 1 } } }]).exec(),
			models.comment
				.aggregate([{ $match: { commentRefId: { $in: eventIds }, commentStatus: CommentStatus.ACTIVE } }, { $group: { _id: { id: '$commentRefId' }, count: { $sum: 1 } } }])
				.exec(),
			models.follow.aggregate([{ $match: { followingId: { $in: memberIds } } }, { $group: { _id: { id: '$followingId' }, count: { $sum: 1 } } }]).exec(),
			models.follow.aggregate([{ $match: { followerId: { $in: memberIds } } }, { $group: { _id: { id: '$followerId' }, count: { $sum: 1 } } }]).exec(),
			models.conversation.find({ organizerId: { $in: memberIds } }).lean().exec(),
		]);

	const rows = (list: any[]) => list.map((row) => ({ id: str(row._id.id), status: row._id.status ? str(row._id.status) : undefined, count: row.count as number }));
	const groupBy = (list: any[], group: string) => rows(list.filter((row) => row._id.status === group));

	// money: the commission is the subtotal times the rate, rounded to cents like calculateOrderAmounts
	const badMoneyOrders = orderDocs.filter(
		(order: any) =>
			order.totalAmount !== order.subtotal || Math.abs(order.commissionAmount - Math.round((order.subtotal * order.commissionRate) / 100 * 100) / 100) > 0.005,
	).length;

	const paidIds = (await models.order.find({ eventId: { $in: eventIds }, orderStatus: OrderStatus.PAID }).select('_id').lean().exec()).map((order: any) => order._id);
	const captured: any[] = await models.payment.find({ orderId: { $in: paidIds }, paymentStatus: PaymentStatus.CAPTURED }).select('orderId').lean().exec();
	const capturedSet = new Set(captured.map((payment) => str(payment.orderId)));
	const paidOrdersWithoutPayment = paidIds.filter((id: unknown) => !capturedSet.has(str(id))).length;

	const rateMap = new Map<string, number[]>();
	for (const order of orderDocs as any[]) {
		const organizerId = organizerOf.get(str(order.eventId));
		if (organizerId) rateMap.set(organizerId, [...(rateMap.get(organizerId) ?? []), order.commissionRate]);
	}

	// the statuses come from the same aggregation the payout screens use
	const organizers = members.filter((member) => member.memberType === MemberType.ORGANIZER);
	const payoutStatuses: DemoSnapshot['payoutStatuses'] = [];
	for (const organizer of organizers) {
		const [result] = await models.event.aggregate(buildPayoutPipeline({ now, organizerId: organizer._id })).exec();
		payoutStatuses.push({ organizerId: str(organizer._id), statuses: (result?.list ?? []).map((row: any) => row.payoutStatus as PayoutStatus) });
	}

	const conversationIds = conversations.map((conversation: any) => conversation._id);
	const unread: any[] = await models.message
		.aggregate([{ $match: { conversationId: { $in: conversationIds }, readAt: null } }, { $group: { _id: { c: '$conversationId', s: '$senderId' }, count: { $sum: 1 } } }])
		.exec();

	const rich = members.find((member) => member.memberEmail === 'organizer@ticketzy.demo');
	return {
		now,
		members: members.map((member) => ({
			_id: str(member._id),
			memberType: member.memberType,
			memberStatus: member.memberStatus,
			completedEvents: member.completedEvents ?? 0,
			memberEvents: member.memberEvents ?? 0,
			memberFollowers: member.memberFollowers ?? 0,
			memberFollowings: member.memberFollowings ?? 0,
			memberLikes: member.memberLikes ?? 0,
			memberViews: member.memberViews ?? 0,
			memberRank: member.memberRank ?? 0,
		})),
		venueCount: await models.venue.countDocuments({ _id: { $in: venueIds } }).exec(),
		events: events.map((event) => ({
			_id: str(event._id),
			organizerId: str(event.organizerId),
			eventStatus: event.eventStatus,
			eventLikes: event.eventLikes ?? 0,
			eventViews: event.eventViews ?? 0,
			eventComments: event.eventComments ?? 0,
			eventRank: event.eventRank ?? 0,
			startAt: new Date(event.startAt),
			endAt: new Date(event.endAt),
			saleStartAt: event.saleStartAt ? new Date(event.saleStartAt) : undefined,
			rejectReason: event.rejectReason,
			cancelReason: event.cancelReason,
			imageCount: (event.eventImages ?? []).length,
		})),
		ticketTypes: ticketTypes.map((type: any) => ({
			eventId: str(type.eventId),
			totalQuantity: type.totalQuantity,
			soldQuantity: type.soldQuantity ?? 0,
			ticketTypeStatus: type.ticketTypeStatus,
		})),
		orders: orderRows.map((row: any) => ({ id: str(row._id.id), status: str(row._id.status), count: row.count, tickets: row.tickets })),
		seats: rows(seatRows),
		tickets: rows(ticketRows),
		badMoneyOrders,
		paidOrdersWithoutPayment,
		rates: [...rateMap].map(([organizerId, rates]) => ({ organizerId, rates })),
		payouts: payouts.map((payout: any) => ({
			eventId: str(payout.eventId),
			eventStatus: events.find((event) => str(event._id) === str(payout.eventId))?.eventStatus,
			gross: payout.gross,
			commission: payout.commission,
			net: payout.net,
		})),
		payoutStatuses,
		eventLikes: groupBy(likeRows, 'EVENT'),
		memberLikes: groupBy(likeRows, 'MEMBER'),
		eventViews: groupBy(viewRows, 'EVENT'),
		memberViews: groupBy(viewRows, 'MEMBER'),
		activeComments: rows(commentRows),
		followers: rows(followerRows),
		followings: rows(followingRows),
		conversations: conversations.map((conversation: any) => {
			const own = str(conversation.organizerId);
			const count = (fromOrganizer: boolean) =>
				unread
					.filter((row) => str(row._id.c) === str(conversation._id) && (str(row._id.s) === own) === fromOrganizer)
					.reduce((total, row) => total + row.count, 0);
			return {
				id: str(conversation._id),
				unreadForOrganizer: conversation.unreadForOrganizer ?? 0,
				unreadForAdmin: conversation.unreadForAdmin ?? 0,
				unreadFromAdmin: count(false),
				unreadFromOrganizer: count(true),
			};
		}),
		richOrganizerId: rich ? str(rich._id) : undefined,
	};
};

/** counts per collection for the report; numbers only */
export const countDemoDocuments = async (models: DemoMongoModels): Promise<Record<string, number>> => {
	const { members, memberIds, events, eventIds } = await findOwnedIds(models);
	const orderIds = (await models.order.find({ eventId: { $in: eventIds } }).select('_id').lean().exec()).map((order: any) => order._id);
	const conversationIds = (await models.conversation.find({ organizerId: { $in: memberIds } }).select('_id').lean().exec()).map((row: any) => row._id);
	const count = (model: Model<any>, filter: any): Promise<number> => model.countDocuments(filter).exec();
	const byStatus = (list: any[], field: string, value: string): number => list.filter((item) => item[field] === value).length;

	const [venues, ticketTypes, seats, soldSeats, orders, paidOrders, tickets, usedTickets, payments, refunds, payouts, likes, views, comments, follows, conversations, messages, notifications, auditLogs] =
		await Promise.all([
			count(models.venue, { _id: { $in: await getTrackedIds(models, 'Venue') } }),
			count(models.ticketType, { eventId: { $in: eventIds } }),
			count(models.eventSeat, { eventId: { $in: eventIds } }),
			count(models.eventSeat, { eventId: { $in: eventIds }, seatStatus: 'SOLD' }),
			count(models.order, { eventId: { $in: eventIds } }),
			count(models.order, { eventId: { $in: eventIds }, orderStatus: OrderStatus.PAID }),
			count(models.ticket, { eventId: { $in: eventIds } }),
			count(models.ticket, { eventId: { $in: eventIds }, ticketStatus: 'USED' }),
			count(models.payment, { orderId: { $in: orderIds } }),
			count(models.refund, { eventId: { $in: eventIds } }),
			count(models.payout, { eventId: { $in: eventIds } }),
			count(models.like, { likeRefId: { $in: [...eventIds, ...memberIds] } }),
			count(models.view, { viewRefId: { $in: [...eventIds, ...memberIds] } }),
			count(models.comment, { commentRefId: { $in: eventIds } }),
			count(models.follow, { followingId: { $in: memberIds } }),
			count(models.conversation, { _id: { $in: conversationIds } }),
			count(models.message, { conversationId: { $in: conversationIds } }),
			count(models.notification, {
				$or: [{ receiverId: { $in: memberIds } }, { eventId: { $in: eventIds } }, { orderId: { $in: orderIds } }, { conversationId: { $in: conversationIds } }],
			}),
			count(models.auditLog, { $or: [{ actorId: { $in: memberIds } }, { targetId: { $in: [...memberIds, ...eventIds, ...orderIds, ...conversationIds] } }] }),
		]);

	return {
		buyers: byStatus(members, 'memberType', MemberType.USER),
		organizers: byStatus(members, 'memberType', MemberType.ORGANIZER),
		venues,
		events: events.length,
		ticketTypes,
		eventSeats: seats,
		soldSeats,
		orders,
		paidOrders,
		tickets,
		checkedInTickets: usedTickets,
		payments,
		refunds,
		payouts,
		likes,
		views,
		comments,
		follows,
		conversations,
		messages,
		notifications,
		auditLogs,
	};
};

/** Records that look like test data somebody left behind. Reported, never changed or deleted: only the manifest decides what a reset removes. */
export const findProbableQaData = async (models: DemoMongoModels): Promise<Record<string, string[]>> => {
	const tracked = {
		member: await getTrackedIds(models, 'Member'),
		venue: await getTrackedIds(models, 'Venue'),
		event: await getTrackedIds(models, 'Event'),
	};
	const match = (field: string) => ({ $or: QA_NAME_PATTERNS.map((pattern) => ({ [field]: pattern })) });
	const [venues, events, members] = await Promise.all([
		models.venue.find({ _id: { $nin: tracked.venue }, ...match('venueName') }).select('venueName').limit(20).lean().exec(),
		models.event.find({ _id: { $nin: tracked.event }, ...match('eventTitle') }).select('eventTitle').limit(20).lean().exec(),
		models.member.find({ _id: { $nin: tracked.member }, ...match('memberNick') }).select('memberNick').limit(20).lean().exec(),
	]);
	return {
		venues: venues.map((venue: any) => venue.venueName),
		events: events.map((event: any) => event.eventTitle),
		members: members.map((member: any) => member.memberNick),
	};
};
