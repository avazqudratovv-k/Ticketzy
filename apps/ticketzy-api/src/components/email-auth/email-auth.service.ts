import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { EmailChangeInput } from '../../libs/dto/member/email-auth.input';
import { buildEmailLink, isMailableAddress } from '../../libs/email-token';
import { getMailConfig } from '../../libs/env.validation';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Message } from '../../libs/enums/common.enum';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { findReusableEmailHolder } from '../../libs/member-email';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthService } from '../auth/auth.service';
import { EmailTokenService, invalidTokenError } from '../mail/email-token.service';
import { MailService } from '../mail/mail.service';

/** a request for a reset link always takes at least this long, found account or not, so the time tells nothing (#135) */
export const PASSWORD_RESET_MIN_MS = 300;

interface Recipient {
	_id: ObjectId;
	memberEmail?: string;
	memberStatus: MemberStatus;
	memberLang?: unknown;
}

const normalizeEmail = (email: unknown): string => String(email ?? '').trim().toLowerCase();

/**
 * Email verification, email change and password reset by one-time emailed links (DECISIONS #135). Tokens come from
 * EmailTokenService (hash stored, single use), mail goes through MailService (never throws). Audit entries hold the purpose
 * and ids only: never a token, a link, an address or a password.
 */
@Injectable()
export class EmailAuthService {
	private readonly logger = new Logger(EmailAuthService.name);
	/** mails started in the background; `whenIdle` lets a test or a shutdown wait for them */
	private readonly background = new Set<Promise<unknown>>();
	/** a field so a test can set it to 0 */
	public resetMinMs = PASSWORD_RESET_MIN_MS;

	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		private readonly emailTokens: EmailTokenService,
		private readonly mail: MailService,
		private readonly authService: AuthService,
		private readonly auditLogService: AuditLogService,
	) {}

	public async whenIdle(): Promise<void> {
		await Promise.allSettled([...this.background]);
	}

	/** the link goes out after the answer was sent: a slow or failing mail provider never slows or fails the request */
	private inBackground(work: Promise<unknown>): void {
		const tracked = work.catch((err) => this.logger.error(`Background mail failed: ${String(err?.name ?? 'Error')}`)).finally(() => this.background.delete(tracked));
		this.background.add(tracked);
	}

	/** issues a token, mails the link, audits. Never throws. Returns whether a mail went out (or was logged in dev mode). */
	private async deliver(member: Recipient, purpose: EmailTokenPurpose, to: string, newEmail?: string): Promise<boolean> {
		try {
			// demo and deleted accounts have no inbox: no token is made for them either
			if (member.memberStatus === MemberStatus.DELETE || !isMailableAddress(to)) return false;
			const token = await this.emailTokens.issue(member._id, purpose, { newEmail });
			const link = buildEmailLink(getMailConfig().siteUrl, purpose, token);
			const result = await this.mail.send({ to, lang: member.memberLang, purpose, link, memberStatus: member.memberStatus });
			if (result === 'sent' || result === 'dev') {
				await this.auditLogService.record({
					actorId: member._id,
					action: {
						[EmailTokenPurpose.VERIFY_EMAIL]: AuditAction.EMAIL_VERIFICATION_SENT,
						[EmailTokenPurpose.CHANGE_EMAIL]: AuditAction.EMAIL_CHANGE_REQUESTED,
						[EmailTokenPurpose.RESET_PASSWORD]: AuditAction.PASSWORD_RESET_REQUESTED,
					}[purpose],
					targetType: AuditTargetType.MEMBER,
					targetId: member._id,
					meta: { purpose },
				});
				return true;
			}
			return false;
		} catch (err) {
			this.logger.error(`Email link not sent (${purpose}): ${String((err as Error)?.name ?? 'Error')}`);
			return false;
		}
	}

	/** after sign-up: fire and forget */
	public sendVerificationInBackground(member: Recipient): void {
		this.inBackground(this.deliver(member, EmailTokenPurpose.VERIFY_EMAIL, member.memberEmail ?? ''));
	}

	/** resendVerificationEmail: the caller is logged in and their address is not verified yet */
	public async resendVerificationEmail(memberId: ObjectId): Promise<string> {
		const member = await this.memberModel
			.findOne({ _id: memberId, memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] } })
			.select('memberEmail memberStatus memberLang emailVerifiedAt')
			.lean()
			.exec();
		if (!member) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (member.emailVerifiedAt) throw new BadRequestException(Message.EMAIL_ALREADY_VERIFIED);
		await this.deliver(member as unknown as Recipient, EmailTokenPurpose.VERIFY_EMAIL, member.memberEmail);
		return Message.VERIFICATION_EMAIL_SENT;
	}

	/**
	 * verifyEmail: the link opened from a verification mail (the address becomes verified) or from an email-change mail (the
	 * new address replaces the old one and counts as verified). The token is spent first, in one conditional update.
	 */
	public async verifyEmail(token: unknown): Promise<string> {
		const redeemed = await this.emailTokens.redeem(token, [EmailTokenPurpose.VERIFY_EMAIL, EmailTokenPurpose.CHANGE_EMAIL]);
		const now = new Date();

		if (redeemed.purpose === EmailTokenPurpose.VERIFY_EMAIL) {
			const changed = await this.memberModel
				.findOneAndUpdate(
					{ _id: redeemed.memberId, memberStatus: { $ne: MemberStatus.DELETE }, emailVerifiedAt: null },
					{ $set: { emailVerifiedAt: now } },
					{ new: true, timestamps: false },
				)
				.select('_id')
				.lean()
				.exec();
			if (!changed) {
				// already verified is fine (the link was a second one); a deleted or missing account is not
				const alive = await this.memberModel.exists({ _id: redeemed.memberId, memberStatus: { $ne: MemberStatus.DELETE } });
				if (!alive) throw invalidTokenError();
				return Message.EMAIL_VERIFIED;
			}
			await this.auditLogService.record({
				actorId: redeemed.memberId,
				action: AuditAction.EMAIL_VERIFIED,
				targetType: AuditTargetType.MEMBER,
				targetId: redeemed.memberId,
				meta: { purpose: redeemed.purpose },
			});
			return Message.EMAIL_VERIFIED;
		}

		if (!redeemed.newEmail) throw invalidTokenError();
		// the address may have been taken (or freshly deleted) since the link was mailed
		await findReusableEmailHolder(this.memberModel as Model<any>, redeemed.newEmail);
		let changed: { _id: ObjectId } | null;
		try {
			changed = await this.memberModel
				.findOneAndUpdate(
					{ _id: redeemed.memberId, memberStatus: { $ne: MemberStatus.DELETE } },
					{ $set: { memberEmail: redeemed.newEmail, emailVerifiedAt: now } },
					{ new: true },
				)
				.select('_id')
				.lean()
				.exec();
		} catch (err) {
			if ((err as any)?.code === 11000) throw new BadRequestException(Message.USED_MEMBER_EMAIL_NICK_OR_PHONE);
			throw err;
		}
		if (!changed) throw invalidTokenError();
		await this.emailTokens.revokeOpen(redeemed.memberId, EmailTokenPurpose.CHANGE_EMAIL, now);
		await this.auditLogService.record({
			actorId: redeemed.memberId,
			action: AuditAction.EMAIL_CHANGED,
			targetType: AuditTargetType.MEMBER,
			targetId: redeemed.memberId,
			meta: { purpose: redeemed.purpose },
		});
		return Message.EMAIL_CHANGED;
	}

	/** requestEmailChange: password checked, the link goes to the NEW address, the old one stays until it is opened */
	public async requestEmailChange(memberId: ObjectId, input: EmailChangeInput): Promise<string> {
		const member = await this.memberModel
			.findOne({ _id: memberId, memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.PENDING] } })
			.select('+memberPassword memberEmail memberStatus memberLang')
			.exec();
		if (!member) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		if (!(await this.authService.comparePasswords(input.currentPassword, member.memberPassword))) {
			throw new BadRequestException(Message.WRONG_PASSWORD);
		}
		const newEmail = normalizeEmail(input.newEmail);
		if (newEmail === normalizeEmail(member.memberEmail)) throw new BadRequestException(Message.EMAIL_CHANGE_SAME);
		await findReusableEmailHolder(this.memberModel as Model<any>, newEmail);

		await this.deliver(member as unknown as Recipient, EmailTokenPurpose.CHANGE_EMAIL, newEmail, newEmail);
		return Message.EMAIL_CHANGE_REQUESTED;
	}

	/**
	 * requestPasswordReset: the same answer for a known and an unknown address, and the same time (a floor of
	 * `resetMinMs`; the token, the mail and the audit run after the answer). Demo and deleted accounts get no mail.
	 */
	public async requestPasswordReset(email: unknown): Promise<string> {
		const startedAt = Date.now();
		const address = normalizeEmail(email);
		const member = address
			? await this.memberModel
					.findOne({ memberEmail: address, memberStatus: { $ne: MemberStatus.DELETE } })
					.select('memberEmail memberStatus memberLang')
					.lean()
					.exec()
			: null;
		if (member) this.inBackground(this.deliver(member as unknown as Recipient, EmailTokenPurpose.RESET_PASSWORD, address));

		const wait = this.resetMinMs - (Date.now() - startedAt);
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		return Message.PASSWORD_RESET_REQUESTED;
	}

	/**
	 * resetPassword: the token is spent first (single use), the password is hashed like at sign-up, tokenVersion goes up so
	 * every older login is rejected, and the address counts as verified (the owner just proved the inbox).
	 */
	public async resetPassword(token: unknown, newPassword: string): Promise<string> {
		const redeemed = await this.emailTokens.redeem(token, [EmailTokenPurpose.RESET_PASSWORD]);
		const memberPassword = await this.authService.hashPassword(newPassword);
		const now = new Date();

		const member = await this.memberModel
			.findOneAndUpdate(
				{ _id: redeemed.memberId, memberStatus: { $ne: MemberStatus.DELETE } },
				{ $set: { memberPassword }, $inc: { tokenVersion: 1 } },
				{ new: true },
			)
			.select('_id emailVerifiedAt')
			.lean()
			.exec();
		if (!member) throw invalidTokenError();

		if (!member.emailVerifiedAt) {
			await this.memberModel.updateOne({ _id: member._id, emailVerifiedAt: null }, { $set: { emailVerifiedAt: now } }, { timestamps: false }).exec();
		}
		await this.emailTokens.revokeOpen(member._id, EmailTokenPurpose.RESET_PASSWORD, now);
		await this.auditLogService.record({
			actorId: member._id,
			action: AuditAction.PASSWORD_RESET_COMPLETED,
			targetType: AuditTargetType.MEMBER,
			targetId: member._id,
			meta: { purpose: EmailTokenPurpose.RESET_PASSWORD },
		});
		return Message.PASSWORD_RESET_DONE;
	}
}
