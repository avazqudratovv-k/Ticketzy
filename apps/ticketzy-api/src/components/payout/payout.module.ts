import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PayoutResolver } from './payout.resolver';
import { PayoutService } from './payout.service';
import PayoutSchema from '../../libs/schemas/Payout.model';
import EventSchema from '../../libs/schemas/Event.model';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Payout', schema: PayoutSchema },
			{ name: 'Event', schema: EventSchema },
		]),
		AuthModule,
		NotificationModule,
		AuditLogModule,
	],
	providers: [PayoutResolver, PayoutService],
	exports: [PayoutService],
})
export class PayoutModule {}
