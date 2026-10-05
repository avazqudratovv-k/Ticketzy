import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { OrderService } from './order.service';
import { Order, Orders } from '../../libs/dto/order/order';
import { OrderInput, OrdersInquiry } from '../../libs/dto/order/order.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class OrderResolver {
	constructor(private readonly orderService: OrderService) {}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async createOrder(@Args('input') input: OrderInput, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		console.log('Mutation: createOrder');
		return await this.orderService.createOrder(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async payOrder(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		console.log('Mutation: payOrder');
		return await this.orderService.payOrder(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Order)
	public async cancelOrder(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		console.log('Mutation: cancelOrder');
		return await this.orderService.cancelOrder(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Query(() => Order)
	public async getOrder(@Args('orderId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Order> {
		console.log('Query: getOrder');
		return await this.orderService.getOrder(memberId, shapeIntoMongoObjectId(input));
	}

	@UseGuards(AuthGuard)
	@Query(() => Orders)
	public async getMyOrders(
		@Args('input') input: OrdersInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Orders> {
		console.log('Query: getMyOrders');
		return await this.orderService.getMyOrders(memberId, input);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Orders)
	public async getAllOrdersByAdmin(@Args('input') input: OrdersInquiry): Promise<Orders> {
		console.log('Query: getAllOrdersByAdmin');
		return await this.orderService.getAllOrdersByAdmin(input);
	}
}
