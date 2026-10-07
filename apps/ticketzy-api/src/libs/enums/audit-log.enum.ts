import { registerEnumType } from '@nestjs/graphql';

export enum AuditAction {
	ORGANIZER_VERIFIED = 'ORGANIZER_VERIFIED',
	ORGANIZER_REJECTED = 'ORGANIZER_REJECTED',
	ORGANIZER_SUSPENDED = 'ORGANIZER_SUSPENDED',
	ORGANIZER_REINSTATED = 'ORGANIZER_REINSTATED',
	COMMISSION_OVERRIDE_SET = 'COMMISSION_OVERRIDE_SET',
}
registerEnumType(AuditAction, {
	name: 'AuditAction',
});

export enum AuditTargetType {
	MEMBER = 'MEMBER',
}
registerEnumType(AuditTargetType, {
	name: 'AuditTargetType',
});
