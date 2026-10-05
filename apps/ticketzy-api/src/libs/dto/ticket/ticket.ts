import { Field, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { TicketStatus } from '../../enums/ticket.enum';
import { TotalCounter } from '../member/member';
import { Event } from '../event/event';
import { TicketType } from '../ticket-type/ticket-type';

@ObjectType()
export class Ticket {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	ticketCode: string;

	@Field(() => TicketStatus)
	ticketStatus: TicketStatus;

	@Field(() => String)
	orderId: ObjectId;

	@Field(() => String)
	ticketTypeId: ObjectId;

	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	ownerId: ObjectId;

	@Field(() => Date, { nullable: true })
	checkedInAt?: Date;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */

	@Field(() => Event, { nullable: true })
	eventData?: Event;

	@Field(() => TicketType, { nullable: true })
	ticketTypeData?: TicketType;
}

@ObjectType()
export class Tickets {
	@Field(() => [Ticket])
	list: Ticket[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
