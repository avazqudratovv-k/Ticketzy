import { Field, Float, ObjectType } from '@nestjs/graphql';
import { CommissionOverride, Member } from '../member/member';

/** answer of clearCommissionOverrideByAdmin: what was removed, why, and the rate the organizer is on now */
@ObjectType()
export class CommissionOverrideCleared {
	@Field(() => Member)
	member: Member;

	@Field(() => CommissionOverride, { description: 'the override that was removed' })
	previousOverride: CommissionOverride;

	@Field(() => Float, { description: 'percent, the automatic tier rate that applies from now on' })
	automaticRate: number;

	@Field(() => String)
	reason: string;

	@Field(() => Date)
	clearedAt: Date;
}
