import { Field, ObjectType } from '@nestjs/graphql';
import { Event } from '../event/event';

@ObjectType()
export class AssistantAnswer {
	@Field(() => String)
	answer: string;

	@Field(() => [Event], { description: 'public events the assistant found, for event cards' })
	events: Event[];
}
