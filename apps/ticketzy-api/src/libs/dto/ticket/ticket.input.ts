import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { TicketTimeFilter } from '../../enums/ticket.enum';

@InputType()
export class TicketsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@Field(() => TicketTimeFilter, { nullable: true, description: 'UPCOMING: the event has not ended; PAST: it has' })
	timeFilter?: TicketTimeFilter;
}
