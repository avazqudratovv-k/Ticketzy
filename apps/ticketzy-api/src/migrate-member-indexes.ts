/**
 * npm run migrate:member-indexes            (dry run: prints the plan, changes nothing)
 * npm run migrate:member-indexes -- --apply (runs the plan)
 *
 * Replaces the unique indexes on members.memberEmail and members.memberPhone with the compound ones that also hold
 * deletedAt, so a deleted account no longer blocks its email (DECISIONS #123). Only indexes change, never a document.
 * With --apply it also needs MEMBER_INDEX_MIGRATION_CONFIRM set to the NAME of the Mongo variable it will use (MONGO_DEV or
 * MONGO_PROD), so it cannot hit a database by accident. Prints index names and variable names only, never a URI.
 */
import { config } from 'dotenv';
import { connect, connection } from 'mongoose';
import { getMongoUriKey } from './libs/env.validation';
import { runMemberIndexMigration } from './libs/member-index-migration';

async function migrate(): Promise<void> {
	config();
	const apply = process.argv.includes('--apply');

	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);
	if (apply && process.env.MEMBER_INDEX_MIGRATION_CONFIRM !== uriKey) {
		throw new Error(`Refusing to change indexes: set MEMBER_INDEX_MIGRATION_CONFIRM=${uriKey} to confirm the database behind ${uriKey}`);
	}

	// autoIndex off: this script is the only thing that touches indexes here
	await connect(uri, { autoIndex: false });
	const collection = connection.db!.collection('members') as any;

	console.log(`Database variable: ${uriKey}. Mode: ${apply ? 'APPLY' : 'dry run (add --apply to change anything)'}.`);
	const steps = await runMemberIndexMigration(collection, { apply });
	for (const step of steps) console.log(`  ${apply && step.action !== 'keep' ? 'done' : 'plan'}: ${step.action} ${step.name} (${step.note})`);
	console.log(apply ? 'Finished. No document was changed.' : 'Nothing was changed.');
}

migrate()
	.catch((err) => {
		console.error(`Migration failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
