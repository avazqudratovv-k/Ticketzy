import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogResolver } from './audit-log.resolver';
import { AuditLogService } from './audit-log.service';
import AuditLogSchema from '../../libs/schemas/AuditLog.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'AuditLog', schema: AuditLogSchema }]), AuthModule],
	providers: [AuditLogResolver, AuditLogService],
	exports: [AuditLogService],
})
export class AuditLogModule {}
