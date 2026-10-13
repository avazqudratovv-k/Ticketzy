import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { AuditAction, AuditTargetType } from '../../enums/audit-log.enum';
import { Direction } from '../../enums/common.enum';
import { availableAuditLogSorts } from '../../config';
import { PageField, LimitField } from '../common/pagination';

@InputType()
class ALSearch {
	@IsOptional()
	@Field(() => AuditAction, { nullable: true })
	action?: AuditAction;

	@IsOptional()
	@Field(() => AuditTargetType, { nullable: true })
	targetType?: AuditTargetType;

	@IsOptional()
	@Field(() => String, { nullable: true })
	targetId?: ObjectId;

	@IsOptional()
	@Field(() => String, { nullable: true })
	actorId?: ObjectId;
}

@InputType()
export class AuditLogsInquiry {
	@PageField()
	page: number;

	@LimitField()
	limit: number;

	@IsOptional()
	@IsIn(availableAuditLogSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => ALSearch)
	search: ALSearch;
}
