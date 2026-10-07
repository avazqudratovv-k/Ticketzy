import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationResolver } from './conversation.resolver';
import { ConversationService } from './conversation.service';
import { ConversationRealtime } from './conversation.realtime';
import ConversationSchema from '../../libs/schemas/Conversation.model';
import MessageSchema from '../../libs/schemas/Message.model';
import MemberSchema from '../../libs/schemas/Member.model';
import EventSchema from '../../libs/schemas/Event.model';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Conversation', schema: ConversationSchema },
			{ name: 'Message', schema: MessageSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Event', schema: EventSchema },
		]),
		AuthModule,
		NotificationModule,
	],
	providers: [ConversationResolver, ConversationService, ConversationRealtime],
	exports: [ConversationService, ConversationRealtime],
})
export class ConversationModule {}
