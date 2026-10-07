import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { VenueService } from './venue.service';
import { Venue, Venues } from '../../libs/dto/venue/venue';
import { VenueInput, VenueUpdate, VenuesInquiry } from '../../libs/dto/venue/venue.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class VenueResolver {
	private readonly logger = new Logger(VenueResolver.name);

	constructor(private readonly venueService: VenueService) {}

	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => Venue)
	public async createVenue(@Args('input') input: VenueInput, @AuthMember('_id') memberId: ObjectId): Promise<Venue> {
		this.logger.log('Mutation: createVenue');
		input.memberId = memberId;
		return await this.venueService.createVenue(input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Venue)
	public async getVenue(@Args('venueId') input: string): Promise<Venue> {
		this.logger.log('Query: getVenue');
		return await this.venueService.getVenue(shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => Venue)
	public async updateVenue(
		@Args('input') input: VenueUpdate,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<Venue> {
		this.logger.log('Mutation: updateVenue');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.venueService.updateVenue(memberId, memberType, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Venues)
	public async getVenues(@Args('input') input: VenuesInquiry): Promise<Venues> {
		this.logger.log('Query: getVenues');
		return await this.venueService.getVenues(input);
	}
}
