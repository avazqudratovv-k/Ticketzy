import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { TicketTypeService } from './ticket-type.service';
import { TicketType } from '../../libs/dto/ticket-type/ticket-type';
import { TicketTypeInput, TicketTypeUpdate } from '../../libs/dto/ticket-type/ticket-type.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class TicketTypeResolver {
	constructor(private readonly ticketTypeService: TicketTypeService) {}

	@Roles(MemberType.AGENT, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => TicketType)
	public async createTicketType(
		@Args('input') input: TicketTypeInput,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<TicketType> {
		console.log('Mutation: createTicketType');
		return await this.ticketTypeService.createTicketType(memberId, memberType, input);
	}

	@Roles(MemberType.AGENT, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => TicketType)
	public async updateTicketType(
		@Args('input') input: TicketTypeUpdate,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<TicketType> {
		console.log('Mutation: updateTicketType');
		input._id = shapeIntoMongoObjectId(input._id);
		return await this.ticketTypeService.updateTicketType(memberId, memberType, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => [TicketType])
	public async getTicketTypes(@Args('eventId') input: string): Promise<TicketType[]> {
		console.log('Query: getTicketTypes');
		return await this.ticketTypeService.getTicketTypes(shapeIntoMongoObjectId(input));
	}
}
