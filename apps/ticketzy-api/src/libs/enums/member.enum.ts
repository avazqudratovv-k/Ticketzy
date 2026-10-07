import { registerEnumType } from '@nestjs/graphql';

export enum MemberType {
	USER = 'USER',
	ORGANIZER = 'ORGANIZER',
	ADMIN = 'ADMIN',
}
registerEnumType(MemberType, {
	name: 'MemberType',
});

export enum MemberStatus {
	PENDING = 'PENDING',
	ACTIVE = 'ACTIVE',
	REJECTED = 'REJECTED',
	SUSPENDED = 'SUSPENDED',
	DELETE = 'DELETE',
}
registerEnumType(MemberStatus, {
	name: 'MemberStatus',
});

/** accounts that cannot log in or use a token */
export const unverifiedMemberStatuses = [MemberStatus.REJECTED, MemberStatus.SUSPENDED, MemberStatus.DELETE];

export enum MemberAuthType {
	PHONE = 'PHONE',
	EMAIL = 'EMAIL',
}
registerEnumType(MemberAuthType, {
	name: 'MemberAuthType',
});
