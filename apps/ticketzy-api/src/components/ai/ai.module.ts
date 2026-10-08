import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import EventSchema from '../../libs/schemas/Event.model';
import VenueSchema from '../../libs/schemas/Venue.model';
import TicketTypeSchema from '../../libs/schemas/TicketType.model';
import TicketSchema from '../../libs/schemas/Ticket.model';
import { AuthModule } from '../auth/auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AiClientService } from './ai-client.service';
import { AiModerationService } from './ai-moderation.service';
import { AiTranslationService } from './ai-translation.service';
import { AiToolsService } from './ai-tools.service';
import { AiAssistantService } from './ai-assistant.service';
import { AiResolver } from './ai.resolver';
import { AI_PROVIDER_FACTORY, createAiProvider } from './providers/create-ai-provider';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Event', schema: EventSchema },
			{ name: 'Venue', schema: VenueSchema },
			{ name: 'TicketType', schema: TicketTypeSchema },
			{ name: 'Ticket', schema: TicketSchema },
		]),
		AuthModule,
		AuditLogModule,
	],
	providers: [{ provide: AI_PROVIDER_FACTORY, useValue: createAiProvider }, AiClientService, AiModerationService, AiTranslationService, AiToolsService, AiAssistantService, AiResolver],
	exports: [AiClientService, AiModerationService],
})
export class AiModule {}
