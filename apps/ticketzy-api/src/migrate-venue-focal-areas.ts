/**
 * npm run migrate:venue-focal-areas            (dry run: counts the venues, changes nothing)
 * npm run migrate:venue-focal-areas -- --apply (writes the default stage into layouts that have none)
 *
 * Optional (DECISIONS #127): a layout without a focal area already reads as the default stage. With --apply it needs
 * VENUE_FOCAL_AREA_MIGRATION_CONFIRM set to the NAME of the Mongo variable it will use (MONGO_DEV or MONGO_PROD).
 * Prints counts and variable names only, never a URI.
 */
import { config } from 'dotenv';
import { connect, connection } from 'mongoose';
import { getMongoUriKey } from './libs/env.validation';
import { runVenueFocalAreaMigration } from './libs/venue-focal-migration';

async function migrate(): Promise<void> {
	config();
	const apply = process.argv.includes('--apply');
	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);
	if (apply && process.env.VENUE_FOCAL_AREA_MIGRATION_CONFIRM !== uriKey) {
		throw new Error(`Refusing to change venues: set VENUE_FOCAL_AREA_MIGRATION_CONFIRM=${uriKey} to confirm the database behind ${uriKey}`);
	}
	await connect(uri, { autoIndex: false });
	const venues = connection.db!.collection('venues') as any;
	console.log(`Database variable: ${uriKey}. Mode: ${apply ? 'APPLY' : 'dry run (add --apply to change anything)'}.`);
	const { pending, updated } = await runVenueFocalAreaMigration(venues, { apply });
	console.log(`Venues with a layout and no focal area: ${pending}.`);
	console.log(apply ? `Updated ${updated} venue(s).` : 'Nothing was changed.');
}

migrate()
	.catch((err) => {
		console.error(`Migration failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
