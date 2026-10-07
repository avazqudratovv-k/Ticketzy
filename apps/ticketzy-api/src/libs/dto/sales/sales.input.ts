import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { TicketStatus } from '../../enums/ticket.enum';

@InputType()
export class AttendeesInquiry {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@Field(() => TicketStatus, { nullable: true, description: 'VALID and USED when not given' })
	ticketStatus?: TicketStatus;
}
