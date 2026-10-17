import { Field, Int, ObjectType } from '@nestjs/graphql';
import { DeletionBlockReason } from '../../enums/account.enum';

@ObjectType()
export class DeletionBlocker {
	@Field(() => DeletionBlockReason)
	reason: DeletionBlockReason;

	@Field(() => Int, { description: 'how many events block (the full number)' })
	count: number;

	@Field(() => [String], { description: 'titles of the first events, at most 10' })
	eventNames: string[];
}

@ObjectType()
export class AccountDeletionCheck {
	@Field(() => Boolean)
	canDelete: boolean;

	@Field(() => [DeletionBlocker], { description: 'empty for a buyer and for an organizer who may delete' })
	blockers: DeletionBlocker[];

	@Field(() => Int, { description: 'buyer: unused (VALID) tickets for events that have not ended; they keep working after deletion' })
	unusedUpcomingTickets: number;
}

@ObjectType()
export class AccountDeletionResult {
	@Field(() => Boolean)
	deleted: boolean;

	@Field(() => Int)
	releasedSeatHolds: number;

	@Field(() => Int)
	cancelledPendingOrders: number;
}
