import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketResolver } from './ticket.resolver';
import { TicketService } from './ticket.service';
import TicketSchema from '../../libs/schemas/Ticket.model';
import EventSchema from '../../libs/schemas/Event.model';
import MemberSchema from '../../libs/schemas/Member.model';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import EventSeatSchema from '../../libs/schemas/EventSeat.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'TicketType', schema: TicketTypeSchema },
			{ name: 'EventSeat', schema: EventSeatSchema },
		]),
		AuthModule,
	],
	providers: [TicketResolver, TicketService],
	exports: [TicketService],
})
export class TicketModule {}
