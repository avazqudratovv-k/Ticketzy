import { Module } from '@nestjs/common';
import { MemberModule } from './member/member.module';
import { EventModule } from './event/event.module';
import { VenueModule } from './venue/venue.module';
import { TicketTypeModule } from './ticket-type/ticket-type.module';
import { SeatModule } from './seat/seat.module';
import { PaymentModule } from './payment/payment.module';
import { OrderModule } from './order/order.module';
import { TicketModule } from './ticket/ticket.module';
import { RefundModule } from './refund/refund.module';
import { SalesModule } from './sales/sales.module';
import { NoticeModule } from './notice/notice.module';
import { NotificationModule } from './notification/notification.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { OrganizerModule } from './organizer/organizer.module';
import { AuthModule } from './auth/auth.module';
import { CommentModule } from './comment/comment.module';
import { LikeModule } from './like/like.module';
import { ViewModule } from './view/view.module';
import { ConversationModule } from './conversation/conversation.module';
import { AiModule } from './ai/ai.module';
import { PayoutModule } from './payout/payout.module';
import { AccountModule } from './account/account.module';
import { EmailAuthModule } from './email-auth/email-auth.module';

@Module({
	imports: [
		MemberModule,
		AuthModule,
		EventModule,
		VenueModule,
		TicketTypeModule,
		SeatModule,
		PaymentModule,
		OrderModule,
		TicketModule,
		RefundModule,
		SalesModule,
		NoticeModule,
		NotificationModule,
		AuditLogModule,
		OrganizerModule,
		LikeModule,
		ViewModule,
		CommentModule,
		ConversationModule,
		AiModule,
		PayoutModule,
		AccountModule,
		EmailAuthModule,
	],
})
export class ComponentsModule {}
