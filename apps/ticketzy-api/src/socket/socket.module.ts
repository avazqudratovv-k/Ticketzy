import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { AuthModule } from '../components/auth/auth.module';
import { ConversationModule } from '../components/conversation/conversation.module';

@Module({
	imports: [AuthModule, ConversationModule],
	providers: [SocketGateway],
})
export class SocketModule {}
