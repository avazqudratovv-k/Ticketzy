import { DEFAULT_STAGE } from './focal-area';
import { FocalAreaType } from './enums/event.enum';
import { runVenueFocalAreaMigration } from './venue-focal-migration';

/** a collection stand-in with the one filter the migration uses */
const collection = (docs: any[]) => {
	const needs = (doc: any) => !!doc.venueLayout?.sections?.length && !doc.venueLayout.focalArea;
	return {
		docs,
		countDocuments: async () => docs.filter(needs).length,
		updateMany: async (_filter: any, update: any) => {
			const targets = docs.filter(needs);
			targets.forEach((doc) => (doc.venueLayout.focalArea = update.$set['venueLayout.focalArea']));
			return { modifiedCount: targets.length };
		},
	};
};

describe('venue focal area migration (optional)', () => {
	const build = () =>
		collection([
			{ _id: 1, venueLayout: { sections: [{ key: 'A' }] } },
			{ _id: 2, venueLayout: { sections: [{ key: 'A' }], focalArea: { type: FocalAreaType.PITCH, x: 290, y: 214, width: 420, height: 272 } } },
			{ _id: 3 },
		]);

	it('a dry run counts and changes nothing', async () => {
		const venues = build();
		expect(await runVenueFocalAreaMigration(venues, { apply: false })).toEqual({ pending: 1, updated: 0 });
		expect(venues.docs[0].venueLayout.focalArea).toBeUndefined();
	});

	it('apply writes the default stage only where there is none, and a second run finds nothing', async () => {
		const venues = build();
		expect(await runVenueFocalAreaMigration(venues, { apply: true })).toEqual({ pending: 1, updated: 1 });
		expect(venues.docs[0].venueLayout.focalArea).toEqual(DEFAULT_STAGE);
		expect(venues.docs[1].venueLayout.focalArea.type).toBe(FocalAreaType.PITCH);
		expect(venues.docs[2].venueLayout).toBeUndefined();
		expect(await runVenueFocalAreaMigration(venues, { apply: true })).toEqual({ pending: 0, updated: 0 });
	});
});
