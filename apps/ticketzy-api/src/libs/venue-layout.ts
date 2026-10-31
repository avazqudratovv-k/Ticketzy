import { Message } from './enums/common.enum';
import { SectionKind, SectionSpacing } from './enums/event.enum';
import { FocalArea, FocalAreaInput, getFocalAreaError } from './focal-area';

export const MAX_SEAT_GRID = 100;

/** where a section sits for the 3D "view from seat": 0 floor, 1 lower tier, 2 upper tier (DECISIONS #128) */
export const SectionLevel = { FLOOR: 0, LOWER_TIER: 1, UPPER_TIER: 2 } as const;
export const DEFAULT_SECTION_LEVEL = SectionLevel.FLOOR;
export const isSectionLevel = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2;

export interface VenueLayoutSection {
	key: string;
	name: string;
	kind: SectionKind;
	rows: number;
	seatsPerRow: number;
	capacity?: number;
	x: number;
	y: number;
	rotation: number;
	spacing: SectionSpacing;
	tierKey?: string;
	/** missing means 0 (floor) */
	level?: number;
}

export interface VenueLayout {
	sections: VenueLayoutSection[];
	/** missing on layouts saved before focal areas; they read as the default stage */
	focalArea?: FocalArea;
}

const isGridSize = (value: unknown): boolean =>
	Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SEAT_GRID;

export const isValidTimezone = (timezone: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: timezone });
		return true;
	} catch {
		return false;
	}
};

/** The first reason a layout is invalid, or null. The client never sends the capacity of a venue: see computeLayoutCapacity. */
export const getVenueLayoutError = (layout: VenueLayout | null | undefined): Message | null => {
	if (!layout?.sections?.length) return Message.VENUE_LAYOUT_NO_SECTIONS;

	const keys = new Set<string>();
	for (const section of layout.sections) {
		const key = section.key?.trim();
		if (!key) return Message.INVALID_VENUE_LAYOUT;
		if (keys.has(key)) return Message.VENUE_LAYOUT_DUPLICATE_SECTION_KEY;
		keys.add(key);

		if (!isGridSize(section.rows) || !isGridSize(section.seatsPerRow)) return Message.VENUE_LAYOUT_BAD_SEAT_GRID;
		if (section.kind === SectionKind.STANDING && !(Number.isInteger(section.capacity) && section.capacity >= 1)) {
			return Message.VENUE_LAYOUT_CAPACITY_REQUIRED;
		}
		if (section.kind === SectionKind.SEATED && !section.tierKey?.trim()) return Message.VENUE_LAYOUT_TIER_KEY_REQUIRED;
		if (section.level !== undefined && section.level !== null && !isSectionLevel(section.level)) return Message.VENUE_LAYOUT_BAD_LEVEL;
	}
	// the focal area from a client: a PITCH with other geometry than the fixed one is refused, a STAGE must lie inside the canvas
	return getFocalAreaError(layout.focalArea as unknown as FocalAreaInput);
};

/** seats of a SEATED section, the capacity of a STANDING one */
export const getSectionCapacity = (section: VenueLayoutSection): number =>
	section.kind === SectionKind.STANDING ? section.capacity : section.rows * section.seatsPerRow;

export const computeLayoutCapacity = (layout: VenueLayout): number =>
	layout.sections.reduce((sum, section) => sum + getSectionCapacity(section), 0);

export const getSeatedSections = (layout: VenueLayout | null | undefined): VenueLayoutSection[] =>
	(layout?.sections ?? []).filter((section) => section.kind === SectionKind.SEATED);

/** tier keys of SEATED sections that no ticket type covers */
export const getMissingTierKeys = (layout: VenueLayout | null | undefined, ticketTypeTierKeys: (string | undefined)[]): string[] => {
	const covered = new Set(ticketTypeTierKeys.filter(Boolean));
	return [...new Set(getSeatedSections(layout).map((section) => section.tierKey))].filter((tierKey) => !covered.has(tierKey));
};

/** seats of every SEATED section of a tier */
export const countTierSeats = (layout: VenueLayout | null | undefined, tierKey: string): number =>
	getSeatedSections(layout)
		.filter((section) => section.tierKey === tierKey)
		.reduce((sum, section) => sum + section.rows * section.seatsPerRow, 0);

export interface SeatIdentity {
	sectionKey: string;
	row: number;
	number: number;
	tierKey: string;
}

/** every seat of the layout, rows and numbers counted from 1 */
export const listLayoutSeats = (layout: VenueLayout): SeatIdentity[] => {
	const seats: SeatIdentity[] = [];
	for (const section of getSeatedSections(layout)) {
		for (let row = 1; row <= section.rows; row++) {
			for (let number = 1; number <= section.seatsPerRow; number++) {
				seats.push({ sectionKey: section.key, row, number, tierKey: section.tierKey });
			}
		}
	}
	return seats;
};
