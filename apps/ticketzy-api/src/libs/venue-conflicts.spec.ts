import { EventStatus } from './enums/event.enum';
import {
	buildVenueClashFilter,
	formatVenueBookedMessage,
	formatVenueTime,
	looksLikeSamePlace,
	normalizeVenueCity,
	normalizeVenueName,
	rangesOverlap,
	venueBlockingStatuses,
} from './venue-conflicts';

const d = (hour: number) => new Date(Date.UTC(2031, 0, 1, hour));

describe('rangesOverlap', () => {
	it.each([
		['exact', 10, 12, 10, 12, true],
		['partial start', 10, 12, 9, 11, true],
		['partial end', 10, 12, 11, 13, true],
		['contained', 10, 12, 10.5 as any, 11, true],
		['containing', 10, 12, 9, 13, true],
		['touching: other ends when this starts', 10, 12, 8, 10, false],
		['touching: other starts when this ends', 10, 12, 12, 14, false],
		['apart', 10, 12, 14, 16, false],
	])('%s', (_name, a1, a2, b1, b2, expected) => {
		const at = (h: number) => new Date(Date.UTC(2031, 0, 1, Math.floor(h), (h % 1) * 60));
		expect(rangesOverlap(at(a1), at(a2), at(b1), at(b2))).toBe(expected);
	});
});

describe('venue place matching', () => {
	it('normalizes names: trim, lowercase, punctuation and repeated spaces', () => {
		expect(normalizeVenueName('  Olympic   Hall! ')).toBe('olympic hall');
		expect(normalizeVenueName("Olympic-Hall (Main)")).toBe('olympic hall main');
		expect(normalizeVenueName('올림픽 홀')).toBe('올림픽 홀');
		expect(normalizeVenueName(undefined)).toBe('');
	});

	it('normalizes cities with trim, lowercase and collapsed spaces only', () => {
		expect(normalizeVenueCity('  Seoul ')).toBe('seoul');
		expect(normalizeVenueCity('New   York')).toBe('new york');
	});

	it('same city and same normalized name is the same place', () => {
		expect(looksLikeSamePlace({ venueName: 'Olympic Hall', venueCity: 'Seoul' }, { venueName: 'olympic  hall.', venueCity: ' SEOUL' })).toBe(true);
	});

	it('another city or another name is not', () => {
		expect(looksLikeSamePlace({ venueName: 'Olympic Hall', venueCity: 'Seoul' }, { venueName: 'Olympic Hall', venueCity: 'Busan' })).toBe(false);
		expect(looksLikeSamePlace({ venueName: 'Olympic Hall', venueCity: 'Seoul' }, { venueName: 'Olympic Park', venueCity: 'Seoul' })).toBe(false);
		expect(looksLikeSamePlace({ venueName: '', venueCity: 'Seoul' }, { venueName: '!!', venueCity: 'Seoul' })).toBe(false);
	});

	it('the same coordinates are the same place whatever the names are; missing coordinates never match', () => {
		expect(looksLikeSamePlace({ venueCoordinates: [127.1, 37.5], venueName: 'A', venueCity: 'X' }, { venueCoordinates: [127.1, 37.5], venueName: 'B', venueCity: 'Y' })).toBe(true);
		expect(looksLikeSamePlace({ venueCoordinates: [127.1, 37.5], venueName: 'A', venueCity: 'X' }, { venueCoordinates: [127.2, 37.5], venueName: 'B', venueCity: 'Y' })).toBe(false);
		expect(looksLikeSamePlace({ venueCoordinates: [], venueName: 'A', venueCity: 'X' }, { venueCoordinates: [], venueName: 'B', venueCity: 'Y' })).toBe(false);
	});

	it('the same record is the same place', () => {
		expect(looksLikeSamePlace({ _id: 'v1', venueName: 'A', venueCity: 'X' }, { _id: 'v1', venueName: 'B', venueCity: 'Y' })).toBe(true);
	});
});

describe('clash filter and message', () => {
	it('blocks with PENDING, APPROVED and ENDED only', () => {
		expect(venueBlockingStatuses).toEqual([EventStatus.PENDING, EventStatus.APPROVED, EventStatus.ENDED]);
	});

	it('builds a half-open interval filter that skips the event itself', () => {
		const filter = buildVenueClashFilter('v1' as any, d(10), d(12), 'self' as any);
		expect(filter).toMatchObject({ venueId: 'v1', startAt: { $lt: d(12) }, endAt: { $gt: d(10) }, _id: { $ne: 'self' } });
		expect(buildVenueClashFilter('v1' as any, d(10), d(12))).not.toHaveProperty('_id');
	});

	it('formats on the venue wall clock, falls back to Seoul for a missing or unknown zone', () => {
		expect(formatVenueTime(d(10), 'Asia/Seoul')).toBe('2031-01-01 19:00');
		expect(formatVenueTime(d(10), 'America/New_York')).toBe('2031-01-01 05:00');
		expect(formatVenueTime(d(10))).toBe('2031-01-01 19:00');
		expect(formatVenueTime(d(10), 'Not/AZone')).toBe('2031-01-01 19:00');
	});

	it('fills the message template', () => {
		expect(formatVenueBookedMessage({ eventTitle: 'Rock Night', startAt: d(10), endAt: d(12) }, 'UTC')).toBe(
			'This venue is already booked for Rock Night from 2031-01-01 10:00 to 2031-01-01 12:00.',
		);
	});
});
