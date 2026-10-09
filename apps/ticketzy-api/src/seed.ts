/**
 * npm run seed
 * Creates the first ADMIN from ADMIN_EMAIL and ADMIN_PASSWORD (.env) when no admin exists yet.
 * Also creates a second ADMIN from ADMIN2_EMAIL, ADMIN2_PASSWORD (and optional ADMIN2_NICK) when that email is unused.
 * Admins can never be created through the API; running this again is safe.
 */
import { config } from 'dotenv';
import * as bcrypt from 'bcryptjs';
import { connect, connection, model } from 'mongoose';
import MemberSchema from './libs/schemas/Member.model';
import { MemberAuthType, MemberStatus, MemberType } from './libs/enums/member.enum';
import { getMongoUriKey } from './libs/env.validation';
import { ensureExtraAdmin } from './libs/admin-seed';

const MIN_PASSWORD_LENGTH = 8;

async function seed(): Promise<void> {
	config();

	const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.ADMIN_PASSWORD;
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL is missing or not a valid email');
	if (!password || password.length < MIN_PASSWORD_LENGTH) {
		throw new Error(`ADMIN_PASSWORD is missing or shorter than ${MIN_PASSWORD_LENGTH} characters`);
	}

	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);

	await connect(uri);
	const memberModel = model('Member', MemberSchema);

	if (await memberModel.exists({ memberType: MemberType.ADMIN })) {
		console.log('An admin already exists, nothing was changed.');
	} else {
		await memberModel.create({
			memberEmail: email,
			memberPassword: await bcrypt.hash(password, await bcrypt.genSalt()),
			memberType: MemberType.ADMIN,
			memberStatus: MemberStatus.ACTIVE,
			memberAuthType: MemberAuthType.EMAIL,
		});
		console.log(`Admin ${email} was created.`);
	}

	await ensureExtraAdmin(memberModel);
}

seed()
	.catch((err) => {
		console.error(`Seed failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
