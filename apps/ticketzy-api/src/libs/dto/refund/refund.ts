import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { RefundSource, RefundStatus } from '../../enums/ticket.enum';

@ObjectType()
export class Refund {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	orderId: ObjectId;

	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	buyerId: ObjectId;

	@Field(() => Number)
	amount: number;

	@Field(() => String, { nullable: true })
	currency?: string;

	@Field(() => RefundStatus)
	refundStatus: RefundStatus;

	@Field(() => RefundSource)
	refundSource: RefundSource;

	@Field(() => String, { nullable: true })
	reason?: string;

	@Field(() => String, { nullable: true })
	requestedBy?: ObjectId;

	@Field(() => Date)
	requestedAt: Date;

	@Field(() => Date, { nullable: true })
	completedAt?: Date;

	@Field(() => Boolean)
	stockReleased: boolean;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;
}

@ObjectType()
export class RefundQuote {
	@Field(() => String)
	orderId: ObjectId;

	@Field(() => Boolean)
	refundable: boolean;

	@Field(() => Date, { description: 'the end of 23:59 on the day before the event, in the venue timezone' })
	deadline: Date;

	@Field(() => String)
	venueTimezone: string;

	@Field(() => Number, { description: 'what the buyer would get back; 0 when it is not refundable' })
	refundableAmount: number;

	@Field(() => String, { nullable: true })
	currency?: string;

	@Field(() => String, { nullable: true, description: 'why it is not refundable' })
	reason?: string;
}

/** what refunding the orders of a cancelled event came to; running it again finishes the rest */
@ObjectType()
export class RefundSummary {
	@Field(() => String)
	eventId: ObjectId;

	@Field(() => Int)
	refundedCount: number;

	@Field(() => Int)
	failedCount: number;

	@Field(() => Int, { description: 'PAID orders that were looked at in this run' })
	totalCount: number;

	@Field(() => [String], { description: 'order ids that failed in this run' })
	failedOrderIds: string[];
}
