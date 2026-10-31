/**
 * npm run migrate:email-verified            (dry run: counts the members, changes nothing)
 * npm run migrate:email-verified -- --apply (marks every member without emailVerifiedAt as verified)
 *
 * One-off (DECISIONS #135): run it once, right after the deploy that adds email verification and BEFORE new sign-ups
 * matter, so existing and demo members are not locked out of buying. With --apply it needs
 * EMAIL_VERIFIED_MIGRATION_CONFIRM set to the NAME of the Mongo variable it will use (MONGO_DEV or MONGO_PROD).
 * Prints counts and variable names only, never a URI. Never run it against a real database without the owner.
 */
import { config } from 'dotenv';
import { connect, connection } from 'mongoose';
import { getMongoUriKey } from './libs/env.validation';
import { runEmailVerifiedMigration } from './libs/email-verified-migration';

async function migrate(): Promise<void> {
	config();
	const apply = process.argv.includes('--apply');
	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);
	if (apply && process.env.EMAIL_VERIFIED_MIGRATION_CONFIRM !== uriKey) {
		throw new Error(`Refusing to change members: set EMAIL_VERIFIED_MIGRATION_CONFIRM=${uriKey} to confirm the database behind ${uriKey}`);
	}
	await connect(uri, { autoIndex: false });
	const members = connection.db!.collection('members') as any;
	console.log(`Database variable: ${uriKey}. Mode: ${apply ? 'APPLY' : 'dry run (add --apply to change anything)'}.`);
	const { pending, updated } = await runEmailVerifiedMigration(members, { apply });
	console.log(`Members without a verified email: ${pending}.`);
	console.log(apply ? `Marked ${updated} member(s) as verified.` : 'Nothing was changed.');
}

migrate()
	.catch((err) => {
		console.error(`Migration failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
