/**
 * The four venue templates (DECISIONS #130): one source of truth for the frontend layout editor (query `getVenueTemplates`)
 * and for the demo seed. Everything sits on the 1000 x 700 canvas of libs/focal-area.ts. A template is plain data; a venue
 * is created from a copy (`instantiateTemplate`), so editing a venue never changes a template.
 * Seat spacing on the canvas: COMPACT 13, NORMAL 16, WIDE 21 (the frontend's `PITCH` table), a section is
 * seatsPerRow x spacing wide and rows x spacing high before its rotation.
 */
import { FocalAreaType, SectionKind, SectionSpacing, VenueType } from './enums/event.enum';
import { DEFAULT_SECTION_LEVEL, SectionLevel, VenueLayout, VenueLayoutSection, computeLayoutCapacity } from './venue-layout';
import { FIXED_PITCH } from './focal-area';

export type VenueTemplateKey = 'CONCERT_HALL' | 'ARENA' | 'FOOTBALL_STADIUM' | 'COMEDY_CLUB';

export interface VenueTemplate {
	key: VenueTemplateKey;
	name: string;
	description: string;
	venueType: VenueType;
	layout: VenueLayout;
}

const { SEATED, STANDING } = SectionKind;
const { COMPACT, NORMAL, WIDE } = SectionSpacing;
const { FLOOR, LOWER_TIER, UPPER_TIER } = SectionLevel;

const section = (
	key: string,
	name: string,
	kind: SectionKind,
	level: number,
	rows: number,
	seatsPerRow: number,
	x: number,
	y: number,
	rotation: number,
	spacing: SectionSpacing,
	extra: { tierKey?: string; capacity?: number } = {},
): VenueLayoutSection => ({ key, name, kind, level, rows, seatsPerRow, x, y, rotation, spacing, ...extra });

const stage = (x: number, y: number, width: number, height: number) => ({ type: FocalAreaType.STAGE, x, y, width, height });

export const VENUE_TEMPLATES: VenueTemplate[] = [
	{
		key: 'CONCERT_HALL',
		name: 'Concert hall',
		description: 'A stage at the top, seated floor stalls, side boxes, a lower tier and an upper tier.',
		venueType: VenueType.HALL,
		layout: {
			focalArea: stage(300, 8, 400, 40),
			sections: [
				section('FLOOR', 'Floor Stalls', SEATED, FLOOR, 12, 24, 500, 190, 0, NORMAL, { tierKey: 'PREMIUM' }),
				section('BOX_L', 'Left Boxes', SEATED, LOWER_TIER, 3, 6, 110, 220, 0, WIDE, { tierKey: 'VIP' }),
				section('BOX_R', 'Right Boxes', SEATED, LOWER_TIER, 3, 6, 890, 220, 0, WIDE, { tierKey: 'VIP' }),
				section('LOWER', 'Lower Tier', SEATED, LOWER_TIER, 8, 30, 500, 360, 0, COMPACT, { tierKey: 'GOLD' }),
				section('UPPER', 'Upper Tier', SEATED, UPPER_TIER, 8, 36, 500, 500, 0, COMPACT, { tierKey: 'STANDARD' }),
			],
		},
	},
	{
		key: 'ARENA',
		name: 'Arena',
		description: 'A stage at one end, a standing floor, and lower and upper tiers around the other three sides.',
		venueType: VenueType.HALL,
		layout: {
			focalArea: stage(350, 8, 300, 36),
			sections: [
				section('FLOOR', 'Standing Floor', STANDING, FLOOR, 1, 1, 500, 200, 0, COMPACT, { capacity: 1500 }),
				section('LOWER_L', 'Lower Left', SEATED, LOWER_TIER, 10, 24, 150, 330, 270, COMPACT, { tierKey: 'GOLD' }),
				section('LOWER_R', 'Lower Right', SEATED, LOWER_TIER, 10, 24, 850, 330, 90, COMPACT, { tierKey: 'GOLD' }),
				section('LOWER_END', 'Lower End', SEATED, LOWER_TIER, 8, 30, 500, 520, 180, COMPACT, { tierKey: 'GOLD' }),
				section('UPPER_L', 'Upper Left', SEATED, UPPER_TIER, 6, 24, 45, 330, 270, COMPACT, { tierKey: 'STANDARD' }),
				section('UPPER_R', 'Upper Right', SEATED, UPPER_TIER, 6, 24, 955, 330, 90, COMPACT, { tierKey: 'STANDARD' }),
				section('UPPER_END', 'Upper End', SEATED, UPPER_TIER, 5, 36, 500, 640, 180, COMPACT, { tierKey: 'STANDARD' }),
			],
		},
	},
	{
		key: 'FOOTBALL_STADIUM',
		name: 'Football stadium',
		description: 'A fixed 105:68 pitch in the middle and four stands (north, south, west, east), each with a lower and an upper level.',
		venueType: VenueType.STADIUM,
		layout: {
			// position and size of the pitch are fixed by the server (libs/focal-area.ts), whatever a client sends
			focalArea: { ...FIXED_PITCH },
			sections: [
				section('LOWER_N', 'Lower North', SEATED, LOWER_TIER, 6, 30, 500, 170, 0, COMPACT, { tierKey: 'GOLD' }),
				section('UPPER_N', 'Upper North', SEATED, UPPER_TIER, 5, 36, 500, 98, 0, COMPACT, { tierKey: 'STANDARD' }),
				section('LOWER_S', 'Lower South', SEATED, LOWER_TIER, 6, 30, 500, 530, 180, COMPACT, { tierKey: 'GOLD' }),
				section('UPPER_S', 'Upper South', SEATED, UPPER_TIER, 5, 36, 500, 602, 180, COMPACT, { tierKey: 'STANDARD' }),
				section('LOWER_W', 'Main Stand (West)', SEATED, LOWER_TIER, 6, 22, 250, 350, 270, COMPACT, { tierKey: 'VIP' }),
				section('UPPER_W', 'Upper West', SEATED, UPPER_TIER, 5, 24, 172, 350, 270, COMPACT, { tierKey: 'STANDARD' }),
				section('LOWER_E', 'Lower East', SEATED, LOWER_TIER, 6, 22, 750, 350, 90, COMPACT, { tierKey: 'GOLD' }),
				section('UPPER_E', 'Upper East', SEATED, UPPER_TIER, 5, 24, 828, 350, 90, COMPACT, { tierKey: 'STANDARD' }),
			],
		},
	},
	{
		key: 'COMEDY_CLUB',
		name: 'Comedy club / small theater',
		description: 'A small stage and a few rows: front tables, a main block and back rows, all on the floor.',
		venueType: VenueType.CLUB,
		layout: {
			focalArea: stage(380, 8, 240, 30),
			sections: [
				section('FRONT', 'Front Tables', SEATED, FLOOR, 3, 8, 500, 100, 0, WIDE, { tierKey: 'FRONT' }),
				section('MAIN', 'Main Rows', SEATED, FLOOR, 5, 12, 500, 190, 0, NORMAL, { tierKey: 'STANDARD' }),
				section('BACK', 'Back Rows', SEATED, FLOOR, 4, 14, 500, 270, 0, COMPACT, { tierKey: 'STANDARD' }),
			],
		},
	},
];

export const getVenueTemplate = (key: string): VenueTemplate | undefined => VENUE_TEMPLATES.find((template) => template.key === key);

/** a deep copy of the layout of a template, ready for a new venue; sections without a level are put on the floor */
export const instantiateTemplate = (key: VenueTemplateKey): VenueLayout => {
	const template = getVenueTemplate(key);
	if (!template) throw new Error(`Unknown venue template ${key}`);
	const copy: VenueLayout = JSON.parse(JSON.stringify(template.layout));
	copy.sections.forEach((item) => (item.level = item.level ?? DEFAULT_SECTION_LEVEL));
	return copy;
};

export const getTemplateCapacity = (key: VenueTemplateKey): number => computeLayoutCapacity(instantiateTemplate(key));
