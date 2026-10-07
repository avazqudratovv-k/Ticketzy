import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { TicketTypeService } from './ticket-type.service';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { TicketTypeInput, TicketTypeUpdate } from '../../libs/dto/ticket-type/ticket-type.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class TicketTypeResolver {
	private readonly logger = new Logger(TicketTypeResolver.name);

	constructor(private readonly ticketTypeService: TicketTypeService) {}

	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => TicketType)
	public async createTicketType(
		@Args('input') input: TicketTypeInput,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<TicketType> {
		this.logger.log('Mutation: createTicketType');
		return await this.ticketTypeService.createTicketType(memberId, memberType, input);
	}

	@Roles(MemberType.ORGANIZER, MemberType.ADMIN)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Mutation(() => TicketType)
	public async updateTicketType(
		@Args('input') input: TicketTypeUpdate,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<TicketType> {
		this.logger.log('Mutation: updateTicketType');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.ticketTypeService.updateTicketType(memberId, memberType, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => [TicketType])
	public async getTicketTypes(@Args('eventId') input: string): Promise<TicketType[]> {
		this.logger.log('Query: getTicketTypes');
		return await this.ticketTypeService.getTicketTypes(shapeIntoMongoObjectId(input));
	}
}
