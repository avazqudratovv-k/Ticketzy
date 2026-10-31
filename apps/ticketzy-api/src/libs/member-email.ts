import { BadRequestException } from '@nestjs/common';
import { Model, ObjectId } from 'mongoose';
import { CodedException } from './coded-exception';
import { getReusableAtOf } from './account-deletion';
import { Message } from './enums/common.enum';
import { MemberStatus } from './enums/member.enum';

/**
 * Accounts that deleted themselves keep their email (DECISIONS #123). A live account with the email is the usual
 * "already used" answer; if only deleted accounts have it, the newest one decides: before its `emailReusableAt` the
 * address is refused with EMAIL_RECENTLY_DELETED (no date in the text), after it the email is free again and the deleted
 * account is returned so a new account can be tagged. The unique index still decides a race between two requests.
 * Used by sign-up and by the email change (#135).
 */
export const findReusableEmailHolder = async (memberModel: Model<any>, memberEmail: string): Promise<{ _id: ObjectId } | null> => {
	const holders: any[] = await memberModel
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
};
