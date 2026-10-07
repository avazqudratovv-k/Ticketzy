import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
	private readonly logger = new Logger('AuthGuard');

	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext | any): Promise<boolean> {
		if (context.contextType === 'graphql') {
			const request = context.getArgByIndex(2).req;

			const token = this.authService.getBearerToken(request);
			const authMember = await this.authService.authenticate(token);

			this.logger.log(`authenticated member ${authMember._id}`);
			request.body.authMember = authMember;

			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
