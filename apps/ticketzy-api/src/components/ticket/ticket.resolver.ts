import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { TicketService } from './ticket.service';
import { Ticket, Tickets } from '../../libs/dto/ticket/ticket';
import { OrdinaryInquiry } from '../../libs/dto/common/common.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';

@Resolver()
export class TicketResolver {
	constructor(private readonly ticketService: TicketService) {}

	@UseGuards(AuthGuard)
	@Query(() => Tickets)
	public async getMyTickets(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Tickets> {
		console.log('Query: getMyTickets');
		return await this.ticketService.getMyTickets(memberId, input);
	}

	@Roles(MemberType.AGENT, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Ticket)
	public async checkInTicket(
		@Args('ticketCode') ticketCode: string,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<Ticket> {
		console.log('Mutation: checkInTicket');
		return await this.ticketService.checkInTicket(memberId, memberType, ticketCode);
	}
}
