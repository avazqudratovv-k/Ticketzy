import { Message } from './enums/common.enum';
import { SectionKind, SectionSpacing } from './enums/event.enum';
import {
	computeLayoutCapacity,
	countTierSeats,
	getMissingTierKeys,
	getVenueLayoutError,
	isValidTimezone,
	listLayoutSeats,
} from './venue-layout';

const seated = (over: any = {}) => ({
	key: 'A',
	name: 'Floor A',
	kind: SectionKind.SEATED,
	rows: 2,
	seatsPerRow: 3,
	x: 0,
	y: 0,
	rotation: 0,
	spacing: SectionSpacing.NORMAL,
	tierKey: 'vip',
	...over,
});
const standing = (over: any = {}) => seated({ key: 'S', kind: SectionKind.STANDING, capacity: 50, tierKey: undefined, ...over });
const layoutOf = (...sections: any[]) => ({ sections });

describe('getVenueLayoutError', () => {
	it('accepts a seated and a standing section', () => {
		expect(getVenueLayoutError(layoutOf(seated(), standing()))).toBeNull();
	});

	it.each([[undefined], [null], [{ sections: [] }]])('needs at least one section (%j)', (layout: any) => {
		expect(getVenueLayoutError(layout)).toBe(Message.VENUE_LAYOUT_NO_SECTIONS);
	});

	it('needs unique section keys', () => {
		expect(getVenueLayoutError(layoutOf(seated(), seated({ tierKey: 'other' })))).toBe(Message.VENUE_LAYOUT_DUPLICATE_SECTION_KEY);
	});

	it('needs a section key', () => {
		expect(getVenueLayoutError(layoutOf(seated({ key: '  ' })))).toBe(Message.INVALID_VENUE_LAYOUT);
	});

	it.each([0, 101, -1, 1.5, NaN, undefined])('rejects rows = %s', (rows: any) => {
		expect(getVenueLayoutError(layoutOf(seated({ rows })))).toBe(Message.VENUE_LAYOUT_BAD_SEAT_GRID);
	});

	it.each([0, 101, 2.5, undefined])('rejects seatsPerRow = %s', (seatsPerRow: any) => {
		expect(getVenueLayoutError(layoutOf(seated({ seatsPerRow })))).toBe(Message.VENUE_LAYOUT_BAD_SEAT_GRID);
	});

	it.each([1, 100])('accepts the bounds (%s)', (size) => {
		expect(getVenueLayoutError(layoutOf(seated({ rows: size, seatsPerRow: size })))).toBeNull();
	});

	it.each([undefined, 0, -5, 2.5])('needs a capacity for a STANDING section (capacity = %s)', (capacity: any) => {
		expect(getVenueLayoutError(layoutOf(standing({ capacity })))).toBe(Message.VENUE_LAYOUT_CAPACITY_REQUIRED);
	});

	it('needs a tier key for a SEATED section, not for a STANDING one', () => {
		expect(getVenueLayoutError(layoutOf(seated({ tierKey: undefined })))).toBe(Message.VENUE_LAYOUT_TIER_KEY_REQUIRED);
		expect(getVenueLayoutError(layoutOf(seated({ tierKey: ' ' })))).toBe(Message.VENUE_LAYOUT_TIER_KEY_REQUIRED);
		expect(getVenueLayoutError(layoutOf(standing()))).toBeNull();
	});
});

describe('computeLayoutCapacity', () => {
	it('adds rows x seatsPerRow of seated sections and the capacity of standing sections', () => {
		expect(computeLayoutCapacity(layoutOf(seated(), seated({ key: 'B', rows: 10, seatsPerRow: 10 }), standing()))).toBe(6 + 100 + 50);
	});

	it('ignores rows and seatsPerRow of a standing section', () => {
		expect(computeLayoutCapacity(layoutOf(standing({ rows: 9, seatsPerRow: 9, capacity: 20 })))).toBe(20);
	});
});

describe('tiers and seats', () => {
	const layout = layoutOf(seated(), seated({ key: 'B', rows: 1, seatsPerRow: 4 }), seated({ key: 'C', tierKey: 'regular' }), standing());

	it('counts the seats of every seated section of a tier', () => {
		expect(countTierSeats(layout, 'vip')).toBe(10);
		expect(countTierSeats(layout, 'regular')).toBe(6);
		expect(countTierSeats(layout, 'nope')).toBe(0);
		expect(countTierSeats(undefined, 'vip')).toBe(0);
	});

	it('lists the tier keys no ticket type covers, once each', () => {
		expect(getMissingTierKeys(layout, ['vip'])).toEqual(['regular']);
		expect(getMissingTierKeys(layout, [undefined])).toEqual(['vip', 'regular']);
		expect(getMissingTierKeys(layout, ['vip', 'regular', 'extra'])).toEqual([]);
	});

	it('lists every seat once, counting rows and numbers from 1, and skips standing sections', () => {
		const seats = listLayoutSeats(layoutOf(seated(), standing()));
		expect(seats).toHaveLength(6);
		expect(seats[0]).toEqual({ sectionKey: 'A', row: 1, number: 1, tierKey: 'vip' });
		expect(seats[5]).toEqual({ sectionKey: 'A', row: 2, number: 3, tierKey: 'vip' });
		expect(new Set(seats.map((s) => `${s.sectionKey}|${s.row}|${s.number}`)).size).toBe(6);
	});
});

describe('isValidTimezone', () => {
	it.each(['Asia/Seoul', 'Asia/Tashkent', 'UTC', 'America/New_York'])('accepts %s', (zone) => {
		expect(isValidTimezone(zone)).toBe(true);
	});

	it.each(['Seoul', 'Mars/Olympus', '', 'GMT+99'])('rejects %j', (zone) => {
		expect(isValidTimezone(zone)).toBe(false);
	});
});
