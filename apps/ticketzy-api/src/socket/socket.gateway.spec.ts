import { ObjectId } from 'bson';
import { SocketGateway } from './socket.gateway';
import { ConversationRealtime } from '../components/conversation/conversation.realtime';
import { Message } from '../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';

const member = (memberType = MemberType.ORGANIZER, memberStatus = MemberStatus.ACTIVE) => ({ _id: new ObjectId(), memberType, memberStatus }) as any;
const socket = () => ({ readyState: 1, send: jest.fn(), close: jest.fn() }) as any;
const events = (s: any) => s.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));

const build = () => {
	const realtime = new ConversationRealtime();
	const authService: any = { authenticate: jest.fn(), loadMember: jest.fn() };
	const conversationService: any = { assertConversationAccess: jest.fn().mockResolvedValue(undefined) };
	const gateway = new SocketGateway(authService, conversationService, realtime);
	return { gateway, realtime, authService, conversationService };
};

describe('SocketGateway', () => {
	afterEach(() => jest.useRealTimers());

	it('authenticates in the handshake from the Authorization header and loads the member with the support exception', async () => {
		const { gateway, realtime, authService } = build();
		const organizer = member(MemberType.ORGANIZER, MemberStatus.REJECTED);
		authService.authenticate.mockResolvedValue(organizer);
		const client = socket();

		await gateway.handleConnection(client, { headers: { authorization: 'Bearer abc' }, url: '/?token=ignored' });

		expect(authService.authenticate).toHaveBeenCalledWith('abc', { allowRestricted: true });
		expect(realtime.getClient(client)).toEqual({ memberId: String(organizer._id), memberType: MemberType.ORGANIZER });
		expect(events(client)[0].event).toBe('authenticated');
	});

	it('never reads a token from the URL: without a header the client must send an auth message', async () => {
		jest.useFakeTimers();
		const { gateway, realtime, authService } = build();
		const client = socket();

		await gateway.handleConnection(client, { headers: {}, url: '/?token=secret' });
		expect(authService.authenticate).not.toHaveBeenCalled();
		expect(realtime.getClient(client)).toBeUndefined();

		authService.authenticate.mockResolvedValue(member());
		await gateway.handleAuth(client, { token: 'abc' });
		expect(authService.authenticate).toHaveBeenCalledWith('abc', { allowRestricted: true });
		expect(realtime.getClient(client)).toBeDefined();

		jest.advanceTimersByTime(60_000);
		expect(client.close).not.toHaveBeenCalled();
	});

	it('closes a client that never authenticates', async () => {
		jest.useFakeTimers();
		const { gateway } = build();
		const client = socket();

		await gateway.handleConnection(client, { headers: {} });
		jest.advanceTimersByTime(10_001);
		expect(client.close).toHaveBeenCalledWith(4408, expect.any(String));
	});

	it('closes on a bad token, a wrong scheme and a USER account', async () => {
		const { gateway, authService, realtime } = build();

		const bad = socket();
		authService.authenticate.mockRejectedValue(new Error(Message.NOT_AUTHENTICATED));
		await gateway.handleConnection(bad, { headers: { authorization: 'Bearer nope' } });
		expect(bad.close).toHaveBeenCalledWith(4401, Message.NOT_AUTHENTICATED);

		const basic = socket();
		await gateway.handleConnection(basic, { headers: { authorization: 'Basic abc' } });
		expect(basic.close).toHaveBeenCalledWith(4401, expect.any(String));

		const user = socket();
		authService.authenticate.mockResolvedValue(member(MemberType.USER));
		await gateway.handleConnection(user, { headers: { authorization: 'Bearer abc' } });
		expect(user.close).toHaveBeenCalledWith(4401, expect.any(String));
		expect(realtime.getClient(user)).toBeUndefined();
	});

	it('refuses every action before authentication', async () => {
		const { gateway, realtime } = build();
		const client = socket();

		await gateway.handleJoin(client, { conversationId: 'c1' });
		expect(client.close).toHaveBeenCalledWith(4401, Message.NOT_AUTHENTICATED);
		expect(realtime.isInRoom(client, 'c1')).toBe(false);
	});

	const authenticated = async (ctx: ReturnType<typeof build>, who = member()) => {
		const known: any[] = ((ctx as any).known ??= []);
		known.push(who);
		ctx.authService.authenticate.mockResolvedValue(who);
		ctx.authService.loadMember.mockImplementation(async (id: string) => known.find((m) => String(m._id) === String(id)));
		const client = socket();
		await ctx.gateway.handleConnection(client, { headers: { authorization: 'Bearer abc' } });
		return { client, who };
	};

	it('joins a room only after the access check passes, and answers an error when it fails', async () => {
		const ctx = build();
		const { client } = await authenticated(ctx);
		const id = String(new ObjectId());

		ctx.conversationService.assertConversationAccess.mockRejectedValueOnce(new Error(Message.CONVERSATION_SUPPORT_ONLY));
		await ctx.gateway.handleJoin(client, { conversationId: id });
		expect(ctx.realtime.isInRoom(client, id)).toBe(false);
		expect(events(client).pop()).toEqual({ event: 'error', data: { message: Message.CONVERSATION_SUPPORT_ONLY } });

		await ctx.gateway.handleJoin(client, { conversationId: id });
		expect(ctx.realtime.isInRoom(client, id)).toBe(true);
		expect(events(client).pop().event).toBe('joined');
	});

	it('reloads the member for every action: a member suspended since connecting is dropped', async () => {
		const ctx = build();
		const { client } = await authenticated(ctx);
		ctx.authService.loadMember.mockRejectedValue(new Error(Message.ACCOUNT_NOT_VERIFIED));

		await ctx.gateway.handleJoin(client, { conversationId: String(new ObjectId()) });
		expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
	});

	it('typing reaches the other sockets of the room only, and only from a socket that joined', async () => {
		const ctx = build();
		const a = await authenticated(ctx, member(MemberType.ADMIN));
		const b = await authenticated(ctx, member(MemberType.ORGANIZER));
		const outsider = await authenticated(ctx);
		const id = String(new ObjectId());
		await ctx.gateway.handleJoin(a.client, { conversationId: id });
		await ctx.gateway.handleJoin(b.client, { conversationId: id });
		[a.client, b.client, outsider.client].forEach((c) => c.send.mockClear());

		await ctx.gateway.handleTyping(a.client, { conversationId: id, isTyping: true });
		expect(events(b.client)).toEqual([{ event: 'typing', data: { conversationId: id, memberId: String(a.who._id), isTyping: true } }]);
		expect(a.client.send).not.toHaveBeenCalled();
		expect(outsider.client.send).not.toHaveBeenCalled();

		await ctx.gateway.handleTyping(outsider.client, { conversationId: id, isTyping: true });
		expect(events(outsider.client)[0]).toEqual({ event: 'error', data: { message: Message.CONVERSATION_NOT_ALLOWED } });
		expect(b.client.send).toHaveBeenCalledTimes(1);
	});

	it('rate limits typing events per member', async () => {
		const ctx = build();
		const { client } = await authenticated(ctx);
		const other = await authenticated(ctx, member(MemberType.ADMIN));
		const id = String(new ObjectId());
		await ctx.gateway.handleJoin(client, { conversationId: id });
		await ctx.gateway.handleJoin(other.client, { conversationId: id });
		other.client.send.mockClear();

		for (let i = 0; i < 50; i++) await ctx.gateway.handleTyping(client, { conversationId: id, isTyping: true });
		expect(other.client.send).toHaveBeenCalledTimes(30);
	});

	it('forgets the socket and its rooms on disconnect, and has no global chat room any more', async () => {
		const ctx = build();
		const { client } = await authenticated(ctx);
		const id = String(new ObjectId());
		await ctx.gateway.handleJoin(client, { conversationId: id });

		ctx.gateway.handleDisconnect(client);
		expect(ctx.realtime.getClient(client)).toBeUndefined();
		expect(ctx.realtime.isInRoom(client, id)).toBe(false);
		expect((ctx.gateway as any).handleMessage).toBeUndefined();
		expect((ctx.gateway as any).messagesList).toBeUndefined();
	});
});
