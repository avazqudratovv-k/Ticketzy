import { AuditLogService } from './audit-log.service';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Direction } from '../../libs/enums/common.enum';

const entry = { actorId: 'a1' as any, action: AuditAction.ORGANIZER_VERIFIED, targetType: AuditTargetType.MEMBER, targetId: 'm1' as any };

describe('AuditLogService', () => {
	it('record writes the entry', async () => {
		const model: any = { create: jest.fn().mockResolvedValue({}) };
		await new AuditLogService(model).record(entry);
		expect(model.create).toHaveBeenCalledWith(entry);
	});

	it('record never throws: the action is already done, the failure is logged', async () => {
		const model: any = { create: jest.fn().mockRejectedValue(new Error('db down')) };
		await expect(new AuditLogService(model).record(entry)).resolves.toBeUndefined();
	});

	it('getAuditLogsByAdmin pages, sorts newest first by default and filters', async () => {
		const model: any = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }) };

		await new AuditLogService(model).getAuditLogsByAdmin({
			page: 3,
			limit: 20,
			search: { action: AuditAction.ORGANIZER_REJECTED, targetType: AuditTargetType.MEMBER },
		});

		const pipeline = model.aggregate.mock.calls[0][0];
		expect(pipeline[0].$match).toEqual({ action: AuditAction.ORGANIZER_REJECTED, targetType: AuditTargetType.MEMBER });
		expect(pipeline[1]).toEqual({ $sort: { createdAt: Direction.DESC } });
		expect(pipeline[2].$facet.list.slice(0, 2)).toEqual([{ $skip: 40 }, { $limit: 20 }]);
		expect(pipeline[2].$facet.metaCounter).toEqual([{ $count: 'total' }]);
	});
});
