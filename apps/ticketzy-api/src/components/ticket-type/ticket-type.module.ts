import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketTypeResolver } from './ticket-type.resolver';
import { TicketTypeService } from './ticket-type.service';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import EventSchema from '../../libs/schemas/Event.model';
import MemberSchema from '../../libs/schemas/Member.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'TicketType', schema: TicketTypeSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Member', schema: MemberSchema },
		]),
		AuthModule,
	],
	providers: [TicketTypeResolver, TicketTypeService],
	exports: [TicketTypeService],
})
export class TicketTypeModule {}
