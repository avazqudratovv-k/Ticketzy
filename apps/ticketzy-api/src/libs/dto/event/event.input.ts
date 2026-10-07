import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { ObjectId } from 'mongoose';
import { EventCategory, EventLocale, EventStatus, SeatingType } from '../../enums/event.enum';
import { availableEventSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { PeriodsRange, PricesRange } from '../common/common.input';

@InputType()
export class EventTranslationInput {
	@IsNotEmpty()
	@Field(() => EventLocale)
	locale: EventLocale;

	@IsNotEmpty()
	@Length(3, 100)
	@Field(() => String)
	title: string;

	@IsOptional()
	@Length(5, 2000)
	@Field(() => String, { nullable: true })
	description?: string;
}

@InputType()
export class EventInput {
	@IsNotEmpty()
	@Field(() => EventCategory)
	eventCategory: EventCategory;

	@IsOptional()
	@Field(() => SeatingType, { nullable: true })
	seatingType?: SeatingType;

	@IsNotEmpty()
	@Length(3, 100)
	@Field(() => String)
	eventTitle: string;

	@IsOptional()
	@Length(5, 2000)
	@Field(() => String, { nullable: true })
	eventDesc?: string;

	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => EventTranslationInput)
	@Field(() => [EventTranslationInput], { nullable: true })
	eventTranslations?: EventTranslationInput[];

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
class EBASearch {
	@IsOptional()
	@Field(() => EventStatus, { nullable: true })
	eventStatus?: EventStatus;

	@IsOptional()
	@Field(() => [EventCategory], { nullable: true })
	eventCategoryList?: EventCategory[];

	@IsOptional()
	@Field(() => String, { nullable: true })
	organizerId?: ObjectId;

	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class EventsByAdminInquiry {
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
	@Field(() => EBASearch)
	search: EBASearch;
}

/** reject and cancel: the reason may not be blank (checked in the service, with its own Message) */
@InputType()
export class EventReasonInput {
	@IsNotEmpty()
	@Field(() => String)
	eventId: ObjectId;

	@IsString()
	@MaxLength(500)
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@Field(() => String)
	reason: string;
}
