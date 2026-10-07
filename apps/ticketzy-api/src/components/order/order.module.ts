import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderResolver } from './order.resolver';
import { OrderService } from './order.service';
import OrderSchema from '../../libs/schemas/Order.model';
import EventSchema from '../../libs/schemas/Event.model';
import MemberSchema from '../../libs/schemas/Member.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import PaymentSchema from '../../libs/schemas/Payment.model';
import { AuthModule } from '../auth/auth.module';
import { TicketTypeModule } from '../ticket-type/ticket-type.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Order', schema: OrderSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Payment', schema: PaymentSchema },
			{ name: 'Member', schema: MemberSchema },
		]),
		AuthModule,
		TicketTypeModule,
		NotificationModule,
	],
	providers: [OrderResolver, OrderService],
	exports: [OrderService],
})
export class OrderModule {}
