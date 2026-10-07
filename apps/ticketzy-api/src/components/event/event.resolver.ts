import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { EventService } from './event.service';
import { Event, Events } from '../../libs/dto/event/event';
import { OrganizerEventsInquiry, AllEventsInquiry, EventInput, EventsInquiry } from '../../libs/dto/event/event.input';
import { EventUpdate } from '../../libs/dto/event/event.update';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { WithoutGuard } from '../auth/guards/without.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class EventResolver {
	private readonly logger = new Logger(EventResolver.name);

	constructor(private readonly eventService: EventService) {}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => Event)
	public async createEvent(
		@Args('input') input: EventInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: createEvent');
		input.organizerId = memberId;
		input.venueId = shapeIntoMongoObjectId(input.venueId);
		return await this.eventService.createEvent(input);
	}

	@UseGuards(WithoutGuard)
	@Query((returns) => Event)
	public async getEvent(@Args('eventId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Event> {
		this.logger.log('Query: getEvent');
		const eventId = shapeIntoMongoObjectId(input);
		return await this.eventService.getEvent(memberId, eventId);
	}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation((returns) => Event)
	public async updateEvent(
		@Args('input') input: EventUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: updateEvent');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.eventService.updateEvent(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query((returns) => Events)
	public async getEvents(
		@Args('input') input: EventsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Events> {
		this.logger.log('Query: getEvents');
		return await this.eventService.getEvents(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query((returns) => Events)
	public async getFavorites(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Events> {
		this.logger.log('Query: getFavorites');
		return await this.eventService.getFavorites(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query((returns) => Events)
	public async getVisited(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Events> {
		this.logger.log('Query: getVisited');
		return await this.eventService.getVisited(memberId, input);
	}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query((returns) => Events)
	public async getOrganizerEvents(
		@Args('input') input: OrganizerEventsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Events> {
		this.logger.log('Query: getOrganizerEvents');
		return await this.eventService.getOrganizerEvents(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Event)
	public async likeTargetEvent(
		@Args('eventId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: likeTargetEvent');
		const likeRefId = shapeIntoMongoObjectId(input);
		return await this.eventService.likeTargetEvent(memberId, likeRefId);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query((returns) => Events)
	public async getAllEventsByAdmin(@Args('input') input: AllEventsInquiry): Promise<Events> {
		this.logger.log('Query: getAllEventsByAdmin');
		return await this.eventService.getAllEventsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation((returns) => Event)
	public async updateEventByAdmin(@Args('input') input: EventUpdate): Promise<Event> {
		this.logger.log('Mutation: updateEventByAdmin');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.eventService.updateEventByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation((returns) => Event)
	public async removeEventByAdmin(@Args('eventId') input: string): Promise<Event> {
		this.logger.log('Mutation: removeEventByAdmin');
		const eventId = shapeIntoMongoObjectId(input);
		return await this.eventService.removeEventByAdmin(eventId);
	}
}
