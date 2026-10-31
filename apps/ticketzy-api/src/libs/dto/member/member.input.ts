import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, Length, Min, MinLength } from 'class-validator';
import { MemberStatus, MemberType } from '../../enums/member.enum';
import { availableOrganizerSorts, availableMemberSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { PageField, LimitField } from '../common/pagination';
import { EventLocale } from '../../enums/event.enum';

const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** used by signupUser and signupOrganizer: the role and status are set by the server, never by the client */
@InputType()
export class MemberInput {
	@IsNotEmpty()
	@IsEmail()
	@Transform(normalizeEmail)
	@Field(() => String)
	memberEmail: string;

	@IsNotEmpty()
	@MinLength(8)
	@Field(() => String)
	memberPassword: string;

	@IsOptional()
	@Length(3, 50)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	/** the language of the emails sent to the member; en when missing */
	@IsOptional()
	@IsEnum(EventLocale)
	@Field(() => EventLocale, { nullable: true })
	memberLang?: EventLocale;
}

@InputType()
export class LoginInput {
	@IsNotEmpty()
	@IsEmail()
	@Transform(normalizeEmail)
	@Field(() => String)
	memberEmail: string;

	@IsNotEmpty()
	@Field(() => String)
	memberPassword: string;
}

@InputType()
class OISearch {
	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class OrganizersInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@IsIn(availableOrganizerSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => OISearch)
	search: OISearch;
}

@InputType()
class MISearch {
	@IsOptional()
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	@IsOptional()
	@Field(() => MemberType, { nullable: true })
	memberType?: MemberType;

	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class MembersInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@IsIn(availableMemberSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => MISearch)
	search: MISearch;
}
