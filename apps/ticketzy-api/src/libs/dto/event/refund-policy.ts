import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsIn, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { RefundPolicyType } from '../../enums/event.enum';
import { MAX_REFUND_DAYS } from '../../refund-policy';

@ObjectType()
export class RefundPolicy {
	@Field(() => RefundPolicyType)
	policyType: RefundPolicyType;

	@Field(() => Int, { description: 'REFUNDABLE: refunds are possible until the end of the day this many days before the event; 0 for NON_REFUNDABLE' })
	daysBefore: number;
}

@InputType()
export class RefundPolicyInput {
	@IsNotEmpty()
	@IsIn(Object.values(RefundPolicyType))
	@Field(() => RefundPolicyType)
	policyType: RefundPolicyType;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(MAX_REFUND_DAYS)
	@Field(() => Int, { nullable: true, description: `REFUNDABLE only: 1 to ${MAX_REFUND_DAYS}, default 1` })
	daysBefore?: number;
}
