import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayNotEmpty, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EventLocale } from '../../enums/event.enum';

export const MAX_ASSISTANT_MESSAGE_LENGTH = 1000;
export const MAX_ASSISTANT_HISTORY = 10;

export enum AssistantRole {
	USER = 'user',
	ASSISTANT = 'assistant',
}
registerEnumType(AssistantRole, {
	name: 'AssistantRole',
});

@InputType()
export class AssistantHistoryInput {
	@IsIn(Object.values(AssistantRole))
	@Field(() => AssistantRole)
	role: AssistantRole;

	@IsString()
	@MaxLength(MAX_ASSISTANT_MESSAGE_LENGTH)
	@Field(() => String)
	content: string;
}

@InputType()
export class AskAssistantInput {
	@IsNotEmpty()
	@IsString()
	@MaxLength(MAX_ASSISTANT_MESSAGE_LENGTH)
	@Field(() => String)
	message: string;

	@IsOptional()
	@ArrayMaxSize(MAX_ASSISTANT_HISTORY)
	@ValidateNested({ each: true })
	@Type(() => AssistantHistoryInput)
	@Field(() => [AssistantHistoryInput], { nullable: true, description: 'the last turns of this chat, at most 10' })
	history?: AssistantHistoryInput[];

	@IsOptional()
	@Field(() => EventLocale, { nullable: true, description: 'language of the answer, default en' })
	locale?: EventLocale;
}

@InputType()
export class TranslateEventInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: string;

	@ArrayNotEmpty()
	@ArrayMaxSize(4)
	@Field(() => [EventLocale])
	targetLocales: EventLocale[];
}
