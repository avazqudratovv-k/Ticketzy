import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { TicketCurrency, TicketTypeStatus } from '../../enums/ticket.enum';

@ObjectType()
export class TicketType {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	ticketTypeName: string;

	@Field(() => Number)
	ticketPrice: number;

	@Field(() => TicketCurrency)
	ticketCurrency: TicketCurrency;

	@Field(() => String, { nullable: true })
	tierKey?: string;

	@Field(() => Int)
	totalQuantity: number;

	@Field(() => Int)
	soldQuantity: number;

	@Field(() => Int)
	maxPerOrder: number;

	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;

	@Field(() => TicketTypeStatus)
	ticketTypeStatus: TicketTypeStatus;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;
}
