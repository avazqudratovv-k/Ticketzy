import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { TicketStatus } from '../../enums/ticket.enum';
import { TotalCounter } from '../member/member';
import { Event } from '../event/event';
import { TicketType } from '../ticket-type/ticket-type';

/** where a reserved-seating ticket sits */
@ObjectType()
export class TicketSeat {
	@Field(() => String)
	sectionKey: string;

	@Field(() => Int)
	row: number;

	@Field(() => Int)
	number: number;
}

@ObjectType()
export class Ticket {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	ticketCode: string;

	@Field(() => TicketStatus)
	ticketStatus: TicketStatus;

	@Field(() => String, { nullable: true, description: 'signed token for the QR code; only the owner receives it' })
	qrToken?: string;

	@Field(() => String, { nullable: true })
	seatId?: ObjectId;

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

	@Field(() => TicketSeat, { nullable: true })
	seatData?: TicketSeat;
}

@ObjectType()
export class Tickets {
	@Field(() => [Ticket])
	list: Ticket[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
