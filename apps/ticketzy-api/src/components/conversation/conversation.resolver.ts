import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { ConversationService } from './conversation.service';
import { ChatMessage, ChatMessages, Conversation, Conversations } from '../../libs/dto/conversation/conversation';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { Member } from '../../libs/dto/member/member';
import { ConversationGuard } from '../auth/guards/conversation.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { shapeIntoMongoObjectId } from '../../libs/config';

/**
 * Organizers and admins only. ConversationGuard also lets REJECTED and SUSPENDED organizers in;
 * ConversationService then limits them to their support conversation.
 */
@Resolver()
export class ConversationResolver {
	private readonly logger = new Logger(ConversationResolver.name);

	constructor(private readonly conversationService: ConversationService) {}

	@UseGuards(ConversationGuard)
	@Mutation(() => Conversation)
	public async startConversation(
		@Args('eventId', { nullable: true }) eventId: string | undefined,
		@AuthMember() member: Member,
	): Promise<Conversation> {
		this.logger.log('Mutation: startConversation');
		return await this.conversationService.startConversation(member, eventId ? shapeIntoMongoObjectId(eventId) : undefined);
	}

	/** ADMIN only: RolesGuard (like the other *ByAdmin operations), checked again in the service */
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Conversation)
	public async startConversationWithOrganizerByAdmin(
		@Args('organizerId') organizerId: string,
		@AuthMember() admin: Member,
	): Promise<Conversation> {
		this.logger.log('Mutation: startConversationWithOrganizerByAdmin');
		return await this.conversationService.startConversationWithOrganizer(admin, shapeIntoMongoObjectId(organizerId));
	}

	@UseGuards(ConversationGuard)
	@Query(() => Conversations)
	public async getMyConversations(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember() member: Member,
	): Promise<Conversations> {
		this.logger.log('Query: getMyConversations');
		return await this.conversationService.getMyConversations(member, input);
	}

	@UseGuards(ConversationGuard)
	@Query(() => Conversation)
	public async getConversation(
		@Args('conversationId') conversationId: string,
		@AuthMember() member: Member,
	): Promise<Conversation> {
		this.logger.log('Query: getConversation');
		return await this.conversationService.getConversation(member, shapeIntoMongoObjectId(conversationId));
	}

	@UseGuards(ConversationGuard)
	@Query(() => ChatMessages)
	public async getMessages(
		@Args('conversationId') conversationId: string,
		@Args('input') input: OrdinaryInquiry,
		@AuthMember() member: Member,
	): Promise<ChatMessages> {
		this.logger.log('Query: getMessages');
		return await this.conversationService.getMessages(member, shapeIntoMongoObjectId(conversationId), input);
	}

	@UseGuards(ConversationGuard)
	@Mutation(() => ChatMessage)
	public async sendMessage(
		@Args('conversationId') conversationId: string,
		@Args('body') body: string,
		@AuthMember() member: Member,
	): Promise<ChatMessage> {
		this.logger.log('Mutation: sendMessage');
		return await this.conversationService.sendMessage(member, shapeIntoMongoObjectId(conversationId), body);
	}

	@UseGuards(ConversationGuard)
	@Mutation(() => Conversation)
	public async markConversationRead(
		@Args('conversationId') conversationId: string,
		@AuthMember() member: Member,
	): Promise<Conversation> {
		this.logger.log('Mutation: markConversationRead');
		return await this.conversationService.markConversationRead(member, shapeIntoMongoObjectId(conversationId));
	}
}
