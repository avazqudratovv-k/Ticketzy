/**
 * npm run seed:demo
 * Fills a database with realistic demo data (DECISIONS #108). Refuses to run unless DEMO_SEED_CONFIRM names the database
 * variable in use, refuses production without ALLOW_DEMO_SEED=true, and refuses a database that holds data it did not create
 * unless DEMO_SEED_ALLOW_NON_DEMO_DB=true. An earlier demo run is removed first (only what the manifest tracks).
 * Needs an existing admin (`npm run seed`) and four passwords from the environment. Prints counts only.
 */
import { config } from 'dotenv';
import { DemoSeedError } from './libs/demo-errors';
import { evaluateDemoConsistency, formatFindings, getInvariantFailures } from './libs/demo-consistency';
import { assertDemoCommandAllowed, assertNoForeignData, readDemoPasswords } from './libs/demo-guards';
import { countForeignData, removeDemoData } from './libs/demo-manifest';
import { openDemoApp, getDemoModels } from './demo-app';
import { DemoSeeder } from './demo-seeder';
import { countDemoDocuments, loadDemoSnapshot } from './demo-snapshot';

async function seedDemo(): Promise<void> {
	config();
	// everything that can be checked without a database is checked first
	const { uriKey } = assertDemoCommandAllowed(process.env, 'seed');
	const passwords = readDemoPasswords(process.env);
	for (const key of ['SECRET_TOKEN', 'QR_SECRET']) if (!process.env[key]?.trim()) throw new Error(`${key} is missing`);

	// only this process: no AI call for the moderation that submit starts, a hold long enough for a slow connection, the mock provider
	process.env.AI_ENABLED = 'false';
	process.env.SEAT_HOLD_SECONDS = '300';
	process.env.PAYMENT_MODE = 'simulated';

	console.log(`Seeding demo data into the database of ${uriKey}...`);
	const app = await openDemoApp();
	try {
		const models = getDemoModels(app);
		assertNoForeignData(await countForeignData(models), process.env, 'seed');

		const earlier = await removeDemoData(models);
		const removedTotal = Object.values(earlier.removed).reduce((sum, count) => sum + count, 0);
		if (removedTotal) console.log(`Removed ${removedTotal} document(s) of an earlier demo run.`);
		const kept = Object.values(earlier.kept).reduce((sum, count) => sum + count, 0);
		if (kept) throw new Error(`${kept} record(s) of an earlier demo run could not be removed because other accounts use them; run reset:demo and look at its report first.`);

		await new DemoSeeder(app).run(passwords);

		console.log('\nCreated:');
		for (const [name, count] of Object.entries(await countDemoDocuments(models))) console.log(`  ${name.padEnd(18)} ${count}`);

		const findings = evaluateDemoConsistency(await loadDemoSnapshot(models));
		console.log('\nConsistency check:\n' + formatFindings(findings));
		const failures = getInvariantFailures(findings, true);
		if (failures.length) {
			throw new Error(`${failures.length} consistency rule(s) failed. The data stays in place; run \`npm run reset:demo\` to remove it.`);
		}
		console.log('\nDemo data is ready. Accounts and passwords: see README (the password variables are DEMO_*_PASSWORD).');
	} finally {
		await app.close();
	}
}

seedDemo().catch((err) => {
	console.error(`Demo seed failed: ${err.message}`);
	// a failed seed leaves what it created; the next run removes it first (only what the manifest tracks)
	if (err instanceof DemoSeedError) console.error('The data created so far stays in place. Run `npm run seed:demo` again: it removes the earlier run first.');
	process.exit(1);
});
