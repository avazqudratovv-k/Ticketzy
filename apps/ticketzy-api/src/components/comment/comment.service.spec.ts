import { InternalServerErrorException } from '@nestjs/common';
import { Message } from '../../libs/enums/common.enum';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CommentInput } from '../../libs/dto/comment/comment.input';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { CommentService } from './comment.service';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { NotificationGroup } from '../../libs/enums/notification.enum';

describe('comments are for events only', () => {
	it('CommentGroup has a single value, EVENT', () => {
		expect(Object.values(CommentGroup)).toEqual(['EVENT']);
	});

	it('no enum knows ARTICLE any more', () => {
		for (const group of [LikeGroup, ViewGroup, NotificationGroup, CommentGroup]) {
			expect(Object.values(group)).not.toContain('ARTICLE');
		}
	});

	describe('createComment', () => {
		const make = (assertPublicEvent: jest.Mock) => {
			const commentModel: any = { create: jest.fn(async (doc) => ({ _id: 'c1', ...doc })) };
			const eventService: any = { assertPublicEvent, eventStatsEditor: jest.fn().mockResolvedValue({}) };
			const notificationService: any = { createNotification: jest.fn() };
			return { commentModel, eventService, notificationService, service: new CommentService(commentModel, eventService, notificationService, {} as any) };
		};
		const input = { commentGroup: CommentGroup.EVENT, commentContent: 'hi', commentRefId: 'e1' as any };

		it('counts the comment on a public event and notifies its organizer', async () => {
			const { service, eventService, notificationService } = make(jest.fn().mockResolvedValue({ organizerId: 'o1' }));
			await service.createComment('u1' as any, { ...input });

			expect(eventService.assertPublicEvent).toHaveBeenCalledWith('e1');
			expect(eventService.eventStatsEditor).toHaveBeenCalledWith({ _id: 'e1', targetKey: 'eventComments', modifier: 1 });
			expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({ receiverId: 'o1', eventId: 'e1' }));
		});

		it('refuses a missing or non-public event (draft, pending, unapproved organizer) before anything is written', async () => {
			const { service, commentModel, eventService, notificationService } = make(jest.fn().mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND)));
			await expect(service.createComment('u1' as any, { ...input })).rejects.toThrow(Message.NO_DATA_FOUND);
			expect(commentModel.create).not.toHaveBeenCalled();
			expect(eventService.eventStatsEditor).not.toHaveBeenCalled();
			expect(notificationService.createNotification).not.toHaveBeenCalled();
		});
	});

	describe('deleting a comment counts it down on the event', () => {
		const make = (over: any = {}) => {
			const commentModel: any = {
				findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'c1', commentRefId: 'e1', commentStatus: CommentStatus.DELETE }),
				findByIdAndDelete: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'c1', commentRefId: 'e1', commentStatus: CommentStatus.ACTIVE, ...over }) }),
			};
			const eventService: any = { eventStatsEditor: jest.fn().mockResolvedValue({}) };
			const auditLogService: any = { record: jest.fn().mockResolvedValue(undefined) };
			return { commentModel, eventService, auditLogService, service: new CommentService(commentModel, eventService, {} as any, auditLogService) };
		};

		it('removeCommentByAdmin decrements eventComments', async () => {
			const { service, eventService } = make();
			await service.removeCommentByAdmin('admin-1' as any, 'c1' as any);
			expect(eventService.eventStatsEditor).toHaveBeenCalledWith({ _id: 'e1', targetKey: 'eventComments', modifier: -1 });
		});

		it('removeCommentByAdmin writes an audit entry with the comment, event and author', async () => {
			const { service, auditLogService } = make({ memberId: 'u9' });
			await service.removeCommentByAdmin('admin-1' as any, 'c1' as any);
			expect(auditLogService.record).toHaveBeenCalledWith({
				actorId: 'admin-1',
				action: AuditAction.COMMENT_REMOVED_BY_ADMIN,
				targetType: AuditTargetType.COMMENT,
				targetId: 'c1',
				meta: { eventId: 'e1', authorId: 'u9' },
			});
		});

		it('removeCommentByAdmin writes no audit entry when nothing was removed', async () => {
			const { service, auditLogService, commentModel } = make();
			commentModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
			await expect(service.removeCommentByAdmin('admin-1' as any, 'c1' as any)).rejects.toThrow();
			expect(auditLogService.record).not.toHaveBeenCalled();
		});

		it('removeCommentByAdmin does not count a soft-deleted comment twice', async () => {
			const { service, eventService } = make({ commentStatus: CommentStatus.DELETE });
			await service.removeCommentByAdmin('admin-1' as any, 'c1' as any);
			expect(eventService.eventStatsEditor).not.toHaveBeenCalled();
		});

		it('a member deleting their comment (status DELETE) decrements once; an edit does not', async () => {
			const { service, eventService, commentModel } = make();
			await service.updateComment('u1' as any, { _id: 'c1', commentStatus: CommentStatus.DELETE } as any);
			expect(commentModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ commentStatus: CommentStatus.ACTIVE });
			expect(eventService.eventStatsEditor).toHaveBeenCalledWith({ _id: 'e1', targetKey: 'eventComments', modifier: -1 });

			eventService.eventStatsEditor.mockClear();
			await service.updateComment('u1' as any, { _id: 'c1', commentContent: 'edited' } as any);
			expect(eventService.eventStatsEditor).not.toHaveBeenCalled();
		});

		it('a failing counter update does not undo the delete', async () => {
			const { service, eventService } = make();
			eventService.eventStatsEditor.mockRejectedValue(new Error('db down'));
			await expect(service.removeCommentByAdmin('admin-1' as any, 'c1' as any)).resolves.toMatchObject({ _id: 'c1' });
		});
	});

	it('getComments only reads EVENT comments', async () => {
		const commentModel: any = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }) };
		const service = new CommentService(commentModel, {} as any, {} as any, {} as any);

		await service.getComments(null as any, { page: 1, limit: 5, search: { commentRefId: 'e1' as any } });

		expect(commentModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ commentGroup: CommentGroup.EVENT, commentRefId: 'e1' });
	});
});

describe('comment length limit is 1 to 500', () => {
	const errorsOf = async (cls: any, plain: any) => (await validate(plainToInstance(cls, plain))).filter((e) => e.property.startsWith('commentContent'));
	const base = { commentGroup: CommentGroup.EVENT, commentRefId: 'e1' };

	it.each([1, 500])('CommentInput accepts %i characters', async (length) => {
		expect(await errorsOf(CommentInput, { ...base, commentContent: 'a'.repeat(length) })).toHaveLength(0);
	});

	it.each([0, 501])('CommentInput rejects %i characters', async (length) => {
		expect(await errorsOf(CommentInput, { ...base, commentContent: 'a'.repeat(length) })).toHaveLength(1);
	});

	it('CommentUpdate accepts 500 and rejects 501 characters', async () => {
		expect(await errorsOf(CommentUpdate, { _id: 'c1', commentContent: 'a'.repeat(500) })).toHaveLength(0);
		expect(await errorsOf(CommentUpdate, { _id: 'c1', commentContent: 'a'.repeat(501) })).toHaveLength(1);
	});
});
