import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { FollowService } from './follow.service';
import { UseGuards, Logger } from '@nestjs/common';
import { Follower, Followers, Followings } from '../../libs/dto/follow/follow';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { ObjectId } from 'mongoose';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import { FollowInquiry } from '../../libs/dto/follow/follow.input';

@Resolver()
export class FollowResolver {
	private readonly logger = new Logger(FollowResolver.name);

    constructor(private readonly followService: FollowService) {}

    @UseGuards(AuthGuard)
    @Mutation((returns) => Follower)
    public async subscribe(
        @Args('input') input: string,
        @AuthMember('_id') memberId: ObjectId, //
    ): Promise<Follower> {
        this.logger.log('Mutation: subscribe');
        const followingId = shapeIntoMongoObjectId(input);
        return await this.followService.subscribe(memberId, followingId);
    }

    @UseGuards(AuthGuard)
    @Mutation((returns) => Follower)
    public async unsubscribe(
        @Args('input') input: string,
        @AuthMember('_id') memberId: ObjectId, //
    ): Promise<Follower> {
        this.logger.log('Mutation: unsubscribe');
        const followingId = shapeIntoMongoObjectId(input);
        return await this.followService.unsubscribe(memberId, followingId);
    }

    @UseGuards(WithoutGuard)
    @Query((returns) => Followings)
    public async getMemberFollowings(
        @Args('input') input: FollowInquiry,
        @AuthMember('_id') memberId: ObjectId,
    ): Promise<Followings> {
        this.logger.log('Query: getMemberFollowings');
        const { followerId } = input.search;
        input.search.followerId = shapeIntoMongoObjectId(followerId);
        return await this.followService.getMemberFollowings(memberId, input);
    }

    @UseGuards(WithoutGuard)
    @Query((returns) => Followers)
    public async getMemberFollowers(
        @Args('input') input: FollowInquiry,
        @AuthMember('_id') memberId: ObjectId,
    ): Promise<Followers> {
        this.logger.log('Query: getMemberFollowers');
        const { followingId } = input.search;
        input.search.followingId = shapeIntoMongoObjectId(followingId);
        return await this.followService.getMemberFollowers(memberId, input);
    }

}
