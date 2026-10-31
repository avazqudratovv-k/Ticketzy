import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { EventCategory, EventLocale, EventStatus, SeatingType } from '../../enums/event.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';
import { Venue } from '../venue/venue';
import { RefundPolicy } from './refund-policy';

@ObjectType()
export class EventTranslation {
	@Field(() => EventLocale)
	locale: EventLocale;

	@Field(() => String)
	title: string;

	@Field(() => String, { nullable: true })
	description?: string;
}

@ObjectType()
export class EventModerationFlag {
	@Field(() => String)
	type: string;

	@Field(() => String, { nullable: true })
	reason?: string;

	@Field(() => Float, { nullable: true })
	confidence?: number;
}

@ObjectType()
export class EventModeration {
	@Field(() => Boolean, { nullable: true, description: 'false: the AI check did not run or failed' })
	checked?: boolean;

	@Field(() => [EventModerationFlag])
	flags: EventModerationFlag[];

	@Field(() => String, { nullable: true })
	reason?: string;

	@Field(() => Float, { nullable: true })
	confidence?: number;

	@Field(() => String, { nullable: true })
	model?: string;

	@Field(() => Date, { nullable: true })
	checkedAt?: Date;
}

@ObjectType()
export class VenueConflict {
	@Field(() => String)
	eventId: ObjectId;

	@Field(() => String)
	eventTitle: string;

	@Field(() => EventStatus)
	eventStatus: EventStatus;

	@Field(() => String)
	organizerNick: string;

	@Field(() => String)
	venueName: string;

	@Field(() => Date)
	startAt: Date;

	@Field(() => Date)
	endAt: Date;
}

@ObjectType()
export class Event {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => EventCategory)
	eventCategory: EventCategory;

	@Field(() => EventStatus)
	eventStatus: EventStatus;

	@Field(() => SeatingType)
	seatingType: SeatingType;

	@Field(() => String)
	eventTitle: string;

	@Field(() => String, { nullable: true })
	eventDesc?: string;

	@Field(() => [String])
	eventImages: string[];

	@Field(() => [EventTranslation])
	eventTranslations: EventTranslation[];

	@Field(() => RefundPolicy, { description: 'refundable until N days before the event, or non-refundable; shown on the event page and at checkout' })
	refundPolicy?: RefundPolicy;

	@Field(() => Number)
	eventMinPrice: number;

	@Field(() => Int)
	eventViews: number;

	@Field(() => Int)
	eventLikes: number;

	@Field(() => Int)
	eventComments: number;

	@Field(() => Int)
	eventRank: number;

	@Field(() => String)
	organizerId: ObjectId;

	@Field(() => String)
	venueId: ObjectId;

	@Field(() => Date)
	startAt: Date;

	@Field(() => Date)
	endAt: Date;

	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;

	/** rejectReason, cancelReason and eventModeration are returned only to the owner and to admins */
	@Field(() => String, { nullable: true })
	rejectReason?: string;

	@Field(() => String, { nullable: true })
	cancelReason?: string;

	@Field(() => EventModeration, { nullable: true })
	eventModeration?: EventModeration;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */

	@Field(() => Int, { nullable: true, description: 'all tickets the event can sell (sum over its ticket types); filled by event queries and lists' })
	eventTotalSeats?: number;

	@Field(() => Int, { nullable: true, description: 'tickets in paid, non-refunded orders; held and unpaid ones do not count' })
	eventSoldSeats?: number;

	@Field(() => [VenueConflict], {
		nullable: true,
		description:
			'ADMIN only (null for everyone else). Other PENDING/APPROVED/ENDED events at the same time at a venue that looks like the same place. A hint for the review, never blocks.',
	})
	possibleVenueConflicts?: VenueConflict[];

	@Field(() => Member, { nullable: true })
	memberData?: Member;

	@Field(() => Venue, { nullable: true })
	venueData?: Venue;

	@Field(() => [MeLiked], { nullable: true })
	meLiked?: MeLiked[];
}

@ObjectType()
export class Events {
	@Field(() => [Event])
	list: Event[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
