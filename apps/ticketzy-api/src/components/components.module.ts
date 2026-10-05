import { Module } from '@nestjs/common';
import { MemberModule } from './member/member.module';
import { EventModule } from './event/event.module';
import { VenueModule } from './venue/venue.module';
import { TicketTypeModule } from './ticket-type/ticket-type.module';
import { OrderModule } from './order/order.module';
import { TicketModule } from './ticket/ticket.module';
import { AuthModule } from './auth/auth.module';
import { CommentModule } from './comment/comment.module';
import { LikeModule } from './like/like.module';
import { ViewModule } from './view/view.module';
import { FollowModule } from './follow/follow.module';
import { BoardArticleModule } from './board-article/board-article.module';

@Module({
	imports: [
		MemberModule,
		AuthModule,
		EventModule,
		VenueModule,
		TicketTypeModule,
		OrderModule,
		TicketModule,
		BoardArticleModule,
		LikeModule,
		ViewModule,
		CommentModule,
		FollowModule,
	],
})
export class ComponentsModule {}
