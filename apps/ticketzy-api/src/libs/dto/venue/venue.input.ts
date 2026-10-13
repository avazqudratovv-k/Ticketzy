import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsNumber, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ObjectId } from 'mongoose';
import { SectionKind, SectionSpacing, VenueStatus, VenueType } from '../../enums/event.enum';
import { availableVenueSorts } from '../../config';
import { Direction } from '../../enums/common.enum';
import { PageField, LimitField } from '../common/pagination';

@InputType()
export class VenueSectionInput {
	@IsNotEmpty()
	@Length(1, 30)
	@Field(() => String)
	key: string;

	@IsNotEmpty()
	@Length(1, 60)
	@Field(() => String)
	name: string;

	@IsNotEmpty()
	@Field(() => SectionKind)
	kind: SectionKind;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	rows: number;

	@IsInt()
	@Min(1)
	@Max(100)
	@Field(() => Int)
	seatsPerRow: number;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Field(() => Int, { nullable: true, description: 'required for STANDING sections' })
	capacity?: number;

	@IsNumber()
	@Field(() => Number)
	x: number;

	@IsNumber()
	@Field(() => Number)
	y: number;

	@IsNumber()
	@Field(() => Number)
	rotation: number;

	@IsNotEmpty()
	@Field(() => SectionSpacing)
	spacing: SectionSpacing;

	@IsOptional()
	@Length(1, 30)
	@Field(() => String, { nullable: true, description: 'required for SEATED sections: links to a ticket type' })
	tierKey?: string;
}

@InputType()
export class VenueLayoutInput {
	@ValidateNested({ each: true })
	@Type(() => VenueSectionInput)
	@Field(() => [VenueSectionInput])
	sections: VenueSectionInput[];
}

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

	@IsOptional()
	@Length(1, 64)
	@Field(() => String, { nullable: true, description: 'IANA timezone, Asia/Seoul by default' })
	venueTimezone?: string;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => VenueLayoutInput)
	@Field(() => VenueLayoutInput, { description: 'the venue capacity is computed from it' })
	venueLayout: VenueLayoutInput;

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
	@Length(1, 64)
	@Field(() => String, { nullable: true })
	venueTimezone?: string;

	@IsOptional()
	@ValidateNested()
	@Type(() => VenueLayoutInput)
	@Field(() => VenueLayoutInput, { nullable: true, description: 'the venue capacity is recomputed from it' })
	venueLayout?: VenueLayoutInput;

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
	@PageField()
	page: number;

	@LimitField()
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
