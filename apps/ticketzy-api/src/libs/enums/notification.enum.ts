import { registerEnumType } from '@nestjs/graphql';

export enum NotificationType {
	LIKE = 'LIKE',
	COMMENT = 'COMMENT',
	ORDER_PAID = 'ORDER_PAID',
	EVENT_REMINDER = 'EVENT_REMINDER',
	ORGANIZER_VERIFIED = 'ORGANIZER_VERIFIED',
	ORGANIZER_REJECTED = 'ORGANIZER_REJECTED',
	ORGANIZER_SUSPENDED = 'ORGANIZER_SUSPENDED',
	ORGANIZER_REINSTATED = 'ORGANIZER_REINSTATED',
	COMMISSION_UPDATED = 'COMMISSION_UPDATED',
	EVENT_APPROVED = 'EVENT_APPROVED',
	EVENT_REJECTED = 'EVENT_REJECTED',
	EVENT_CANCELLED = 'EVENT_CANCELLED',
}
registerEnumType(NotificationType, {
	name: 'NotificationType',
});

export enum NotificationStatus {
	WAIT = 'WAIT',
	READ = 'READ',
}
registerEnumType(NotificationStatus, {
	name: 'NotificationStatus',
});

export enum NotificationGroup {
	MEMBER = 'MEMBER',
	EVENT = 'EVENT',
	ORDER = 'ORDER',
}
registerEnumType(NotificationGroup, {
	name: 'NotificationGroup',
});
