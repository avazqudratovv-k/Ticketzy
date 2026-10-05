import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventResolver } from './event.resolver';
import { EventService } from './event.service';
import EventSchema from '../../libs/schemas/Event.model';
import VenueSchema from '../../libs/schemas/Venue.model';
import { AuthModule } from '../auth/auth.module';
import { ViewModule } from '../view/view.module';
import { MemberModule } from '../member/member.module';
import { LikeModule } from '../like/like.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Event', schema: EventSchema },
			{ name: 'Venue', schema: VenueSchema },
		]),
		AuthModule,
		ViewModule,
		MemberModule,
		LikeModule,
	],
	providers: [EventResolver, EventService],
	exports: [EventService],
})
export class EventModule {}
