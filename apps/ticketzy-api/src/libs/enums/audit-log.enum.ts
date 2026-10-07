import { registerEnumType } from '@nestjs/graphql';

export enum AuditAction {
	ORGANIZER_VERIFIED = 'ORGANIZER_VERIFIED',
	ORGANIZER_REJECTED = 'ORGANIZER_REJECTED',
	ORGANIZER_SUSPENDED = 'ORGANIZER_SUSPENDED',
	ORGANIZER_REINSTATED = 'ORGANIZER_REINSTATED',
	COMMISSION_OVERRIDE_SET = 'COMMISSION_OVERRIDE_SET',
	EVENT_APPROVED = 'EVENT_APPROVED',
	EVENT_REJECTED = 'EVENT_REJECTED',
	EVENT_CANCELLED = 'EVENT_CANCELLED',
}
registerEnumType(AuditAction, {
	name: 'AuditAction',
});

export enum AuditTargetType {
	MEMBER = 'MEMBER',
	EVENT = 'EVENT',
}
registerEnumType(AuditTargetType, {
	name: 'AuditTargetType',
});
