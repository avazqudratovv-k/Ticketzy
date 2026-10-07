import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, Length, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { EventCategory, EventStatus } from '../../enums/event.enum';
import { availableEventSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { PeriodsRange, PricesRange } from '../common/common.input';

@InputType()
export class EventInput {
	@IsNotEmpty()
	@Field(() => EventCategory)
	eventCategory: EventCategory;

	@IsOptional()
	@Field(() => EventStatus, { nullable: true })
	eventStatus?: EventStatus;

	@IsNotEmpty()
	@Length(3, 100)
	@Field(() => String)
	eventTitle: string;

	@IsOptional()
	@Length(5, 2000)
	@Field(() => String, { nullable: true })
	eventDesc?: string;

	@IsNotEmpty()
	@Field(() => [String])
	eventImages: string[];

	@IsNotEmpty()
	@Field(() => String)
	venueId: ObjectId;

	@IsNotEmpty()
	@Field(() => Date)
	startAt: Date;

	@IsNotEmpty()
	@Field(() => Date)
	endAt: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;

	organizerId?: ObjectId;
}

@InputType()
class EISearch {
	@IsOptional()
	@Field(() => String, { nullable: true })
	organizerId?: ObjectId;

	@IsOptional()
	@Field(() => String, { nullable: true })
	venueId?: ObjectId;

	@IsOptional()
	@Field(() => [String], { nullable: true })
	cityList?: string[];

	@IsOptional()
	@Field(() => [EventCategory], { nullable: true })
	categoryList?: EventCategory[];

	@IsOptional()
	@Field(() => PricesRange, { nullable: true })
	pricesRange?: PricesRange;

	@IsOptional()
	@Field(() => PeriodsRange, { nullable: true })
	periodsRange?: PeriodsRange;

	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class EventsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableEventSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => EISearch)
	search: EISearch;
}

@InputType()
class AESearch {
	@IsOptional()
	@Field(() => EventStatus, { nullable: true })
	eventStatus?: EventStatus;
}

@InputType()
export class OrganizerEventsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableEventSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => AESearch)
	search: AESearch;
}

@InputType()
class ALESearch {
	@IsOptional()
	@Field(() => EventStatus, { nullable: true })
	eventStatus?: EventStatus;

	@IsOptional()
	@Field(() => [EventCategory], { nullable: true })
	eventCategoryList?: EventCategory[];
}

@InputType()
export class AllEventsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableEventSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => ALESearch)
	search: ALESearch;
}
