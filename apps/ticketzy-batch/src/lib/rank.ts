/** counters can be missing on old documents; a missing counter counts as 0 */
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** event rank: likes count double, views once (the formula the ranking jobs always used) */
export const getEventRank = (event: { eventLikes?: number; eventViews?: number }): number => count(event.eventLikes) * 2 + count(event.eventViews);

/** organizer rank: events count 5, likes 2, views 1 */
export const getOrganizerRank = (member: { memberEvents?: number; memberLikes?: number; memberViews?: number }): number =>
	count(member.memberEvents) * 5 + count(member.memberLikes) * 2 + count(member.memberViews);
