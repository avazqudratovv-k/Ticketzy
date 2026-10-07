import { Field, Float, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { AuditAction, AuditTargetType } from '../../enums/audit-log.enum';
import { EventStatus } from '../../enums/event.enum';
import { MemberStatus } from '../../enums/member.enum';
import { Member, TotalCounter } from '../member/member';

@ObjectType()
export class AuditLogMeta {
	@Field(() => String, { nullable: true })
	reason?: string;

	@Field(() => MemberStatus, { nullable: true })
	fromStatus?: MemberStatus;

	@Field(() => MemberStatus, { nullable: true })
	toStatus?: MemberStatus;

	@Field(() => EventStatus, { nullable: true })
	fromEventStatus?: EventStatus;

	@Field(() => EventStatus, { nullable: true })
	toEventStatus?: EventStatus;

	@Field(() => Float, { nullable: true })
	rate?: number;

	@Field(() => Date, { nullable: true })
	endsAt?: Date;
}

@ObjectType()
export class AuditLog {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	actorId: ObjectId;

	@Field(() => AuditAction)
	action: AuditAction;

	@Field(() => AuditTargetType)
	targetType: AuditTargetType;

	@Field(() => String)
	targetId: ObjectId;

	@Field(() => AuditLogMeta, { nullable: true })
	meta?: AuditLogMeta;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */
	@Field(() => Member, { nullable: true })
	actorData?: Member;
}

@ObjectType()
export class AuditLogs {
	@Field(() => [AuditLog])
	list: AuditLog[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}

/** internal: what other services pass to AuditLogService.record (not exposed in GraphQL) */
export interface AuditLogCreate {
	actorId: ObjectId;
	action: AuditAction;
	targetType: AuditTargetType;
	targetId: ObjectId;
	meta?: Record<string, any>;
}
