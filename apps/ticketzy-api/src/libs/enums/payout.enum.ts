import { registerEnumType } from '@nestjs/graphql';

/** computed, never typed in: see getPayoutStatus in libs/payout.ts */
export enum PayoutStatus {
	NOT_YET_DUE = 'NOT_YET_DUE',
	DUE = 'DUE',
	PAID_OUT = 'PAID_OUT',
	NOTHING_TO_PAY = 'NOTHING_TO_PAY',
}
registerEnumType(PayoutStatus, {
	name: 'PayoutStatus',
});
