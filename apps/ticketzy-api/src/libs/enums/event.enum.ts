import { registerEnumType } from '@nestjs/graphql';

export enum EventCategory {
	CONCERT = 'CONCERT',
	SPORT = 'SPORT',
	THEATER = 'THEATER',
	CONFERENCE = 'CONFERENCE',
	FESTIVAL = 'FESTIVAL',
	OTHER = 'OTHER',
}
registerEnumType(EventCategory, {
	name: 'EventCategory',
});

export enum EventStatus {
	DRAFT = 'DRAFT',
	PENDING = 'PENDING',
	APPROVED = 'APPROVED',
	REJECTED = 'REJECTED',
	CANCELLED = 'CANCELLED',
	ENDED = 'ENDED',
}
registerEnumType(EventStatus, {
	name: 'EventStatus',
});

export enum SeatingType {
	GENERAL = 'GENERAL',
	RESERVED = 'RESERVED',
}
registerEnumType(SeatingType, {
	name: 'SeatingType',
});

export enum EventLocale {
	EN = 'en',
	KO = 'ko',
	RU = 'ru',
	UZ = 'uz',
}
registerEnumType(EventLocale, {
	name: 'EventLocale',
});

/** the only status that public queries (list, detail, favorites, visited, likes, orders) can see */
export const publicEventStatus = EventStatus.APPROVED;

/** statuses in which the organizer may edit; editing an APPROVED event sends it back to PENDING */
export const editableEventStatuses = [EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.APPROVED];

/** statuses that can no longer change (ticket types are frozen too) */
export const closedEventStatuses = [EventStatus.CANCELLED, EventStatus.ENDED];

/** actions on an event and the statuses they may start from */
export const eventTransitions = {
	submit: { from: [EventStatus.DRAFT, EventStatus.REJECTED], to: EventStatus.PENDING },
	approve: { from: [EventStatus.PENDING], to: EventStatus.APPROVED },
	reject: { from: [EventStatus.PENDING], to: EventStatus.REJECTED },
	cancel: { from: [EventStatus.APPROVED], to: EventStatus.CANCELLED },
	end: { from: [EventStatus.APPROVED], to: EventStatus.ENDED },
};
export type EventAction = keyof typeof eventTransitions;

export enum VenueType {
	STADIUM = 'STADIUM',
	THEATER = 'THEATER',
	CLUB = 'CLUB',
	HALL = 'HALL',
	OPEN_AIR = 'OPEN_AIR',
	ONLINE = 'ONLINE',
}
registerEnumType(VenueType, {
	name: 'VenueType',
});

export enum VenueStatus {
	ACTIVE = 'ACTIVE',
	CLOSED = 'CLOSED',
	DELETE = 'DELETE',
}
registerEnumType(VenueStatus, {
	name: 'VenueStatus',
});

export enum SectionKind {
	SEATED = 'SEATED',
	STANDING = 'STANDING',
}
registerEnumType(SectionKind, {
	name: 'SectionKind',
});

export enum SectionSpacing {
	COMPACT = 'COMPACT',
	NORMAL = 'NORMAL',
	WIDE = 'WIDE',
}
registerEnumType(SectionSpacing, {
	name: 'SectionSpacing',
});

export enum SeatStatus {
	AVAILABLE = 'AVAILABLE',
	HELD = 'HELD',
	SOLD = 'SOLD',
}
registerEnumType(SeatStatus, {
	name: 'SeatStatus',
});
