import { Args, Context, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { MemberService } from './member.service';
import { OrganizersInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { Member, Members } from '../../libs/dto/member/member';
import { Logger, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { ObjectId } from 'mongoose';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberUpdate } from '../../libs/dto/member/member.update';
import { saveVerifiedImage, shapeIntoMongoObjectId, validUploadTargets } from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import { GraphQLUpload, FileUpload } from 'graphql-upload';
import { Message } from '../../libs/enums/common.enum';

@Resolver(() => Member)
export class MemberResolver {
	private readonly logger = new Logger(MemberResolver.name);

	constructor(private readonly memberService: MemberService) {}

	/** the email is private: only the member themselves and admins see it, everyone else gets null */
	@ResolveField(() => String, { nullable: true })
	public memberEmail(@Parent() member: Member, @Context() context: any): string | null {
		const authMember = context?.req?.body?.authMember;
		if (!authMember || !member.memberEmail) return null;

		const isSelf = String(authMember._id) === String(member._id);
		return isSelf || authMember.memberType === MemberType.ADMIN ? member.memberEmail : null;
	}

	@Mutation(() => Member)
	public async signupUser(@Args('input') input: MemberInput): Promise<Member> {
		this.logger.log('Mutation: signupUser');
		return await this.memberService.signupUser(input);
	}

	@Mutation(() => Member)
	public async signupOrganizer(@Args('input') input: MemberInput): Promise<Member> {
		this.logger.log('Mutation: signupOrganizer');
		return await this.memberService.signupOrganizer(input);
	}

	@Mutation(() => Member)
	public async login(@Args('input') input: LoginInput): Promise<Member> {
		this.logger.log('Mutation: login');
		return await this.memberService.login(input);
	}

	@UseGuards(AuthGuard)
	@Query(() => String)
	public async checkAuth(@AuthMember('_id') memberId: ObjectId): Promise<string> {
		this.logger.log('Query: checkAuth');
		return `Hi ${memberId}`;
	}

	@Roles(MemberType.USER, MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query(() => String)
	public async checkAuthRoles(@AuthMember() authMember: Member): Promise<string> {
		this.logger.log('Query: checkAuthRoles');
		return `Hi ${authMember.memberNick ?? authMember.memberFullName ?? 'member'}, you are ${authMember.memberType} (memberId: ${authMember._id})`;
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public async updateMember(
		@Args('input') input: MemberUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		this.logger.log('Mutation: updateMember');
		delete input._id;
		return await this.memberService.updateMember(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public async getMember(@Args('memberId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Member> {
		this.logger.log('Query: getMember');
		const targetId = shapeIntoMongoObjectId(input);
		return await this.memberService.getMember(memberId, targetId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Members)
	public async getOrganizers(@Args('input') input: OrganizersInquiry, @AuthMember('_id') memberId: ObjectId): Promise<Members> {
		this.logger.log('Query: getOrganizers');
		return await this.memberService.getOrganizers(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public async likeTargetMember(
    	@Args('memberId') input: string,
    	@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
    	this.logger.log('Mutation: likeTargetMember');
		const likeRefId = shapeIntoMongoObjectId(input);
    	return await this.memberService.likeTargetMember(memberId, likeRefId);
	}


	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Members)
	public async getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		this.logger.log('Query: getAllMembersByAdmin');
		return await this.memberService.getAllMembersByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async updateMemberByAdmin(@Args('input') input: MemberUpdate): Promise<Member> {
		this.logger.log('Mutation: updateMemberByAdmin');
		return await this.memberService.updateMemberByAdmin(input);
	}

	/** UPLOADER */

	@UseGuards(AuthGuard)
	@Mutation((returns) => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload })
		{ createReadStream, filename }: FileUpload,
		@Args('target') target: string,
	): Promise<string> {
		this.logger.log('Mutation: imageUploader');

		if (!filename) throw new Error(Message.UPLOAD_FAILED);
		if (!validUploadTargets.includes(target)) throw new Error(Message.BAD_REQUEST);

		// the file type is checked from the file's first bytes inside saveVerifiedImage
		return await saveVerifiedImage(createReadStream(), target);
	}

	@UseGuards(AuthGuard)
	@Mutation((returns) => [String])
	public async imagesUploader(
		@Args('files', { type: () => [GraphQLUpload] })
		files: Promise<FileUpload>[],
		@Args('target') target: string,
	): Promise<string[]> {
		this.logger.log('Mutation: imagesUploader');

		if (!validUploadTargets.includes(target)) throw new Error(Message.BAD_REQUEST);

		const uploadedImages = [];
		const promisedList = files.map(async (img: Promise<FileUpload>, index: number): Promise<Promise<void>> => {
			try {
				const { createReadStream } = await img;
				uploadedImages[index] = await saveVerifiedImage(createReadStream(), target);
			} catch (err) {
				this.logger.error(`Error, file rejected: ${err.message}`);
			}
		});

		await Promise.all(promisedList);
		return uploadedImages;
	}
}
