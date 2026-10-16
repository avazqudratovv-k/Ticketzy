import { BadRequestException } from '@nestjs/common';
import { OrganizerService } from './organizer.service';
import { Message } from '../../libs/enums/common.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { MemberStatus, MemberType, OrganizerAction, organizerTransitions } from '../../libs/enums/member.enum';
import { NotificationType } from '../../libs/enums/notification.enum';
import { NotificationService } from '../notification/notification.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const ADMIN = 'admin-1';
const ORG = 'org-1';
const allStatuses = Object.values(MemberStatus);

/** tiny in-memory stand-in for the member collection: it applies the status condition of the filter like MongoDB would */
const fakeMemberModel = (members: any[]) => {
	const matches = (filter: any) => (m: any) =>
		(filter._id === undefined || m._id === filter._id) &&
		(filter.memberType === undefined || m.memberType === filter.memberType) &&
		(filter.commissionOverride === undefined || (filter.commissionOverride.$ne === null && m.commissionOverride != null)) &&
		(filter.memberStatus === undefined ||
			(filter.memberStatus.$in
				? filter.memberStatus.$in.includes(m.memberStatus)
				: filter.memberStatus.$ne
					? m.memberStatus !== filter.memberStatus.$ne
					: m.memberStatus === filter.memberStatus));
	return {
		findOneAndUpdate: jest.fn((filter: any, update: any, options: any = {}) => ({
			exec: async () => {
				const found = members.find(matches(filter));
				if (!found) return null;
				const before = { ...found };
				if (update.$set) Object.assign(found, update.$set);
				if (update.$unset) for (const key of Object.keys(update.$unset)) delete found[key];
				if (!update.$set && !update.$unset) Object.assign(found, update);
				return options.new === false ? before : found;
			},
		})),
		findOne: jest.fn((filter: any) => ({ lean: () => ({ exec: async () => members.find(matches(filter)) ?? null }) })),
		findById: jest.fn((id: string) => ({ exec: async () => members.find((m) => m._id === id) ?? null })),
	};
};

describe('OrganizerService status transitions', () => {
	let members: any[];
	let model: any;
	let auditLogService: any;
	let notificationService: any;
	let service: OrganizerService;
	let realtime: any;

	const run = (action: OrganizerAction): Promise<any> => {
		switch (action) {
			case 'verify':
				return service.verifyOrganizerByAdmin(ADMIN as any, ORG as any);
			case 'reject':
				return service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Documents are unreadable' });
			case 'suspend':
				return service.suspendOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Refund abuse' });
			case 'reinstate':
				return service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);
		}
	};

	beforeEach(() => {
		members = [{ _id: ORG, memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.PENDING }];
		model = fakeMemberModel(members);
		auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
		notificationService = { createNotification: jest.fn().mockResolvedValue(undefined) };
		realtime = { setMemberRestricted: jest.fn() };
		service = new OrganizerService(model, auditLogService, notificationService, realtime);
	});

	describe.each(Object.keys(organizerTransitions) as OrganizerAction[])('%s', (action) => {
		const { from, to } = organizerTransitions[action];

		it.each(allStatuses.filter((s) => from.includes(s)))('is allowed from %s and ends ACTIVE/REJECTED/SUSPENDED as defined', async (status) => {
			members[0].memberStatus = status;

			const result = await run(action);

			expect(result.memberStatus).toBe(to);
			expect(auditLogService.record).toHaveBeenCalledTimes(1);
			expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
		});

		it.each(allStatuses.filter((s) => !from.includes(s)))('is refused from %s with INVALID_STATUS_TRANSITION and changes nothing', async (status) => {
			members[0].memberStatus = status;

			await expect(run(action)).rejects.toThrow(Message.INVALID_STATUS_TRANSITION);

			expect(members[0].memberStatus).toBe(status);
			expect(auditLogService.record).not.toHaveBeenCalled();
			expect(notificationService.createNotification).not.toHaveBeenCalled();
		});
	});

	it('the rules are: verify and reject from PENDING, suspend from ACTIVE, reinstate from SUSPENDED or REJECTED', () => {
		expect(organizerTransitions.verify).toEqual({ from: [MemberStatus.PENDING], to: MemberStatus.ACTIVE });
		expect(organizerTransitions.reject).toEqual({ from: [MemberStatus.PENDING], to: MemberStatus.REJECTED });
		expect(organizerTransitions.suspend).toEqual({ from: [MemberStatus.ACTIVE], to: MemberStatus.SUSPENDED });
		expect(organizerTransitions.reinstate).toEqual({
			from: [MemberStatus.SUSPENDED, MemberStatus.REJECTED],
			to: MemberStatus.ACTIVE,
		});
	});

	it('answers NO_ORGANIZER_FOUND for an unknown member and for a member that is not an organizer', async () => {
		members.push({ _id: 'user-1', memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE });

		await expect(service.verifyOrganizerByAdmin(ADMIN as any, 'nobody' as any)).rejects.toThrow(Message.NO_ORGANIZER_FOUND);
		await expect(service.suspendOrganizerByAdmin(ADMIN as any, { memberId: 'user-1' as any, reason: 'x' })).rejects.toThrow(
			Message.NO_ORGANIZER_FOUND,
		);
		expect(members[1].memberStatus).toBe(MemberStatus.ACTIVE);
	});

	it('makes the status change in ONE conditional update that names the allowed starting statuses', async () => {
		await service.verifyOrganizerByAdmin(ADMIN as any, ORG as any);

		const [filter] = model.findOneAndUpdate.mock.calls[0];
		expect(filter).toEqual({ _id: ORG, memberType: MemberType.ORGANIZER, memberStatus: { $in: [MemberStatus.PENDING] } });
	});

	describe('rejectReason', () => {
		it('is saved on reject', async () => {
			const result = await service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: '  Incomplete profile  ' });

			expect(result.memberStatus).toBe(MemberStatus.REJECTED);
			expect(result.rejectReason).toBe('Incomplete profile');
		});

		it('is cleared when the organizer is reinstated', async () => {
			await service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Incomplete profile' });

			const result = await service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);

			expect(result.memberStatus).toBe(MemberStatus.ACTIVE);
			expect(result.rejectReason).toBeUndefined();
		});
	});

	describe('required reasons', () => {
		it.each(['', '   ', '\n\t'])('reject refuses the blank reason %j', async (reason) => {
			await expect(service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason })).rejects.toThrow(
				Message.REJECT_REASON_REQUIRED,
			);

			expect(model.findOneAndUpdate).not.toHaveBeenCalled();
			expect(members[0].memberStatus).toBe(MemberStatus.PENDING);
			expect(auditLogService.record).not.toHaveBeenCalled();
		});

		it.each(['', '   '])('suspend refuses the blank reason %j', async (reason) => {
			members[0].memberStatus = MemberStatus.ACTIVE;

			await expect(service.suspendOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason })).rejects.toThrow(
				Message.SUSPEND_REASON_REQUIRED,
			);

			expect(members[0].memberStatus).toBe(MemberStatus.ACTIVE);
		});

		it('commission override refuses a blank reason', async () => {
			await expect(
				service.setCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, rate: 5, reason: ' ' }),
			).rejects.toThrow(Message.COMMISSION_REASON_REQUIRED);
			expect(model.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('every missing-reason error is a 400', async () => {
			const err: any = await service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: '' }).catch((e) => e);
			expect(err).toBeInstanceOf(BadRequestException);
		});
	});

	describe('audit log and notification', () => {
		it('write one audit entry and notify the organizer, with the reason and both statuses', async () => {
			await service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Documents are unreadable' });

			expect(auditLogService.record).toHaveBeenCalledWith({
				actorId: ADMIN,
				action: AuditAction.ORGANIZER_REJECTED,
				targetType: AuditTargetType.MEMBER,
				targetId: ORG,
				meta: { fromStatus: MemberStatus.PENDING, toStatus: MemberStatus.REJECTED, reason: 'Documents are unreadable' },
			});
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					notificationType: NotificationType.ORGANIZER_REJECTED,
					authorId: ADMIN,
					receiverId: ORG,
					notificationDesc: 'Documents are unreadable',
				}),
			);
		});

		it('a notification that fails to save never blocks the action (real NotificationService, broken database)', async () => {
			const brokenNotifications = new NotificationService({ create: jest.fn().mockRejectedValue(new Error('db down')) } as any);
			const withRealNotifications = new OrganizerService(model, auditLogService, brokenNotifications, realtime);

			const result = await withRealNotifications.verifyOrganizerByAdmin(ADMIN as any, ORG as any);

			expect(result.memberStatus).toBe(MemberStatus.ACTIVE);
			expect(auditLogService.record).toHaveBeenCalledTimes(1);
		});

		it('a failing audit write never blocks the action either', async () => {
			const brokenAudit = new AuditLogService({ create: jest.fn().mockRejectedValue(new Error('db down')) } as any);
			const withBrokenAudit = new OrganizerService(model, brokenAudit, notificationService, realtime);

			const result = await withBrokenAudit.verifyOrganizerByAdmin(ADMIN as any, ORG as any);

			expect(result.memberStatus).toBe(MemberStatus.ACTIVE);
			expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
		});
	});

	describe('setCommissionOverrideByAdmin', () => {
		it('saves rate, end date and reason, writes an audit entry and notifies', async () => {
			const endsAt = new Date(Date.now() + 86400000);

			const result = await service.setCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, rate: 7.5, endsAt, reason: ' Launch partner ' });

			expect(result.commissionOverride).toEqual({ rate: 7.5, endsAt, reason: 'Launch partner' });
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: AuditAction.COMMISSION_OVERRIDE_SET, meta: { rate: 7.5, endsAt, reason: 'Launch partner' } }),
			);
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: NotificationType.COMMISSION_UPDATED, receiverId: ORG }),
			);
		});

		it.each([-1, 100.5, NaN])('refuses the rate %p', async (rate) => {
			await expect(service.setCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, rate, reason: 'x' })).rejects.toThrow(
				Message.INVALID_COMMISSION_RATE,
			);
		});

		it('refuses an end date in the past', async () => {
			await expect(
				service.setCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, rate: 5, endsAt: new Date(Date.now() - 1000), reason: 'x' }),
			).rejects.toThrow(Message.INVALID_COMMISSION_END_DATE);
		});
	});
});

describe('OrganizerService.clearCommissionOverrideByAdmin', () => {
	const override = { rate: 3, endsAt: new Date(Date.now() + 86400000), reason: 'Launch partner' };
	let members: any[];
	let auditLogService: any;
	let notificationService: any;
	let service: OrganizerService;

	beforeEach(() => {
		members = [
			{ _id: ORG, memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, completedEvents: 6, commissionOverride: override },
			{ _id: 'plain', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, completedEvents: 0 },
			{ _id: 'user', memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, commissionOverride: override },
		];
		auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
		notificationService = { createNotification: jest.fn().mockResolvedValue(undefined) };
		service = new OrganizerService(fakeMemberModel(members) as any, auditLogService, notificationService, { setMemberRestricted: jest.fn() } as any);
	});

	it('removes the override and answers with the previous override, the reason and the automatic tier rate', async () => {
		const result = await service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: ' Deal ended ' });

		expect(members[0].commissionOverride).toBeUndefined();
		expect(result.member._id).toBe(ORG);
		expect(result.previousOverride).toEqual(override);
		expect(result.automaticRate).toBe(7); // 6 completed events
		expect(result.reason).toBe('Deal ended');
		expect(result.clearedAt).toBeInstanceOf(Date);
	});

	it('writes an audit entry with the removed values and notifies the organizer', async () => {
		await service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Deal ended' });

		expect(auditLogService.record).toHaveBeenCalledWith({
			actorId: ADMIN,
			action: AuditAction.COMMISSION_OVERRIDE_CLEARED,
			targetType: AuditTargetType.MEMBER,
			targetId: ORG,
			meta: { previousRate: 3, previousEndsAt: override.endsAt, previousReason: 'Launch partner', reason: 'Deal ended' },
		});
		expect(notificationService.createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ notificationType: NotificationType.COMMISSION_UPDATED, receiverId: ORG, authorId: ADMIN }),
		);
	});

	it('the cleared organizer is charged the automatic rate again', async () => {
		const { getCommissionRate } = require('../../libs/commission');
		expect(getCommissionRate(members[0])).toBe(3);
		await service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' });
		expect(getCommissionRate(members[0])).toBe(7);
	});

	it('refuses a blank reason without touching anything', async () => {
		await expect(service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: '  ' })).rejects.toThrow(
			Message.COMMISSION_CLEAR_REASON_REQUIRED,
		);
		expect(members[0].commissionOverride).toBe(override);
	});

	it('refuses an organizer without an override, so a second clear does nothing and is not audited twice', async () => {
		await expect(service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: 'plain' as any, reason: 'x' })).rejects.toThrow(
			Message.NO_COMMISSION_OVERRIDE,
		);
		await service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' });
		await expect(service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' })).rejects.toThrow(
			Message.NO_COMMISSION_OVERRIDE,
		);
		expect(auditLogService.record).toHaveBeenCalledTimes(1);
		expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
	});

	it('refuses a member that is not an organizer, and an unknown id', async () => {
		await expect(service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: 'user' as any, reason: 'x' })).rejects.toThrow(Message.NO_ORGANIZER_FOUND);
		await expect(service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: 'nope' as any, reason: 'x' })).rejects.toThrow(Message.NO_ORGANIZER_FOUND);
		expect(members[2].commissionOverride).toBe(override);
	});

	it('setCommissionOverrideByAdmin still works after a clear', async () => {
		await service.clearCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' });
		const result = await service.setCommissionOverrideByAdmin(ADMIN as any, { memberId: ORG as any, rate: 2, reason: 'again' });
		expect(result.commissionOverride).toEqual({ rate: 2, endsAt: undefined, reason: 'again' });
	});
});

describe('OrganizerService socket cut-off', () => {
	const build = (status: MemberStatus) => {
		const members: any[] = [{ _id: ORG, memberType: MemberType.ORGANIZER, memberStatus: status }];
		const realtime: any = { setMemberRestricted: jest.fn() };
		const notifications: any = { createNotification: jest.fn().mockResolvedValue(undefined) };
		const service = new OrganizerService(fakeMemberModel(members) as any, { record: jest.fn() } as any, notifications, realtime);
		return { service, realtime };
	};

	it('reject and suspend restrict the sockets of the organizer', async () => {
		const a = build(MemberStatus.PENDING);
		await a.service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'bad documents' });
		expect(a.realtime.setMemberRestricted).toHaveBeenCalledWith(ORG, true);

		const b = build(MemberStatus.ACTIVE);
		await b.service.suspendOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'abuse' });
		expect(b.realtime.setMemberRestricted).toHaveBeenCalledWith(ORG, true);
	});

	it('verify and reinstate lift the restriction', async () => {
		const a = build(MemberStatus.PENDING);
		await a.service.verifyOrganizerByAdmin(ADMIN as any, ORG as any);
		expect(a.realtime.setMemberRestricted).toHaveBeenCalledWith(ORG, false);

		const b = build(MemberStatus.SUSPENDED);
		await b.service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);
		expect(b.realtime.setMemberRestricted).toHaveBeenCalledWith(ORG, false);
	});

	it('an invalid transition touches no socket, and a failing realtime never fails the action', async () => {
		const a = build(MemberStatus.ACTIVE);
		await expect(a.service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' })).rejects.toThrow(Message.INVALID_STATUS_TRANSITION);
		expect(a.realtime.setMemberRestricted).not.toHaveBeenCalled();

		const b = build(MemberStatus.ACTIVE);
		b.realtime.setMemberRestricted.mockImplementation(() => {
			throw new Error('boom');
		});
		await expect(b.service.suspendOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'x' })).resolves.toBeDefined();
	});
});

describe('OrganizerService.getOrganizersByAdmin', () => {
	it('lists organizers only, filters by status, and searches name, nick and email with escaped text', async () => {
		const memberModel: any = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }) };
		const service = new OrganizerService(memberModel, {} as any, {} as any, {} as any);

		await service.getOrganizersByAdmin({ page: 2, limit: 10, search: { memberStatus: MemberStatus.PENDING, text: 'a.b+' } });

		const pipeline = memberModel.aggregate.mock.calls[0][0];
		const { $match } = pipeline[0];
		expect($match.memberType).toBe(MemberType.ORGANIZER);
		expect($match.memberStatus).toBe(MemberStatus.PENDING);
		expect($match.$or.map((c: any) => Object.keys(c)[0])).toEqual(['memberFullName', 'memberNick', 'memberEmail']);
		expect($match.$or[0].memberFullName.$regex.test('xa.b+y')).toBe(true);
		expect($match.$or[0].memberFullName.$regex.test('xaXbbby')).toBe(false);
		expect(pipeline.find((s: any) => s.$facet).$facet.list[0]).toEqual({ $skip: 10 });
		expect(pipeline.find((s: any) => s.$project)).toEqual({ $project: { memberPassword: 0 } });
	});
});

describe('OrganizerService approval celebration flag (DECISIONS #120)', () => {
	let members: any[];
	let model: any;
	let service: OrganizerService;

	const setup = (memberStatus: MemberStatus, extra: any = {}) => {
		members = [{ _id: ORG, memberType: MemberType.ORGANIZER, memberStatus, ...extra }];
		model = fakeMemberModel(members);
		service = new OrganizerService(
			model,
			{ record: jest.fn().mockResolvedValue(undefined) } as any,
			{ createNotification: jest.fn().mockResolvedValue(undefined) } as any,
			{ setMemberRestricted: jest.fn() } as any,
		);
	};

	it('verify (PENDING to ACTIVE) sets the flag in the same update as the status', async () => {
		setup(MemberStatus.PENDING);
		await service.verifyOrganizerByAdmin(ADMIN as any, ORG as any);

		expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
		expect(model.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: true });
		expect(members[0].approvalCelebrationPending).toBe(true);
	});

	it('reinstating a REJECTED organizer is an approval and sets the flag', async () => {
		setup(MemberStatus.REJECTED);
		await service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);

		expect(members[0]).toMatchObject({ memberStatus: MemberStatus.ACTIVE, approvalCelebrationPending: true });
	});

	it('reinstating a SUSPENDED organizer does not set the flag', async () => {
		setup(MemberStatus.SUSPENDED);
		await service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);

		expect(members[0].memberStatus).toBe(MemberStatus.ACTIVE);
		expect(members[0].approvalCelebrationPending).toBeUndefined();
	});

	it('reinstating a SUSPENDED organizer keeps no old flag (suspending cleared it)', async () => {
		setup(MemberStatus.ACTIVE, { approvalCelebrationPending: true });
		await service.suspendOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Refund abuse' });
		expect(members[0].approvalCelebrationPending).toBe(false);

		await service.reinstateOrganizerByAdmin(ADMIN as any, ORG as any);
		expect(members[0].approvalCelebrationPending).toBe(false);
	});

	it('reject never sets the flag', async () => {
		setup(MemberStatus.PENDING);
		await service.rejectOrganizerByAdmin(ADMIN as any, { memberId: ORG as any, reason: 'Incomplete profile' });

		expect(members[0].approvalCelebrationPending).toBeUndefined();
	});

	it('still sends the ORGANIZER_VERIFIED notification on approval', async () => {
		setup(MemberStatus.PENDING);
		const notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
		service = new OrganizerService(model, { record: jest.fn() } as any, notifications as any, { setMemberRestricted: jest.fn() } as any);
		await service.verifyOrganizerByAdmin(ADMIN as any, ORG as any);

		expect(notifications.createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ notificationType: NotificationType.ORGANIZER_VERIFIED, receiverId: ORG }),
		);
	});
});
