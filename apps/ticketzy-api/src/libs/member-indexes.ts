/**
 * The unique indexes on `members` (DECISIONS #123). A deleted account keeps its email and phone, so uniqueness can no longer
 * be "one member per email". Each unique index now also holds `deletedAt`: a live account has no `deletedAt` (stored as null),
 * so two live accounts with one email collide, while a deleted account (it has a `deletedAt`) never collides with a live one or
 * with another deleted one. This needs no partial filter (the operators a partial filter may use differ between MongoDB
 * versions) and no change to existing documents. `memberNick` keeps its plain unique index: a deleted nick stays reserved.
 * The schema and the one-off migration script both read these specs, so the names and options always match.
 */
export interface MemberIndexSpec {
	name: string;
	key: Record<string, 1>;
	unique: true;
	sparse?: true;
}

export const MEMBER_EMAIL_INDEX: MemberIndexSpec = { name: 'memberEmail_1_deletedAt_1', key: { memberEmail: 1, deletedAt: 1 }, unique: true };
export const MEMBER_PHONE_INDEX: MemberIndexSpec = { name: 'memberPhone_1_deletedAt_1', key: { memberPhone: 1, deletedAt: 1 }, unique: true, sparse: true };

/** the indexes this change replaces: the old single-field unique indexes (Mongoose default names) */
export const OLD_MEMBER_EMAIL_INDEX_NAME = 'memberEmail_1';
export const OLD_MEMBER_PHONE_INDEX_NAME = 'memberPhone_1';
