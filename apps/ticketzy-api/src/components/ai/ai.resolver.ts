import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { AiAssistantService } from './ai-assistant.service';
import { AiModerationService } from './ai-moderation.service';
import { AiTranslationService } from './ai-translation.service';
import { AssistantAnswer } from '../../libs/dto/ai/ai';
import { AskAssistantInput, TranslateEventInput } from '../../libs/dto/ai/ai.input';
import { Event, EventTranslation } from '../../libs/dto/event/event';
import { Member } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class AiResolver {
	private readonly logger = new Logger(AiResolver.name);

	constructor(
		private readonly aiAssistantService: AiAssistantService,
		private readonly aiModerationService: AiModerationService,
		private readonly aiTranslationService: AiTranslationService,
	) {}

	/** visitors and members alike; a visitor is rate limited by IP */
	@UseGuards(WithoutGuard)
	@Mutation(() => AssistantAnswer)
	public async askAssistant(
		@Args('input') input: AskAssistantInput,
		@AuthMember() authMember: Member | null,
		@Context() context: any,
	): Promise<AssistantAnswer> {
		this.logger.log('Mutation: askAssistant');
		const rateKey = authMember?._id ? `member:${authMember._id}` : `ip:${context?.req?.ip ?? 'unknown'}`;
		return await this.aiAssistantService.askAssistant(authMember, rateKey, input);
	}

	/** suggestions only: nothing is saved, the organizer saves the reviewed text with updateEvent */
	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => [EventTranslation])
	public async translateEvent(
		@Args('input') input: TranslateEventInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<EventTranslation[]> {
		this.logger.log('Mutation: translateEvent');
		return await this.aiTranslationService.translateEvent(memberId, shapeIntoMongoObjectId(input.eventId), input.targetLocales);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Event)
	public async runEventModerationByAdmin(@Args('eventId') input: string, @AuthMember('_id') adminId: ObjectId): Promise<Event> {
		this.logger.log('Mutation: runEventModerationByAdmin');
		return await this.aiModerationService.runEventModerationByAdmin(adminId, shapeIntoMongoObjectId(input));
	}
}
