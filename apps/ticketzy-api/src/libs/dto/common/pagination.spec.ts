import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrdinaryInquiry } from './common.input';
import { MAX_ADMIN_EVENTS_LIMIT, MAX_PAGE, MAX_PAGE_LIMIT } from './pagination';
import { OrdersInquiry, OrganizerOrdersInquiry, AdminOrdersInquiry } from '../order/order.input';
import { AttendeesInquiry } from '../sales/sales.input';
import { CommentsInquiry } from '../comment/comment.input';
import { NotificationsInquiry } from '../notification/notification.input';
import { FollowInquiry } from '../follow/follow.input';
import { OrganizersByAdminInquiry } from '../organizer/organizer.input';
import { MembersInquiry, OrganizersInquiry } from '../member/member.input';
import { AuditLogsInquiry } from '../audit-log/audit-log.input';
import { AllNoticesInquiry, NoticesInquiry } from '../notice/notice.input';
import { TicketsInquiry } from '../ticket/ticket.input';
import { VenuesInquiry } from '../venue/venue.input';
import { EventsByAdminInquiry, EventsInquiry, OrganizerEventsInquiry } from '../event/event.input';
import { PayoutsInquiry } from '../payout/payout.input';

/** every list query input; the admin event list is the only one allowed more than 100 rows */
const INQUIRIES: [string, new () => object][] = [
	['OrdinaryInquiry', OrdinaryInquiry],
	['OrdersInquiry', OrdersInquiry],
	['OrganizerOrdersInquiry', OrganizerOrdersInquiry],
	['AdminOrdersInquiry', AdminOrdersInquiry],
	['AttendeesInquiry', AttendeesInquiry],
	['CommentsInquiry', CommentsInquiry],
	['NotificationsInquiry', NotificationsInquiry],
	['FollowInquiry', FollowInquiry],
	['OrganizersByAdminInquiry', OrganizersByAdminInquiry],
	['MembersInquiry', MembersInquiry],
	['OrganizersInquiry', OrganizersInquiry],
	['AuditLogsInquiry', AuditLogsInquiry],
	['NoticesInquiry', NoticesInquiry],
	['AllNoticesInquiry', AllNoticesInquiry],
	['TicketsInquiry', TicketsInquiry],
	['VenuesInquiry', VenuesInquiry],
	['EventsInquiry', EventsInquiry],
	['OrganizerEventsInquiry', OrganizerEventsInquiry],
	['PayoutsInquiry', PayoutsInquiry],
];

/** the errors that concern page or limit (other fields of the input are not under test here) */
const pagingErrors = async (type: new () => object, values: { page?: unknown; limit?: unknown }): Promise<string[]> => {
	const errors = await validate(plainToInstance(type, values) as object);
	return errors.filter((error) => ['page', 'limit'].includes(error.property)).map((error) => error.property);
};

describe('page and limit bounds on every list query', () => {
	it('the bounds are 100 rows and page 10000', () => {
		expect([MAX_PAGE_LIMIT, MAX_PAGE, MAX_ADMIN_EVENTS_LIMIT]).toEqual([100, 10000, 200]);
	});

	it.each(INQUIRIES)('%s accepts the edges (page 1, limit 1) and (page 10000, limit 100)', async (_name, type) => {
		expect(await pagingErrors(type, { page: 1, limit: 1 })).toEqual([]);
		expect(await pagingErrors(type, { page: MAX_PAGE, limit: MAX_PAGE_LIMIT })).toEqual([]);
	});

	it.each(INQUIRIES)('%s refuses limit 101, limit 0, limit 2000000000 and a fractional limit', async (_name, type) => {
		for (const limit of [101, 0, -1, 2000000000, 1.5]) {
			expect(await pagingErrors(type, { page: 1, limit })).toContain('limit');
		}
	});

	it.each(INQUIRIES)('%s refuses page 0, page 10001 and a fractional page', async (_name, type) => {
		for (const page of [0, -3, MAX_PAGE + 1, 2.5]) {
			expect(await pagingErrors(type, { page, limit: 10 })).toContain('page');
		}
	});

	it.each(INQUIRIES)('%s refuses a missing page or limit (the schema default fills them before validation)', async (_name, type) => {
		expect(await pagingErrors(type, { limit: 10 })).toContain('page');
		expect(await pagingErrors(type, { page: 1 })).toContain('limit');
	});

	it('the admin event list keeps room for the 200 rows the dashboard asks for, and stops there', async () => {
		expect(await pagingErrors(EventsByAdminInquiry, { page: 1, limit: 200 })).toEqual([]);
		expect(await pagingErrors(EventsByAdminInquiry, { page: 1, limit: 201 })).toContain('limit');
	});
});
