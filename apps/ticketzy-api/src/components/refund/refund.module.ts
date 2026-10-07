import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RefundResolver } from './refund.resolver';
import { RefundService } from './refund.service';
import OrderSchema from '../../libs/schemas/Order.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import EventSchema from '../../libs/schemas/Event.model';
import VenueSchema from '../../libs/schemas/Venue.model';
import RefundSchema from '../../libs/schemas/Refund.model';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { SeatModule } from '../seat/seat.module';
import { TicketTypeModule } from '../ticket-type/ticket-type.module';
import { NotificationModule } from '../notification/notification.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Order', schema: OrderSchema },
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Venue', schema: VenueSchema },
			{ name: 'Refund', schema: RefundSchema },
		]),
		AuthModule,
		PaymentModule,
		SeatModule,
		TicketTypeModule,
		NotificationModule,
		AuditLogModule,
	],
	providers: [RefundResolver, RefundService],
	exports: [RefundService],
})
export class RefundModule {}
