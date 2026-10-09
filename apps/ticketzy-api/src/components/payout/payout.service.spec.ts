import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'bson';
import { PayoutService } from './payout.service';
import { PayoutResolver } from './payout.resolver';
import { Message } from '../../libs/enums/common.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { PayoutStatus } from '../../libs/enums/payout.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const ADMIN = new ObjectId();
const ORG = new ObjectId();
const EVENT = new ObjectId();

const row = (over: any = {}) => ({
	eventId: EVENT,
	eventTitle: 'Rock Night',
	organizerId: ORG,
	payoutDate: new Date(Date.now() - 86400000),
	payoutStatus: PayoutStatus.DUE,
	gross: 133000,
	commission: 12310,
	net: 120690,
	orderCount: 2,
	...over,
});
const facet = (rows: any[], totals: any[] = []) => exec([{ list: rows, metaCounter: [{ total: rows.length }], totals }]);

describe('PayoutService', () => {
	let eventModel: any;
	let payoutModel: any;
	let notificationService: any;
	let auditLogService: any;
	let service: PayoutService;

	beforeEach(() => {
		eventModel = { exists: jest.fn().mockResolvedValue({ _id: EVENT }), aggregate: jest.fn().mockReturnValue(facet([row()])) };
		payoutModel = { create: jest.fn().mockImplementation(async (doc: any) => ({ _id: new ObjectId(), ...doc })) };
		notificationService = { createNotification: jest.fn().mockResolvedValue(undefined) };
		auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
		service = new PayoutService(payoutModel, eventModel, notificationService, auditLogService);
	});

	const mark = (note?: string) => service.markPayoutPaidByAdmin(ADMIN as any, { eventId: EVENT as any, note });
	const expectRefusal = async (message: Message) => {
		await expect(mark()).rejects.toThrow(message);
		await expect(mark()).rejects.toBeInstanceOf(BadRequestException);
		expect(payoutModel.create).not.toHaveBeenCalled();
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(auditLogService.record).not.toHaveBeenCalled();
	};

	describe('markPayoutPaidByAdmin', () => {
		it('records the snapshot of the amounts computed in this call, writes the audit log and returns a PAID_OUT row', async () => {
			const result = await mark('  bank transfer  ');

			expect(payoutModel.create).toHaveBeenCalledTimes(1);
			expect(payoutModel.create.mock.calls[0][0]).toMatchObject({
				eventId: EVENT,
				organizerId: ORG,
				gross: 133000,
				commission: 12310,
				net: 120690,
				orderCount: 2,
				paidBy: ADMIN,
				note: 'bank transfer',
			});
			expect(payoutModel.create.mock.calls[0][0].paidAt).toBeInstanceOf(Date);
			expect(result).toMatchObject({ payoutStatus: PayoutStatus.PAID_OUT, net: 120690, note: 'bank transfer', paidBy: ADMIN });
			expect(result.payoutId).toBeDefined();
			expect(auditLogService.record).toHaveBeenCalledWith(
				expect.objectContaining({ actorId: ADMIN, action: AuditAction.PAYOUT_MARKED_PAID, targetType: AuditTargetType.EVENT, targetId: EVENT }),
			);
		});

		it('computes the amount from the orders in the same call (one pipeline run, for this event only)', async () => {
			await mark();
			expect(eventModel.aggregate).toHaveBeenCalledTimes(1);
			expect(eventModel.aggregate.mock.calls[0][0][0].$match._id).toEqual(EVENT);
		});

		it('notifies the organizer once, with the event title and the net amount', async () => {
			await mark();
			expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
			expect(notificationService.createNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					notificationType: NotificationType.PAYOUT_PAID,
					notificationGroup: NotificationGroup.EVENT,
					authorId: ADMIN,
					receiverId: ORG,
					eventId: EVENT,
					notificationDesc: 'Rock Night: 120,690 KRW',
				}),
			);
		});

		it('refuses an event that does not exist', async () => {
			eventModel.exists.mockResolvedValue(null);
			await expectRefusal(Message.PAYOUT_EVENT_NOT_FOUND);
		});

		it('refuses before the payout date', async () => {
			eventModel.aggregate.mockReturnValue(facet([row({ payoutDate: new Date(Date.now() + 86400000), payoutStatus: PayoutStatus.NOT_YET_DUE })]));
			await expectRefusal(Message.PAYOUT_NOT_DUE_YET);
		});

		it('refuses an event with nothing to pay (all refunded, or cancelled)', async () => {
			eventModel.aggregate.mockReturnValue(facet([row({ gross: 0, commission: 0, net: 0, orderCount: 0, payoutStatus: PayoutStatus.NOTHING_TO_PAY })]));
			await expectRefusal(Message.PAYOUT_NOTHING_TO_PAY);
		});

		it('refuses an event that never was on sale (no payout row at all)', async () => {
			eventModel.aggregate.mockReturnValue(facet([]));
			await expectRefusal(Message.PAYOUT_NOTHING_TO_PAY);
		});

		it('refuses an event that is already paid out, with no second record and no second notification', async () => {
			eventModel.aggregate.mockReturnValue(facet([row({ payoutStatus: PayoutStatus.PAID_OUT })]));
			await expectRefusal(Message.PAYOUT_ALREADY_PAID);
		});

		it('double marking: the unique index decides a race, the loser gets ALREADY_PAID and sends nothing', async () => {
			payoutModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
			await expect(mark()).rejects.toThrow(Message.PAYOUT_ALREADY_PAID);
			expect(notificationService.createNotification).not.toHaveBeenCalled();
			expect(auditLogService.record).not.toHaveBeenCalled();
		});

		it('two marks in a row create one record and one notification', async () => {
			const created: any[] = [];
			payoutModel.create.mockImplementation(async (doc: any) => {
				if (created.length) throw Object.assign(new Error('E11000'), { code: 11000 });
				created.push(doc);
				return { _id: new ObjectId(), ...doc };
			});
			await mark();
			await expect(mark()).rejects.toThrow(Message.PAYOUT_ALREADY_PAID);
			expect(created).toHaveLength(1);
			expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
		});

		it('stores no note when it is blank', async () => {
			await mark('   ');
			expect(payoutModel.create.mock.calls[0][0].note).toBeUndefined();
		});
	});

	describe('getMyPayouts', () => {
		it('always filters by the calling organizer and shapes the page and the totals', async () => {
			eventModel.aggregate.mockReturnValue(
				facet([row()], [{ _id: PayoutStatus.DUE, net: 120690 }, { _id: PayoutStatus.PAID_OUT, net: 5000 }, { _id: PayoutStatus.NOT_YET_DUE, net: 700 }]),
			);
			const result = await service.getMyPayouts(ORG as any, { page: 3, limit: 10, payoutStatus: PayoutStatus.DUE });

			const pipeline = eventModel.aggregate.mock.calls[0][0];
			expect(pipeline[0].$match.organizerId).toEqual(ORG);
			const list = pipeline.find((stage: any) => stage.$facet).$facet.list;
			expect(list.slice(0, 3)).toEqual([{ $match: { payoutStatus: 'DUE' } }, { $skip: 20 }, { $limit: 10 }]);
			expect(JSON.stringify(list)).not.toContain('memberNick');
			expect(result.totals).toEqual({ totalPaidOut: 5000, totalDue: 120690, totalUpcoming: 700 });
			expect(result.metaCounter).toEqual([{ total: 1 }]);
		});

		it('returns empty lists and zero totals when the facet has nothing', async () => {
			eventModel.aggregate.mockReturnValue(exec([]));
			const result = await service.getMyPayouts(ORG as any, { page: 1, limit: 10 });
			expect(result).toEqual({ list: [], metaCounter: [], totals: { totalPaidOut: 0, totalDue: 0, totalUpcoming: 0 } });
		});
	});

	describe('getPayoutsByAdmin', () => {
		it('applies organizer, escaped title, date range and status, and joins the organizer for the page', async () => {
			const organizerId = ORG.toHexString();
			const dateFrom = new Date('2026-09-01');
			const dateTo = new Date('2026-09-30');
			await service.getPayoutsByAdmin({ page: 1, limit: 5, organizerId: organizerId as any, text: ' rock.* ', dateFrom, dateTo, payoutStatus: PayoutStatus.PAID_OUT });

			const pipeline = eventModel.aggregate.mock.calls[0][0];
			expect(String(pipeline[0].$match.organizerId)).toBe(organizerId);
			expect(pipeline[0].$match.$or[0].eventTitle.source).toBe('rock\\.\\*');
			expect(pipeline.find((stage: any) => stage.$match?.payoutDate).$match.payoutDate).toEqual({ $gte: dateFrom, $lte: dateTo });
			const facetStage = pipeline.find((stage: any) => stage.$facet).$facet;
			expect(facetStage.list[0]).toEqual({ $match: { payoutStatus: 'PAID_OUT' } });
			expect(JSON.stringify(facetStage.list)).toContain('organizerEmail');
		});

		it('refuses a date range that ends before it starts', async () => {
			await expect(
				service.getPayoutsByAdmin({ page: 1, limit: 5, dateFrom: new Date('2026-10-01'), dateTo: new Date('2026-09-01') }),
			).rejects.toThrow(Message.PAYOUT_INVALID_DATE_RANGE);
			expect(eventModel.aggregate).not.toHaveBeenCalled();
		});

		it('paginates with skip and limit and sorts by payout date, latest first by default', async () => {
			await service.getPayoutsByAdmin({ page: 4, limit: 25 });
			const pipeline = eventModel.aggregate.mock.calls[0][0];
			expect(pipeline.find((stage: any) => stage.$sort).$sort.payoutDate).toBe(-1);
			expect(pipeline.find((stage: any) => stage.$facet).$facet.list.slice(0, 2)).toEqual([{ $skip: 75 }, { $limit: 25 }]);
		});
	});

	describe('roles and guards', () => {
		const meta = (name: string) => {
			const handler = (PayoutResolver.prototype as any)[name];
			return { roles: Reflect.getMetadata('roles', handler), guards: (Reflect.getMetadata('__guards__', handler) ?? []).map((guard: any) => guard.name) };
		};

		it('getMyPayouts is for ORGANIZER only and refuses a PENDING, REJECTED or SUSPENDED organizer (ActiveOrganizerGuard)', () => {
			expect(meta('getMyPayouts')).toEqual({ roles: ['ORGANIZER'], guards: ['RolesGuard', 'ActiveOrganizerGuard'] });
		});

		it.each(['getPayoutsByAdmin', 'markPayoutPaidByAdmin'])('%s is for ADMIN only', (name) => {
			expect(meta(name).roles).toEqual(['ADMIN']);
			expect(meta(name).guards).toContain('RolesGuard');
		});
	});
});
