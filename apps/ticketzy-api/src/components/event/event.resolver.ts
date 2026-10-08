import { Args, Context, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { EventService } from './event.service';
import { Event, EventModeration, Events } from '../../libs/dto/event/event';
import {
	EventInput,
	EventReasonInput,
	EventsByAdminInquiry,
	EventsInquiry,
	OrganizerEventsInquiry,
} from '../../libs/dto/event/event.input';
import { EventSeatMap } from '../../libs/dto/event/event-seat';
import { EventUpdate } from '../../libs/dto/event/event.update';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { WithoutGuard } from '../auth/guards/without.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Member } from '../../libs/dto/member/member';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver(() => Event)
export class EventResolver {
	private readonly logger = new Logger(EventResolver.name);

	constructor(private readonly eventService: EventService) {}

	/** private fields: only the organizer who owns the event and admins see them, everyone else gets null */
	private isOwnerOrAdmin(event: Event, context: any): boolean {
		const authMember = context?.req?.body?.authMember;
		if (!authMember) return false;
		return String(authMember._id) === String(event.organizerId) || authMember.memberType === MemberType.ADMIN;
	}

	@ResolveField(() => String, { nullable: true })
	public rejectReason(@Parent() event: Event, @Context() context: any): string | null {
		return event.rejectReason && this.isOwnerOrAdmin(event, context) ? event.rejectReason : null;
	}

	@ResolveField(() => String, { nullable: true })
	public cancelReason(@Parent() event: Event, @Context() context: any): string | null {
		return event.cancelReason && this.isOwnerOrAdmin(event, context) ? event.cancelReason : null;
	}

	@ResolveField(() => EventModeration, { nullable: true })
	public eventModeration(@Parent() event: Event, @Context() context: any): EventModeration | null {
		return event.eventModeration && this.isOwnerOrAdmin(event, context) ? event.eventModeration : null;
	}

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
	public async getEvent(@Args('eventId') input: string, @AuthMember() authMember: Member | null): Promise<Event> {
		this.logger.log('Query: getEvent');
		const eventId = shapeIntoMongoObjectId(input);
		return await this.eventService.getEvent(authMember, eventId);
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

	@UseGuards(WithoutGuard)
	@Query(() => EventSeatMap)
	public async getEventSeatMap(
		@Args('eventId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<EventSeatMap> {
		this.logger.log('Query: getEventSeatMap');
		return await this.eventService.getEventSeatMap(shapeIntoMongoObjectId(input), memberId);
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
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Query((returns) => Events)
	public async getMyEvents(
		@Args('input') input: OrganizerEventsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Events> {
		this.logger.log('Query: getMyEvents');
		return await this.eventService.getMyEvents(memberId, input);
	}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => Event)
	public async submitEventForApproval(
		@Args('eventId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: submitEventForApproval');
		return await this.eventService.submitEventForApproval(memberId, shapeIntoMongoObjectId(input));
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
	public async getEventsByAdmin(@Args('input') input: EventsByAdminInquiry): Promise<Events> {
		this.logger.log('Query: getEventsByAdmin');
		return await this.eventService.getEventsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Event)
	public async approveEventByAdmin(
		@Args('eventId') input: string,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: approveEventByAdmin');
		return await this.eventService.approveEventByAdmin(adminId, shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Event)
	public async rejectEventByAdmin(
		@Args('input') input: EventReasonInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: rejectEventByAdmin');
		input.eventId = shapeIntoMongoObjectId(input.eventId);
		return await this.eventService.rejectEventByAdmin(adminId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Event)
	public async cancelEventByAdmin(
		@Args('input') input: EventReasonInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Event> {
		this.logger.log('Mutation: cancelEventByAdmin');
		input.eventId = shapeIntoMongoObjectId(input.eventId);
		return await this.eventService.cancelEventByAdmin(adminId, input);
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
