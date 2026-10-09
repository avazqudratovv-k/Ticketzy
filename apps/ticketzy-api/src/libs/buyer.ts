import { BadRequestException } from '@nestjs/common';
import { Message } from './enums/common.enum';
import { MemberType } from './enums/member.enum';

/** Only buyer accounts (USER) may start or complete a purchase; organizers and admins are refused, even on their own events. */
export const assertBuyerAccount = (memberType: MemberType | string | undefined | null): void => {
	if (memberType !== MemberType.USER) throw new BadRequestException(Message.ONLY_BUYERS_CAN_BUY);
};
