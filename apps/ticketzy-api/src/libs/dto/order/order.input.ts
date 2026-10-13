import { Field, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDate, IsIn, IsInt, IsNotEmpty, IsOptional, MaxLength, Min, ValidateNested } from 'class-validator';
import { ObjectId } from 'mongoose';
import { OrderStatus } from '../../enums/ticket.enum';
import { Direction } from '../../enums/common.enum';
import { availableOrderSorts } from '../../config';
import { PageField, LimitField } from '../common/pagination';

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

/** RESERVED events send seatIds (held by the buyer), GENERAL events send items; prices always come from the server */
@InputType()
export class CheckoutInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@IsOptional()
	@ArrayMinSize(1)
	@ArrayMaxSize(8)
	@Field(() => [String], { nullable: true })
	seatIds?: ObjectId[];

	@IsOptional()
	@ArrayMinSize(1)
	@ArrayMaxSize(10)
	@ValidateNested({ each: true })
	@Type(() => OrderItemInput)
	@Field(() => [OrderItemInput], { nullable: true })
	items?: OrderItemInput[];
}

@InputType()
export class OrdersInquiry {
	@PageField()
	page: number;

	@LimitField()
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

/** orders on the organizer's own events; eventId and orderStatus are optional filters */
@InputType()
export class OrganizerOrdersInquiry extends OrdersInquiry {
	@IsOptional()
	@Field(() => String, { nullable: true })
	eventId?: ObjectId;
}

/** admin orders list: all filters are optional and combine; the date range applies to the order's createdAt */
@InputType()
export class AdminOrdersInquiry extends OrdersInquiry {
	@IsOptional()
	@Field(() => String, { nullable: true })
	eventId?: ObjectId;

	/** matches the buyer's nickname, full name or email */
	@IsOptional()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	text?: string;

	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	dateFrom?: Date;

	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	dateTo?: Date;
}
