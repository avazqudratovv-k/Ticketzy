import { Injectable, Logger } from '@nestjs/common';
import * as WebSocket from 'ws';
import { MemberType } from '../../libs/enums/member.enum';

export interface RealtimeClient {
	memberId: string;
	memberType: MemberType;
}

/**
 * Private rooms, one per conversation. A socket is only ever added to a room after ConversationService checked
 * that its member may use the conversation, and events are sent to the sockets of one room and nobody else.
 * Lives in the conversation module so the service can publish without importing the gateway.
 */
@Injectable()
export class ConversationRealtime {
	private readonly logger = new Logger(ConversationRealtime.name);
	private readonly clients = new Map<WebSocket, RealtimeClient>();
	private readonly rooms = new Map<string, Set<WebSocket>>();
	private readonly clientRooms = new Map<WebSocket, Set<string>>();

	public register(socket: WebSocket, client: RealtimeClient): void {
		this.clients.set(socket, client);
	}

	public getClient(socket: WebSocket): RealtimeClient | undefined {
		return this.clients.get(socket);
	}

	/** forgets the socket and takes it out of every room */
	public unregister(socket: WebSocket): void {
		for (const conversationId of this.clientRooms.get(socket) ?? []) this.leave(socket, conversationId);
		this.clientRooms.delete(socket);
		this.clients.delete(socket);
	}

	public join(socket: WebSocket, conversationId: string): void {
		if (!this.clients.has(socket)) return;
		if (!this.rooms.has(conversationId)) this.rooms.set(conversationId, new Set());
		this.rooms.get(conversationId).add(socket);
		if (!this.clientRooms.has(socket)) this.clientRooms.set(socket, new Set());
		this.clientRooms.get(socket).add(conversationId);
	}

	public leave(socket: WebSocket, conversationId: string): void {
		const room = this.rooms.get(conversationId);
		room?.delete(socket);
		if (room && !room.size) this.rooms.delete(conversationId);
		this.clientRooms.get(socket)?.delete(conversationId);
	}

	public isInRoom(socket: WebSocket, conversationId: string): boolean {
		return Boolean(this.rooms.get(conversationId)?.has(socket));
	}

	/** sends to the sockets of one room; `except` skips the sender (typing). Never throws. */
	public emitToRoom(conversationId: string, event: string, data: unknown, except?: WebSocket): void {
		this.send(conversationId, (socket) => (socket === except ? null : { event, data }));
	}

	/** every socket gets the unread count of its own side: organizers their count, admins the shared admin count */
	public emitUnread(conversationId: string, counts: { unreadForOrganizer: number; unreadForAdmin: number }): void {
		this.send(conversationId, (socket) => {
			const client = this.clients.get(socket);
			if (!client) return null;
			const unreadCount = client.memberType === MemberType.ADMIN ? counts.unreadForAdmin : counts.unreadForOrganizer;
			return { event: 'unread', data: { conversationId, unreadCount } };
		});
	}

	private send(conversationId: string, build: (socket: WebSocket) => { event: string; data: unknown } | null): void {
		try {
			for (const socket of this.rooms.get(conversationId) ?? []) {
				if (socket.readyState !== WebSocket.OPEN) continue;
				const payload = build(socket);
				if (payload) socket.send(JSON.stringify(payload));
			}
		} catch (err) {
			this.logger.error(`Error, ConversationRealtime.send: ${err.message}`);
		}
	}
}
