import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { MemberType } from '../../../libs/enums/member.enum';
import { Message } from '../../../libs/enums/common.enum';

/**
 * Guard of the contact-support flow: organizers and admins only, and, unlike AuthGuard, REJECTED and SUSPENDED
 * accounts get through so they can still reach support. What each status may do inside a conversation is decided
 * by ConversationService (libs/conversation-access.ts), so use this guard for conversation operations only.
 */
@Injectable()
export class ConversationGuard implements CanActivate {
	private readonly logger = new Logger('ConversationGuard');

	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext | any): Promise<boolean> {
		if (context.contextType === 'graphql') {
			const request = context.getArgByIndex(2).req;

			const token = this.authService.getBearerToken(request);
			const authMember = await this.authService.authenticate(token, { allowRestricted: true });

			if (![MemberType.ORGANIZER, MemberType.ADMIN].includes(authMember.memberType)) {
				throw new ForbiddenException(Message.ONLY_SPECIFIC_ROLES_ALLOWED);
			}

			this.logger.log(`member ${authMember._id} allowed for conversations as ${authMember.memberType}`);
			request.body.authMember = authMember;
			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
