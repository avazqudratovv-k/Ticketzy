import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import PropertySchema from 'apps/ticketzy-api/src/libs/schemas/Property.model';
import MemberSchema from 'apps/ticketzy-api/src/libs/schemas/Member.model';

@Module({
	imports: [
		ConfigModule.forRoot(), 
		DatabaseModule, 
		ScheduleModule.forRoot(),
		MongooseModule.forFeature([{ name: 'Property', schema: PropertySchema}]),
		MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema}]),
	],
	controllers: [BatchController],
	providers: [BatchService],
})
export class BatchModule {}
