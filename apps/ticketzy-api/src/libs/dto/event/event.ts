import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { EventCategory, EventStatus } from '../../enums/event.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';
import { Venue } from '../venue/venue';

@ObjectType()
export class Event {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => EventCategory)
	eventCategory: EventCategory;

	@Field(() => EventStatus)
	eventStatus: EventStatus;

	@Field(() => String)
	eventTitle: string;

	@Field(() => String, { nullable: true })
	eventDesc?: string;

	@Field(() => [String])
	eventImages: string[];

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

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;

	/** from aggregation */

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
