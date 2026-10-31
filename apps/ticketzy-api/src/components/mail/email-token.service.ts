import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { CodedException } from '../../libs/coded-exception';
import { EMAIL_TOKEN_TTL_MS, generateEmailToken, hashEmailToken, looksLikeEmailToken } from '../../libs/email-token';
import { Message } from '../../libs/enums/common.enum';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';

export interface RedeemedToken {
	memberId: ObjectId;
	purpose: EmailTokenPurpose;
	newEmail?: string;
}

export const invalidTokenError = (): CodedException => new CodedException(Message.INVALID_OR_EXPIRED_TOKEN, 'INVALID_OR_EXPIRED_TOKEN', 400);

/** the one-time tokens (DECISIONS #135): only the SHA-256 hash is stored, a new token revokes the older ones, a token works once */
@Injectable()
export class EmailTokenService {
	constructor(@InjectModel('EmailToken') private readonly emailTokenModel: Model<any>) {}

	/** the plain token goes into the email and nowhere else */
	public async issue(memberId: ObjectId, purpose: EmailTokenPurpose, options: { newEmail?: string; now?: Date } = {}): Promise<string> {
		const now = options.now ?? new Date();
		const { token, tokenHash } = generateEmailToken();
		const created = await this.emailTokenModel.create({
			memberId,
			purpose,
			tokenHash,
			expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
			...(options.newEmail ? { newEmail: options.newEmail } : {}),
		});
		// the new token exists first, so there is never a moment without a working link; the older open ones stop working
		await this.emailTokenModel
			.updateMany({ memberId, purpose, _id: { $ne: created._id }, usedAt: null, revokedAt: null }, { $set: { revokedAt: now } })
			.exec();
		return token;
	}

	/** one conditional update: unknown, expired, used or revoked tokens all give the same error */
	public async redeem(token: unknown, purposes: EmailTokenPurpose[], now: Date = new Date()): Promise<RedeemedToken> {
		if (!looksLikeEmailToken(token)) throw invalidTokenError();
		const row: any = await this.emailTokenModel
			.findOneAndUpdate(
				{ tokenHash: hashEmailToken(token), purpose: { $in: purposes }, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
				{ $set: { usedAt: now } },
				{ new: true },
			)
			.lean()
			.exec();
		if (!row) throw invalidTokenError();
		return { memberId: row.memberId, purpose: row.purpose, ...(row.newEmail ? { newEmail: row.newEmail } : {}) };
	}

	/** after a successful reset: every other open token of that purpose for the member stops working */
	public async revokeOpen(memberId: ObjectId, purpose: EmailTokenPurpose, now: Date = new Date()): Promise<void> {
		await this.emailTokenModel.updateMany({ memberId, purpose, usedAt: null, revokedAt: null }, { $set: { revokedAt: now } }).exec();
	}
}
