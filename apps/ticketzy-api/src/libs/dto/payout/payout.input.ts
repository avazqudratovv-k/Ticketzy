import { Field, InputType, Int } from '@nestjs/graphql';
import { IsDate, IsNotEmpty, IsOptional, MaxLength, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { Direction } from '../../enums/common.enum';
import { PayoutStatus } from '../../enums/payout.enum';
import { PageField, LimitField } from '../common/pagination';

@InputType()
export class PayoutsInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@Field(() => PayoutStatus, { nullable: true })
	payoutStatus?: PayoutStatus;

	/** by payout date; DESC (latest first) when not given */
	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;
}

@InputType()
export class PayoutsByAdminInquiry extends PayoutsInquiry {
	@IsOptional()
	@Field(() => String, { nullable: true })
	organizerId?: ObjectId;

	/** event title */
	@IsOptional()
	@MaxLength(100)
	@Field(() => String, { nullable: true })
	text?: string;

	/** the range applies to the payout date */
	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	dateFrom?: Date;

	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	dateTo?: Date;
}

@InputType()
export class MarkPayoutPaidInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@IsOptional()
	@MaxLength(300)
	@Field(() => String, { nullable: true })
	note?: string;
}
