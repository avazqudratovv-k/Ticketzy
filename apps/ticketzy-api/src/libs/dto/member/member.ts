import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { MemberAuthType, MemberStatus, MemberType } from '../../enums/member.enum';
import { MeLiked } from '../like/like';
import { MeFollowed } from '../follow/follow';

@ObjectType()
export class CommissionOverride {
	@Field(() => Float)
	rate: number;

	@Field(() => Date, { nullable: true })
	endsAt?: Date;

	@Field(() => String)
	reason: string;
}

@ObjectType()
export class Member {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => MemberType)
	memberType: MemberType;

	@Field(() => MemberStatus)
	memberStatus: MemberStatus;

	@Field(() => MemberAuthType)
	memberAuthType: MemberAuthType;

	/** only returned to the member themselves and to admins, see MemberResolver.memberEmail */
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@Field(() => String, { nullable: true })
	memberNick?: string;

	memberPassword?: string;

	/** public for organizers (organization name), private for everyone else, see MemberResolver */
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@Field(() => String)
	memberImage: string;

	/** public for organizers (organization address), private for everyone else, see MemberResolver */
	@Field(() => String, { nullable: true })
	memberAddress?: string;

	@Field(() => String, { nullable: true })
	memberDesc?: string;

	@Field(() => Int)
	memberEvents: number;

	@Field(() => Int)
	completedEvents: number;

	@Field(() => Int)
	memberFollowers: number;

	@Field(() => Int)
	memberFollowings: number;

	@Field(() => Int)
	memberLikes: number;

	@Field(() => Int)
	memberViews: number;

	@Field(() => Int)
	memberComments: number;

	@Field(() => Int)
	memberRank: number;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => String, { nullable: true })
	rejectReason?: string;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => CommissionOverride, { nullable: true })
	commissionOverride?: CommissionOverride;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => Int, { nullable: true })
	memberWarnings?: number;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => Int, { nullable: true })
	memberBlocks?: number;

	/** only returned to the member themselves and to admins, see MemberResolver */
	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	@Field(() => String, { nullable: true })
	accessToken?: string;

	/** From aggregation */
	@Field(() => [MeLiked], {nullable: true})
	meLiked?: MeLiked[];

	@Field(() => [MeFollowed], {nullable: true})
	meFollowed?: MeFollowed[];
}

@ObjectType()
export class TotalCounter {
	@Field(() => Int, { nullable: true })
	total: number;
}

@ObjectType()
export class Members {
	@Field(() => [Member])
	list: Member[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
