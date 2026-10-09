import { Model, ObjectId } from 'mongoose';
import { Message } from './enums/common.enum';
import { EventStatus } from './enums/event.enum';
import { escapeRegExp } from './config';
import { PAYOUT_DEFAULT_TIMEZONE } from './payout';

/** statuses whose time slot is taken; DRAFT, REJECTED and CANCELLED do not block anybody */
export const venueBlockingStatuses = [EventStatus.PENDING, EventStatus.APPROVED, EventStatus.ENDED];

/** statuses for which the admin sees "possible conflicts at the same place" */
export const conflictWatchedStatuses = [EventStatus.PENDING, EventStatus.APPROVED];

type DateLike = Date | string;

/** [startA, endA) and [startB, endB) intersect; ranges that only touch do not */
export const rangesOverlap = (startA: DateLike, endA: DateLike, startB: DateLike, endB: DateLike): boolean =>
	new Date(startA).getTime() < new Date(endB).getTime() && new Date(endA).getTime() > new Date(startB).getTime();

/** trim, lowercase, punctuation and repeated spaces become one space ("Olympic  Hall!" and "olympic hall" match) */
export const normalizeVenueName = (name?: string | null): string =>
	(name ?? '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/** the city only gets trim, lowercase and collapsed whitespace, so a database prefilter by regex gives the same answer */
export const normalizeVenueCity = (city?: string | null): string => (city ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

interface PlaceLike {
	_id?: any;
	venueName?: string;
	venueCity?: string;
	venueCoordinates?: number[] | null;
}

const hasCoordinates = (venue: PlaceLike): boolean => Array.isArray(venue.venueCoordinates) && venue.venueCoordinates.length === 2;

/** same record, same coordinates, or same city and same normalized name */
export const looksLikeSamePlace = (a: PlaceLike, b: PlaceLike): boolean => {
	if (a._id && b._id && String(a._id) === String(b._id)) return true;
	if (hasCoordinates(a) && hasCoordinates(b) && a.venueCoordinates[0] === b.venueCoordinates[0] && a.venueCoordinates[1] === b.venueCoordinates[1]) {
		return true;
	}
	const name = normalizeVenueName(a.venueName);
	return !!name && name === normalizeVenueName(b.venueName) && !!normalizeVenueCity(a.venueCity) && normalizeVenueCity(a.venueCity) === normalizeVenueCity(b.venueCity);
};

/** "2026-12-01 19:00" on the wall clock of the venue, so the organizer reads the time they typed */
export const formatVenueTime = (at: DateLike, timeZone: string = PAYOUT_DEFAULT_TIMEZONE): string => {
	const format = (zone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
	try {
		return format(timeZone);
	} catch {
		return format(PAYOUT_DEFAULT_TIMEZONE);
	}
};

export const formatVenueBookedMessage = (clash: { eventTitle: string; startAt: DateLike; endAt: DateLike }, timeZone?: string): string =>
	Message.VENUE_ALREADY_BOOKED.replace('{title}', clash.eventTitle)
		.replace('{start}', formatVenueTime(clash.startAt, timeZone))
		.replace('{end}', formatVenueTime(clash.endAt, timeZone));

/** the filter for events of `venueId` whose slot intersects [startAt, endAt), except `excludeEventId` (the event itself) */
export const buildVenueClashFilter = (venueId: ObjectId, startAt: DateLike, endAt: DateLike, excludeEventId?: ObjectId) => ({
	venueId,
	eventStatus: { $in: venueBlockingStatuses },
	startAt: { $lt: new Date(endAt) },
	endAt: { $gt: new Date(startAt) },
	...(excludeEventId ? { _id: { $ne: excludeEventId } } : {}),
});

/** one item of Event.possibleVenueConflicts (admin only) */
export interface PossibleVenueConflict {
	eventId: ObjectId;
	eventTitle: string;
	eventStatus: EventStatus;
	organizerNick: string;
	venueName: string;
	startAt: Date;
	endAt: Date;
}

interface ConflictSource {
	_id: ObjectId;
	eventStatus: EventStatus;
	startAt: Date;
	endAt: Date;
	venueData?: PlaceLike | null;
	possibleVenueConflicts?: PossibleVenueConflict[] | null;
}

/**
 * Fills possibleVenueConflicts on a whole page with TWO queries, however many events it has:
 *  1. venues in the same city or at the same coordinates as a venue of the page (narrowed in JS to the same place)
 *  2. one events aggregation over those venues and the time ranges of the page, joined with the organizer nick
 * Only PENDING and APPROVED events with a venue are looked at; the rest stay null. Only call it for admins.
 */
export const attachPossibleVenueConflicts = async (
	events: ConflictSource[] | undefined,
	venueModel: Model<any>,
	eventModel: Model<any>,
): Promise<void> => {
	const sources = (events ?? []).filter((event) => conflictWatchedStatuses.includes(event.eventStatus) && event.venueData);
	if (!sources.length) return;

	const cityPatterns = [...new Set(sources.map((event) => normalizeVenueCity(event.venueData.venueCity)).filter(Boolean))].map(
		(city) => new RegExp(`^\\s*${city.split(' ').map(escapeRegExp).join('\\s+')}\\s*$`, 'i'),
	);
	const coordinates = sources.filter((event) => hasCoordinates(event.venueData)).map((event) => event.venueData.venueCoordinates);
	const venueFilter: any[] = [{ venueCity: { $in: cityPatterns } }];
	if (coordinates.length) venueFilter.push({ venueCoordinates: { $in: coordinates } });

	const candidateVenues: PlaceLike[] = await venueModel
		.find({ $or: venueFilter })
		.select('venueName venueCity venueCoordinates')
		.lean()
		.exec();
	const samePlaceVenues = candidateVenues.filter((venue) => sources.some((event) => looksLikeSamePlace(event.venueData, venue)));
	for (const event of sources) event.possibleVenueConflicts = [];
	if (!samePlaceVenues.length) return;

	const candidates: Array<{ _id: ObjectId; venueId: ObjectId; eventTitle: string; eventStatus: EventStatus; startAt: Date; endAt: Date; organizerNick?: string }> =
		await eventModel
			.aggregate([
				{
					$match: {
						eventStatus: { $in: venueBlockingStatuses },
						venueId: { $in: samePlaceVenues.map((venue) => venue._id) },
						$or: sources.map((event) => ({ startAt: { $lt: new Date(event.endAt) }, endAt: { $gt: new Date(event.startAt) } })),
					},
				},
				{ $lookup: { from: 'members', localField: 'organizerId', foreignField: '_id', as: 'organizer' } },
				{
					$project: {
						venueId: 1,
						eventTitle: 1,
						eventStatus: 1,
						startAt: 1,
						endAt: 1,
						organizerNick: { $arrayElemAt: ['$organizer.memberNick', 0] },
					},
				},
				{ $sort: { startAt: 1 } },
			])
			.exec();

	const venueById = new Map(samePlaceVenues.map((venue) => [String(venue._id), venue]));
	for (const event of sources) {
		event.possibleVenueConflicts = candidates
			.filter((candidate) => {
				const venue = venueById.get(String(candidate.venueId));
				return (
					String(candidate._id) !== String(event._id) &&
					rangesOverlap(event.startAt, event.endAt, candidate.startAt, candidate.endAt) &&
					!!venue &&
					looksLikeSamePlace(event.venueData, venue)
				);
			})
			.map((candidate) => ({
				eventId: candidate._id,
				eventTitle: candidate.eventTitle,
				eventStatus: candidate.eventStatus,
				organizerNick: candidate.organizerNick ?? '',
				venueName: venueById.get(String(candidate.venueId)).venueName,
				startAt: candidate.startAt,
				endAt: candidate.endAt,
			}));
	}
};
