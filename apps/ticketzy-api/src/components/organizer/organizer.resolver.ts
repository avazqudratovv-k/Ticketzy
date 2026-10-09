import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { OrganizerService } from './organizer.service';
import { Member, Members } from '../../libs/dto/member/member';
import { ClearCommissionOverrideInput, CommissionOverrideInput, OrganizerReasonInput, OrganizersByAdminInquiry } from '../../libs/dto/organizer/organizer.input';
import { CommissionOverrideCleared } from '../../libs/dto/organizer/organizer';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

/** every operation here is ADMIN only */
@Resolver()
export class OrganizerResolver {
	private readonly logger = new Logger(OrganizerResolver.name);

	constructor(private readonly organizerService: OrganizerService) {}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public async getOrganizersByAdmin(@Args('input') input: OrganizersByAdminInquiry): Promise<Members> {
		this.logger.log('Query: getOrganizersByAdmin');
		return await this.organizerService.getOrganizersByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async verifyOrganizerByAdmin(
		@Args('memberId') input: string,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: verifyOrganizerByAdmin');
		return await this.organizerService.verifyOrganizerByAdmin(adminId, shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async rejectOrganizerByAdmin(
		@Args('input') input: OrganizerReasonInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: rejectOrganizerByAdmin');
		input.memberId = shapeIntoMongoObjectId(input.memberId);
		return await this.organizerService.rejectOrganizerByAdmin(adminId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async suspendOrganizerByAdmin(
		@Args('input') input: OrganizerReasonInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: suspendOrganizerByAdmin');
		input.memberId = shapeIntoMongoObjectId(input.memberId);
		return await this.organizerService.suspendOrganizerByAdmin(adminId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async reinstateOrganizerByAdmin(
		@Args('memberId') input: string,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: reinstateOrganizerByAdmin');
		return await this.organizerService.reinstateOrganizerByAdmin(adminId, shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async setCommissionOverrideByAdmin(
		@Args('input') input: CommissionOverrideInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: setCommissionOverrideByAdmin');
		input.memberId = shapeIntoMongoObjectId(input.memberId);
		return await this.organizerService.setCommissionOverrideByAdmin(adminId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => CommissionOverrideCleared)
	public async clearCommissionOverrideByAdmin(
		@Args('input') input: ClearCommissionOverrideInput,
		@AuthMember('_id') adminId: ObjectId,
	): Promise<CommissionOverrideCleared> {
		this.logger.log('Mutation: clearCommissionOverrideByAdmin');
		input.memberId = shapeIntoMongoObjectId(input.memberId);
		return await this.organizerService.clearCommissionOverrideByAdmin(adminId, input);
	}
}
