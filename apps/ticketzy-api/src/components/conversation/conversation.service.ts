import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	HttpStatus,
	Injectable,
	Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId, PipelineStage } from 'mongoose';
import { ChatMessage, ChatMessages, Conversation, Conversations } from '../../libs/dto/conversation/conversation';
import { Member } from '../../libs/dto/member/member';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { getConversationDenial, getStartDenial, supportOnlyOrganizerStatuses } from '../../libs/conversation-access';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { RateLimiter } from '../../libs/rate-limiter';
import { T } from '../../libs/types/common';
import { NotificationService } from '../notification/notification.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { ConversationRealtime } from './conversation.realtime';

export const MESSAGE_MAX_LENGTH = 2000;
/** per member and per process: 10 messages in 10 seconds */
export const MESSAGE_RATE_LIMIT = 10;
export const MESSAGE_RATE_WINDOW_MS = 10_000;
const MESSAGES_PAGE_MAX = 100;
const NOTIFICATION_PREVIEW_LENGTH = 100;
/** admins are seeded and few; this only guards against a runaway fan-out */
const ADMIN_NOTIFY_LIMIT = 50;

@Injectable()
export class ConversationService {
	private readonly logger = new Logger(ConversationService.name);
	public readonly sendLimiter = new RateLimiter(MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);

	constructor(
		@InjectModel('Conversation') private readonly conversationModel: Model<Conversation>,
		@InjectModel('Message') private readonly messageModel: Model<ChatMessage>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Event') private readonly eventModel: Model<any>,
		private readonly notificationService: NotificationService,
		private readonly realtime: ConversationRealtime,
		private readonly auditLogService: AuditLogService,
	) {}

	public async startConversation(member: Member, eventId?: ObjectId): Promise<Conversation> {
		this.assertAllowed(getStartDenial(member, Boolean(eventId)));

		if (eventId) {
			const event = await this.eventModel.findOne({ _id: eventId, organizerId: member._id }).lean().exec();
			if (!event) throw new ForbiddenException(Message.CONVERSATION_EVENT_NOT_YOURS);
		}

		const filter: T = eventId ? { eventId } : { organizerId: member._id, isSupport: true };
		const existing = await this.conversationModel.findOne(filter).lean().exec();
		if (existing) return await this.getConversation(member, existing._id);

		try {
			const created = await this.conversationModel.create(
				eventId ? { eventId, organizerId: member._id } : { isSupport: true, organizerId: member._id },
			);
			return await this.getConversation(member, created._id);
		} catch (err) {
			// the unique indexes decide a race: someone created it first, return that one
			if (err?.code !== 11000) throw err;
			const winner = await this.conversationModel.findOne(filter).lean().exec();
			if (!winner) throw err;
			return await this.getConversation(member, winner._id);
		}
	}

	/**
	 * Admin side of the support conversation: opens it when the organizer has none, otherwise returns the existing one.
	 * The admin who opens it is recorded as its admin; the organizer is notified only when it was created now.
	 */
	public async startConversationWithOrganizer(admin: Member, organizerId: ObjectId): Promise<Conversation> {
		if (!admin) throw new ForbiddenException(Message.NOT_AUTHENTICATED);
		if (admin.memberType !== MemberType.ADMIN || admin.memberStatus !== MemberStatus.ACTIVE) {
			throw new ForbiddenException(Message.CONVERSATION_NOT_ALLOWED);
		}

		const target = await this.memberModel
			.findOne({ _id: shapeIntoMongoObjectId(organizerId) })
			.select('_id memberType memberStatus')
			.lean()
			.exec();
		if (!target) throw new BadRequestException(Message.NO_DATA_FOUND);
		if (target.memberType !== MemberType.ORGANIZER) throw new BadRequestException(Message.CONVERSATION_TARGET_NOT_ORGANIZER);
		if (target.memberStatus === MemberStatus.DELETE) throw new BadRequestException(Message.NO_DATA_FOUND);

		const filter: T = { organizerId: target._id, isSupport: true };
		const existing = await this.conversationModel.findOne(filter).lean().exec();
		if (existing) return await this.getConversation(admin, existing._id);

		try {
			const created = await this.conversationModel.create({ isSupport: true, organizerId: target._id, adminId: admin._id });
			await this.auditLogService.record({
				actorId: admin._id,
				action: AuditAction.SUPPORT_CONVERSATION_STARTED,
				targetType: AuditTargetType.CONVERSATION,
				targetId: created._id,
				meta: { organizerId: target._id },
			});
			await this.notifyConversationOpened(admin, created._id, target._id as ObjectId);
			return await this.getConversation(admin, created._id);
		} catch (err) {
			// the unique index decides a race: the other request created it and notified, return that one
			if (err?.code !== 11000) throw err;
			const winner = await this.conversationModel.findOne(filter).lean().exec();
			if (!winner) throw err;
			return await this.getConversation(admin, winner._id);
		}
	}

	public async getMyConversations(member: Member, input: OrdinaryInquiry): Promise<Conversations> {
		const match: T = {};
		if (member.memberType === MemberType.ORGANIZER) {
			match.organizerId = member._id;
			// accounts that may only contact support see nothing else
			if (supportOnlyOrganizerStatuses.includes(member.memberStatus)) match.isSupport = true;
			else if (member.memberStatus !== MemberStatus.ACTIVE) throw new ForbiddenException(Message.CONVERSATION_NOT_ALLOWED);
		} else if (member.memberType !== MemberType.ADMIN || member.memberStatus !== MemberStatus.ACTIVE) {
			throw new ForbiddenException(Message.CONVERSATION_NOT_ALLOWED);
		}

		const limit = Math.min(input.limit, MESSAGES_PAGE_MAX);
		const result = await this.conversationModel
			.aggregate([
				{ $match: match },
				{ $sort: { lastMessageAt: -1, _id: -1 } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * limit }, { $limit: limit }, ...this.lookupStages()],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result[0] ?? { list: [], metaCounter: [] };
	}

	public async getConversation(member: Member, conversationId: ObjectId): Promise<Conversation> {
		await this.getAllowedConversation(member, conversationId);

		const result = await this.conversationModel
			.aggregate([{ $match: { _id: shapeIntoMongoObjectId(conversationId) } }, ...this.lookupStages()])
			.exec();
		if (!result.length) throw new BadRequestException(Message.NO_DATA_FOUND);
		return result[0];
	}

	/** newest first */
	public async getMessages(member: Member, conversationId: ObjectId, input: OrdinaryInquiry): Promise<ChatMessages> {
		await this.getAllowedConversation(member, conversationId);

		const limit = Math.min(input.limit, MESSAGES_PAGE_MAX);
		const filter = { conversationId: shapeIntoMongoObjectId(conversationId) };
		const [list, total] = await Promise.all([
			this.messageModel
				.find(filter)
				.sort({ createdAt: -1, _id: -1 })
				.skip((input.page - 1) * limit)
				.limit(limit)
				.lean()
				.exec(),
			this.messageModel.countDocuments(filter).exec(),
		]);
		return { list: list as unknown as ChatMessage[], metaCounter: [{ total }] };
	}

	public async sendMessage(member: Member, conversationId: ObjectId, rawBody: string): Promise<ChatMessage> {
		if (!this.sendLimiter.tryConsume(String(member._id))) {
			throw new HttpException(Message.TOO_MANY_MESSAGES, HttpStatus.TOO_MANY_REQUESTS);
		}

		const body = typeof rawBody === 'string' ? rawBody.trim() : '';
		if (!body) throw new BadRequestException(Message.MESSAGE_BODY_REQUIRED);
		if (body.length > MESSAGE_MAX_LENGTH) throw new BadRequestException(Message.MESSAGE_BODY_TOO_LONG);

		const conversation = await this.getAllowedConversation(member, conversationId);
		const isAdmin = member.memberType === MemberType.ADMIN;

		let adminId = conversation.adminId ?? null;
		if (isAdmin && !adminId) adminId = await this.claimConversation(conversation._id, member._id);

		const message = await this.messageModel.create({ conversationId: conversation._id, senderId: member._id, body });

		// the sender's side is read by definition; the other side has one more unread message
		const counters = await this.conversationModel
			.findOneAndUpdate(
				{ _id: conversation._id },
				{ $set: { lastMessageAt: new Date() }, $inc: isAdmin ? { unreadForOrganizer: 1 } : { unreadForAdmin: 1 } },
				{ new: true },
			)
			.lean()
			.exec();

		const id = String(conversation._id);
		this.realtime.emitToRoom(id, 'message', this.toPayload(message));
		if (counters) this.realtime.emitUnread(id, counters);

		await this.notifyOtherParty(member, conversation, adminId, body);
		return message as unknown as ChatMessage;
	}

	public async markConversationRead(member: Member, conversationId: ObjectId): Promise<Conversation> {
		const conversation = await this.getAllowedConversation(member, conversationId);
		const isAdmin = member.memberType === MemberType.ADMIN;

		// what the other side wrote: an organizer reads the admins' messages and the admins read the organizer's
		const incoming = isAdmin ? { senderId: conversation.organizerId } : { senderId: { $ne: conversation.organizerId } };
		await this.messageModel
			.updateMany({ conversationId: conversation._id, readAt: null, ...incoming }, { $set: { readAt: new Date() } })
			.exec();

		const counters = await this.conversationModel
			.findOneAndUpdate(
				{ _id: conversation._id },
				{ $set: isAdmin ? { unreadForAdmin: 0 } : { unreadForOrganizer: 0 } },
				{ new: true },
			)
			.lean()
			.exec();

		const id = String(conversation._id);
		if (counters) this.realtime.emitUnread(id, counters);
		this.realtime.emitToRoom(id, 'read', { conversationId: id, readerId: String(member._id), readAt: new Date() });

		return await this.getConversation(member, conversation._id);
	}

	/** for the socket gateway: returns the conversation, throws unless the member may use it */
	public async assertConversationAccess(member: Member, conversationId: ObjectId): Promise<Conversation> {
		return await this.getAllowedConversation(member, conversationId);
	}

	private async getAllowedConversation(member: Member, conversationId: ObjectId): Promise<Conversation> {
		const conversation = (await this.conversationModel
			.findOne({ _id: shapeIntoMongoObjectId(conversationId) })
			.lean()
			.exec()) as unknown as Conversation | null;
		if (!conversation) throw new BadRequestException(Message.NO_DATA_FOUND);
		this.assertAllowed(getConversationDenial(member, conversation));
		return conversation;
	}

	private assertAllowed(denial: Message | null): void {
		if (denial === Message.NOT_AUTHENTICATED) throw new ForbiddenException(Message.NOT_AUTHENTICATED);
		if (denial) throw new ForbiddenException(denial);
	}

	/** the first admin reply records the admin; if another admin was faster, theirs stays */
	private async claimConversation(conversationId: ObjectId, adminId: ObjectId): Promise<ObjectId> {
		const claimed = await this.conversationModel
			.findOneAndUpdate({ _id: conversationId, adminId: null }, { $set: { adminId } }, { new: true })
			.lean()
			.exec();
		if (claimed) return adminId;

		const current = await this.conversationModel.findOne({ _id: conversationId }).lean().exec();
		return (current?.adminId as ObjectId) ?? adminId;
	}

	/** never throws: the conversation already exists, a failed notification must not fail the start */
	private async notifyConversationOpened(admin: Member, conversationId: ObjectId, organizerId: ObjectId): Promise<void> {
		try {
			await this.notificationService.createNotification({
				notificationType: NotificationType.NEW_MESSAGE,
				notificationGroup: NotificationGroup.CONVERSATION,
				notificationTitle: 'Support started a conversation with you',
				notificationDesc: 'An admin opened a conversation with you.',
				authorId: admin._id,
				receiverId: organizerId,
				conversationId,
			});
		} catch (err) {
			this.logger.error(`Error, ConversationService.notifyConversationOpened: ${err.message}`);
		}
	}

	/** never throws: the message is already saved, a failed notification must not fail the send */
	private async notifyOtherParty(sender: Member, conversation: Conversation, adminId: ObjectId | null, body: string): Promise<void> {
		try {
			let receivers: ObjectId[];
			if (sender.memberType === MemberType.ADMIN) receivers = [conversation.organizerId];
			else if (adminId) receivers = [adminId];
			else {
				// nobody answered yet: every active admin hears about it
				const admins = await this.memberModel
					.find({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE })
					.select('_id')
					.limit(ADMIN_NOTIFY_LIMIT)
					.lean()
					.exec();
				receivers = admins.map((admin) => admin._id as ObjectId);
			}

			const preview = body.length > NOTIFICATION_PREVIEW_LENGTH ? `${body.slice(0, NOTIFICATION_PREVIEW_LENGTH)}…` : body;
			for (const receiverId of receivers) {
				if (String(receiverId) === String(sender._id)) continue;
				await this.notificationService.createNotification({
					notificationType: NotificationType.NEW_MESSAGE,
					notificationGroup: NotificationGroup.CONVERSATION,
					notificationTitle: 'You have a new message',
					notificationDesc: preview,
					authorId: sender._id,
					receiverId,
					conversationId: conversation._id,
					eventId: conversation.eventId,
				});
			}
		} catch (err) {
			this.logger.error(`Error, ConversationService.notifyOtherParty: ${err.message}`);
		}
	}

	private toPayload(message: any): ChatMessage {
		return {
			_id: message._id,
			conversationId: message.conversationId,
			senderId: message.senderId,
			body: message.body,
			readAt: message.readAt,
			createdAt: message.createdAt,
		};
	}

	/** event card and the two parties, with only their public fields */
	private lookupStages(): PipelineStage.FacetPipelineStage[] {
		const party = (localField: string, as: string) => [
			{
				$lookup: {
					from: 'members',
					let: { id: localField },
					pipeline: [
						{ $match: { $expr: { $eq: ['$_id', '$$id'] } } },
						{ $project: { memberType: 1, memberStatus: 1, memberNick: 1, memberFullName: 1, memberImage: 1 } },
					],
					as,
				},
			},
			{ $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
		];
		return [
			{
				$lookup: {
					from: 'events',
					let: { id: '$eventId' },
					pipeline: [
						{ $match: { $expr: { $eq: ['$_id', '$$id'] } } },
						{ $project: { eventTitle: 1, eventImages: 1, eventStatus: 1, eventCategory: 1, startAt: 1, endAt: 1 } },
					],
					as: 'eventData',
				},
			},
			{ $unwind: { path: '$eventData', preserveNullAndEmptyArrays: true } },
			...party('$organizerId', 'organizerData'),
			...party('$adminId', 'adminData'),
		];
	}
}
