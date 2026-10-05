import { Field, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsNotEmpty, IsOptional, Min, ValidateNested } from 'class-validator';
import { ObjectId } from 'mongoose';
import { OrderStatus } from '../../enums/ticket.enum';
import { Direction } from '../../enums/common.enum';
import { availableOrderSorts } from '../../config';

@InputType()
export class OrderItemInput {
	@IsNotEmpty()
	@Field(() => String)
	ticketTypeId: ObjectId;

	@IsNotEmpty()
	@IsInt()
	@Min(1)
	@Field(() => Int)
	quantity: number;
}

@InputType()
export class OrderInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@ArrayMinSize(1)
	@ArrayMaxSize(10)
	@ValidateNested({ each: true })
	@Type(() => OrderItemInput)
	@Field(() => [OrderItemInput])
	items: OrderItemInput[];
}

@InputType()
export class OrdersInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableOrderSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsOptional()
	@Field(() => OrderStatus, { nullable: true })
	orderStatus?: OrderStatus;
}
