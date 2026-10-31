/**
 * One-off (DECISIONS #138): moves the sections of PITCH venues outward so the plate of each keeps PITCH_CLEARANCE from the pitch
 * (rule and planner in libs/stadium-surround.ts). It writes only `venueLayout.sections.<i>.x` and `.y`; keys, rows, seats per row,
 * rotation, spacing, level and tier stay, so no EventSeat, order or ticket is touched (they hold sectionKey / row / number and
 * seat ids, never a position). Each write is conditional on the old x / y, so a venue edited meanwhile is skipped, not overwritten.
 */
import { FocalAreaType } from './enums/event.enum';
import { FIXED_PITCH } from './focal-area';
import { SectionMove, planStadiumSurround } from './stadium-surround';
import { VenueLayoutSection } from './venue-layout';

/** the little of a MongoDB collection the migration needs, so a test can use a stand-in */
export interface StadiumVenueCollection {
	find(filter: any): { toArray(): Promise<any[]> };
	updateOne(filter: any, update: any): Promise<{ matchedCount: number }>;
}

export const PITCH_VENUE_FILTER = { 'venueLayout.focalArea.type': FocalAreaType.PITCH, 'venueLayout.sections.0': { $exists: true } };

export interface VenueSurroundReport {
	id: string;
	name: string;
	moves: SectionMove[];
	/** set when the venue is left untouched and needs a person */
	problems: string[];
	/** apply only: the venue changed after it was read, nothing was written */
	skippedChanged?: boolean;
}

export interface StadiumSurroundResult {
	venues: number;
	reports: VenueSurroundReport[];
	updated: number;
}

export const runStadiumSurroundMigration = async (venues: StadiumVenueCollection, options: { apply: boolean }): Promise<StadiumSurroundResult> => {
	const docs = await venues.find(PITCH_VENUE_FILTER).toArray();
	const reports: VenueSurroundReport[] = [];
	let updated = 0;
	for (const doc of docs) {
		const sections: VenueLayoutSection[] = doc.venueLayout.sections;
		// a stored PITCH is always read as the fixed one (DECISIONS #127)
		const plan = planStadiumSurround(sections, { ...FIXED_PITCH });
		if (!plan.moves.length && !plan.problems.length) continue;
		const report: VenueSurroundReport = { id: String(doc._id), name: doc.venueName, moves: plan.moves, problems: plan.problems };
		if (options.apply && plan.moves.length) {
			const filter: Record<string, unknown> = { _id: doc._id };
			const set: Record<string, number> = {};
			for (const move of plan.moves) {
				const index = sections.findIndex((item) => item.key === move.key);
				filter[`venueLayout.sections.${index}.key`] = move.key;
				filter[`venueLayout.sections.${index}.x`] = move.from.x;
				filter[`venueLayout.sections.${index}.y`] = move.from.y;
				set[`venueLayout.sections.${index}.x`] = move.to.x;
				set[`venueLayout.sections.${index}.y`] = move.to.y;
			}
			const result = await venues.updateOne(filter, { $set: set });
			if (result.matchedCount) updated++;
			else report.skippedChanged = true;
		}
		reports.push(report);
	}
	return { venues: docs.length, reports, updated };
};
