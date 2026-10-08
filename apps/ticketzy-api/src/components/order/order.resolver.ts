import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { OrderService } from './order.service';
import { Order, Orders, OrganizerOrders } from '../../libs/dto/order/order';
import { CheckoutInput, OrdersInquiry, OrganizerOrdersInquiry } from '../../libs/dto/order/order.input';
import { PaymentSimulation } from '../../libs/enums/ticket.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveOrganizerGuard } from '../auth/guards/organizer.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class OrderResolver {
	private readonly logger = new Logger(OrderResolver.name);

	constructor(private readonly orderService: OrderService) {}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async createCheckout(@Args('input') input: CheckoutInput, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		this.logger.log('Mutation: createCheckout');
		return await this.orderService.createCheckout(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async payOrder(
		@Args('orderId') input: string,
		@Args('simulate', { type: () => PaymentSimulation }) simulate: PaymentSimulation,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Order> {
		this.logger.log('Mutation: payOrder');
		return await this.orderService.payOrder(memberId, shapeIntoMongoObjectId(input), simulate);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async cancelPendingOrder(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		this.logger.log('Mutation: cancelPendingOrder');
		return await this.orderService.cancelPendingOrder(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Query(() => Order)
	public async getOrder(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		this.logger.log('Query: getOrder');
		return await this.orderService.getOrder(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Query(() => Orders)
	public async getMyOrders(
		@Args('input') input: OrdersInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Orders> {
		this.logger.log('Query: getMyOrders');
		return await this.orderService.getMyOrders(memberId, input);
	}

	/** ORGANIZER */

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard, ActiveOrganizerGuard)
	@Query(() => OrganizerOrders)
	public async getMyEventOrders(
		@Args('input') input: OrganizerOrdersInquiry,
		@AuthMember('_id') organizerId: ObjectId,
	): Promise<OrganizerOrders> {
		this.logger.log('Query: getMyEventOrders');
		return await this.orderService.getMyEventOrders(organizerId, input);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Orders)
	public async getAllOrdersByAdmin(@Args('input') input: OrdersInquiry): Promise<Orders> {
		this.logger.log('Query: getAllOrdersByAdmin');
		return await this.orderService.getAllOrdersByAdmin(input);
	}
}
