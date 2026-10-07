import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, Length, ValidateNested } from 'class-validator';
import { ObjectId } from 'mongoose';
import { EventCategory, SeatingType } from '../../enums/event.enum';
import { EventTranslationInput } from './event.input';

@InputType()
export class EventUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id: ObjectId;

	@IsOptional()
	@Field(() => EventCategory, { nullable: true })
	eventCategory?: EventCategory;

	@IsOptional()
	@Field(() => SeatingType, { nullable: true })
	seatingType?: SeatingType;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	eventTitle?: string;

	@IsOptional()
	@Length(5, 2000)
	@Field(() => String, { nullable: true })
	eventDesc?: string;

	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => EventTranslationInput)
	@Field(() => [EventTranslationInput], { nullable: true })
	eventTranslations?: EventTranslationInput[];

	@IsOptional()
	@Field(() => [String], { nullable: true })
	eventImages?: string[];

	@IsOptional()
	@Field(() => String, { nullable: true })
	venueId?: ObjectId;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	startAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	endAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleStartAt?: Date;

	@IsOptional()
	@Field(() => Date, { nullable: true })
	saleEndAt?: Date;
}
