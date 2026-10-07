import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesResolver } from './sales.resolver';
import { SalesService } from './sales.service';
import OrderSchema from '../../libs/schemas/Order.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import EventSchema from '../../libs/schemas/Event.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Order', schema: OrderSchema },
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'TicketType', schema: TicketTypeSchema },
		]),
		AuthModule,
	],
	providers: [SalesResolver, SalesService],
	exports: [SalesService],
})
export class SalesModule {}
