import { Module } from '@nestjs/common';
import { MemberResolver } from './member.resolver';
import { MemberService } from './member.service';
import { MongooseModule } from '@nestjs/mongoose';
import MemberSchema from '../../libs/schemas/Member.model';
import { AuthModule } from '../auth/auth.module';
import { ViewModule } from '../view/view.module';
import { LikeModule } from '../like/like.module';
import EventSchema from '../../libs/schemas/Event.model';
import FollowSchema from '../../libs/schemas/Follow.model';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }]),
		MongooseModule.forFeature([{name: 'Follow',schema: FollowSchema,}]), 
		MongooseModule.forFeature([{ name: 'Event', schema: EventSchema }]),
		AuthModule, 
		ViewModule,
		LikeModule,
		AuditLogModule,
	],
	providers: [MemberResolver, MemberService],
	exports: [MemberService], 
})
export class MemberModule {}
