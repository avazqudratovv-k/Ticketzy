import { Args, Query, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogs } from '../../libs/dto/audit-log/audit-log';
import { AuditLogsInquiry } from '../../libs/dto/audit-log/audit-log.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Resolver()
export class AuditLogResolver {
	private readonly logger = new Logger(AuditLogResolver.name);

	constructor(private readonly auditLogService: AuditLogService) {}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => AuditLogs)
	public async getAuditLogsByAdmin(@Args('input') input: AuditLogsInquiry): Promise<AuditLogs> {
		this.logger.log('Query: getAuditLogsByAdmin');
		return await this.auditLogService.getAuditLogsByAdmin(input);
	}
}
