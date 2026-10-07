import { CommentService } from './comment.service';
import { CommentGroup } from '../../libs/enums/comment.enum';
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

	it('createComment counts the comment on the event and notifies its organizer', async () => {
		const commentModel: any = { create: jest.fn(async (doc) => ({ _id: 'c1', ...doc })) };
		const eventService: any = { eventStatsEditor: jest.fn().mockResolvedValue({ organizerId: 'o1' }) };
		const notificationService: any = { createNotification: jest.fn() };
		const service = new CommentService(commentModel, eventService, notificationService);

		await service.createComment('u1' as any, { commentGroup: CommentGroup.EVENT, commentContent: 'hi', commentRefId: 'e1' as any });

		expect(eventService.eventStatsEditor).toHaveBeenCalledWith({ _id: 'e1', targetKey: 'eventComments', modifier: 1 });
		expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({ receiverId: 'o1', eventId: 'e1' }));
	});

	it('getComments only reads EVENT comments', async () => {
		const commentModel: any = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }) };
		const service = new CommentService(commentModel, {} as any, {} as any);

		await service.getComments(null as any, { page: 1, limit: 5, search: { commentRefId: 'e1' as any } });

		expect(commentModel.aggregate.mock.calls[0][0][0].$match).toMatchObject({ commentGroup: CommentGroup.EVENT, commentRefId: 'e1' });
	});
});
