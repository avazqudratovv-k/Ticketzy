import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { EmailChangeInput } from '../../libs/dto/member/email-auth.input';
import { ValidationFailedException } from '../../libs/coded-exception';
import { Message } from '../../libs/enums/common.enum';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { enforceEmailTokenLimit, enforceMailLimit, enforcePasswordLimit } from '../../libs/rate-limit';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { EmailAuthService } from './email-auth.service';

/** the same rule as sign-up and updateMember (`@MinLength(8)`): a scalar argument cannot carry the decorator */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt reads at most 72 bytes; a huge body is refused before any hashing */
const MAX_PASSWORD_LENGTH = 200;

@Resolver()
export class EmailAuthResolver {
	private readonly logger = new Logger(EmailAuthResolver.name);

	constructor(private readonly emailAuthService: EmailAuthService) {}

	/** public: the link may be opened in a browser where the member is not logged in */
	@Mutation(() => String)
	public async verifyEmail(@Args('token') token: string, @Context() context: any): Promise<string> {
		this.logger.log('Mutation: verifyEmail');
		enforceEmailTokenLimit(context?.req);
		return await this.emailAuthService.verifyEmail(token);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async resendVerificationEmail(@AuthMember() authMember: Member, @Context() context: any): Promise<string> {
		this.logger.log('Mutation: resendVerificationEmail');
		enforceMailLimit(context?.req, EmailTokenPurpose.VERIFY_EMAIL, authMember.memberEmail);
		return await this.emailAuthService.resendVerificationEmail(authMember._id);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async requestEmailChange(
		@Args('input') input: EmailChangeInput,
		@AuthMember('_id') memberId: ObjectId,
		@Context() context: any,
	): Promise<string> {
		this.logger.log('Mutation: requestEmailChange');
		enforcePasswordLimit(context?.req, memberId);
		enforceMailLimit(context?.req, EmailTokenPurpose.CHANGE_EMAIL, input.newEmail);
		return await this.emailAuthService.requestEmailChange(memberId, input);
	}

	/** public; the answer is the same whether or not the address belongs to an account */
	@Mutation(() => String)
	public async requestPasswordReset(@Args('email') email: string, @Context() context: any): Promise<string> {
		this.logger.log('Mutation: requestPasswordReset');
		enforceMailLimit(context?.req, EmailTokenPurpose.RESET_PASSWORD, email);
		return await this.emailAuthService.requestPasswordReset(email);
	}

	@Mutation(() => String)
	public async resetPassword(@Args('token') token: string, @Args('newPassword') newPassword: string, @Context() context: any): Promise<string> {
		this.logger.log('Mutation: resetPassword');
		enforceEmailTokenLimit(context?.req);
		if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
			throw new ValidationFailedException(Message.VALIDATION_FAILED, [{ field: 'newPassword', rules: ['length'] }]);
		}
		return await this.emailAuthService.resetPassword(token, newPassword);
	}
}
