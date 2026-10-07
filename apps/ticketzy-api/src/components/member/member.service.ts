import { BadRequestException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Member, Members } from '../../libs/dto/member/member';
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
import { Follower, Following, MeFollowed } from '../../libs/dto/follow/follow';
import { escapeRegExp, lookupAuthMemberLiked } from '../../libs/config';

@Injectable()
export class MemberService {
	private readonly logger = new Logger(MemberService.name);

	constructor(
		@InjectModel('Member')
		private readonly memberModel: Model<Member>,
		@InjectModel('Follow')
		private readonly followModel: Model<Follower | Following>,
		private authService: AuthService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	/** the server decides role and status: users are active at once, organizers wait for admin approval */
	public async signupUser(input: MemberInput): Promise<Member> {
		return await this.signup(input, MemberType.USER, MemberStatus.ACTIVE);
	}

	public async signupOrganizer(input: MemberInput): Promise<Member> {
		return await this.signup(input, MemberType.ORGANIZER, MemberStatus.PENDING);
	}

	private async signup(input: MemberInput, memberType: MemberType, memberStatus: MemberStatus): Promise<Member> {
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
			});
			result.accessToken = await this.authService.createToken(result);
			return result;
		} catch (err) {
			this.logger.error(`signup failed: ${err.message}`);
			if (err?.code === 11000) throw new BadRequestException(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		}
	}

	public async login(input: LoginInput): Promise<Member> {
		const { memberEmail, memberPassword } = input;
		const response: Member = await this.memberModel
			.findOne({ memberEmail: memberEmail })
			.select('+memberPassword')
			.exec();

		// one message for an unknown email and a wrong password, and the password is always compared
		const isMatch = await this.authService.comparePasswords(memberPassword, response?.memberPassword);
		if (!response || !isMatch) throw new UnauthorizedException(Message.WRONG_EMAIL_OR_PASSWORD);

		// PENDING organizers may log in, they just cannot use organizer features yet
		if (unverifiedMemberStatuses.includes(response.memberStatus)) {
			throw new UnauthorizedException(Message.ACCOUNT_NOT_VERIFIED);
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
			
			targetMember.meFollowed = await this.checkSubscription(memberId, targetId);
		}
		return targetMember;
	}

	public async checkSubscription(followerId: ObjectId, followingId: ObjectId): Promise<MeFollowed[]> {
    const result = await this.followModel.findOne({ followingId: followingId, followerId: followerId }).exec();
    return result ? [{ followerId: followerId, followingId: followingId, myFollowing: true }] : [];
	}

	public async getOrganizers(memberId: ObjectId, input: OrganizersInquiry): Promise<Members> {
		const { text } = input.search;
		const match: T = { memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (text) match.memberNick = { $regex: new RegExp(escapeRegExp(text), 'i') };
		this.logger.log(`match: ${JSON.stringify(match)}`);

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
		this.logger.log(`match: ${JSON.stringify(match)}`);

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

	public async updateMemberByAdmin(input: MemberUpdate): Promise<Member> {
		if (input.memberPassword) input.memberPassword = await this.authService.hashPassword(input.memberPassword);
		const result: Member = await this.memberModel.findOneAndUpdate({ _id: input._id }, input, { new: true }).exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
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
