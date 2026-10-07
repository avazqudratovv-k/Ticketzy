import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { TicketStatus } from '../../enums/ticket.enum';
import { TotalCounter } from '../member/member';
import { TicketSeat } from '../ticket/ticket';

@ObjectType()
export class TicketTypeSales {
	@Field(() => String)
	ticketTypeId: ObjectId;

	@Field(() => String, { nullable: true })
	ticketTypeName?: string;

	@Field(() => String, { nullable: true })
	currency?: string;

	@Field(() => Int, { description: 'tickets of PAID orders; refunded orders do not count' })
	ticketsSold: number;

	@Field(() => Number)
	revenue: number;

	@Field(() => Number)
	commission: number;

	@Field(() => Number, { description: 'revenue minus commission' })
	netPayout: number;
}

@ObjectType()
export class EventSales {
	@Field(() => String)
	eventId: ObjectId;

	@Field(() => [TicketTypeSales])
	ticketTypes: TicketTypeSales[];
}

@ObjectType()
export class CurrencyEarnings {
	@Field(() => String, { nullable: true })
	currency?: string;

	@Field(() => Int)
	ordersCount: number;

	@Field(() => Int)
	ticketsSold: number;

	@Field(() => Number)
	revenue: number;

	@Field(() => Number)
	commission: number;

	@Field(() => Number)
	netPayout: number;

	@Field(() => Number, { description: 'money given back for refunded orders; not part of revenue' })
	refundedAmount: number;
}

/** one entry per currency: amounts of different currencies are never added together */
@ObjectType()
export class MyEarnings {
	@Field(() => [CurrencyEarnings])
	earnings: CurrencyEarnings[];
}

@ObjectType()
export class Attendee {
	@Field(() => String)
	ticketId: ObjectId;

	@Field(() => String)
	ticketCode: string;

	@Field(() => TicketStatus)
	ticketStatus: TicketStatus;

	@Field(() => Date, { nullable: true })
	checkedInAt?: Date;

	@Field(() => String)
	buyerName: string;

	@Field(() => String, { nullable: true })
	ticketTypeName?: string;

	@Field(() => TicketSeat, { nullable: true })
	seat?: TicketSeat;

	@Field(() => String, { nullable: true })
	orderNumber?: string;
}

@ObjectType()
export class Attendees {
	@Field(() => [Attendee])
	list: Attendee[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
