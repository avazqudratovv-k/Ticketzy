import { ObjectId } from 'bson';
import { DELETED_USER_NAME, EMAIL_REUSE_DAYS, buildBlocker, getEmailReusableAt, getReusableAtOf, maskDeletedMember } from './account-deletion';
import { DeletionBlockReason } from './enums/account.enum';
import { MemberStatus, MemberType } from './enums/member.enum';
import { CommentService } from '../components/comment/comment.service';
import { NotificationService } from '../components/notification/notification.service';
import { PayoutService } from '../components/payout/payout.service';
import { MemberService } from '../components/member/member.service';
import { PayoutStatus } from './enums/payout.enum';
import { lookupActiveOrganizer } from './config';
import MemberSchema from './schemas/Member.model';

const DAY = 24 * 3600 * 1000;
const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('account deletion helpers (DECISIONS #123)', () => {
	it('the email waits 30 days after deletion', () => {
		const deletedAt = new Date('2026-03-01T10:00:00Z');
		expect(EMAIL_REUSE_DAYS).toBe(30);
		expect(getEmailReusableAt(deletedAt)).toEqual(new Date('2026-03-31T10:00:00Z'));
	});

	it('reads the stored date first, then computes it from deletedAt, and has none for a record with neither', () => {
		const stored = new Date('2030-01-01');
		expect(getReusableAtOf({ emailReusableAt: stored, deletedAt: new Date('2026-01-01') })).toEqual(stored);
		expect(getReusableAtOf({ deletedAt: new Date('2026-01-01T00:00:00Z') })).toEqual(new Date('2026-01-31T00:00:00Z'));
		expect(getReusableAtOf({})).toBeNull();
	});

	it('a blocker is built only when there is something to wait for, and lists at most 10 names', () => {
		expect(buildBlocker(DeletionBlockReason.EVENTS_IN_REVIEW, 0, [])).toBeNull();
		const blocker = buildBlocker(DeletionBlockReason.EVENTS_NOT_ENDED, 15, Array.from({ length: 15 }, (_, i) => `e${i}`));
		expect(blocker!.count).toBe(15);
		expect(blocker!.eventNames).toHaveLength(10);
	});

	it('shows a deleted member as "Deleted user" without touching the record or the live ones', () => {
		const deleted: any = { _id: 'd1', memberType: MemberType.USER, memberStatus: MemberStatus.DELETE, memberNick: 'real_nick', memberImage: 'me.png', memberFullName: 'Real Name', memberDesc: 'bio', memberAddress: 'street' };
		const masked: any = maskDeletedMember(deleted);

		expect(masked).toMatchObject({ _id: 'd1', memberStatus: MemberStatus.DELETE, memberNick: DELETED_USER_NAME, memberImage: '' });
		expect(masked.memberFullName).toBeUndefined();
		expect(masked.memberDesc).toBeUndefined();
		expect(masked.memberAddress).toBeUndefined();
		expect(deleted.memberNick).toBe('real_nick');

		const live = { memberStatus: MemberStatus.ACTIVE, memberNick: 'ann' };
		expect(maskDeletedMember(live)).toBe(live);
		expect(maskDeletedMember(null)).toBeNull();
		expect(maskDeletedMember(undefined)).toBeUndefined();
	});
});

describe('public views of a deleted member (DECISIONS #123)', () => {
	it('getComments keeps the comment and shows its author as "Deleted user"', async () => {
		const commentModel: any = {
			aggregate: jest.fn().mockReturnValue(
				exec([
					{
						list: [
							{ _id: 'c1', commentContent: 'hello', memberData: { _id: 'd1', memberStatus: MemberStatus.DELETE, memberNick: 'real_nick', memberImage: 'me.png' } },
							{ _id: 'c2', commentContent: 'hi', memberData: { _id: 'a1', memberStatus: MemberStatus.ACTIVE, memberNick: 'ann', memberImage: 'ann.png' } },
						],
						metaCounter: [{ total: 2 }],
					},
				]),
			),
		};
		const service = new CommentService(commentModel, { assertEventReadable: jest.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any);

		const result: any = await service.getComments(null as any, { page: 1, limit: 5, search: { commentRefId: 'e1' as any } });

		expect(result.list.map((comment: any) => comment.commentContent)).toEqual(['hello', 'hi']);
		expect(result.list[0].memberData).toMatchObject({ memberNick: 'Deleted user', memberImage: '' });
		expect(result.list[1].memberData.memberNick).toBe('ann');
	});

	it('a notification from a deleted author shows "Deleted user" too', async () => {
		const notificationModel: any = {
			aggregate: jest.fn().mockReturnValue(
				exec([{ list: [{ _id: 'n1', authorData: { memberStatus: MemberStatus.DELETE, memberNick: 'real_nick' } }, { _id: 'n2' }], metaCounter: [] }]),
			),
		};
		const service = new NotificationService(notificationModel);

		const result: any = await service.getMyNotifications(new ObjectId() as any, { page: 1, limit: 10 } as any);

		expect(result.list[0].authorData.memberNick).toBe('Deleted user');
		expect(result.list[1].authorData).toBeUndefined();
	});

	it('a deleted member (organizer or not) answers not found on public pages: the profile and the organizer list read ACTIVE members only', async () => {
		const memberModel: any = {
			findOne: jest.fn().mockReturnValue({ lean: () => exec(null) }),
			aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])),
		};
		const service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any, {} as any, { sendVerificationInBackground: jest.fn() } as any);

		await expect(service.getMember(null, new ObjectId() as any)).rejects.toThrow('No data found!');
		expect(memberModel.findOne.mock.calls[0][0].memberStatus).toBe(MemberStatus.ACTIVE);
		// even the deleted member's own id does not open the page: only ACTIVE and PENDING qualify for "self"
		await service.getMember('self' as any, 'self' as any).catch(() => undefined);
		expect(memberModel.findOne.mock.calls[1][0].memberStatus).toEqual({ $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] });

		await service.getOrganizers(null as any, { page: 1, limit: 10, search: {} } as any);
		expect(memberModel.aggregate.mock.calls[0][0][0].$match.memberStatus).toBe(MemberStatus.ACTIVE);
	});

	it('events of a deleted organizer are hidden: public event queries join the organizer and keep ACTIVE ones', () => {
		expect(lookupActiveOrganizer[2]).toEqual({ $match: { 'memberData.memberStatus': MemberStatus.ACTIVE } });
	});

	it('liking a deleted member is refused (ACTIVE members only)', async () => {
		const memberModel: any = { findOne: jest.fn().mockReturnValue(exec(null)) };
		const service = new MemberService(memberModel, {} as any, {} as any, {} as any, {} as any, {} as any, { sendVerificationInBackground: jest.fn() } as any);
		await expect(service.likeTargetMember('m1' as any, 'm2' as any)).rejects.toThrow('No data found!');
		expect(memberModel.findOne.mock.calls[0][0].memberStatus).toBe(MemberStatus.ACTIVE);
	});
});

describe('PayoutService.getOpenPayoutsOf (account deletion check)', () => {
	it('counts NOT_YET_DUE and DUE payouts of the organizer, ignoring NOTHING_TO_PAY and PAID_OUT', async () => {
		const aggregate = jest.fn().mockImplementation((pipeline: any[]) => {
			// the status filter sits in the facet: read which status this call asked for
			const facet = pipeline.find((stage) => stage.$facet).$facet;
			const status = facet.list.find((stage: any) => stage.$match?.payoutStatus)?.$match.payoutStatus;
			if (status === PayoutStatus.DUE) return exec([{ list: [{ eventTitle: 'Due one' }], metaCounter: [{ total: 1 }], totals: [] }]);
			if (status === PayoutStatus.NOT_YET_DUE) return exec([{ list: [{ eventTitle: 'Soon one' }, { eventTitle: 'Soon two' }], metaCounter: [{ total: 2 }], totals: [] }]);
			return exec([{ list: [], metaCounter: [], totals: [] }]);
		});
		const service = new PayoutService({} as any, { aggregate } as any, {} as any, {} as any);
		const organizerId = new ObjectId();

		const open = await service.getOpenPayoutsOf(organizerId as any, 10);

		expect(open).toEqual({ count: 3, eventNames: ['Due one', 'Soon one', 'Soon two'] });
		expect(aggregate).toHaveBeenCalledTimes(2);
		for (const [pipeline] of aggregate.mock.calls) expect(JSON.stringify(pipeline)).toContain(String(organizerId));
	});

	it('is empty when nothing is open', async () => {
		const service = new PayoutService({} as any, { aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [], totals: [] }])) } as any, {} as any, {} as any);
		expect(await service.getOpenPayoutsOf(new ObjectId() as any, 10)).toEqual({ count: 0, eventNames: [] });
	});
});

describe('Member schema indexes (DECISIONS #123)', () => {
	const indexes = MemberSchema.indexes();

	it('has no plain unique index on memberEmail or memberPhone any more, and a unique one on the field plus deletedAt', () => {
		const plain = (field: string) => indexes.filter(([key]) => Object.keys(key).length === 1 && key[field] === 1);
		expect(plain('memberEmail')).toEqual([]);
		expect(plain('memberPhone')).toEqual([]);
		const email = indexes.find(([key]) => key.memberEmail === 1 && key.deletedAt === 1);
		const phone = indexes.find(([key]) => key.memberPhone === 1 && key.deletedAt === 1);
		expect(email![1]).toMatchObject({ unique: true, name: 'memberEmail_1_deletedAt_1' });
		expect(phone![1]).toMatchObject({ unique: true, sparse: true, name: 'memberPhone_1_deletedAt_1' });
	});

	it('keeps the nick unique and reserved: the deleted nick is not freed', () => {
		const nick = (MemberSchema.path('memberNick') as any).options.index;
		expect(nick).toEqual({ unique: true, sparse: true });
	});

	it('the deletion tags exist on the schema', () => {
		for (const field of ['deletedAt', 'emailReusableAt', 'previousAccountId', 'reusedByMemberId']) expect(MemberSchema.path(field)).toBeDefined();
	});
});
