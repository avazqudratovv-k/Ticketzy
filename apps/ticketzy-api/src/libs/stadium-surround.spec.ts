import { FocalAreaType, SectionKind, SectionSpacing } from './enums/event.enum';
import { FIXED_PITCH } from './focal-area';
import { PITCH_CLEARANCE, SECTION_GAP, getPitchClearance, getSectionGap, planStadiumSurround } from './stadium-surround';
import { PITCH_VENUE_FILTER, runStadiumSurroundMigration } from './stadium-surround-migration';
import { VenueLayoutSection } from './venue-layout';
import { instantiateTemplate } from './venue-templates';

const seated = (key: string, level: number, rows: number, seatsPerRow: number, x: number, y: number, rotation: number): VenueLayoutSection => ({
	key, name: key, kind: SectionKind.SEATED, level, rows, seatsPerRow, x, y, rotation, spacing: SectionSpacing.COMPACT, tierKey: 'GOLD',
});

/** FOOTBALL_STADIUM as it was stored before #138 */
const oldStadium = (): VenueLayoutSection[] => [
	seated('LOWER_N', 1, 6, 30, 500, 170, 0),
	seated('UPPER_N', 2, 5, 36, 500, 86, 0),
	seated('LOWER_S', 1, 6, 30, 500, 530, 180),
	seated('UPPER_S', 2, 5, 36, 500, 614, 180),
	seated('LOWER_W', 1, 6, 22, 250, 350, 270),
	seated('UPPER_W', 2, 5, 24, 165, 350, 270),
	seated('LOWER_E', 1, 6, 22, 750, 350, 90),
	seated('UPPER_E', 2, 5, 24, 835, 350, 90),
];

const apply = (sections: VenueLayoutSection[]) => {
	const plan = planStadiumSurround(sections, FIXED_PITCH);
	const moved = sections.map((item) => ({ ...item, ...(plan.moves.find((move) => move.key === item.key)?.to ?? {}) }));
	return { plan, moved };
};

describe('planStadiumSurround (DECISIONS #138)', () => {
	it('moves the old football stadium outward, stacked tiers together, to a layout that meets both rules', () => {
		const { plan, moved } = apply(oldStadium());
		expect(plan.problems).toEqual([]);
		expect(Object.fromEntries(plan.moves.map((move) => [move.key, [move.to.x, move.to.y]]))).toEqual({
			LOWER_N: [500, 153], UPPER_N: [500, 69], LOWER_S: [500, 547], UPPER_S: [500, 631],
			LOWER_W: [229, 350], UPPER_W: [145, 350], LOWER_E: [771, 350], UPPER_E: [855, 350],
		});
		for (const item of moved) expect(getPitchClearance(item, FIXED_PITCH)).toBeGreaterThanOrEqual(PITCH_CLEARANCE);
		for (let i = 0; i < moved.length; i++) for (let j = i + 1; j < moved.length; j++) expect(getSectionGap(moved[i], moved[j])).toBeGreaterThanOrEqual(SECTION_GAP);
	});

	it('moves by the least whole number of units and keeps everything but x and y', () => {
		const { plan, moved } = apply(oldStadium());
		const lowerNorth = moved.find((item) => item.key === 'LOWER_N');
		expect(getPitchClearance(lowerNorth, FIXED_PITCH)).toBeGreaterThanOrEqual(16);
		expect(getPitchClearance({ ...lowerNorth, y: lowerNorth.y + 1 }, FIXED_PITCH)).toBeLessThan(16);
		moved.forEach((item, i) => expect({ ...item, x: 0, y: 0 }).toEqual({ ...oldStadium()[i], x: 0, y: 0 }));
		plan.moves.forEach((move) => expect(move.from.x === move.to.x || move.from.y === move.to.y).toBe(true));
	});

	it('changes nothing in the new template, and a second run over the result changes nothing', () => {
		expect(planStadiumSurround(instantiateTemplate('FOOTBALL_STADIUM').sections, FIXED_PITCH)).toEqual({ moves: [], problems: [] });
		expect(planStadiumSurround(apply(oldStadium()).moved, FIXED_PITCH).moves).toEqual([]);
	});

	it('moves only what is too close: a stand already far enough stays', () => {
		const { plan } = apply([seated('FAR', 1, 6, 30, 500, 60, 0), seated('NEAR', 1, 6, 30, 500, 170, 0)]);
		expect(plan.moves.map((move) => move.key)).toEqual(['NEAR']);
	});

	it('a pair the moves did not touch keeps its gap, even a small one', () => {
		const alreadyClose = [seated('A', 1, 6, 30, 500, 100, 0), seated('B', 2, 5, 36, 500, 110, 0)];
		expect(planStadiumSurround(alreadyClose, FIXED_PITCH)).toEqual({ moves: [], problems: [] });
	});

	it('the stands stored before #134 (tiers 0.5 apart) end 12 apart instead of overlapping after the move', () => {
		const stored = oldStadium();
		const upper = { UPPER_N: 98, UPPER_S: 602 } as Record<string, number>;
		stored.forEach((item) => (item.y = upper[item.key] ?? item.y));
		stored.find((item) => item.key === 'UPPER_W').x = 172;
		stored.find((item) => item.key === 'UPPER_E').x = 828;
		const { plan, moved } = apply(stored);
		expect(plan.problems).toEqual([]);
		expect(Object.fromEntries(plan.moves.map((move) => [move.key, [move.to.x, move.to.y]]))).toEqual({
			LOWER_N: [500, 153], UPPER_N: [500, 69], LOWER_S: [500, 547], UPPER_S: [500, 631],
			LOWER_W: [229, 350], UPPER_W: [145, 350], LOWER_E: [771, 350], UPPER_E: [855, 350],
		});
		for (let i = 0; i < moved.length; i++) for (let j = i + 1; j < moved.length; j++) expect(getSectionGap(moved[i], moved[j])).toBeGreaterThanOrEqual(SECTION_GAP);
	});

	it('refuses to touch a venue when a pushed section would leave the canvas, or sits on the pitch center', () => {
		// N (y 175) must move up 22; BIG (104 high, bottom 122, gap 14 from N) is then pushed up past the top edge
		const edge = planStadiumSurround([seated('N', 1, 6, 30, 500, 175, 0), seated('BIG', 2, 8, 36, 500, 70, 0)], FIXED_PITCH);
		expect(edge.moves).toEqual([]);
		expect(edge.problems.join()).toContain('BIG: would leave the 1000 x 700 canvas');
		const middle = planStadiumSurround([seated('MID', 1, 4, 4, 500, 350, 0)], FIXED_PITCH);
		expect(middle).toEqual({ moves: [], problems: ['MID: centered on the pitch, no outward direction'] });
	});

	it('handles every rotation: 90 and 270 swap width and height, 0 and 180 do not', () => {
		const moveFor = (rotation: number) => {
			const { plan, moved } = apply([seated('W', 1, 4, 10, 300, 350, rotation)]);
			expect(plan.problems).toEqual([]);
			expect(getPitchClearance(moved[0], FIXED_PITCH)).toBeGreaterThanOrEqual(16);
			return plan.moves[0].to.x;
		};
		expect(moveFor(0)).toBe(moveFor(180));
		expect(moveFor(90)).toBe(moveFor(270));
		expect(moveFor(90)).toBeGreaterThan(moveFor(0));
	});
});

const venueDoc = (id: number, name: string, sections: VenueLayoutSection[], focalType = FocalAreaType.PITCH) => ({
	_id: id, venueName: name, venueLayout: { sections: sections.map((item) => ({ ...item })), focalArea: { ...FIXED_PITCH, type: focalType } },
});

const collection = (docs: any[]) => ({
	docs,
	filters: [] as any[],
	find(filter: any) {
		this.filters.push(filter);
		return { toArray: async () => docs.filter((doc) => doc.venueLayout?.focalArea?.type === FocalAreaType.PITCH && doc.venueLayout.sections.length) };
	},
	updateOne: jest.fn(async (filter: any, update: any) => {
		const doc = docs.find((item) => item._id === filter._id);
		const stale = Object.entries(filter).some(([path, value]) => {
			if (path === '_id') return false;
			const [, , index, field] = path.split('.');
			return doc.venueLayout.sections[Number(index)][field] !== value;
		});
		if (stale) return { matchedCount: 0 };
		for (const [path, value] of Object.entries(update.$set)) {
			const [, , index, field] = path.split('.');
			doc.venueLayout.sections[Number(index)][field] = value;
		}
		return { matchedCount: 1 };
	}),
});

describe('migrate:stadium-surround (DECISIONS #138)', () => {
	const build = () => collection([venueDoc(1, 'Old Stadium', oldStadium()), venueDoc(2, 'New Stadium', instantiateTemplate('FOOTBALL_STADIUM').sections), venueDoc(3, 'Hall', oldStadium(), FocalAreaType.STAGE)]);

	it('only looks at PITCH venues that have a layout', async () => {
		const venues = build();
		await runStadiumSurroundMigration(venues, { apply: false });
		expect(venues.filters[0]).toEqual(PITCH_VENUE_FILTER);
	});

	it('a dry run reports old to new per venue and writes nothing', async () => {
		const venues = build();
		const result = await runStadiumSurroundMigration(venues, { apply: false });
		expect(result.venues).toBe(2);
		expect(result.reports).toHaveLength(1);
		expect(result.reports[0]).toMatchObject({ id: '1', name: 'Old Stadium', problems: [] });
		expect(result.reports[0].moves).toContainEqual({ key: 'LOWER_N', from: { x: 500, y: 170 }, to: { x: 500, y: 153 } });
		expect(result.updated).toBe(0);
		expect(venues.updateOne).not.toHaveBeenCalled();
		expect(venues.docs[0].venueLayout.sections[0].y).toBe(170);
	});

	it('apply writes only x and y of the moved sections, leaves other venues alone, and a second run finds nothing', async () => {
		const venues = build();
		const before = JSON.parse(JSON.stringify(venues.docs));
		const result = await runStadiumSurroundMigration(venues, { apply: true });
		expect(result.updated).toBe(1);
		expect(venues.updateOne).toHaveBeenCalledTimes(1);
		const set = venues.updateOne.mock.calls[0][1].$set;
		expect(Object.keys(set).every((path) => /\.(x|y)$/.test(path))).toBe(true);
		venues.docs[0].venueLayout.sections.forEach((item: any, i: number) => expect({ ...item, x: 0, y: 0 }).toEqual({ ...before[0].venueLayout.sections[i], x: 0, y: 0 }));
		expect(venues.docs[1]).toEqual(before[1]);
		expect(venues.docs[2]).toEqual(before[2]);
		expect((await runStadiumSurroundMigration(venues, { apply: true })).reports).toEqual([]);
	});

	it('skips a venue that changed after it was read, and does not write a venue with a problem', async () => {
		const venues = build();
		venues.docs.push(venueDoc(4, 'Centered', [seated('MID', 1, 4, 4, 500, 350, 0)]));
		const find = venues.find.bind(venues);
		venues.find = (filter: any) => {
			const cursor = find(filter);
			return { toArray: async () => { const docs = await cursor.toArray(); venues.docs[0].venueLayout.sections[0].y = 171; return docs.map((doc) => JSON.parse(JSON.stringify({ ...doc, venueLayout: { ...doc.venueLayout, sections: doc.venueLayout.sections.map((s: any, i: number) => (doc._id === 1 && i === 0 ? { ...s, y: 170 } : s)) } }))); } };
		};
		const result = await runStadiumSurroundMigration(venues, { apply: true });
		expect(result.reports.find((report) => report.id === '1').skippedChanged).toBe(true);
		expect(result.reports.find((report) => report.id === '4').problems).not.toEqual([]);
		expect(result.updated).toBe(0);
		expect(venues.docs[3].venueLayout.sections[0].y).toBe(350);
	});
});
