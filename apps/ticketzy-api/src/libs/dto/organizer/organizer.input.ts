import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { Direction } from '../../enums/common.enum';
import { MemberStatus } from '../../enums/member.enum';
import { availableOrganizerSorts } from '../../config';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@InputType()
class OASearch {
	@IsOptional()
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	/** matches full name, nick or email */
	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class OrganizersByAdminInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableOrganizerSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => OASearch)
	search: OASearch;
}

/** reject and suspend: the reason may not be blank (checked in the service, with its own Message) */
@InputType()
export class OrganizerReasonInput {
	@IsNotEmpty()
	@Field(() => String)
	memberId: ObjectId;

	@IsString()
	@MaxLength(500)
	@Transform(trim)
	@Field(() => String)
	reason: string;
}

@InputType()
export class CommissionOverrideInput {
	@IsNotEmpty()
	@Field(() => String)
	memberId: ObjectId;

	/** percentage, 0 to 100 */
	@IsNumber()
	@Min(0)
	@Max(100)
	@Field(() => Float)
	rate: number;

	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	endsAt?: Date;

	@IsString()
	@MaxLength(500)
	@Transform(trim)
	@Field(() => String)
	reason: string;
}

/** clears the override, so the organizer returns to the automatic tier rate; the reason is kept in the audit log */
@InputType()
export class ClearCommissionOverrideInput {
	@IsNotEmpty()
	@Field(() => String)
	memberId: ObjectId;

	@IsString()
	@MaxLength(500)
	@Transform(trim)
	@Field(() => String)
	reason: string;
}
