/**
 * The check that runs before `seed:demo` or `reset:demo` removes anything (DECISIONS #132): what do other accounts' records
 * say about the demo data? Prints counts only. `--dry-run` stops after the report and changes nothing; a real run stops with a
 * clear error while the count is not 0, unless DEMO_SEED_KEEP_LINKED=true says to keep the linked demo records.
 */
import { DemoModels, findDemoScope } from './demo-manifest';
import { KEEP_LINKED_ENV, LinkedRecords, assertNoLinkedRecords, findLinkedRecords, formatLinkCounts, isKeepLinked } from './demo-links';

export const isDryRun = (argv: string[]): boolean => argv.includes('--dry-run');

export interface DemoGateResult {
	links: LinkedRecords;
	/** the dry run is complete: the caller must not change anything */
	stop: boolean;
	/** linked demo records stay and the seed works around them */
	keepLinked: boolean;
}

export const runDemoLinkGate = async (
	models: DemoModels,
	env: Record<string, string | undefined>,
	action: 'seed' | 'reset',
	dryRun: boolean,
	log: (line: string) => void = console.log,
): Promise<DemoGateResult> => {
	const links = await findLinkedRecords(models);
	log('\nRecords of other accounts that point at demo data (non-demo orders, tickets, comments, likes, messages, notifications ...):');
	log(formatLinkCounts(links.counts));
	log(`  ${'total'.padEnd(14)} ${links.total}`);

	if (dryRun) {
		const scope = await findDemoScope(models);
		log('\nA reset would remove:');
		log(`  ${'accounts'.padEnd(14)} ${scope.memberIds.length}\n  ${'venues'.padEnd(14)} ${scope.venueIds.length}\n  ${'events'.padEnd(14)} ${scope.eventIds.length}`);
		log('and keep, because something points at them:');
		log(`  ${'accounts'.padEnd(14)} ${scope.kept.members}\n  ${'venues'.padEnd(14)} ${scope.kept.venues}\n  ${'events'.padEnd(14)} ${scope.kept.events}`);
		log(
			links.total === 0
				? `\nDry run: nothing was changed. A real ${action} would go ahead.`
				: `\nDry run: nothing was changed. A real ${action} would stop here unless ${KEEP_LINKED_ENV}=true is set.`,
		);
		return { links, stop: true, keepLinked: isKeepLinked(env) };
	}

	assertNoLinkedRecords(links, env, action);
	if (links.total > 0) log(`\n${KEEP_LINKED_ENV}=true: the demo events, venues and organizers listed above are kept as they are.`);
	return { links, stop: false, keepLinked: links.total > 0 && isKeepLinked(env) };
};
