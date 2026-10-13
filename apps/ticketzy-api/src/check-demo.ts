/**
 * npm run check:demo
 * Read only. Compares the counters of the demo data with the records they count (DECISIONS #108) and lists records that look
 * like leftover test data (never touched). Exit code 1 when an invariant fails; a missing "coverage" item is only a warning,
 * because real use changes it. Needs no confirmation because it writes nothing.
 */
import { config } from 'dotenv';
import { evaluateDemoConsistency, formatFindings, getInvariantFailures } from './libs/demo-consistency';
import { getMongoUriKey } from './libs/env.validation';
import { openDemoApp, getDemoModels } from './demo-app';
import { countDemoDocuments, findProbableQaData, loadDemoSnapshot } from './demo-snapshot';

async function checkDemo(): Promise<void> {
	config();
	const uriKey = getMongoUriKey();
	if (!process.env[uriKey]?.trim()) throw new Error(`${uriKey} is missing`);
	const app = await openDemoApp();
	try {
		const models = getDemoModels(app);
		const counts = await countDemoDocuments(models);
		if (!counts.events && !counts.buyers) {
			console.log(`No demo data is tracked in the database of ${uriKey}.`);
		} else {
			console.log(`Demo data in the database of ${uriKey}:`);
			for (const [name, count] of Object.entries(counts)) console.log(`  ${name.padEnd(18)} ${count}`);
			const findings = evaluateDemoConsistency(await loadDemoSnapshot(models));
			console.log('\nConsistency check:\n' + formatFindings(findings));
			if (getInvariantFailures(findings).length) process.exitCode = 1;
		}
		const qa = await findProbableQaData(models);
		const found = Object.entries(qa).filter(([, names]) => names.length);
		if (found.length) {
			console.log('\nProbable QA or test data that is not part of the demo seed (reported only, nothing is changed):');
			for (const [kind, names] of found) console.log(`  ${kind}: ${names.join(', ')}`);
		}
	} finally {
		await app.close();
	}
}

checkDemo().catch((err) => {
	console.error(`Demo check failed: ${err.message}`);
	process.exit(1);
});
