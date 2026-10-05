import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsNotEmpty, IsOptional, Length, Min } from 'class-validator';
import { ObjectId } from 'mongoose';
import { VenueStatus, VenueType } from '../../enums/event.enum';
import { availableVenueSorts } from '../../config';
import { Direction } from '../../enums/common.enum';

@InputType()
export class VenueInput {
	@IsNotEmpty()
	@Length(2, 100)
	@Field(() => String)
	venueName: string;

	@IsNotEmpty()
	@Field(() => VenueType)
	venueType: VenueType;

	@IsNotEmpty()
	@Length(2, 100)
	@Field(() => String)
	venueCity: string;

	@IsNotEmpty()
	@Length(3, 200)
	@Field(() => String)
	venueAddress: string;

	@IsOptional()
	@Field(() => [Number], { nullable: true, description: '[longitude, latitude]' })
	venueCoordinates?: number[];

	@IsNotEmpty()
	@IsInt()
	@Min(1)
	@Field(() => Int)
	venueCapacity: number;

	@IsOptional()
	@Field(() => [String], { nullable: true })
	venueImages?: string[];

	memberId?: ObjectId;
}

@InputType()
export class VenueUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id: ObjectId;

	@IsOptional()
	@Length(2, 100)
	@Field(() => String, { nullable: true })
	venueName?: string;

	@IsOptional()
	@Field(() => VenueType, { nullable: true })
	venueType?: VenueType;

	@IsOptional()
	@Length(2, 100)
	@Field(() => String, { nullable: true })
	venueCity?: string;

	@IsOptional()
	@Length(3, 200)
	@Field(() => String, { nullable: true })
	venueAddress?: string;

	@IsOptional()
	@Field(() => [Number], { nullable: true })
	venueCoordinates?: number[];

	@IsOptional()
	@IsInt()
	@Min(1)
	@Field(() => Int, { nullable: true })
	venueCapacity?: number;

	@IsOptional()
	@Field(() => [String], { nullable: true })
	venueImages?: string[];

	@IsOptional()
	@Field(() => VenueStatus, { nullable: true })
	venueStatus?: VenueStatus;
}

@InputType()
class VISearch {
	@IsOptional()
	@Field(() => [String], { nullable: true })
	cityList?: string[];

	@IsOptional()
	@Field(() => [VenueType], { nullable: true })
	typeList?: VenueType[];

	@IsOptional()
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class VenuesInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit: number;

	@IsOptional()
	@IsIn(availableVenueSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@Field(() => VISearch)
	search: VISearch;
}
