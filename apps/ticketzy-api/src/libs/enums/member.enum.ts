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

/** admin actions on an organizer and the statuses they may start from */
export const organizerTransitions = {
	verify: { from: [MemberStatus.PENDING], to: MemberStatus.ACTIVE },
	reject: { from: [MemberStatus.PENDING], to: MemberStatus.REJECTED },
	suspend: { from: [MemberStatus.ACTIVE], to: MemberStatus.SUSPENDED },
	reinstate: { from: [MemberStatus.SUSPENDED, MemberStatus.REJECTED], to: MemberStatus.ACTIVE },
};
export type OrganizerAction = keyof typeof organizerTransitions;

/** accounts that cannot log in or use a token */
export const unverifiedMemberStatuses = [MemberStatus.REJECTED, MemberStatus.SUSPENDED, MemberStatus.DELETE];

export enum MemberAuthType {
	PHONE = 'PHONE',
	EMAIL = 'EMAIL',
}
registerEnumType(MemberAuthType, {
	name: 'MemberAuthType',
});
