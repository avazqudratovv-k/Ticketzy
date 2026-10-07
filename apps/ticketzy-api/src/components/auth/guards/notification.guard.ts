import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth.service';

/**
 * Guard of the notification inbox: any member type, and, unlike AuthGuard, REJECTED and SUSPENDED accounts get through
 * so they can still read why they were rejected or suspended. DELETE accounts stay blocked.
 */
@Injectable()
export class NotificationGuard implements CanActivate {
	private readonly logger = new Logger('NotificationGuard');

	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext | any): Promise<boolean> {
		if (context.contextType === 'graphql') {
			const request = context.getArgByIndex(2).req;

			const token = this.authService.getBearerToken(request);
			const authMember = await this.authService.authenticate(token, { allowRestricted: true });

			this.logger.log(`member ${authMember._id} allowed for notifications`);
			request.body.authMember = authMember;
			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
