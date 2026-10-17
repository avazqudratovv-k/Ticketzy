import { registerEnumType } from '@nestjs/graphql';

/** why an organizer cannot delete the account yet (DECISIONS #123) */
export enum DeletionBlockReason {
	EVENTS_IN_REVIEW = 'EVENTS_IN_REVIEW',
	EVENTS_NOT_ENDED = 'EVENTS_NOT_ENDED',
	PAYOUTS_NOT_PAID = 'PAYOUTS_NOT_PAID',
}
registerEnumType(DeletionBlockReason, {
	name: 'DeletionBlockReason',
});
