import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketTypeResolver } from './ticket-type.resolver';
import { TicketTypeService } from './ticket-type.service';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import EventSchema from '../../libs/schemas/Event.model';
import VenueSchema from '../../libs/schemas/Venue.model';
import EventSeatSchema from '../../libs/schemas/EventSeat.model';
import MemberSchema from '../../libs/schemas/Member.model';
import OrderSchema from '../../libs/schemas/Order.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'TicketType', schema: TicketTypeSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Venue', schema: VenueSchema },
			{ name: 'EventSeat', schema: EventSeatSchema },
			{ name: 'Order', schema: OrderSchema },
		]),
		AuthModule,
	],
	providers: [TicketTypeResolver, TicketTypeService],
	exports: [TicketTypeService],
})
export class TicketTypeModule {}
