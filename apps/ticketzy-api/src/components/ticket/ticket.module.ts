import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketResolver } from './ticket.resolver';
import { TicketService } from './ticket.service';
import TicketSchema from '../../libs/schemas/Ticket.model';
import EventSchema from '../../libs/schemas/Event.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Ticket', schema: TicketSchema },
			{ name: 'Event', schema: EventSchema },
		]),
		AuthModule,
	],
	providers: [TicketResolver, TicketService],
	exports: [TicketService],
})
export class TicketModule {}
