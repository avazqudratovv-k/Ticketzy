import { ObjectId } from 'bson';
import { FakeModel } from '../../../test/fake-model';
import { ConversationService, MESSAGE_RATE_LIMIT } from './conversation.service';
import { ConversationRealtime } from './conversation.realtime';
import { ConversationGuard } from '../auth/guards/conversation.guard';
import { NotificationService } from '../notification/notification.service';
import { RateLimiter } from '../../libs/rate-limiter';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { NotificationGroup, NotificationStatus, NotificationType } from '../../libs/enums/notification.enum';

const oid = () => new ObjectId();
const member = (memberType: MemberType, memberStatus = MemberStatus.ACTIVE) => ({ _id: oid(), memberType, memberStatus }) as any;

/** FakeModel plus the unique indexes and the lookup pipeline of the real Conversation collection */
class ConversationModel extends FakeModel {
	public pipelines: any[][] = [];

	public async create(doc: any) {
		const clash = this.docs.some(
			(d) => (doc.eventId && String(d.eventId) === String(doc.eventId)) || (doc.isSupport && d.isSupport && String(d.organizerId) === String(doc.organizerId)),
		);
		if (clash) throw Object.assign(new Error('E11000'), { code: 11000 });
		return super.create(doc);
	}

	public aggregate(pipeline: any[]) {
		this.pipelines.push(pipeline);
		const first = pipeline[0].$match;
		const result = first._id
			? this.docs.filter((d) => String(d._id) === String(first._id))
			: [{ list: this.docs, metaCounter: [{ total: this.docs.length }] }];
		return { exec: async () => result };
	}
}

const socket = () => ({ readyState: 1, send: jest.fn() }) as any;
const sent = (s: any) => s.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));

const build = () => {
	const organizer = member(MemberType.ORGANIZER);
	const admin = member(MemberType.ADMIN);
	const eventId = oid();
	const otherEventId = oid();

	const events = new FakeModel([
		{ _id: eventId, organizerId: organizer._id },
		{ _id: otherEventId, organizerId: oid() },
	]);
	const members = new FakeModel([admin, member(MemberType.ADMIN), { ...member(MemberType.ADMIN), memberStatus: MemberStatus.SUSPENDED }, organizer]);
	const conversations = new ConversationModel();
	const messages = new FakeModel();
	const notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
	const realtime = new ConversationRealtime();
	const service = new ConversationService(
		conversations as any,
		messages as any,
		members as any,
		events as any,
		notifications as unknown as NotificationService,
		realtime,
	);

	/** the support conversation and an event conversation of `organizer`, created directly */
	const seed = async (owner = organizer) => {
		const support = await conversations.create({ isSupport: true, organizerId: owner._id, adminId: null, unreadForOrganizer: 0, unreadForAdmin: 0 });
		const event = await conversations.create({ eventId, organizerId: owner._id, adminId: null, unreadForOrganizer: 0, unreadForAdmin: 0 });
		return { support, event };
	};
	const row = (id: any) => conversations.docs.find((d) => String(d._id) === String(id));
	return { service, conversations, messages, members, notifications, realtime, organizer, admin, eventId, otherEventId, seed, row };
};

describe('ConversationService authorization', () => {
	it('lets only the conversation organizer and admins read, write and mark read', async () => {
		const { service, organizer, admin, seed } = build();
		const { support } = await seed();
		const stranger = member(MemberType.ORGANIZER);

		for (const allowed of [organizer, admin]) {
			await expect(service.getConversation(allowed, support._id)).resolves.toBeDefined();
			await expect(service.sendMessage(allowed, support._id, 'hi')).resolves.toMatchObject({ body: 'hi' });
			await expect(service.markConversationRead(allowed, support._id)).resolves.toBeDefined();
		}
		await expect(service.getConversation(stranger, support._id)).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
		await expect(service.getMessages(stranger, support._id, { page: 1, limit: 10 })).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
		await expect(service.sendMessage(stranger, support._id, 'hi')).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
		await expect(service.markConversationRead(stranger, support._id)).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
	});

	it('rejects a USER, an inactive admin and a deleted organizer', async () => {
		const { service, organizer, seed } = build();
		const { support } = await seed();

		await expect(service.sendMessage(member(MemberType.USER), support._id, 'hi')).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
		await expect(service.sendMessage(member(MemberType.ADMIN, MemberStatus.SUSPENDED), support._id, 'hi')).rejects.toThrow(
			Message.CONVERSATION_NOT_ALLOWED,
		);
		await expect(service.sendMessage({ ...organizer, memberStatus: MemberStatus.DELETE }, support._id, 'hi')).rejects.toThrow(
			Message.CONVERSATION_NOT_ALLOWED,
		);
	});

	it('answers no data for an unknown conversation', async () => {
		const { service, admin } = build();
		await expect(service.getConversation(admin, oid() as any)).rejects.toThrow(Message.NO_DATA_FOUND);
	});

	it('organizers list only their own conversations, admins list all, a USER is refused', async () => {
		const { service, conversations, organizer, admin, seed } = build();
		await seed();

		await service.getMyConversations(organizer, { page: 1, limit: 10 });
		expect(conversations.pipelines[0][0].$match).toEqual({ organizerId: organizer._id });

		await service.getMyConversations(admin, { page: 2, limit: 10 });
		expect(conversations.pipelines[1][0].$match).toEqual({});
		expect(conversations.pipelines[1][2].$facet.list[0]).toEqual({ $skip: 10 });

		await expect(service.getMyConversations(member(MemberType.USER), { page: 1, limit: 10 })).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
	});

	it('ConversationGuard authenticates with allowRestricted and refuses a USER', async () => {
		const authService: any = { getBearerToken: jest.fn().mockReturnValue('t'), authenticate: jest.fn() };
		const guard = new ConversationGuard(authService);
		const request: any = { body: {} };
		const context: any = { contextType: 'graphql', getArgByIndex: () => ({ req: request }) };

		authService.authenticate.mockResolvedValue(member(MemberType.ORGANIZER, MemberStatus.REJECTED));
		await expect(guard.canActivate(context)).resolves.toBe(true);
		expect(authService.authenticate).toHaveBeenCalledWith('t', { allowRestricted: true });
		expect(request.body.authMember.memberStatus).toBe(MemberStatus.REJECTED);

		authService.authenticate.mockResolvedValue(member(MemberType.USER));
		await expect(guard.canActivate(context)).rejects.toThrow(Message.ONLY_SPECIFIC_ROLES_ALLOWED);
	});
});

describe('support conversation exception', () => {
	it.each([MemberStatus.PENDING, MemberStatus.REJECTED, MemberStatus.SUSPENDED])('%s organizer can use the support conversation only', async (status) => {
		const { service, organizer, seed } = build();
		const { support, event } = await seed();
		const restricted = { ...organizer, memberStatus: status };

		await expect(service.getConversation(restricted, support._id)).resolves.toBeDefined();
		await expect(service.getMessages(restricted, support._id, { page: 1, limit: 10 })).resolves.toBeDefined();
		await expect(service.sendMessage(restricted, support._id, 'why was I rejected?')).resolves.toMatchObject({ body: 'why was I rejected?' });
		await expect(service.markConversationRead(restricted, support._id)).resolves.toBeDefined();

		await expect(service.getConversation(restricted, event._id)).rejects.toThrow(Message.CONVERSATION_SUPPORT_ONLY);
		await expect(service.getMessages(restricted, event._id, { page: 1, limit: 10 })).rejects.toThrow(Message.CONVERSATION_SUPPORT_ONLY);
		await expect(service.sendMessage(restricted, event._id, 'hi')).rejects.toThrow(Message.CONVERSATION_SUPPORT_ONLY);
		await expect(service.markConversationRead(restricted, event._id)).rejects.toThrow(Message.CONVERSATION_SUPPORT_ONLY);
	});

	it('a restricted organizer lists only the support conversation', async () => {
		const { service, conversations, organizer } = build();
		await service.getMyConversations({ ...organizer, memberStatus: MemberStatus.REJECTED }, { page: 1, limit: 10 });
		expect(conversations.pipelines[0][0].$match).toEqual({ organizerId: organizer._id, isSupport: true });
	});

	it('PENDING and REJECTED organizers may open the support conversation but not one about an event', async () => {
		const { service, conversations, organizer, eventId } = build();

		for (const status of [MemberStatus.PENDING, MemberStatus.REJECTED]) {
			const restricted = { ...organizer, memberStatus: status };
			await expect(service.startConversation(restricted, eventId as any)).rejects.toThrow(Message.CONVERSATION_SUPPORT_ONLY);
			await expect(service.startConversation(restricted)).resolves.toMatchObject({ isSupport: true });
		}
		expect(conversations.docs).toHaveLength(1);
	});

	it('a deleted organizer cannot start anything', async () => {
		const { service, organizer } = build();
		await expect(service.startConversation({ ...organizer, memberStatus: MemberStatus.DELETE })).rejects.toThrow(Message.CONVERSATION_NOT_ALLOWED);
	});

	it('an ACTIVE organizer starts a conversation on their own event only, once per event and once for support', async () => {
		const { service, conversations, organizer, eventId, otherEventId } = build();

		await expect(service.startConversation(organizer, otherEventId as any)).rejects.toThrow(Message.CONVERSATION_EVENT_NOT_YOURS);

		const first = await service.startConversation(organizer, eventId as any);
		const again = await service.startConversation(organizer, eventId as any);
		expect(String(again._id)).toBe(String(first._id));

		const support = await service.startConversation(organizer);
		expect(String((await service.startConversation(organizer))._id)).toBe(String(support._id));
		expect(conversations.docs).toHaveLength(2);
	});

	it('two parallel starts of the support conversation end with one conversation', async () => {
		const { service, conversations, organizer } = build();
		const [a, b] = await Promise.all([service.startConversation(organizer), service.startConversation(organizer)]);
		expect(String(a._id)).toBe(String(b._id));
		expect(conversations.docs).toHaveLength(1);
	});

	it('admins and users cannot start conversations', async () => {
		const { service, admin } = build();
		await expect(service.startConversation(admin)).rejects.toThrow(Message.CONVERSATION_ORGANIZERS_ONLY);
		await expect(service.startConversation(member(MemberType.USER))).rejects.toThrow(Message.CONVERSATION_ORGANIZERS_ONLY);
	});
});

describe('unread counters and admin assignment', () => {
	it('counts unread for the other side only and adds up', async () => {
		const { service, organizer, admin, seed, row } = build();
		const { support } = await seed();

		await service.sendMessage(organizer, support._id, 'one');
		await service.sendMessage(organizer, support._id, 'two');
		expect(row(support._id)).toMatchObject({ unreadForAdmin: 2, unreadForOrganizer: 0 });

		await service.sendMessage(admin, support._id, 'answer');
		expect(row(support._id)).toMatchObject({ unreadForAdmin: 2, unreadForOrganizer: 1 });
	});

	it('mark read zeroes the reader side, marks only the other side messages and leaves the other counter alone', async () => {
		const { service, messages, organizer, admin, seed, row } = build();
		const { support } = await seed();
		await service.sendMessage(organizer, support._id, 'question');
		await service.sendMessage(admin, support._id, 'answer');

		await service.markConversationRead(organizer, support._id);
		expect(row(support._id)).toMatchObject({ unreadForOrganizer: 0, unreadForAdmin: 1 });
		const byBody = (body: string) => messages.docs.find((m) => m.body === body);
		expect(byBody('answer').readAt).toBeInstanceOf(Date);
		expect(byBody('question').readAt).toBeUndefined();

		await service.markConversationRead(admin, support._id);
		expect(row(support._id)).toMatchObject({ unreadForOrganizer: 0, unreadForAdmin: 0 });
		expect(byBody('question').readAt).toBeInstanceOf(Date);
	});

	it('records the first replying admin as adminId and keeps it when another admin writes', async () => {
		const { service, conversations, organizer, admin, seed, row } = build();
		const { support } = await seed();
		const second = member(MemberType.ADMIN);

		await service.sendMessage(organizer, support._id, 'hello');
		expect(row(support._id).adminId).toBeNull();

		await service.sendMessage(admin, support._id, 'first reply');
		expect(String(row(support._id).adminId)).toBe(String(admin._id));

		await service.sendMessage(second, support._id, 'second admin');
		expect(String(row(support._id).adminId)).toBe(String(admin._id));
		expect(conversations.docs).toHaveLength(2);
	});

	it('two admins replying at the same time end with exactly one adminId', async () => {
		const { service, organizer, admin, seed, row } = build();
		const { support } = await seed();
		const second = member(MemberType.ADMIN);
		await service.sendMessage(organizer, support._id, 'hello');

		await Promise.all([service.sendMessage(admin, support._id, 'a'), service.sendMessage(second, support._id, 'b')]);
		expect([String(admin._id), String(second._id)]).toContain(String(row(support._id).adminId));
		await service.sendMessage(second, support._id, 'c');
		await service.sendMessage(admin, support._id, 'd');
		expect([String(admin._id), String(second._id)]).toContain(String(row(support._id).adminId));
	});

	it('trims the body and refuses an empty or too long one', async () => {
		const { service, messages, organizer, seed } = build();
		const { support } = await seed();

		await expect(service.sendMessage(organizer, support._id, '   ')).rejects.toThrow(Message.MESSAGE_BODY_REQUIRED);
		await expect(service.sendMessage(organizer, support._id, undefined as any)).rejects.toThrow(Message.MESSAGE_BODY_REQUIRED);
		await expect(service.sendMessage(organizer, support._id, 'x'.repeat(2001))).rejects.toThrow(Message.MESSAGE_BODY_TOO_LONG);
		await service.sendMessage(organizer, support._id, `  ${'x'.repeat(2000)}  `);
		expect(messages.docs).toHaveLength(1);
		expect(messages.docs[0].body).toHaveLength(2000);
	});

	it('getMessages sorts newest first and caps the page size', async () => {
		const { service, messages, organizer, seed } = build();
		const { support } = await seed();
		const find = jest.spyOn(messages, 'find');
		const chain: any = { sort: jest.fn(() => chain), skip: jest.fn(() => chain), limit: jest.fn(() => chain), lean: jest.fn(() => chain), exec: jest.fn().mockResolvedValue([]) };
		find.mockReturnValue(chain);
		(messages as any).countDocuments = jest.fn(() => ({ exec: async () => 7 }));

		const result = await service.getMessages(organizer, support._id, { page: 3, limit: 5000 });
		expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
		expect(chain.skip).toHaveBeenCalledWith(200);
		expect(chain.limit).toHaveBeenCalledWith(100);
		expect(result.metaCounter).toEqual([{ total: 7 }]);
	});
});

describe('realtime rooms', () => {
	it('sends message and unread events only to sockets that joined that conversation, each with its own count', async () => {
		const { service, realtime, organizer, admin, seed } = build();
		const { support, event } = await seed();

		const organizerSocket = socket();
		const adminSocket = socket();
		const outsider = socket();
		const otherRoom = socket();
		realtime.register(organizerSocket, { memberId: String(organizer._id), memberType: MemberType.ORGANIZER });
		realtime.register(adminSocket, { memberId: String(admin._id), memberType: MemberType.ADMIN });
		realtime.register(outsider, { memberId: 'x', memberType: MemberType.ORGANIZER });
		realtime.register(otherRoom, { memberId: 'y', memberType: MemberType.ADMIN });
		realtime.join(organizerSocket, String(support._id));
		realtime.join(adminSocket, String(support._id));
		realtime.join(otherRoom, String(event._id));

		await service.sendMessage(organizer, support._id, 'ping');

		expect(sent(organizerSocket).map((m: any) => m.event)).toEqual(['message', 'unread']);
		expect(sent(adminSocket).map((m: any) => m.event)).toEqual(['message', 'unread']);
		expect(sent(adminSocket)[1].data.unreadCount).toBe(1);
		expect(sent(organizerSocket)[1].data.unreadCount).toBe(0);
		expect(sent(adminSocket)[0].data).toMatchObject({ body: 'ping', conversationId: expect.anything() });
		expect(outsider.send).not.toHaveBeenCalled();
		expect(otherRoom.send).not.toHaveBeenCalled();
	});

	it('a socket that left a room, or disconnected, hears nothing', () => {
		const realtime = new ConversationRealtime();
		const a = socket();
		const b = socket();
		realtime.register(a, { memberId: '1', memberType: MemberType.ADMIN });
		realtime.register(b, { memberId: '2', memberType: MemberType.ORGANIZER });
		realtime.join(a, 'c1');
		realtime.join(b, 'c1');
		realtime.leave(a, 'c1');
		realtime.unregister(b);

		realtime.emitToRoom('c1', 'message', {});
		expect(a.send).not.toHaveBeenCalled();
		expect(b.send).not.toHaveBeenCalled();
		expect(realtime.isInRoom(a, 'c1')).toBe(false);
	});

	it('an unregistered socket cannot join, and typing skips the sender', () => {
		const realtime = new ConversationRealtime();
		const stranger = socket();
		realtime.join(stranger, 'c1');
		expect(realtime.isInRoom(stranger, 'c1')).toBe(false);

		const a = socket();
		const b = socket();
		realtime.register(a, { memberId: '1', memberType: MemberType.ADMIN });
		realtime.register(b, { memberId: '2', memberType: MemberType.ORGANIZER });
		realtime.join(a, 'c1');
		realtime.join(b, 'c1');
		realtime.emitToRoom('c1', 'typing', { isTyping: true }, a);
		expect(a.send).not.toHaveBeenCalled();
		expect(sent(b)[0].event).toBe('typing');
	});

	it('a socket error never fails the send', async () => {
		const { service, realtime, organizer, seed } = build();
		const { support } = await seed();
		const broken = { readyState: 1, send: jest.fn(() => { throw new Error('socket gone'); }) } as any;
		realtime.register(broken, { memberId: 'z', memberType: MemberType.ADMIN });
		realtime.join(broken, String(support._id));
		await expect(service.sendMessage(organizer, support._id, 'still saved')).resolves.toMatchObject({ body: 'still saved' });
	});
});

describe('rate limiting', () => {
	it('allows the limit per member, then answers 429, and other members are not affected', async () => {
		const { service, organizer, admin, seed } = build();
		const { support } = await seed();

		for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) await service.sendMessage(organizer, support._id, `m${i}`);
		const err: any = await service.sendMessage(organizer, support._id, 'one too many').catch((e) => e);
		expect(err.message).toBe(Message.TOO_MANY_MESSAGES);
		expect(err.getStatus()).toBe(429);

		await expect(service.sendMessage(admin, support._id, 'admin is fine')).resolves.toBeDefined();
	});

	it('refused messages are not saved or notified', async () => {
		const { service, messages, notifications, organizer, seed } = build();
		const { support } = await seed();
		for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) await service.sendMessage(organizer, support._id, `m${i}`);
		notifications.createNotification.mockClear();

		await service.sendMessage(organizer, support._id, 'blocked').catch(() => undefined);
		expect(messages.docs).toHaveLength(MESSAGE_RATE_LIMIT);
		expect(notifications.createNotification).not.toHaveBeenCalled();
	});

	it('the window slides: attempts come back after the window passes', () => {
		const limiter = new RateLimiter(2, 1000);
		expect(limiter.tryConsume('a', 0)).toBe(true);
		expect(limiter.tryConsume('a', 100)).toBe(true);
		expect(limiter.tryConsume('a', 200)).toBe(false);
		expect(limiter.tryConsume('b', 200)).toBe(true);
		expect(limiter.tryConsume('a', 1001)).toBe(true);
		expect(limiter.tryConsume('a', 1050)).toBe(false);
	});
});

describe('message notifications', () => {
	it('an organizer message notifies the assigned admin only', async () => {
		const { service, notifications, organizer, admin, seed, conversations } = build();
		const { support } = await seed();
		conversations.docs.find((d) => d._id === support._id).adminId = admin._id;

		await service.sendMessage(organizer, support._id, 'need help');

		expect(notifications.createNotification).toHaveBeenCalledTimes(1);
		expect(notifications.createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				notificationType: NotificationType.NEW_MESSAGE,
				notificationGroup: NotificationGroup.CONVERSATION,
				authorId: organizer._id,
				receiverId: admin._id,
				conversationId: support._id,
				notificationDesc: 'need help',
			}),
		);
	});

	it('an organizer message in an unassigned conversation notifies every active admin, not inactive ones or the organizer', async () => {
		const { service, notifications, members, organizer, seed } = build();
		const { support } = await seed();
		const activeAdmins = members.docs.filter((m) => m.memberType === MemberType.ADMIN && m.memberStatus === MemberStatus.ACTIVE);

		await service.sendMessage(organizer, support._id, 'hello?');

		const receivers = notifications.createNotification.mock.calls.map(([n]) => String(n.receiverId)).sort();
		expect(receivers).toEqual(activeAdmins.map((a) => String(a._id)).sort());
		expect(receivers).toHaveLength(2);
		expect(receivers).not.toContain(String(organizer._id));
	});

	it('an admin reply notifies the organizer and includes the event of an event conversation', async () => {
		const { service, notifications, organizer, admin, seed, eventId } = build();
		const { event } = await seed();

		await service.sendMessage(admin, event._id, 'x'.repeat(300));

		const call = notifications.createNotification.mock.calls[0][0];
		expect(call.receiverId).toBe(organizer._id);
		expect(String(call.eventId)).toBe(String(eventId));
		expect(call.notificationDesc).toHaveLength(101);
	});

	it('never notifies the sender, even when the receiver resolves to the sender', async () => {
		const { service, notifications, organizer, admin, seed, conversations } = build();
		const { support } = await seed();
		conversations.docs.find((d) => d._id === support._id).adminId = admin._id;

		// the assigned admin is the one writing, and an organizer id equal to the admin id would also be skipped
		await service.sendMessage(admin, support._id, 'reply');
		expect(notifications.createNotification.mock.calls.every(([n]) => String(n.receiverId) !== String(admin._id))).toBe(true);

		const loop = build();
		const { support: s2 } = await loop.seed(loop.organizer);
		loop.conversations.docs.find((d) => d._id === s2._id).adminId = loop.organizer._id;
		await loop.service.sendMessage(loop.organizer, s2._id, 'to myself');
		expect(loop.notifications.createNotification).not.toHaveBeenCalled();
	});

	it('NotificationService also drops a NEW_MESSAGE whose author is the receiver', async () => {
		const model: any = { create: jest.fn().mockResolvedValue({}) };
		const service = new NotificationService(model);
		const id = oid() as any;
		const base = { notificationType: NotificationType.NEW_MESSAGE, notificationGroup: NotificationGroup.CONVERSATION, notificationTitle: 't' };

		await service.createNotification({ ...base, authorId: id, receiverId: id });
		expect(model.create).not.toHaveBeenCalled();
		await service.createNotification({ ...base, authorId: id, receiverId: oid() as any });
		expect(model.create).toHaveBeenCalledTimes(1);
	});

	it('a failing notification never fails the send', async () => {
		const { service, notifications, organizer, seed } = build();
		const { support } = await seed();
		notifications.createNotification.mockRejectedValue(new Error('notification db down'));

		await expect(service.sendMessage(organizer, support._id, 'still sent')).resolves.toMatchObject({ body: 'still sent' });
	});

	it('a failing admin lookup never fails the send', async () => {
		const { service, members, organizer, seed } = build();
		const { support } = await seed();
		jest.spyOn(members, 'find').mockImplementation(() => {
			throw new Error('members down');
		});
		await expect(service.sendMessage(organizer, support._id, 'still sent')).resolves.toMatchObject({ body: 'still sent' });
	});
});

describe('NotificationService queries', () => {
	const agg = () => ({ aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ list: [], metaCounter: [] }]) }) });

	it('pages and filters unread with unreadOnly or notificationStatus', async () => {
		const model: any = agg();
		const service = new NotificationService(model);
		const me = oid() as any;

		await service.getMyNotifications(me, { page: 2, limit: 5, unreadOnly: true });
		expect(model.aggregate.mock.calls[0][0][0].$match).toEqual({ receiverId: me, notificationStatus: NotificationStatus.WAIT });
		expect(model.aggregate.mock.calls[0][0][2].$facet.list.slice(0, 2)).toEqual([{ $skip: 5 }, { $limit: 5 }]);

		await service.getMyNotifications(me, { page: 1, limit: 5, notificationStatus: NotificationStatus.READ });
		expect(model.aggregate.mock.calls[1][0][0].$match.notificationStatus).toBe(NotificationStatus.READ);

		await service.getMyNotifications(me, { page: 1, limit: 5 });
		expect(model.aggregate.mock.calls[2][0][0].$match).toEqual({ receiverId: me });
	});

	it('counts and marks only the caller own unread notifications', async () => {
		const model: any = {
			countDocuments: jest.fn().mockReturnValue({ exec: async () => 4 }),
			updateMany: jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 4 }) }),
		};
		const service = new NotificationService(model);
		const me = oid() as any;

		await expect(service.getUnreadNotificationCount(me)).resolves.toBe(4);
		expect(model.countDocuments).toHaveBeenCalledWith({ receiverId: me, notificationStatus: NotificationStatus.WAIT });

		await expect(service.markAllNotificationsRead(me)).resolves.toBe(4);
		expect(model.updateMany).toHaveBeenCalledWith(
			{ receiverId: me, notificationStatus: NotificationStatus.WAIT },
			{ notificationStatus: NotificationStatus.READ },
		);
	});
});
