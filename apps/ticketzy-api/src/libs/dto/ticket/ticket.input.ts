import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { TicketTimeFilter } from '../../enums/ticket.enum';
import { PageField, LimitField } from '../common/pagination';

@InputType()
export class TicketsInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@Field(() => TicketTimeFilter, { nullable: true, description: 'UPCOMING: the event has not ended; PAST: it has' })
	timeFilter?: TicketTimeFilter;
}
