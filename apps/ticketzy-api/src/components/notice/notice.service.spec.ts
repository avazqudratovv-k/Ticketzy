import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { NoticeService } from './notice.service';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Message } from '../../libs/enums/common.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const ADMIN = 'admin-1';

const build = () => {
	const noticeModel: any = {
		create: jest.fn(async (doc) => ({ _id: 'n1', ...doc })),
		findOneAndUpdate: jest.fn().mockReturnValue(exec({ _id: 'n1', noticeCategory: 'FAQ' })),
		findOneAndDelete: jest.fn().mockReturnValue(exec({ _id: 'n1', noticeCategory: 'FAQ' })),
	};
	const auditLogService: any = { record: jest.fn().mockResolvedValue(undefined) };
	return { noticeModel, auditLogService, service: new NoticeService(noticeModel, auditLogService) };
};

describe('NoticeService admin audit entries', () => {
	it('createNotice writes NOTICE_CREATED for the new notice', async () => {
		const { service, auditLogService } = build();
		await service.createNotice(ADMIN as any, { noticeTitle: 'Title', noticeContent: 'Body text', noticeCategory: 'FAQ' } as any);
		expect(auditLogService.record).toHaveBeenCalledWith({
			actorId: ADMIN,
			action: AuditAction.NOTICE_CREATED,
			targetType: AuditTargetType.NOTICE,
			targetId: 'n1',
			meta: { noticeCategory: 'FAQ' },
		});
	});

	it('createNotice writes no audit entry when the create fails', async () => {
		const { service, noticeModel, auditLogService } = build();
		noticeModel.create.mockRejectedValue(new Error('db down'));
		await expect(service.createNotice(ADMIN as any, {} as any)).rejects.toBeInstanceOf(BadRequestException);
		expect(auditLogService.record).not.toHaveBeenCalled();
	});

	it('updateNotice writes NOTICE_UPDATED with the changed field names, not the text', async () => {
		const { service, auditLogService } = build();
		await service.updateNotice(ADMIN as any, { _id: 'n1', noticeTitle: 'Private new title' } as any);
		expect(auditLogService.record).toHaveBeenCalledWith({
			actorId: ADMIN,
			action: AuditAction.NOTICE_UPDATED,
			targetType: AuditTargetType.NOTICE,
			targetId: 'n1',
			meta: { changedFields: ['noticeTitle'] },
		});
		expect(JSON.stringify(auditLogService.record.mock.calls)).not.toContain('Private new title');
	});

	it('updateNotice writes no audit entry for a missing notice', async () => {
		const { service, noticeModel, auditLogService } = build();
		noticeModel.findOneAndUpdate.mockReturnValue(exec(null));
		await expect(service.updateNotice(ADMIN as any, { _id: 'n1' } as any)).rejects.toThrow(Message.UPDATE_FAILED);
		expect(auditLogService.record).not.toHaveBeenCalled();
	});

	it('removeNoticeByAdmin writes NOTICE_REMOVED, and nothing when no soft-deleted notice matched', async () => {
		const { service, noticeModel, auditLogService } = build();
		await service.removeNoticeByAdmin(ADMIN as any, 'n1' as any);
		expect(auditLogService.record).toHaveBeenCalledWith(
			expect.objectContaining({ actorId: ADMIN, action: AuditAction.NOTICE_REMOVED, targetType: AuditTargetType.NOTICE, targetId: 'n1' }),
		);

		auditLogService.record.mockClear();
		noticeModel.findOneAndDelete.mockReturnValue(exec(null));
		await expect(service.removeNoticeByAdmin(ADMIN as any, 'n1' as any)).rejects.toBeInstanceOf(InternalServerErrorException);
		expect(auditLogService.record).not.toHaveBeenCalled();
	});
});
