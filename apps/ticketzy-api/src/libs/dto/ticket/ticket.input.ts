import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
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

/** check-in or preview by the ticket code printed under the QR code; the format is checked by the service so every bad code gets the same answer */
@InputType()
export class CheckInByCodeInput {
	@IsString()
	@Field(() => String)
	eventId: string;

	@IsString()
	@Field(() => String, { description: '20 hex characters; spaces, dashes and lower case are accepted' })
	ticketCode: string;
}
