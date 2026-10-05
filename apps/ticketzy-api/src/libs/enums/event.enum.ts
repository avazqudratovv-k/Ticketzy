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
	PUBLISHED = 'PUBLISHED',
	ON_SALE = 'ON_SALE',
	SOLD_OUT = 'SOLD_OUT',
	CANCELLED = 'CANCELLED',
	FINISHED = 'FINISHED',
	DELETE = 'DELETE',
}
registerEnumType(EventStatus, {
	name: 'EventStatus',
});

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

/** Statuses shown in public listings / detail pages */
export const listedEventStatuses = [EventStatus.PUBLISHED, EventStatus.ON_SALE, EventStatus.SOLD_OUT];
export const viewableEventStatuses = [...listedEventStatuses, EventStatus.FINISHED];
