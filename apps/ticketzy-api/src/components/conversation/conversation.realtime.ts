import { Injectable, Logger } from '@nestjs/common';
import * as WebSocket from 'ws';
import { MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';

export interface RealtimeClient {
	memberId: string;
	memberType: MemberType;
	/** set while the member is REJECTED / SUSPENDED / PENDING: the socket may only use support rooms */
	restricted?: boolean;
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
	private readonly supportRooms = new Set<string>();

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

	/** false when the socket is not registered or is restricted and the room is not the support conversation */
	public join(socket: WebSocket, conversationId: string, isSupport = false): boolean {
		const client = this.clients.get(socket);
		if (!client || (client.restricted && !isSupport)) return false;
		if (isSupport) this.supportRooms.add(conversationId);
		if (!this.rooms.has(conversationId)) this.rooms.set(conversationId, new Set());
		this.rooms.get(conversationId).add(socket);
		if (!this.clientRooms.has(socket)) this.clientRooms.set(socket, new Set());
		this.clientRooms.get(socket).add(conversationId);
		return true;
	}

	public leave(socket: WebSocket, conversationId: string): void {
		const room = this.rooms.get(conversationId);
		room?.delete(socket);
		if (room && !room.size) {
			this.rooms.delete(conversationId);
			this.supportRooms.delete(conversationId);
		}
		this.clientRooms.get(socket)?.delete(conversationId);
	}

	/**
	 * Marks one socket (un)restricted. Becoming restricted removes it from every non-support room and tells it so.
	 * Returns the ids of the rooms it was removed from.
	 */
	public setRestricted(socket: WebSocket, restricted: boolean): string[] {
		const client = this.clients.get(socket);
		if (!client) return [];
		client.restricted = restricted;
		if (!restricted) return [];

		const removed = [...(this.clientRooms.get(socket) ?? [])].filter((id) => !this.supportRooms.has(id));
		for (const conversationId of removed) {
			this.leave(socket, conversationId);
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ event: 'left', data: { conversationId, reason: Message.CONVERSATION_SUPPORT_ONLY } }));
			}
		}
		return removed;
	}

	/** every live socket of a member, used when an admin changes the member's status */
	public setMemberRestricted(memberId: string, restricted: boolean): number {
		let removed = 0;
		for (const [socket, client] of this.clients) {
			if (client.memberId === memberId) removed += this.setRestricted(socket, restricted).length;
		}
		return removed;
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
			const isSupport = this.supportRooms.has(conversationId);
			for (const socket of this.rooms.get(conversationId) ?? []) {
				if (socket.readyState !== WebSocket.OPEN) continue;
				// last line of defence: a restricted socket never gets an event of a non-support room
				if (this.clients.get(socket)?.restricted && !isSupport) continue;
				const payload = build(socket);
				if (payload) socket.send(JSON.stringify(payload));
			}
		} catch (err) {
			this.logger.error(`Error, ConversationRealtime.send: ${err.message}`);
		}
	}
}
