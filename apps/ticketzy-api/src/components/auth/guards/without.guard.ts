import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class WithoutGuard implements CanActivate {
	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext | any): Promise<boolean> {
		if (context.contextType === 'graphql') {
			const request = context.getArgByIndex(2).req;

			// guests, bad tokens and unverified accounts are all treated as "not logged in"
			try {
				const token = this.authService.getBearerToken(request);
				request.body.authMember = await this.authService.authenticate(token);
			} catch (err) {
				request.body.authMember = null;
			}
			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
