import { DeletionBlockReason } from './enums/account.enum';
import { MemberStatus } from './enums/member.enum';

/** a deleted account keeps its email reserved for this many days (DECISIONS #123) */
export const EMAIL_REUSE_DAYS = 30;
/** the word a client must send to delete an account */
export const DELETE_CONFIRMATION_WORD = 'DELETE';
/** how many event names one blocking reason lists; the count is always the full number */
export const MAX_BLOCKING_EVENT_NAMES = 10;
/** what the public sees instead of a deleted member's nick */
export const DELETED_USER_NAME = 'Deleted user';

const DAY_MS = 24 * 60 * 60 * 1000;

export const getEmailReusableAt = (deletedAt: Date): Date => new Date(deletedAt.getTime() + EMAIL_REUSE_DAYS * DAY_MS);

/**
 * When a deleted account's email may be used again. `emailReusableAt` is the stored answer; for a record that has only
 * `deletedAt` it is computed; a record with neither has no waiting time.
 */
export const getReusableAtOf = (deleted: { emailReusableAt?: Date | null; deletedAt?: Date | null }): Date | null => {
	if (deleted.emailReusableAt) return new Date(deleted.emailReusableAt);
	if (deleted.deletedAt) return getEmailReusableAt(new Date(deleted.deletedAt));
	return null;
};

/** one reason with its full count and the first few event names (the organizer's own events) */
export interface DeletionBlocker {
	reason: DeletionBlockReason;
	count: number;
	eventNames: string[];
}

export const buildBlocker = (reason: DeletionBlockReason, count: number, names: string[]): DeletionBlocker | null =>
	count > 0 ? { reason, count, eventNames: names.slice(0, MAX_BLOCKING_EVENT_NAMES) } : null;

/**
 * The public never sees a deleted member's name, picture or texts: a comment shows "Deleted user". The record itself is not
 * changed; this masks a copy on the way out. Everything else public (id, type, counters) stays, so a client can still style it.
 */
export const maskDeletedMember = <T extends { memberStatus?: MemberStatus | string | null } | null | undefined>(member: T): T => {
	if (!member || member.memberStatus !== MemberStatus.DELETE) return member;
	return {
		...member,
		memberNick: DELETED_USER_NAME,
		memberImage: '',
		memberFullName: undefined,
		memberDesc: undefined,
		memberAddress: undefined,
	};
};
