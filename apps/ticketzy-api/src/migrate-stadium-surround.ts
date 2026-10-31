/**
 * npm run migrate:stadium-surround            (dry run: prints what would move, changes nothing)
 * npm run migrate:stadium-surround -- --apply (moves the sections of PITCH venues that are too close to the pitch)
 *
 * One-off (DECISIONS #138): the plate of every section of a PITCH venue must be 16 units from the pitch. Only x / y of those
 * sections change. With --apply it needs STADIUM_SURROUND_MIGRATION_CONFIRM set to the NAME of the Mongo variable it will use
 * (MONGO_DEV or MONGO_PROD). Prints venue names, section keys, coordinates and the variable and database names, never a URI.
 * Never run it against a real database without the owner.
 */
import { config } from 'dotenv';
import { connect, connection } from 'mongoose';
import { getMongoUriKey } from './libs/env.validation';
import { runStadiumSurroundMigration } from './libs/stadium-surround-migration';

async function migrate(): Promise<void> {
	config();
	const apply = process.argv.includes('--apply');
	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);
	if (apply && process.env.STADIUM_SURROUND_MIGRATION_CONFIRM !== uriKey) {
		throw new Error(`Refusing to change venues: set STADIUM_SURROUND_MIGRATION_CONFIRM=${uriKey} to confirm the database behind ${uriKey}`);
	}
	await connect(uri, { autoIndex: false });
	const venues = connection.db!.collection('venues') as any;
	console.log(`Database variable: ${uriKey}. Database: ${connection.name}. Mode: ${apply ? 'APPLY' : 'dry run (add --apply to change anything)'}.`);
	const { venues: total, reports, updated } = await runStadiumSurroundMigration(venues, { apply });
	for (const report of reports) {
		console.log(`Venue "${report.name}" (${report.id}):`);
		for (const move of report.moves) console.log(`  ${move.key}: (${move.from.x}, ${move.from.y}) -> (${move.to.x}, ${move.to.y})`);
		for (const problem of report.problems) console.log(`  NEEDS A PERSON, left untouched: ${problem}`);
		if (report.skippedChanged) console.log('  SKIPPED: the venue changed after it was read, run again');
	}
	const blocked = reports.filter((report) => report.problems.length || report.skippedChanged).length;
	console.log(`PITCH venues with a layout: ${total}. Need changes: ${reports.length}. Blocked or skipped: ${blocked}.`);
	console.log(apply ? `Updated ${updated} venue(s).` : 'Nothing was changed.');
	if (blocked) process.exitCode = 1;
}

migrate()
	.catch((err) => {
		console.error(`Migration failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
