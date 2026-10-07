import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import EventSchema from 'apps/ticketzy-api/src/libs/schemas/Event.model';
import MemberSchema from 'apps/ticketzy-api/src/libs/schemas/Member.model';
import OrderSchema from 'apps/ticketzy-api/src/libs/schemas/Order.model';
import TicketTypeSchema from 'apps/ticketzy-api/src/libs/schemas/TicketType.model';
import { validateEnv } from 'apps/ticketzy-api/src/libs/env.validation';

@Module({
	imports: [
		ConfigModule.forRoot({ validate: validateEnv() }),
		DatabaseModule, 
		ScheduleModule.forRoot(),
		MongooseModule.forFeature([
			{ name: 'Event', schema: EventSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Order', schema: OrderSchema },
			{ name: 'TicketType', schema: TicketTypeSchema },
		]),
	],
	controllers: [BatchController],
	providers: [BatchService],
})
export class BatchModule {}
