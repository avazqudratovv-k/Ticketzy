import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, IsOptional, Length, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { TicketCurrency, TicketTypeStatus } from '../../enums/ticket.enum';

@InputType()
export class TicketTypeInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@IsNotEmpty()
	@Length(2, 60)
	@Field(() => String)
	ticketTypeName: string;

	@IsNotEmpty()
	@Min(0)
	@Field(() => Number)
	ticketPrice: number;

	@IsNotEmpty()
	@Field(() => TicketCurrency)
	ticketCurrency: TicketCurrency;

	@IsNotEmpty()
	@IsInt()
	@Min(1)
	@Field(() => Int)
	totalQuantity: number;

	@IsNotEmpty()
	@IsInt()
	@Min(1)
	@Field(() => Int)
	maxPerOrder: number;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;
}

@InputType()
export class TicketTypeUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id: ObjectId;

	@IsOptional()
	@Length(2, 60)
	@Field(() => String, { nullable: true })
	ticketTypeName?: string;

	@IsOptional()
	@Min(0)
	@Field(() => Number, { nullable: true })
	ticketPrice?: number;

	@IsOptional()
	@Field(() => TicketCurrency, { nullable: true })
	ticketCurrency?: TicketCurrency;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Field(() => Int, { nullable: true })
	totalQuantity?: number;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Field(() => Int, { nullable: true })
	maxPerOrder?: number;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;

	@IsOptional()
	@Field(() => TicketTypeStatus, { nullable: true })
	ticketTypeStatus?: TicketTypeStatus;
}
