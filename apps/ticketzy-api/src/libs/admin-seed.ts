import * as bcrypt from 'bcryptjs';
import { MemberAuthType, MemberStatus, MemberType } from './enums/member.enum';

export const MIN_ADMIN_PASSWORD_LENGTH = 8;

export interface ExtraAdminModel {
	findOne(filter: { memberEmail: string }): { select(fields: string): { lean(): Promise<{ memberType?: string } | null> } };
	create(doc: Record<string, unknown>): Promise<unknown>;
}

export type ExtraAdminResult = 'created' | 'exists' | 'not-admin' | 'skipped' | 'failed';

/**
 * Creates the second admin from ADMIN2_EMAIL, ADMIN2_PASSWORD and the optional ADMIN2_NICK.
 * Only called by the seed script, never by an API operation. It only ever inserts: an existing account
 * is never updated (password included), and neither the password nor its hash is logged.
 */
export async function ensureExtraAdmin(
	memberModel: ExtraAdminModel,
	env: NodeJS.ProcessEnv = process.env,
	log: Pick<Console, 'log' | 'warn'> = console,
): Promise<ExtraAdminResult> {
	const email = env.ADMIN2_EMAIL?.trim().toLowerCase();
	const password = env.ADMIN2_PASSWORD;
	const nick = env.ADMIN2_NICK?.trim();

	if (!email && !password) return 'skipped';
	if (!email || !password) {
		log.warn('Second admin skipped: ADMIN2_EMAIL and ADMIN2_PASSWORD must both be set.');
		return 'skipped';
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		log.warn('Second admin skipped: ADMIN2_EMAIL is not a valid email.');
		return 'skipped';
	}
	if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
		log.warn(`Second admin skipped: ADMIN2_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
		return 'skipped';
	}

	const existing = await memberModel.findOne({ memberEmail: email }).select('memberType').lean();
	if (existing) {
		if (existing.memberType === MemberType.ADMIN) {
			log.log(`Second admin ${email} already exists, nothing was changed.`);
			return 'exists';
		}
		log.warn(`Second admin skipped: ${email} already belongs to a ${existing.memberType} account, it was left unchanged.`);
		return 'not-admin';
	}

	try {
		await memberModel.create({
			memberEmail: email,
			memberPassword: await bcrypt.hash(password, await bcrypt.genSalt()),
			memberType: MemberType.ADMIN,
			memberStatus: MemberStatus.ACTIVE,
			memberAuthType: MemberAuthType.EMAIL,
			...(nick ? { memberNick: nick } : {}),
		});
	} catch (err) {
		// a duplicate key (for example ADMIN2_NICK already taken, or a parallel run) must not fail the whole seed
		log.warn(`Second admin ${email} was not created: ${(err as { code?: number }).code === 11000 ? 'duplicate email or nick' : 'database error'}.`);
		return 'failed';
	}
	log.log(`Second admin ${email} was created.`);
	return 'created';
}
