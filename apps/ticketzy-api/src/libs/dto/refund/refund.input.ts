import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional } from 'class-validator';
import { ObjectId } from 'mongoose';

@InputType()
export class AdminRefundInput {
	@IsNotEmpty()
	@Field(() => String)
	orderId: ObjectId;

	@IsNotEmpty()
	@Field(() => String)
	reason: string;
}

@InputType()
export class RefundRequestInput {
	@IsNotEmpty()
	@Field(() => String)
	orderId: ObjectId;

	@IsOptional()
	@Field(() => String, { nullable: true })
	reason?: string;
}
