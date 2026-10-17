import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountResolver } from './account.resolver';
import { AccountService } from './account.service';
import MemberSchema from '../../libs/schemas/Member.model';
import EventSchema from '../../libs/schemas/Event.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { SeatModule } from '../seat/seat.module';
import { PayoutModule } from '../payout/payout.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Ticket', schema: TicketSchema },
		]),
		AuthModule,
		OrderModule,
		SeatModule,
		PayoutModule,
		AuditLogModule,
	],
	providers: [AccountResolver, AccountService],
	exports: [AccountService],
})
export class AccountModule {}
