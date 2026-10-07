/** offset of `timeZone` from UTC at the instant `at`, in milliseconds */
const getZoneOffsetMs = (at: Date, timeZone: string): number => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	}).formatToParts(at);
	const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return asUtc - Math.floor(at.getTime() / 1000) * 1000;
};

/** the instant (UTC) at which the calendar day year-month-day starts in `timeZone`; two passes keep DST changes right */
const getZonedDayStart = (year: number, month: number, day: number, timeZone: string): Date => {
	const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
	const first = guess - getZoneOffsetMs(new Date(guess), timeZone);
	const second = guess - getZoneOffsetMs(new Date(first), timeZone);
	return new Date(second);
};

/** the year, month and day of `at` as they are on the wall clock in `timeZone` */
const getZonedDate = (at: Date, timeZone: string): { year: number; month: number; day: number } => {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
	const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
	return { year: get('year'), month: get('month'), day: get('day') };
};

/**
 * The last moment a buyer may still refund: the end of 23:59 on the day before the event starts, on the wall clock of the
 * venue's timezone. Returned as a UTC instant (what the database stores).
 */
export const getRefundDeadline = (startAt: Date | string, venueTimezone: string): Date => {
	const { year, month, day } = getZonedDate(new Date(startAt), venueTimezone);
	const startOfEventDay = getZonedDayStart(year, month, day, venueTimezone);
	return new Date(startOfEventDay.getTime() - 1);
};

export const isBeforeRefundDeadline = (startAt: Date | string, venueTimezone: string, now: Date = new Date()): boolean =>
	now.getTime() <= getRefundDeadline(startAt, venueTimezone).getTime();
