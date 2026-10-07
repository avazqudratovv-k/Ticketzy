import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { Message } from '../../../libs/enums/common.enum';

@Injectable()
export class RolesGuard implements CanActivate {
	private readonly logger = new Logger('RolesGuard');

	constructor(
		private reflector: Reflector,
		private authService: AuthService,
	) {}

	async canActivate(context: ExecutionContext | any): Promise<boolean> {
		const roles = this.reflector.get<string[]>('roles', context.getHandler());
		if (!roles) return true;

		if (context.contextType === 'graphql') {
			const request = context.getArgByIndex(2).req;

			const token = this.authService.getBearerToken(request);
			const authMember = await this.authService.authenticate(token);

			if (!authMember || !roles.includes(authMember.memberType)) {
				throw new ForbiddenException(Message.ONLY_SPECIFIC_ROLES_ALLOWED);
			}

			this.logger.log(`member ${authMember._id} allowed as ${authMember.memberType} [${roles}]`);
			request.body.authMember = authMember;
			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
