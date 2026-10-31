/**
 * Room around the pitch (DECISIONS #138): the frontend draws a run-off, advertising boards and dugouts between the pitch and
 * the first stand, so every section of a PITCH venue keeps its plate (seat block + 6 units, the plate the layout editor draws)
 * at least 16 units from the pitch. `planStadiumSurround` is the rule applied to a stored layout: it moves sections that are too
 * close outward by the least whole number of units, and only x / y change (size, rotation, rows, seats and keys stay).
 */
import { SectionSpacing } from './enums/event.enum';
import { FocalArea, LAYOUT_CANVAS } from './focal-area';
import { VenueLayoutSection } from './venue-layout';

/** the plate the layout editor draws around the seat block of a section */
export const SECTION_PLATE = 6;
/** least distance between the plate of a section and the pitch */
export const PITCH_CLEARANCE = 16;
/** least distance between two seat blocks (DECISIONS #134) */
export const SECTION_GAP = 12;

const SPACING_UNITS: Record<string, number> = { [SectionSpacing.COMPACT]: 13, [SectionSpacing.NORMAL]: 16, [SectionSpacing.WIDE]: 21 };
const MAX_PASSES = 20;

export interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

type Position = Pick<VenueLayoutSection, 'x' | 'y'>;
type Placed = Omit<VenueLayoutSection, 'x' | 'y'> & Position;

/** the seat block of a section on the canvas; a missing spacing counts as NORMAL (the schema default) */
export const getSectionBox = (section: Placed): Box => {
	const unit = SPACING_UNITS[section.spacing] ?? SPACING_UNITS[SectionSpacing.NORMAL];
	const width = section.seatsPerRow * unit;
	const height = section.rows * unit;
	const turned = Math.abs(section.rotation ?? 0) % 180 === 90;
	const w = turned ? height : width;
	const h = turned ? width : height;
	return { left: section.x - w / 2, right: section.x + w / 2, top: section.y - h / 2, bottom: section.y + h / 2 };
};

export const withPlate = (box: Box, plate = SECTION_PLATE): Box => ({ left: box.left - plate, right: box.right + plate, top: box.top - plate, bottom: box.bottom + plate });

/** the signed gap on each axis between two boxes (negative = they overlap on that axis) */
const getGaps = (a: Box, b: Box) => ({
	x: Math.max(a.left - b.right, b.left - a.right),
	y: Math.max(a.top - b.bottom, b.top - a.bottom),
});

const pitchBox = (pitch: FocalArea): Box => ({ left: pitch.x, right: pitch.x + pitch.width, top: pitch.y, bottom: pitch.y + pitch.height });

/** the distance from the plate of a section to the pitch: the larger of the two axis gaps, as for the 12-unit section gap */
export const getPitchClearance = (section: Placed, pitch: FocalArea): number => {
	const gaps = getGaps(withPlate(getSectionBox(section)), pitchBox(pitch));
	return Math.max(gaps.x, gaps.y);
};

export const getSectionGap = (a: Placed, b: Placed): number => {
	const gaps = getGaps(getSectionBox(a), getSectionBox(b));
	return Math.max(gaps.x, gaps.y);
};

export const isInsideCanvas = (box: Box): boolean => box.left >= 0 && box.top >= 0 && box.right <= LAYOUT_CANVAS.width && box.bottom <= LAYOUT_CANVAS.height;

export interface SectionMove {
	key: string;
	from: Position;
	to: Position;
}

export interface SurroundPlan {
	moves: SectionMove[];
	/** why the venue was left untouched (nothing is moved when there is a problem) */
	problems: string[];
}

const center = (pitch: FocalArea) => ({ x: pitch.x + pitch.width / 2, y: pitch.y + pitch.height / 2 });

/**
 * Moves sections outward until each plate is PITCH_CLEARANCE from the pitch. A section pushed toward another one (a gap that the
 * moves made smaller and that is now below SECTION_GAP) pushes that one outward as well, so a stack of tiers moves together and
 * ends at least SECTION_GAP apart. Pairs the moves did not touch keep the gap they had, even a small one.
 * Moves are whole units (rounded up), so the result is never below the rule. Pure: the layout is not changed.
 */
export const planStadiumSurround = (sections: VenueLayoutSection[], pitch: FocalArea): SurroundPlan => {
	const original = sections.map((item) => ({ ...item }));
	const work = sections.map((item) => ({ ...item }));
	const problems: string[] = [];
	const middle = center(pitch);

	const gapBefore = (i: number, j: number) => getSectionGap(original[i], original[j]);
	const sideOf = (item: Placed) => {
		const gaps = getGaps(withPlate(getSectionBox(item)), pitchBox(pitch));
		const axis: 'x' | 'y' = gaps.x >= gaps.y ? 'x' : 'y';
		return { axis, gap: Math.max(gaps.x, gaps.y), direction: Math.sign(item[axis] - middle[axis]) };
	};

	let settled = false;
	for (let pass = 0; pass < MAX_PASSES && !settled; pass++) {
		settled = true;
		for (let i = 0; i < work.length; i++) {
			const { axis, gap, direction } = sideOf(work[i]);
			if (gap >= PITCH_CLEARANCE) continue;
			if (!direction) {
				problems.push(`${work[i].key}: centered on the pitch, no outward direction`);
				return { moves: [], problems };
			}
			work[i][axis] += direction * Math.ceil(PITCH_CLEARANCE - gap);
			settled = false;
		}
		for (let i = 0; i < work.length; i++) {
			for (let j = i + 1; j < work.length; j++) {
				const gap = getSectionGap(work[i], work[j]);
				if (gap >= SECTION_GAP || gap >= gapBefore(i, j)) continue;
				// the one farther from the pitch gives way, away from the other along the axis where they are closest to apart
				const [near, far] = getPitchClearance(work[i], pitch) <= getPitchClearance(work[j], pitch) ? [i, j] : [j, i];
				const gaps = getGaps(getSectionBox(work[near]), getSectionBox(work[far]));
				const axis: 'x' | 'y' = gaps.x >= gaps.y ? 'x' : 'y';
				const direction = Math.sign(work[far][axis] - work[near][axis]) || Math.sign(work[far][axis] - middle[axis]);
				if (!direction) {
					problems.push(`${work[far].key}: no direction to clear ${work[near].key}`);
					return { moves: [], problems };
				}
				work[far][axis] += direction * Math.ceil(SECTION_GAP - Math.max(gaps.x, gaps.y));
				settled = false;
			}
		}
	}
	if (!settled) return { moves: [], problems: ['the sections did not settle after moving'] };

	const moves: SectionMove[] = [];
	work.forEach((item, i) => {
		if (item.x === original[i].x && item.y === original[i].y) return;
		moves.push({ key: item.key, from: { x: original[i].x, y: original[i].y }, to: { x: item.x, y: item.y } });
		if (!isInsideCanvas(withPlate(getSectionBox(item)))) problems.push(`${item.key}: would leave the ${LAYOUT_CANVAS.width} x ${LAYOUT_CANVAS.height} canvas`);
	});
	return problems.length ? { moves: [], problems } : { moves, problems };
};
