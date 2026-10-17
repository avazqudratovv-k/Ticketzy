import { BadRequestException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { GraphQLError } from 'graphql';
import { Model, ObjectId } from 'mongoose';
import { Member, Members, MyAccountState } from '../../libs/dto/member/member';
import { OrganizersInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { MemberAuthType, MemberStatus, MemberType, unverifiedMemberStatuses } from '../../libs/enums/member.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { AuthService } from '../auth/auth.service';
import { MemberUpdate } from '../../libs/dto/member/member.update';
import { StatisticModifier, T } from '../../libs/types/common';
import { ViewService } from '../view/view.service';
import { ViewGroup } from '../../libs/enums/view.enum';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeService } from '../like/like.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Event } from '../../libs/dto/event/event';
import { publicEventFilter } from '../../libs/event-visibility';
import { escapeRegExp, lookupAuthMemberLiked } from '../../libs/config';
import { CodedException } from '../../libs/coded-exception';
import { getReusableAtOf } from '../../libs/account-deletion';

@Injectable()
export class MemberService {
	private readonly logger = new Logger(MemberService.name);

	constructor(
		@InjectModel('Member')
		private readonly memberModel: Model<Member>,
		@InjectModel('Event')
		private readonly eventModel: Model<Event>,
		private authService: AuthService,
		private viewService: ViewService,
		private likeService: LikeService,
		private auditLogService: AuditLogService,
	) {}

	/** the server decides role and status: users are active at once, organizers wait for admin approval */
	public async signupUser(input: MemberInput): Promise<Member> {
		return await this.signup(input, MemberType.USER, MemberStatus.ACTIVE);
	}

	public async signupOrganizer(input: MemberInput): Promise<Member> {
		return await this.signup(input, MemberType.ORGANIZER, MemberStatus.PENDING);
	}

	private async signup(input: MemberInput, memberType: MemberType, memberStatus: MemberStatus): Promise<Member> {
		const memberEmail = String(input.memberEmail ?? '').trim().toLowerCase();
		const previous = await this.checkEmailAvailable(memberEmail);
		const memberPassword = await this.authService.hashPassword(input.memberPassword);
		try {
			const result = await this.memberModel.create({
				memberEmail: input.memberEmail,
				memberPassword,
				memberNick: input.memberNick,
				memberPhone: input.memberPhone,
				memberFullName: input.memberFullName,
				memberType,
				memberStatus,
				memberAuthType: MemberAuthType.EMAIL,
				...(previous ? { previousAccountId: previous._id } : {}),
			});
			if (previous) await this.markEmailReused(previous._id, result._id);
			result.accessToken = await this.authService.createToken(result);
			return result;
		} catch (err) {
			this.logger.error(`signup failed: ${err.message}`);
			if (err?.code === 11000) throw new BadRequestException(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		}
	}

	/**
	 * Accounts that deleted themselves keep their email (DECISIONS #123). A live account with the email is the usual
	 * "already used" answer; if only deleted accounts have it, the newest one decides: before its `emailReusableAt` the
	 * sign-up is refused with EMAIL_RECENTLY_DELETED (no date in the text), after it the email is free again and the deleted
	 * account is returned so the new one can be tagged. The unique index still decides a race between two sign-ups.
	 */
	private async checkEmailAvailable(memberEmail: string): Promise<{ _id: ObjectId } | null> {
		const holders = await this.memberModel
			.find({ memberEmail })
			.select('memberStatus deletedAt emailReusableAt')
			.sort({ deletedAt: -1 })
			.lean()
			.exec();
		if (!holders.length) return null;
		if (holders.some((holder) => holder.memberStatus !== MemberStatus.DELETE)) {
			throw new BadRequestException(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
		}
		const newest = holders[0];
		const reusableAt = getReusableAtOf(newest);
		if (reusableAt && reusableAt.getTime() > Date.now()) {
			throw new CodedException(Message.EMAIL_RECENTLY_DELETED, 'EMAIL_RECENTLY_DELETED', 400);
		}
		return { _id: newest._id as unknown as ObjectId };
	}

	/** the deleted account learns who took its email; a failure only costs this admin tag, so it is logged and the sign-up stands */
	private async markEmailReused(deletedId: ObjectId, newMemberId: ObjectId): Promise<void> {
		try {
			await this.memberModel
				.updateOne({ _id: deletedId, memberStatus: MemberStatus.DELETE }, { $set: { reusedByMemberId: newMemberId } }, { timestamps: false })
				.exec();
		} catch (err) {
			this.logger.error(`reusedByMemberId NOT SET on deleted member ${deletedId}: ${err.message}`);
		}
	}

	public async login(input: LoginInput): Promise<Member> {
		const { memberEmail, memberPassword } = input;
		// a deleted account never matches: its email may belong to a new account, and a token or password of the old one is dead (#123)
		const response: Member = await this.memberModel
			.findOne({ memberEmail: memberEmail, memberStatus: { $ne: MemberStatus.DELETE } })
			.select('+memberPassword')
			.exec();

		// one message for an unknown email and a wrong password, and the password is always compared
		const isMatch = await this.authService.comparePasswords(memberPassword, response?.memberPassword);
		if (!response || !isMatch) throw new UnauthorizedException(Message.WRONG_EMAIL_OR_PASSWORD);

		// PENDING organizers may log in, they just cannot use organizer features yet
		// a GraphQLError keeps its own code; an HttpException would be mapped to UNAUTHENTICATED by the Apollo driver
		if (unverifiedMemberStatuses.includes(response.memberStatus)) {
			throw new GraphQLError(Message.ACCOUNT_NOT_VERIFIED, { extensions: { code: 'ACCOUNT_NOT_VERIFIED' } });
		}

		response.accessToken = await this.authService.createToken(response);
		return response;
	}

	public async updateMember(memberId: ObjectId, input: MemberUpdate): Promise<Member> {
		// role and status can only be changed by an admin (updateMemberByAdmin)
		delete input.memberType;
		delete input.memberStatus;
		if (input.memberPassword) input.memberPassword = await this.authService.hashPassword(input.memberPassword);

		const result: Member = await this.memberModel
			.findOneAndUpdate(
				{
					_id: memberId,
					memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] },
				},
				input,
				{ new: true },
			)
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		result.accessToken = await this.authService.createToken(result);
		return result;
	}

	public async getMember(memberId: ObjectId, targetId: ObjectId): Promise<Member> {
		// public profiles show ACTIVE members only; a member can always open their own page, even while PENDING
		const isSelf = memberId && String(memberId) === String(targetId);
		const search: T = {
			_id: targetId,
			memberStatus: isSelf ? { $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] } : MemberStatus.ACTIVE,
		};
		const targetMember = await this.memberModel.findOne(search).lean().exec();
		if (!targetMember) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (memberId) {
			const viewInput = { memberId: memberId, viewRefId: targetId, viewGroup: ViewGroup.MEMBER };
			const newView = await this.viewService.recordView(viewInput);
			if (newView) {
				await this.memberModel.findOneAndUpdate(search, { $inc: { memberViews: 1 } }, { new: true }).exec();
				targetMember.memberViews++;
			}
			
			const likeInput = { memberId: memberId, likeRefId: targetId, likeGroup: LikeGroup.MEMBER };
			targetMember.meLiked = await this.likeService.checkLikeExistence(likeInput);
			
		}
		await this.useVisibleEventCount([targetMember]);
		return targetMember;
	}

	/** the caller's own status and approval flag, one indexed read by token id; REJECTED and SUSPENDED callers get it too (#120) */
	public async getMyAccountState(memberId: ObjectId): Promise<MyAccountState> {
		const member = await this.memberModel.findById(memberId).select('memberStatus approvalCelebrationPending').lean().exec();
		if (!member) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return { memberStatus: member.memberStatus, approvalCelebrationPending: member.approvalCelebrationPending === true };
	}

	/**
	 * Conditional update true to false on the caller's own organizer account (there is no id argument, so nobody can clear another
	 * member's flag). A second call, or a call without a flag, matches nothing and is not an error.
	 */
	public async markApprovalCelebrationDone(memberId: ObjectId): Promise<MyAccountState> {
		await this.memberModel
			.updateOne(
				{ _id: memberId, memberType: MemberType.ORGANIZER, approvalCelebrationPending: true },
				{ $set: { approvalCelebrationPending: false } },
				{ timestamps: false },
			)
			.exec();
		return await this.getMyAccountState(memberId);
	}

	/**
	 * memberEvents counts every event the organizer created (drafts included); public pages show only
	 * what the public event list shows, so the number is counted from the events themselves
	 */
	private async useVisibleEventCount(members: Member[]): Promise<void> {
		const organizers = members.filter((member) => member?.memberType === MemberType.ORGANIZER);
		if (!organizers.length) return;

		const counts: { _id: ObjectId; total: number }[] = await this.eventModel
			.aggregate([
				{ $match: { organizerId: { $in: organizers.map((member) => member._id) }, ...publicEventFilter() } },
				{ $group: { _id: '$organizerId', total: { $sum: 1 } } },
			])
			.exec();
		const totals = new Map(counts.map((row) => [String(row._id), row.total]));
		for (const member of organizers) member.memberEvents = totals.get(String(member._id)) ?? 0;
	}

	public async getOrganizers(memberId: ObjectId, input: OrganizersInquiry): Promise<Members> {
		const { text } = input.search;
		const match: T = { memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (text) match.memberNick = { $regex: new RegExp(escapeRegExp(text), 'i') };
		this.logger.debug(`match built (${Object.keys(match).join(", ")})`);

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit }, 
							{ $limit: input.limit },
							lookupAuthMemberLiked(memberId),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		await this.useVisibleEventCount(result[0].list);
		return result[0];
	}

	public async likeTargetMember(memberId: ObjectId, likeRefId: ObjectId): Promise<Member> {
    	const target: Member = await this.memberModel.findOne({ _id: likeRefId, memberStatus: MemberStatus.ACTIVE }).exec();
    	if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

    	const input: LikeInput = {
        memberId: memberId,
        likeRefId: likeRefId,
        likeGroup: LikeGroup.MEMBER,
    	};

    	// LIKE TOGGLE via Like modules
    	const modifier: number = await this.likeService.toggleLike(input);
    	const result = await this.memberStatsEditor({ _id: likeRefId, targetKey: 'memberLikes', modifier: modifier });

    	if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
    	return result;
	}


	/** ADMIN */

	public async getAllMembersByAdmin(input: MembersInquiry): Promise<Members> {
		const { memberStatus, memberType, text } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (memberStatus) match.memberStatus = memberStatus;
		if (memberType) match.memberType = memberType;
		if (text) match.memberNick = { $regex: new RegExp(escapeRegExp(text), 'i') };
		this.logger.debug(`match built (${Object.keys(match).join(", ")})`);

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async updateMemberByAdmin(adminId: ObjectId, input: MemberUpdate): Promise<Member> {
		// admin accounts are created only by the server seed, never by promotion
		if (input.memberType === MemberType.ADMIN) throw new BadRequestException(Message.CANNOT_ASSIGN_ADMIN_ROLE);
		const changesAccess = Boolean(input.memberStatus || input.memberType);
		const isSelf = String(input._id) === String(adminId);
		// an admin cannot lock themselves out or promote / demote themselves
		if (changesAccess && isSelf) throw new BadRequestException(Message.CANNOT_CHANGE_OWN_ACCESS);
		// accounts are deleted by their owner only (#123)
		if (input.memberStatus === MemberStatus.DELETE) throw new BadRequestException(Message.CANNOT_SET_DELETED_STATUS);
		if (changesAccess || input.memberPassword) {
			const target = await this.memberModel.findOne({ _id: input._id }).select('memberType memberStatus').lean().exec();
			// a deleted account cannot be brought back or re-roled: its email may already belong to a new account
			if (changesAccess && target?.memberStatus === MemberStatus.DELETE) throw new BadRequestException(Message.ACCOUNT_IS_DELETED);
			// no admin takes over another admin's account by setting a password; the attempt is audited (DECISIONS #93)
			if (input.memberPassword && !isSelf && target?.memberType === MemberType.ADMIN) {
				await this.auditLogService.record({
					actorId: adminId,
					action: AuditAction.ADMIN_PASSWORD_RESET_BLOCKED,
					targetType: AuditTargetType.MEMBER,
					targetId: target._id,
					meta: { changedFields: this.changedFields(input) },
				});
				throw new BadRequestException(Message.CANNOT_RESET_ADMIN_PASSWORD);
			}
			if (changesAccess) {
				// admin accounts are not touched by other admins
				if (target?.memberType === MemberType.ADMIN) throw new BadRequestException(Message.CANNOT_CHANGE_ADMIN_ACCESS);
				// organizer status changes must go through verify / reject / suspend / reinstate so they are audited and notified
				if (target?.memberType === MemberType.ORGANIZER) throw new BadRequestException(Message.USE_ORGANIZER_OPERATIONS);
			}
		}
		const changedFields = this.changedFields(input);
		if (input.memberPassword) input.memberPassword = await this.authService.hashPassword(input.memberPassword);
		const result: Member = await this.memberModel.findOneAndUpdate({ _id: input._id }, input, { new: true }).exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.MEMBER_UPDATED_BY_ADMIN,
			targetType: AuditTargetType.MEMBER,
			targetId: result._id,
			meta: { changedFields, ...(input.memberStatus ? { toStatus: input.memberStatus } : {}) },
		});
		return result;
	}

	/** field names only: an audit entry never holds a password, a hash or personal values */
	private changedFields(input: MemberUpdate): string[] {
		return Object.keys(input).filter((key) => key !== '_id' && (input as any)[key] !== undefined);
	}

	public async memberStatsEditor(input: StatisticModifier): Promise<Member> {
    const { _id, targetKey, modifier } = input;
    return await this.memberModel
      .findByIdAndUpdate(
        _id,
        {
          $inc: { [targetKey]: modifier },
        },
        { new: true },
      )
      .exec();
  }

}
