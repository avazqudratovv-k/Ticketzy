/** The Nest application context the demo scripts run in: the whole API without the HTTP server, plus the manifest model. */
import { INestApplicationContext, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { DatabaseModule } from './database/database.module';
import { ComponentsModule } from './components/components.module';
import DemoSeedRecordSchema from './libs/schemas/DemoSeedRecord.model';
import { DemoMongoModels } from './demo-snapshot';

@Module({
	imports: [ConfigModule.forRoot(), DatabaseModule, ComponentsModule, MongooseModule.forFeature([{ name: 'DemoSeedRecord', schema: DemoSeedRecordSchema }])],
})
export class DemoSeedModule {}

export const openDemoApp = (): Promise<INestApplicationContext> =>
	NestFactory.createApplicationContext(DemoSeedModule, { logger: ['error', 'warn'] });

const MODEL_NAMES: Record<keyof DemoMongoModels, string> = {
	manifest: 'DemoSeedRecord',
	member: 'Member',
	venue: 'Venue',
	event: 'Event',
	ticketType: 'TicketType',
	eventSeat: 'EventSeat',
	order: 'Order',
	ticket: 'Ticket',
	payment: 'Payment',
	refund: 'Refund',
	payout: 'Payout',
	comment: 'Comment',
	like: 'Like',
	view: 'View',
	follow: 'Follow',
	conversation: 'Conversation',
	message: 'Message',
	notification: 'Notification',
	auditLog: 'AuditLog',
};

export const getDemoModels = (app: INestApplicationContext): DemoMongoModels =>
	Object.fromEntries(Object.entries(MODEL_NAMES).map(([key, name]) => [key, app.get(getModelToken(name), { strict: false })])) as unknown as DemoMongoModels;
