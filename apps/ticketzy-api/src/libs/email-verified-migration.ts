/**
 * One-off (DECISIONS #135): every member that exists when email verification ships counts as verified, so nobody is locked
 * out of buying. Sets `emailVerifiedAt` on members that have none (a missing field and null both count), demo accounts
 * and deleted accounts included; members who already have a value are never touched, so it can be run again. New sign-ups
 * start unverified and are not affected, as long as the script runs once, right after the deploy that adds the field.
 */
export interface MemberCollection {
	countDocuments(filter: any): Promise<number>;
	updateMany(filter: any, update: any): Promise<{ modifiedCount: number }>;
}

export const MISSING_EMAIL_VERIFIED_FILTER = { emailVerifiedAt: { $in: [null] } };

export const runEmailVerifiedMigration = async (
	members: MemberCollection,
	options: { apply: boolean; now?: Date },
): Promise<{ pending: number; updated: number }> => {
	const pending = await members.countDocuments(MISSING_EMAIL_VERIFIED_FILTER);
	if (!options.apply || !pending) return { pending, updated: 0 };
	const result = await members.updateMany(MISSING_EMAIL_VERIFIED_FILTER, { $set: { emailVerifiedAt: options.now ?? new Date() } });
	return { pending, updated: result.modifiedCount };
};
