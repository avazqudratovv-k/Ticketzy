import { ObjectId, PipelineStage } from 'mongoose';
import { EventStatus } from './enums/event.enum';
import { PayoutStatus } from './enums/payout.enum';
import { OrderStatus } from './enums/ticket.enum';
import { getZoneOffsetMs } from './refund-policy';
import { T } from './types/common';

/** the organizer is paid this many days after the event ends */
export const PAYOUT_DELAY_DAYS = 3;
/** same default as the refund deadline (decision #55) */
export const PAYOUT_DEFAULT_TIMEZONE = 'Asia/Seoul';
/** events that can have a payout: a DRAFT, PENDING or REJECTED event was never on sale */
export const payoutEventStatuses = [EventStatus.APPROVED, EventStatus.ENDED, EventStatus.CANCELLED];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The payout date: the event end plus 3 calendar days on the wall clock of the venue timezone (same time of day, so a DST
 * change inside the 3 days does not move it by an hour). Returned as a UTC instant. Same result as MongoDB's
 * `$dateAdd` with a timezone, which `buildPayoutPipeline` uses for the filters.
 */
export const getPayoutDate = (endAt: Date | string, venueTimezone?: string | null): Date => {
	const timeZone = venueTimezone || PAYOUT_DEFAULT_TIMEZONE;
	const end = new Date(endAt);
	// the wall clock of the end as a plain number, three days later; then back to the instant that shows that wall clock
	const wallClock = end.getTime() + getZoneOffsetMs(end, timeZone) + PAYOUT_DELAY_DAYS * DAY_MS;
	const first = wallClock - getZoneOffsetMs(new Date(wallClock), timeZone);
	const second = wallClock - getZoneOffsetMs(new Date(first), timeZone);
	return new Date(second);
};

/**
 * Order matters: a recorded payout wins (its stored snapshot is final), then a net of 0 (nothing to pay, also every cancelled
 * event), then the date. Keep it in line with the `$switch` in buildPayoutPipeline.
 */
export const getPayoutStatus = (row: { paid: boolean; net: number; payoutDate: Date | string }, now: Date = new Date()): PayoutStatus => {
	if (row.paid) return PayoutStatus.PAID_OUT;
	if (row.net === 0) return PayoutStatus.NOTHING_TO_PAY;
	return new Date(row.payoutDate).getTime() > now.getTime() ? PayoutStatus.NOT_YET_DUE : PayoutStatus.DUE;
};

export interface PayoutPipelineOptions {
	now: Date;
	/** one event (mark as paid) */
	eventId?: ObjectId;
	organizerId?: ObjectId;
	/** events whose title (or translated title) matches; already escaped */
	titleRegex?: RegExp;
	dateFrom?: Date;
	dateTo?: Date;
	payoutStatus?: PayoutStatus;
	direction?: 1 | -1;
	/** undefined: all rows in one list (single event) */
	page?: { skip: number; limit: number };
	/** attach organizerNick and organizerEmail to the rows of the page (admin) */
	withOrganizer?: boolean;
}

/** the commission of the whole event is rounded once, half up, to whole won ($round would round halves to even) */
const zeroIfCancelled = (value: unknown) => ({ $cond: [{ $eq: ['$eventStatus', EventStatus.CANCELLED] }, 0, value] });

/**
 * One aggregation over `events`: payout date, live amounts from the PAID orders (the commission stored on each order),
 * the recorded payout if any, and the computed status. The status filter and the totals run on the computed status in the
 * database, nothing is loaded and filtered in memory. Needs MongoDB 5.0+ for `$dateAdd` with a timezone.
 */
export const buildPayoutPipeline = (options: PayoutPipelineOptions): PipelineStage[] => {
	const match: T = { eventStatus: { $in: payoutEventStatuses } };
	if (options.eventId) match._id = options.eventId;
	if (options.organizerId) match.organizerId = options.organizerId;
	if (options.titleRegex) match.$or = [{ eventTitle: options.titleRegex }, { 'eventTranslations.title': options.titleRegex }];

	const dateMatch: T = {};
	if (options.dateFrom) dateMatch.$gte = options.dateFrom;
	if (options.dateTo) dateMatch.$lte = options.dateTo;

	const statusMatch: T[] = options.payoutStatus ? [{ $match: { payoutStatus: options.payoutStatus } }] : [];
	const pageStages: T[] = options.page ? [{ $skip: options.page.skip }, { $limit: options.page.limit }] : [];
	const organizerStages: T[] = options.withOrganizer
		? [
				{
					$lookup: {
						from: 'members',
						let: { organizerId: '$organizerId' },
						pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$organizerId'] } } }, { $project: { memberNick: 1, memberEmail: 1 } }],
						as: 'organizer',
					},
				},
				{
					$addFields: {
						organizerNick: { $arrayElemAt: ['$organizer.memberNick', 0] },
						organizerEmail: { $arrayElemAt: ['$organizer.memberEmail', 0] },
					},
				},
			]
		: [];

	const stages: T[] = [
		{ $match: match },
		{
			$lookup: {
				from: 'venues',
				let: { venueId: '$venueId' },
				pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$venueId'] } } }, { $project: { venueTimezone: 1 } }],
				as: 'venue',
			},
		},
		{
			$addFields: {
				venueTimezone: {
					$let: {
						vars: { zone: { $ifNull: [{ $arrayElemAt: ['$venue.venueTimezone', 0] }, ''] } },
						in: { $cond: [{ $gt: [{ $strLenCP: '$$zone' }, 0] }, '$$zone', PAYOUT_DEFAULT_TIMEZONE] },
					},
				},
			},
		},
		{ $addFields: { payoutDate: { $dateAdd: { startDate: '$endAt', unit: 'day', amount: PAYOUT_DELAY_DAYS, timezone: '$venueTimezone' } } } },
		...(Object.keys(dateMatch).length ? [{ $match: { payoutDate: dateMatch } }] : []),
		{
			$lookup: {
				from: 'orders',
				let: { eventId: '$_id' },
				pipeline: [
					{ $match: { $expr: { $eq: ['$eventId', '$$eventId'] }, orderStatus: OrderStatus.PAID } },
					{ $group: { _id: null, gross: { $sum: '$totalAmount' }, commission: { $sum: '$commissionAmount' }, orderCount: { $sum: 1 } } },
				],
				as: 'liveOrders',
			},
		},
		{ $lookup: { from: 'payouts', localField: '_id', foreignField: 'eventId', as: 'payouts' } },
		{
			$addFields: {
				payout: { $arrayElemAt: ['$payouts', 0] },
				live: { $arrayElemAt: ['$liveOrders', 0] },
			},
		},
		{
			// a recorded payout is a snapshot and is shown as it was stored; otherwise the live numbers (0 for a cancelled event)
			$addFields: {
				gross: { $ifNull: ['$payout.gross', zeroIfCancelled({ $ifNull: ['$live.gross', 0] })] },
				commission: { $ifNull: ['$payout.commission', zeroIfCancelled({ $floor: { $add: [{ $ifNull: ['$live.commission', 0] }, 0.5] } })] },
				orderCount: { $ifNull: ['$payout.orderCount', zeroIfCancelled({ $ifNull: ['$live.orderCount', 0] })] },
			},
		},
		{ $addFields: { net: { $ifNull: ['$payout.net', { $subtract: ['$gross', '$commission'] }] } } },
		{
			$addFields: {
				payoutStatus: {
					$switch: {
						branches: [
							{ case: { $ne: [{ $type: '$payout' }, 'missing'] }, then: PayoutStatus.PAID_OUT },
							{ case: { $eq: ['$net', 0] }, then: PayoutStatus.NOTHING_TO_PAY },
							{ case: { $gt: ['$payoutDate', options.now] }, then: PayoutStatus.NOT_YET_DUE },
						],
						default: PayoutStatus.DUE,
					},
				},
			},
		},
		{
			$project: {
				_id: 0,
				payoutId: '$payout._id',
				eventId: '$_id',
				eventTitle: 1,
				eventStatus: 1,
				organizerId: 1,
				startAt: 1,
				endAt: 1,
				venueTimezone: 1,
				payoutDate: 1,
				payoutStatus: 1,
				gross: 1,
				commission: 1,
				net: 1,
				orderCount: 1,
				paidAt: '$payout.paidAt',
				paidBy: '$payout.paidBy',
				note: '$payout.note',
			},
		},
		{ $sort: { payoutDate: options.direction ?? -1, eventId: -1 } },
		{
			$facet: {
				list: [...statusMatch, ...pageStages, ...organizerStages],
				metaCounter: [...statusMatch, { $count: 'total' }],
				// the totals ignore the status filter, so the tabs of a screen stay consistent; every other filter applies
				totals: [{ $group: { _id: '$payoutStatus', net: { $sum: '$net' } } }],
			},
		},
	];
	return stages as PipelineStage[];
};

/** turns the `totals` branch of the facet into the three numbers of the screen */
export const shapePayoutTotals = (rows: { _id: PayoutStatus; net: number }[] = []) => {
	const net = (status: PayoutStatus) => rows.find((row) => row._id === status)?.net ?? 0;
	return { totalPaidOut: net(PayoutStatus.PAID_OUT), totalDue: net(PayoutStatus.DUE), totalUpcoming: net(PayoutStatus.NOT_YET_DUE) };
};
