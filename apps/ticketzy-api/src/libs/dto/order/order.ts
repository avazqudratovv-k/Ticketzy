import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { OrderStatus } from '../../enums/ticket.enum';
import { TotalCounter } from '../member/member';
import { Event } from '../event/event';

@ObjectType()
export class OrderItem {
	@Field(() => String)
	ticketTypeId: ObjectId;

	@Field(() => Int)
	quantity: number;

	@Field(() => Number)
	unitPrice: number;
}

@ObjectType()
export class Order {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	orderNumber: string;

	@Field(() => OrderStatus)
	orderStatus: OrderStatus;

	@Field(() => String)
	buyerId: ObjectId;

	@Field(() => String)
	eventId: ObjectId;

	@Field(() => [OrderItem])
	items: OrderItem[];

	@Field(() => [String])
	seatIds: ObjectId[];

	@Field(() => String, { nullable: true })
	currency?: string;

	@Field(() => Number)
	subtotal: number;

	@Field(() => Number, { description: 'percent' })
	commissionRate: number;

	@Field(() => Number)
	commissionAmount: number;

	@Field(() => Number, { description: 'what the buyer pays' })
	totalAmount: number;

	@Field(() => Date)
	expiresAt: Date;

	@Field(() => Date, { nullable: true })
	paidAt?: Date;

	@Field(() => Date, { nullable: true })
	refundedAt?: Date;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */

	@Field(() => Event, { nullable: true })
	eventData?: Event;
}

@ObjectType()
export class Orders {
	@Field(() => [Order])
	list: Order[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
