import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import * as WebSocket from 'ws';
import { AuthService } from '../components/auth/auth.service';
import { ConversationRealtime } from '../components/conversation/conversation.realtime';
import { ConversationService } from '../components/conversation/conversation.service';
import { Member } from '../libs/dto/member/member';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';
import { Message } from '../libs/enums/common.enum';
import { RateLimiter } from '../libs/rate-limiter';
import { shapeIntoMongoObjectId } from '../libs/config';

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_AUTH_TIMEOUT = 4408;
/** a client that connects without an Authorization header has this long to send its auth message */
const AUTH_TIMEOUT_MS = 10_000;
/** per member: 30 typing events in 10 seconds are plenty for a human */
const TYPING_LIMIT = 30;
const TYPING_WINDOW_MS = 10_000;

/**
 * Real time side of the organizer / admin conversations (the old global chat room is gone).
 *
 * Authentication (never a URL query, tokens in URLs end up in logs):
 *  1. handshake: `Authorization: Bearer <token>` header (non browser clients), or
 *  2. a first message `{ "event": "auth", "data": { "token": "<token>" } }` (browsers cannot set headers on a WebSocket).
 * Either way the token is verified and the member is loaded from the database with its status checked.
 *
 * Client messages: auth, joinConversation { conversationId }, leaveConversation { conversationId },
 *                  typing { conversationId, isTyping }
 * Server messages: authenticated, joined, left, message, unread, read, typing, error
 * Messages are sent with the GraphQL mutation sendMessage, the service publishes them to the room.
 */
@WebSocketGateway({ transports: ['websocket'], secure: false })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger('SocketEventsGateway');
	private readonly authTimers = new Map<WebSocket, NodeJS.Timeout>();
	private readonly typingLimiter = new RateLimiter(TYPING_LIMIT, TYPING_WINDOW_MS);

	constructor(
		private readonly authService: AuthService,
		private readonly conversationService: ConversationService,
		private readonly realtime: ConversationRealtime,
	) {}

	public async handleConnection(client: WebSocket, req: any): Promise<void> {
		const header: string | undefined = req?.headers?.authorization;
		if (header) {
			const [scheme, token] = header.split(' ');
			if (scheme?.toLowerCase() === 'bearer' && token) return await this.authenticateClient(client, token);
			return this.reject(client, Message.NOT_AUTHENTICATED);
		}

		this.authTimers.set(
			client,
			setTimeout(() => this.reject(client, Message.NOT_AUTHENTICATED, CLOSE_AUTH_TIMEOUT), AUTH_TIMEOUT_MS),
		);
	}

	public handleDisconnect(client: WebSocket): void {
		this.clearAuthTimer(client);
		this.realtime.unregister(client);
	}

	@SubscribeMessage('auth')
	public async handleAuth(client: WebSocket, data: { token?: string }): Promise<void> {
		if (this.realtime.getClient(client)) return;
		if (typeof data?.token !== 'string' || !data.token) return this.reject(client, Message.NOT_AUTHENTICATED);
		await this.authenticateClient(client, data.token);
	}

	@SubscribeMessage('joinConversation')
	public async handleJoin(client: WebSocket, data: { conversationId?: string }): Promise<void> {
		await this.run(client, async (member) => {
			const conversationId = this.conversationIdOf(data);
			const conversation = await this.conversationService.assertConversationAccess(member, shapeIntoMongoObjectId(conversationId));
			if (!this.realtime.join(client, conversationId, Boolean(conversation?.isSupport))) {
				throw new Error(Message.CONVERSATION_SUPPORT_ONLY);
			}
			this.send(client, 'joined', { conversationId });
		});
	}

	@SubscribeMessage('leaveConversation')
	public async handleLeave(client: WebSocket, data: { conversationId?: string }): Promise<void> {
		await this.run(client, async () => {
			const conversationId = this.conversationIdOf(data);
			this.realtime.leave(client, conversationId);
			this.send(client, 'left', { conversationId });
		});
	}

	@SubscribeMessage('typing')
	public async handleTyping(client: WebSocket, data: { conversationId?: string; isTyping?: boolean }): Promise<void> {
		await this.run(client, async (member) => {
			const conversationId = this.conversationIdOf(data);
			// only sockets that joined (and were checked) may speak into the room
			if (!this.realtime.isInRoom(client, conversationId)) throw new Error(Message.CONVERSATION_NOT_ALLOWED);
			if (!this.typingLimiter.tryConsume(String(member._id))) return;
			this.realtime.emitToRoom(
				conversationId,
				'typing',
				{ conversationId, memberId: String(member._id), isTyping: data?.isTyping !== false },
				client,
			);
		});
	}

	private async authenticateClient(client: WebSocket, token: string): Promise<void> {
		try {
			const member = await this.authService.authenticate(token, { allowRestricted: true });
			if (![MemberType.ORGANIZER, MemberType.ADMIN].includes(member.memberType)) throw new Error(Message.ONLY_SPECIFIC_ROLES_ALLOWED);

			this.clearAuthTimer(client);
			this.realtime.register(client, { memberId: String(member._id), memberType: member.memberType });
			this.logger.verbose(`Socket authenticated [${member._id}]`);
			this.send(client, 'authenticated', { memberId: String(member._id) });
		} catch (err) {
			this.reject(client, err.message);
		}
	}

	/** runs an action for an authenticated client with the member freshly loaded, so a status change applies at once */
	private async run(client: WebSocket, action: (member: Member) => Promise<void>): Promise<void> {
		const info = this.realtime.getClient(client);
		if (!info) return this.reject(client, Message.NOT_AUTHENTICATED);

		let member: Member;
		try {
			member = await this.authService.loadMember(info.memberId, { allowRestricted: true });
		} catch (err) {
			return this.reject(client, err.message);
		}

		// the status is read fresh on every action, so a socket opened before a rejection loses its rooms at once
		this.realtime.setRestricted(client, member.memberType === MemberType.ORGANIZER && member.memberStatus !== MemberStatus.ACTIVE);

		try {
			await action(member);
		} catch (err) {
			this.send(client, 'error', { message: err.message ?? Message.SOMETHING_WENT_WRONG });
		}
	}

	private conversationIdOf(data: { conversationId?: string } | undefined): string {
		if (typeof data?.conversationId !== 'string' || !data.conversationId) throw new Error(Message.BAD_REQUEST);
		return data.conversationId;
	}

	private send(client: WebSocket, event: string, data: unknown): void {
		if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event, data }));
	}

	private reject(client: WebSocket, message: string, code: number = CLOSE_UNAUTHORIZED): void {
		this.clearAuthTimer(client);
		this.send(client, 'error', { message });
		client.close(code, message.slice(0, 120));
	}

	private clearAuthTimer(client: WebSocket): void {
		clearTimeout(this.authTimers.get(client));
		this.authTimers.delete(client);
	}
}
