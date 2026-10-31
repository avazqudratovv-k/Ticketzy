import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Model, ObjectId } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType, unverifiedMemberStatuses } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import { shapeIntoMongoObjectId } from '../../libs/config';

/** the token only identifies the member; everything else is loaded from the database on each request */
export interface TokenPayload {
	_id: string;
	memberType: MemberType;
	/** the member's tokenVersion when the token was made; a token without it counts as 0 (DECISIONS #135) */
	tv?: number;
}

@Injectable()
export class AuthService {
	/** compared against when the email is unknown, so a missing account costs as much time as a wrong password */
	private static readonly DUMMY_HASH = bcrypt.hashSync('ticketzy-dummy-password', 10);
	private readonly logger = new Logger(AuthService.name);

	constructor(
		private jwtService: JwtService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	public async hashPassword(memberPassword: string): Promise<string> {
		const salt = await bcrypt.genSalt();
		return await bcrypt.hash(memberPassword, salt);
	}

	public async comparePasswords(password: string, hashedPassword?: string): Promise<boolean> {
		const isMatch = await bcrypt.compare(password, hashedPassword ?? AuthService.DUMMY_HASH);
		return Boolean(hashedPassword) && isMatch;
	}

	public async createToken(member: { _id: ObjectId; memberType: MemberType; tokenVersion?: number }): Promise<string> {
		const payload: TokenPayload = { _id: String(member._id), memberType: member.memberType, tv: member.tokenVersion ?? 0 };
		return await this.jwtService.signAsync(payload);
	}

	/** never leaks jwt library errors: any invalid, expired or malformed token is a plain 401 */
	public async verifyToken(token: string): Promise<TokenPayload> {
		try {
			const payload = await this.jwtService.verifyAsync<TokenPayload>(token);
			if (!payload?._id || !payload?.memberType) throw new Error('Malformed token payload');
			return payload;
		} catch (err) {
			this.logger.warn(`Token rejected: ${err.message}`);
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}
	}

	/**
	 * verifies the token, then loads the member so blocked accounts and role changes apply immediately.
	 * `allowRestricted` also lets REJECTED and SUSPENDED members in; only the contact-support flow asks for it.
	 */
	public async authenticate(token: string, options: { allowRestricted?: boolean } = {}): Promise<Member> {
		const payload = await this.verifyToken(token);
		const member = await this.loadMember(payload._id, options);
		// a password reset or change raised the member's tokenVersion: tokens made before it are dead (DECISIONS #135)
		if ((payload.tv ?? 0) !== (member.tokenVersion ?? 0)) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		return member;
	}

	/** the member by id with the same status rules as authenticate (used by sockets that outlive one request) */
	public async loadMember(memberId: string | ObjectId, options: { allowRestricted?: boolean } = {}): Promise<Member> {
		let member: Member | null = null;
		try {
			member = (await this.memberModel.findById(shapeIntoMongoObjectId(memberId)).lean().exec()) as unknown as Member;
		} catch (err) {
			this.logger.warn(`Member lookup failed: ${err.message}`);
		}
		if (!member) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);

		const blocked = options.allowRestricted ? [MemberStatus.DELETE] : unverifiedMemberStatuses;
		if (blocked.includes(member.memberStatus)) {
			throw new UnauthorizedException(Message.ACCOUNT_NOT_VERIFIED);
		}
		return member;
	}

	public getBearerToken(request: any): string {
		const header: string | undefined = request?.headers?.authorization;
		if (!header) throw new UnauthorizedException(Message.TOKEN_NOT_EXIST);

		const [scheme, token] = header.split(' ');
		if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		return token;
	}
}
