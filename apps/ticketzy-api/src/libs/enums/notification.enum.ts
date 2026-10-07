import { registerEnumType } from '@nestjs/graphql';

export enum NotificationType {
	LIKE = 'LIKE',
	COMMENT = 'COMMENT',
	ORDER_PAID = 'ORDER_PAID',
	EVENT_REMINDER = 'EVENT_REMINDER',
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
