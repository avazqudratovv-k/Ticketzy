import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { VenueStatus, VenueType } from '../../enums/event.enum';
import { TotalCounter } from '../member/member';

@ObjectType()
export class Venue {
	@Field(() => String)
	_id: ObjectId;

	@Field(() => String)
	venueName: string;

	@Field(() => VenueType)
	venueType: VenueType;

	@Field(() => String)
	venueCity: string;

	@Field(() => String)
	venueAddress: string;

	@Field(() => [Number], { nullable: true })
	venueCoordinates?: number[];

	@Field(() => Int)
	venueCapacity: number;

	@Field(() => [String])
	venueImages: string[];

	@Field(() => VenueStatus)
	venueStatus: VenueStatus;

	@Field(() => String)
	memberId: ObjectId;

	@Field(() => Date)
	createdAt: Date;

	@Field(() => Date)
	updatedAt: Date;
}

@ObjectType()
export class Venues {
	@Field(() => [Venue])
	list: Venue[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
