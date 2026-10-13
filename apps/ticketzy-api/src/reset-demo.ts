/**
 * npm run reset:demo
 * Removes what `seed:demo` created and nothing else (DECISIONS #108): the manifest decides, see libs/demo-manifest.ts.
 * Same guards as the seed. Prints counts only.
 */
import { config } from 'dotenv';
import { assertDemoCommandAllowed, assertNoForeignData } from './libs/demo-guards';
import { countForeignData, removeDemoData } from './libs/demo-manifest';
import { openDemoApp, getDemoModels } from './demo-app';

async function resetDemo(): Promise<void> {
	config();
	const { uriKey } = assertDemoCommandAllowed(process.env, 'reset');
	console.log(`Removing demo data from the database of ${uriKey}...`);
	const app = await openDemoApp();
	try {
		const models = getDemoModels(app);
		assertNoForeignData(await countForeignData(models), process.env, 'reset');
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
