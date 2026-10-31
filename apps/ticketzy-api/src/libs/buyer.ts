import { BadRequestException } from '@nestjs/common';
import { CodedException } from './coded-exception';
import { Message } from './enums/common.enum';
import { MemberType } from './enums/member.enum';

/** Only buyer accounts (USER) may start or complete a purchase; organizers and admins are refused, even on their own events. */
export const assertBuyerAccount = (memberType: MemberType | string | undefined | null): void => {
	if (memberType !== MemberType.USER) throw new BadRequestException(Message.ONLY_BUYERS_CAN_BUY);
};

/**
 * Buying needs a verified email address (DECISIONS #135): unverified members may log in and browse, but holdSeats,
 * createCheckout and payOrder are refused with the code EMAIL_NOT_VERIFIED. Checked after assertBuyerAccount.
 */
export const assertVerifiedEmail = (member: { emailVerifiedAt?: Date | null } | undefined | null): void => {
	if (!member?.emailVerifiedAt) throw new CodedException(Message.EMAIL_NOT_VERIFIED, 'EMAIL_NOT_VERIFIED', 403);
};
