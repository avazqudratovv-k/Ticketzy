import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import EmailTokenSchema from '../../libs/schemas/EmailToken.model';
import { EmailTokenService } from './email-token.service';
import { MailService } from './mail.service';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'EmailToken', schema: EmailTokenSchema }])],
	providers: [MailService, EmailTokenService],
	exports: [MailService, EmailTokenService],
})
export class MailModule {}
