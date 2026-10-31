/**
 * Optional one-off (DECISIONS #127): writes the default stage into stored venue layouts that have no focal area. Nothing
 * needs it (a layout without one already reads as the default stage); it only makes the stored data match what is returned.
 * Touches only `venueLayout.focalArea` of venues that have a layout and no focal area, so it can be run again.
 */
import { DEFAULT_STAGE } from './focal-area';

/** the little of a MongoDB collection the migration needs, so a test can use a stand-in */
export interface VenueCollection {
	countDocuments(filter: any): Promise<number>;
	updateMany(filter: any, update: any): Promise<{ modifiedCount: number }>;
}

/** a layout exists, a focal area does not (a missing field and null both count) */
export const MISSING_FOCAL_AREA_FILTER = { 'venueLayout.sections.0': { $exists: true }, 'venueLayout.focalArea': { $in: [null] } };

export const runVenueFocalAreaMigration = async (venues: VenueCollection, options: { apply: boolean }): Promise<{ pending: number; updated: number }> => {
	const pending = await venues.countDocuments(MISSING_FOCAL_AREA_FILTER);
	if (!options.apply || !pending) return { pending, updated: 0 };
	const result = await venues.updateMany(MISSING_FOCAL_AREA_FILTER, { $set: { 'venueLayout.focalArea': { ...DEFAULT_STAGE } } });
	return { pending, updated: result.modifiedCount };
};
