import { CodedException } from './coded-exception';
import { Message } from './enums/common.enum';
import { EventStatus, publicEventStatus } from './enums/event.enum';

/**
 * Public visibility of an event (#121): APPROVED and not ended. "Ended" is decided by comparing `endAt` with the clock, never
 * by waiting for the batch job that sets ENDED (#39, #102), so an APPROVED event past its end time is already hidden.
 */
export const isEventEnded = (event: { eventStatus?: EventStatus; endAt?: Date | string | null }, now: Date = new Date()): boolean =>
	event.eventStatus === EventStatus.ENDED || (!!event.endAt && new Date(event.endAt).getTime() <= now.getTime());

/** `$match` filter for the events collection: public status and `endAt` still ahead */
export const publicEventFilter = (now: Date = new Date()) => ({ eventStatus: publicEventStatus, endAt: { $gt: now } });

/** the same filter for a joined path, for example `publicEventFilterAt('favoriteEvent')` */
export const publicEventFilterAt = (prefix: string, now: Date = new Date()) => ({
	[`${prefix}.eventStatus`]: publicEventStatus,
	[`${prefix}.endAt`]: { $gt: now },
});

export type PublicEventState = 'PUBLIC' | 'ENDED' | 'HIDDEN';

/**
 * What the public may know about an event: PUBLIC (APPROVED, not ended), ENDED (APPROVED past its end, or ENDED: a typed
 * answer without details) or HIDDEN (draft, pending, rejected, cancelled: the same answer as a missing event).
 */
export const getPublicEventState = (event: { eventStatus?: EventStatus; endAt?: Date | string | null }, now: Date = new Date()): PublicEventState => {
	if (event.eventStatus !== publicEventStatus && event.eventStatus !== EventStatus.ENDED) return 'HIDDEN';
	return isEventEnded(event, now) ? 'ENDED' : 'PUBLIC';
};

/** the answer for an ended event: code EVENT_ENDED, no event data (the frontend shows "This event has ended") */
export const eventEndedException = (): CodedException => new CodedException(Message.EVENT_ENDED, 'EVENT_ENDED', 410);
