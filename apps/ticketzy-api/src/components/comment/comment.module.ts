import { Module } from '@nestjs/common';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';
import { MongooseModule } from '@nestjs/mongoose';
import CommentSchema from '../../libs/schemas/Comment.model';
import { AuthModule } from '../auth/auth.module';
import { EventModule } from '../event/event.module';
import { NotificationModule } from '../notification/notification.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: 'Comment',
        schema: CommentSchema,
      },
    ]),
    AuthModule,
    EventModule,
    NotificationModule,
    AuditLogModule,
  ],
  providers: [CommentResolver, CommentService]
})
export class CommentModule {}
