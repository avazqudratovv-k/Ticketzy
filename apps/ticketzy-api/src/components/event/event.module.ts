import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventResolver } from './event.resolver';
import { EventService } from './event.service';
import EventSchema from '../../libs/schemas/Event.model';
import MemberSchema from '../../libs/schemas/Member.model';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import EventSeatSchema from '../../libs/schemas/EventSeat.model';
import VenueSchema from '../../libs/schemas/Venue.model';
import { AuthModule } from '../auth/auth.module';
import { ViewModule } from '../view/view.module';
import { MemberModule } from '../member/member.module';
import { LikeModule } from '../like/like.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RefundModule } from '../refund/refund.module';
import { NotificationModule } from '../notification/notification.module';
import { AiModule } from '../ai/ai.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Event', schema: EventSchema },
			{ name: 'Venue', schema: VenueSchema },
			{ name: 'TicketType', schema: TicketTypeSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'EventSeat', schema: EventSeatSchema },
		]),
		AuthModule,
		ViewModule,
		MemberModule,
		LikeModule,
		NotificationModule,
		AuditLogModule,
		RefundModule,
		AiModule,
	],
	providers: [EventResolver, EventService],
	exports: [EventService],
})
export class EventModule {}
