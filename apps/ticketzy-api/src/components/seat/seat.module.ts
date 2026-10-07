import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SeatResolver } from './seat.resolver';
import { SeatService } from './seat.service';
import EventSeatSchema from '../../libs/schemas/EventSeat.model';
import EventSchema from '../../libs/schemas/Event.model';
import MemberSchema from '../../libs/schemas/Member.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'EventSeat', schema: EventSeatSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'Member', schema: MemberSchema },
		]),
		AuthModule,
	],
	providers: [SeatResolver, SeatService],
	exports: [SeatService],
})
export class SeatModule {}
