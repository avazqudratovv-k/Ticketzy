import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { TicketStatus } from '../../enums/ticket.enum';
import { PageField, LimitField } from '../common/pagination';

@InputType()
export class AttendeesInquiry {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@Field(() => TicketStatus, { nullable: true, description: 'VALID and USED when not given' })
	ticketStatus?: TicketStatus;
}
