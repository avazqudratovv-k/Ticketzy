import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { SeatStatus } from '../../enums/event.enum';
import { VenueLayout } from '../venue/venue';

/** the stored seat document */
export interface EventSeat {
	_id: ObjectId;
	eventId: ObjectId;
	ticketTypeId: ObjectId;
	sectionKey: string;
	row: number;
	number: number;
	seatStatus: SeatStatus;
	heldBy?: ObjectId;
	heldUntil?: Date;
	orderId?: ObjectId;
}

/** a seat that is not free; heldBy is never exposed */
@ObjectType()
export class TakenSeat {
	@Field(() => String)
	sectionKey: string;

	@Field(() => Int)
	row: number;

	@Field(() => Int)
	number: number;

	@Field(() => SeatStatus)
	seatStatus: SeatStatus;
}

@ObjectType()
export class EventSeatMap {
	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	venueTimezone: string;

	@Field(() => VenueLayout)
	venueLayout: VenueLayout;

	@Field(() => [TakenSeat], { description: 'only SOLD seats and HELD seats whose hold has not expired' })
	seats: TakenSeat[];
}
