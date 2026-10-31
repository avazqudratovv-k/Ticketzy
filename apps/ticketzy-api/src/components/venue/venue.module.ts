import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VenueLayoutResolver, VenueResolver, VenueSectionResolver } from './venue.resolver';
import { VenueService } from './venue.service';
import VenueSchema from '../../libs/schemas/Venue.model';
import EventSchema from '../../libs/schemas/Event.model';
import EventSeatSchema from '../../libs/schemas/EventSeat.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Venue', schema: VenueSchema },
			{ name: 'Event', schema: EventSchema },
			{ name: 'EventSeat', schema: EventSeatSchema },
		]),
		AuthModule,
	],
	providers: [VenueResolver, VenueLayoutResolver, VenueSectionResolver, VenueService],
	exports: [VenueService],
})
export class VenueModule {}
