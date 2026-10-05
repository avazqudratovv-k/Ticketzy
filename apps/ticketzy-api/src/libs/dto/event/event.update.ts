import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Length } from 'class-validator';
import { ObjectId } from 'mongoose';
import { EventCategory, EventStatus } from '../../enums/event.enum';

@InputType()
export class EventUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id: ObjectId;

	@IsOptional()
	@Field(() => EventCategory, { nullable: true })
	eventCategory?: EventCategory;

	@IsOptional()
	@Field(() => EventStatus, { nullable: true })
	eventStatus?: EventStatus;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	eventTitle?: string;

	@IsOptional()
	@Length(5, 2000)
	@Field(() => String, { nullable: true })
	eventDesc?: string;

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

	deletedAt?: Date;
}
