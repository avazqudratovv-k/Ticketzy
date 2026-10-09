import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { PayoutStatus } from '../../enums/payout.enum';
import { TotalCounter } from '../member/member';

/** one event's payout; the amounts are whole won. A recorded payout (PAID_OUT) shows the snapshot taken when it was marked */
@ObjectType()
export class PayoutRow {
	@Field(() => String, { nullable: true, description: 'set once the payout is recorded (PAID_OUT)' })
	payoutId?: ObjectId;

	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	eventTitle: string;

	@Field(() => String)
	organizerId: ObjectId;

	@Field(() => Date)
	startAt: Date;

	@Field(() => Date)
	endAt: Date;

	@Field(() => Date, { description: 'event end plus 3 days, on the clock of the venue timezone' })
	payoutDate: Date;

	@Field(() => PayoutStatus)
	payoutStatus: PayoutStatus;

	@Field(() => Number, { description: 'total of the paid, non-refunded orders' })
	gross: number;

	@Field(() => Number, { description: 'the commission stored on those orders' })
	commission: number;

	@Field(() => Number, { description: 'gross minus commission: what the organizer receives' })
	net: number;

	@Field(() => Int)
	orderCount: number;

	@Field(() => Date, { nullable: true })
	paidAt?: Date;

	@Field(() => String, { nullable: true, description: 'id of the admin who marked it' })
	paidBy?: ObjectId;

	@Field(() => String, { nullable: true })
	note?: string;

	@Field(() => String, { nullable: true, description: 'admin list only' })
	organizerNick?: string;

	@Field(() => String, { nullable: true, description: 'admin list only' })
	organizerEmail?: string;
}

@ObjectType()
export class PayoutTotals {
	@Field(() => Number, { description: 'net of the PAID_OUT rows' })
	totalPaidOut: number;

	@Field(() => Number, { description: 'net of the DUE rows' })
	totalDue: number;

	@Field(() => Number, { description: 'net of the NOT_YET_DUE rows' })
	totalUpcoming: number;
}

@ObjectType()
export class Payouts {
	@Field(() => [PayoutRow])
	list: PayoutRow[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];

	@Field(() => PayoutTotals, { description: 'over all rows of the other filters; the payoutStatus filter does not change them' })
	totals: PayoutTotals;
}
