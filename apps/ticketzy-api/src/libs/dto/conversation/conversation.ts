import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { EventCategory, EventStatus } from '../../enums/event.enum';
import { MemberStatus, MemberType } from '../../enums/member.enum';
import { TotalCounter } from '../member/member';

/** the few event fields a conversation header needs */
@ObjectType()
export class ConversationEventCard {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	eventTitle: string;

	@Field(() => [String])
	eventImages: string[];

	@Field(() => EventStatus)
	eventStatus: EventStatus;

	@Field(() => EventCategory)
	eventCategory: EventCategory;

	@Field(() => Date)
	startAt: Date;

	@Field(() => Date)
	endAt: Date;
}

/** public side of a member: never email, phone or password */
@ObjectType()
export class ConversationParty {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => MemberType)
	memberType: MemberType;

	@Field(() => MemberStatus)
	memberStatus: MemberStatus;

	@Field(() => String, { nullable: true })
	memberNick?: string;

	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@Field(() => String, { nullable: true })
	memberImage?: string;
}

@ObjectType()
export class Conversation {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String, { nullable: true })
	eventId?: ObjectId;

	@Field(() => Boolean)
	isSupport: boolean;

	@Field(() => String)
	organizerId: ObjectId;

	@Field(() => String, { nullable: true })
	adminId?: ObjectId;

	@Field(() => Date)
	lastMessageAt: Date;

	@Field(() => Int)
	unreadForOrganizer: number;

	@Field(() => Int)
	unreadForAdmin: number;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */

	@Field(() => ConversationEventCard, { nullable: true })
	eventData?: ConversationEventCard;

	@Field(() => ConversationParty, { nullable: true })
	organizerData?: ConversationParty;

	@Field(() => ConversationParty, { nullable: true })
	adminData?: ConversationParty;
}

@ObjectType()
export class Conversations {
	@Field(() => [Conversation])
	list: Conversation[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}

/** named ChatMessage because `Message` is the error message enum of this project */
@ObjectType()
export class ChatMessage {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	conversationId: ObjectId;

	@Field(() => String)
	senderId: ObjectId;

	@Field(() => String)
	body: string;

	@Field(() => Date, { nullable: true })
	readAt?: Date;

	@Field(() => Date)
	createdAt: Date;
}

@ObjectType()
export class ChatMessages {
	@Field(() => [ChatMessage])
	list: ChatMessage[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
