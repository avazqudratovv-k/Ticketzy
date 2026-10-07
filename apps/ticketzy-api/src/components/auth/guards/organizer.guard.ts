import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { MemberStatus, MemberType } from '../../../libs/enums/member.enum';
import { Message } from '../../../libs/enums/common.enum';

/**
 * Organizer-only mutations: a PENDING organizer may log in but cannot create or change anything yet.
 * Must run after RolesGuard / AuthGuard (it reads the member they load): @UseGuards(RolesGuard, ActiveOrganizerGuard)
 */
@Injectable()
export class ActiveOrganizerGuard implements CanActivate {
	canActivate(context: ExecutionContext | any): boolean {
		if (context.contextType === 'graphql') {
			const authMember = context.getArgByIndex(2).req.body.authMember;
			if (!authMember) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);

			if (authMember.memberType === MemberType.ORGANIZER && authMember.memberStatus !== MemberStatus.ACTIVE) {
				throw new ForbiddenException(Message.ORGANIZER_NOT_APPROVED);
			}
			return true;
		}

		// description => http, rpc, gprs and etc are ignored
		return false;
	}
}
