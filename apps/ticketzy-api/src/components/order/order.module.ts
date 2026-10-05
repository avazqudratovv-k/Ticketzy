import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderResolver } from './order.resolver';
import { OrderService } from './order.service';
import OrderSchema from '../../libs/schemas/Order.model';
import EventSchema from '../../libs/schemas/Event.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import PaymentSchema from '../../libs/schemas/Payment.model';
import { AuthModule } from '../auth/auth.module';
import { TicketTypeModule } from '../ticket-type/ticket-type.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Order', schema: OrderSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Payment', schema: PaymentSchema },
		]),
		AuthModule,
		TicketTypeModule,
	],
	providers: [OrderResolver, OrderService],
	exports: [OrderService],
})
export class OrderModule {}
