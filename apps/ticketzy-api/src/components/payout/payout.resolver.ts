import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { PayoutService } from './payout.service';
import { PayoutRow, Payouts } from '../../libs/dto/payout/payout';
import { MarkPayoutPaidInput, PayoutsByAdminInquiry, PayoutsInquiry } from '../../libs/dto/payout/payout.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';

@Resolver()
export class PayoutResolver {
	private readonly logger = new Logger(PayoutResolver.name);

	constructor(private readonly payoutService: PayoutService) {}

	/** ORGANIZER */

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Query(() => Payouts)
	public async getMyPayouts(@Args('input') input: PayoutsInquiry, @AuthMember('_id') memberId: ObjectId): Promise<Payouts> {
		this.logger.log('Query: getMyPayouts');
		return await this.payoutService.getMyPayouts(memberId, input);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Payouts)
	public async getPayoutsByAdmin(@Args('input') input: PayoutsByAdminInquiry): Promise<Payouts> {
		this.logger.log('Query: getPayoutsByAdmin');
		return await this.payoutService.getPayoutsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => PayoutRow)
	public async markPayoutPaidByAdmin(@Args('input') input: MarkPayoutPaidInput, @AuthMember('_id') adminId: ObjectId): Promise<PayoutRow> {
		this.logger.log('Mutation: markPayoutPaidByAdmin');
		return await this.payoutService.markPayoutPaidByAdmin(adminId, input);
	}
}
