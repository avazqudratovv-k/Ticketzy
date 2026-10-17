import { Args, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { AccountService } from './account.service';
import { AccountDeletionCheck, AccountDeletionResult } from '../../libs/dto/account/account';
import { DeleteAccountInput } from '../../libs/dto/account/account.input';
import { Member } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { enforceAccountDeleteLimit } from '../../libs/rate-limit';

/** Deleting one's own account (DECISIONS #123). USER and ORGANIZER only: admins are refused by the role guard. */
@Resolver()
export class AccountResolver {
	private readonly logger = new Logger(AccountResolver.name);

	constructor(private readonly accountService: AccountService) {}

	/** read-only: may the caller delete, what blocks an organizer, how many unused tickets a buyer has */
	@Roles(MemberType.USER, MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query(() => AccountDeletionCheck)
	public async getMyAccountDeletionCheck(@AuthMember() authMember: Member): Promise<AccountDeletionCheck> {
		this.logger.log('Query: getMyAccountDeletionCheck');
		return await this.accountService.getDeletionCheck(authMember);
	}

	@Roles(MemberType.USER, MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Mutation(() => AccountDeletionResult)
	public async deleteMyAccount(
		@Args('input') _input: DeleteAccountInput,
		@AuthMember() authMember: Member,
		@Context() context: any,
	): Promise<AccountDeletionResult> {
		this.logger.log('Mutation: deleteMyAccount');
		enforceAccountDeleteLimit(context?.req, authMember._id);
		return await this.accountService.deleteAccount(authMember);
	}
}
