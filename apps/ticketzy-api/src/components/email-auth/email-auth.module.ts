import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import MemberSchema from '../../libs/schemas/Member.model';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { EmailAuthResolver } from './email-auth.resolver';
import { EmailAuthService } from './email-auth.service';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }]), AuthModule, MailModule, AuditLogModule],
	providers: [EmailAuthService, EmailAuthResolver],
	exports: [EmailAuthService],
})
export class EmailAuthModule {}
