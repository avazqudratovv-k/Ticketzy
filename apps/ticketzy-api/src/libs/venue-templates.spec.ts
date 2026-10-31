import { FocalAreaType, SectionKind, VenueType } from './enums/event.enum';
import { FIXED_PITCH, getFocalAreaError } from './focal-area';
import { VENUE_TEMPLATES, VenueTemplateKey, getTemplateCapacity, getVenueTemplate, instantiateTemplate } from './venue-templates';
import { computeLayoutCapacity, getVenueLayoutError } from './venue-layout';

describe('venue templates (DECISIONS #130)', () => {
	it('are the four asked for', () => {
		expect(VENUE_TEMPLATES.map((template) => template.key)).toEqual(['CONCERT_HALL', 'ARENA', 'FOOTBALL_STADIUM', 'COMEDY_CLUB']);
	});

	it.each(VENUE_TEMPLATES.map((template) => [template.key, template] as const))('%s is a valid layout the server would accept', (_key, template) => {
		expect(getVenueLayoutError(template.layout)).toBeNull();
		expect(getFocalAreaError(template.layout.focalArea as any)).toBeNull();
		expect(computeLayoutCapacity(template.layout)).toBeGreaterThan(0);
	});

	it('the football stadium has the fixed 105:68 PITCH, four stands and two levels', () => {
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		expect(layout.focalArea).toEqual(FIXED_PITCH);
		expect(layout.sections).toHaveLength(8);
		expect(new Set(layout.sections.map((section) => section.level))).toEqual(new Set([1, 2]));
		for (const side of ['_N', '_S', '_W', '_E']) {
			expect(layout.sections.filter((section) => section.key.endsWith(side)).map((section) => section.level).sort()).toEqual([1, 2]);
		}
	});

	it('the stands do not overlap the pitch', () => {
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		const pitch = FIXED_PITCH;
		const pitchch = 13; // COMPACT spacing
		for (const item of layout.sections) {
			const w = item.seatsPerRow * pitchch;
			const h = item.rows * pitchch;
			const turned = item.rotation === 90 || item.rotation === 270;
			const bw = turned ? h : w;
			const bh = turned ? w : h;
			const overlapX = item.x - bw / 2 < pitch.x + pitch.width && item.x + bw / 2 > pitch.x;
			const overlapY = item.y - bh / 2 < pitch.y + pitch.height && item.y + bh / 2 > pitch.y;
			expect({ key: item.key, overlap: overlapX && overlapY }).toEqual({ key: item.key, overlap: false });
		}
	});

	it('the concert hall has a stage, a floor and two tiers; the arena a standing floor and tiers around; the comedy club a small stage', () => {
		const hall = instantiateTemplate('CONCERT_HALL');
		expect(hall.focalArea.type).toBe(FocalAreaType.STAGE);
		expect(new Set(hall.sections.map((section) => section.level))).toEqual(new Set([0, 1, 2]));
		const arena = instantiateTemplate('ARENA');
		expect(arena.sections.some((section) => section.kind === SectionKind.STANDING && section.level === 0)).toBe(true);
		expect(new Set(arena.sections.map((section) => section.level))).toEqual(new Set([0, 1, 2]));
		const club = instantiateTemplate('COMEDY_CLUB');
		expect(club.focalArea.type).toBe(FocalAreaType.STAGE);
		expect(club.focalArea.width).toBeLessThan(hall.focalArea.width);
		expect(getVenueTemplate('COMEDY_CLUB').venueType).toBe(VenueType.CLUB);
		expect(getTemplateCapacity('COMEDY_CLUB')).toBeLessThan(getTemplateCapacity('CONCERT_HALL'));
	});

	it('an instance is a copy: changing it never changes the template', () => {
		const copy = instantiateTemplate('ARENA');
		copy.sections[0].name = 'changed';
		copy.focalArea = { type: FocalAreaType.STAGE, x: 0, y: 0, width: 1, height: 1 } as any;
		const again = instantiateTemplate('ARENA');
		expect(again.sections[0].name).not.toBe('changed');
		expect(again.focalArea.width).toBe(300);
	});

	it.each(['CONCERT_HALL', 'ARENA', 'FOOTBALL_STADIUM', 'COMEDY_CLUB'] as VenueTemplateKey[])('%s: every tier key of a seated section is set and keys are unique', (key) => {
		const layout = instantiateTemplate(key);
		expect(new Set(layout.sections.map((section) => section.key)).size).toBe(layout.sections.length);
		expect(layout.sections.filter((section) => section.kind === SectionKind.SEATED).every((section) => !!section.tierKey)).toBe(true);
	});

	// the frontend editor draws a 6-unit plate around every section, so two sections need at least 12 units between them
	it.each(VENUE_TEMPLATES.map((template) => [template.key, template] as const))('%s keeps at least 12 units between section seat boxes', (_key, template) => {
		const spacing = { COMPACT: 13, NORMAL: 16, WIDE: 21 } as Record<string, number>;
		const boxes = template.layout.sections.map((item) => {
			const w = item.seatsPerRow * spacing[item.spacing];
			const h = item.rows * spacing[item.spacing];
			const turned = item.rotation % 180 === 90;
			const bw = turned ? h : w;
			const bh = turned ? w : h;
			return { key: item.key, left: item.x - bw / 2, right: item.x + bw / 2, top: item.y - bh / 2, bottom: item.y + bh / 2 };
		});
		const tooClose: string[] = [];
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i];
				const b = boxes[j];
				const gapX = Math.max(a.left - b.right, b.left - a.right);
				const gapY = Math.max(a.top - b.bottom, b.top - a.bottom);
				// boxes that overlap on one axis are separated by the gap on the other; the real distance is the larger of the two
				if (Math.max(gapX, gapY) < 12) tooClose.push(`${a.key}/${b.key}`);
			}
		}
		expect(tooClose).toEqual([]);
	});
});
