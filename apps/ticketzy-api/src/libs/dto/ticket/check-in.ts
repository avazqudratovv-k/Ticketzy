import { Field, ObjectType } from '@nestjs/graphql';
import { TicketStatus } from '../../enums/ticket.enum';
import { Ticket, TicketSeat } from './ticket';

/** what the gate sees after a scan (or a preview of it); never contains the qrToken or contact details */
@ObjectType()
export class CheckInResult {
	@Field(() => Ticket)
	ticket: Ticket;

	@Field(() => TicketSeat, { nullable: true })
	seat?: TicketSeat;

	@Field(() => String)
	buyerName: string;

	@Field(() => String, { nullable: true })
	ticketTypeName?: string;

	@Field(() => TicketStatus)
	ticketStatus: TicketStatus;
}
