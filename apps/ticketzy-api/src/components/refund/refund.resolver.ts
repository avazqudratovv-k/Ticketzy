import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { RefundService } from './refund.service';
import { Order } from '../../libs/dto/order/order';
import { RefundQuote, RefundSummary } from '../../libs/dto/refund/refund';
import { AdminRefundInput } from '../../libs/dto/refund/refund.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class RefundResolver {
	private readonly logger = new Logger(RefundResolver.name);

	constructor(private readonly refundService: RefundService) {}

	@UseGuards(AuthGuard)
	@Query(() => RefundQuote)
	public async getRefundQuote(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<RefundQuote> {
		this.logger.log('Query: getRefundQuote');
		return await this.refundService.getRefundQuote(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async requestRefund(
		@Args('orderId') input: string,
		@Args('reason', { type: () => String, nullable: true }) reason: string | undefined,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Order> {
		this.logger.log('Mutation: requestRefund');
		return await this.refundService.requestRefund(memberId, shapeIntoMongoObjectId(input), reason);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Order)
	public async refundOrderByAdmin(@Args('input') input: AdminRefundInput, @AuthMember('_id') adminId: ObjectId): Promise<Order> {
		this.logger.log('Mutation: refundOrderByAdmin');
		input.orderId = shapeIntoMongoObjectId(input.orderId);
		return await this.refundService.refundOrderByAdmin(adminId, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => RefundSummary)
	public async retryEventRefundsByAdmin(@Args('eventId') input: string, @AuthMember('_id') adminId: ObjectId): Promise<RefundSummary> {
		this.logger.log('Mutation: retryEventRefundsByAdmin');
		return await this.refundService.retryEventRefundsByAdmin(adminId, shapeIntoMongoObjectId(input));
	}
}
