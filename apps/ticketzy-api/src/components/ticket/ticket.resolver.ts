import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { TicketService } from './ticket.service';
import { Ticket, Tickets } from '../../libs/dto/ticket/ticket';
import { CheckInResult } from '../../libs/dto/ticket/check-in';
import { TicketsInquiry } from '../../libs/dto/ticket/ticket.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { AuthMember } from '../auth/decorators/authMember.decorator';

@Resolver()
export class TicketResolver {
	private readonly logger = new Logger(TicketResolver.name);

	constructor(private readonly ticketService: TicketService) {}

	@UseGuards(AuthGuard)
	@Query(() => Tickets)
	public async getMyTickets(
		@Args('input') input: TicketsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Tickets> {
		this.logger.log('Query: getMyTickets');
		return await this.ticketService.getMyTickets(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => Ticket)
	public async getTicket(@Args('ticketId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Ticket> {
		this.logger.log('Query: getTicket');
		return await this.ticketService.getTicket(memberId, shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => CheckInResult)
	public async checkInTicket(
		@Args('qrToken') qrToken: string,
		@Args('eventId', { type: () => String, nullable: true }) eventId: string | undefined,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<CheckInResult> {
		this.logger.log('Mutation: checkInTicket');
		return await this.ticketService.checkInTicket(memberId, memberType, qrToken, eventId ? shapeIntoMongoObjectId(eventId) : undefined);
	}

	/** validates a scan like checkInTicket does, without changing anything */
	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Query(() => CheckInResult)
	public async checkInPreview(
		@Args('qrToken') qrToken: string,
		@Args('eventId', { type: () => String, nullable: true }) eventId: string | undefined,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<CheckInResult> {
		this.logger.log('Query: checkInPreview');
		return await this.ticketService.checkInPreview(memberId, memberType, qrToken, eventId ? shapeIntoMongoObjectId(eventId) : undefined);
	}
}
