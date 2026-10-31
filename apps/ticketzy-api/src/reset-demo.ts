/**
 * npm run reset:demo
 * Removes what `seed:demo` created and nothing else (DECISIONS #108): the manifest decides, see libs/demo-manifest.ts.
 * Same guards as the seed, and the same check of records of other accounts that point at demo data (DECISIONS #132):
 * `-- --dry-run` reports and changes nothing, a real run stops while the count is not 0 unless DEMO_SEED_KEEP_LINKED=true.
 * Prints counts only.
 */
import { config } from 'dotenv';
import { assertDemoCommandAllowed, assertNoForeignData } from './libs/demo-guards';
import { countForeignData, removeDemoData } from './libs/demo-manifest';
import { isDryRun, runDemoLinkGate } from './libs/demo-gate';
import { openDemoApp, getDemoModels } from './demo-app';

async function resetDemo(): Promise<void> {
	config();
	const { uriKey } = assertDemoCommandAllowed(process.env, 'reset');
	const dryRun = isDryRun(process.argv);
	console.log(`${dryRun ? 'Dry run of the demo reset for' : 'Removing demo data from'} the database of ${uriKey}...`);
	const app = await openDemoApp();
	try {
		const models = getDemoModels(app);
		assertNoForeignData(await countForeignData(models), process.env, 'reset');
		const gate = await runDemoLinkGate(models, process.env, 'reset', dryRun);
		if (gate.stop) return;
		const { removed, kept, leftBehind } = await removeDemoData(models);

		const total = Object.values(removed).reduce((sum, count) => sum + count, 0);
		console.log(total ? `Removed ${total} document(s):` : 'Nothing to remove: no demo data is tracked in this database.');
		for (const [name, count] of Object.entries(removed)) if (count) console.log(`  ${name.padEnd(18)} ${count}`);
		if (Object.values(kept).some(Boolean)) {
			console.log('Kept because other accounts use them:');
			for (const [name, count] of Object.entries(kept)) if (count) console.log(`  ${name.padEnd(18)} ${count}`);
		}
		if (Object.values(leftBehind).some(Boolean)) {
			console.log('Records written by other accounts about removed demo data (left in place, not touched):');
			for (const [name, count] of Object.entries(leftBehind)) if (count) console.log(`  ${name.padEnd(18)} ${count}`);
		}
	} finally {
		await app.close();
	}
}

resetDemo().catch((err) => {
	console.error(`Demo reset failed: ${err.message}`);
	process.exit(1);
});
