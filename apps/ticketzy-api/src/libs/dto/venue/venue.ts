import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ObjectId } from 'mongoose';
import { FocalAreaType, SectionKind, SectionSpacing, VenueStatus, VenueType } from '../../enums/event.enum';
import { TotalCounter } from '../member/member';

@ObjectType()
export class VenueSection {
	@Field(() => String)
	key: string;

	@Field(() => String)
	name: string;

	@Field(() => SectionKind)
	kind: SectionKind;

	@Field(() => Int)
	rows: number;

	@Field(() => Int)
	seatsPerRow: number;

	@Field(() => Int, { nullable: true })
	capacity?: number;

	@Field(() => Number)
	x: number;

	@Field(() => Number)
	y: number;

	@Field(() => Number)
	rotation: number;

	@Field(() => SectionSpacing)
	spacing: SectionSpacing;

	@Field(() => String, { nullable: true })
	tierKey?: string;

	@Field(() => Int, { description: '0 floor, 1 lower tier, 2 upper tier (for the 3D view from a seat)' })
	level?: number;
}

@ObjectType()
export class FocalArea {
	@Field(() => FocalAreaType)
	type: FocalAreaType;

	@Field(() => Number, { description: 'top left corner on the 1000 x 700 canvas' })
	x: number;

	@Field(() => Number)
	y: number;

	@Field(() => Number)
	width: number;

	@Field(() => Number)
	height: number;
}

@ObjectType()
export class VenueLayout {
	@Field(() => [VenueSection])
	sections: VenueSection[];

	@Field(() => FocalArea, { description: 'a STAGE the organizer places, or a PITCH (105:68) fixed by the server' })
	focalArea?: FocalArea;
}

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

	@Field(() => String)
	venueTimezone: string;

	@Field(() => VenueLayout, { nullable: true })
	venueLayout?: VenueLayout;

	@Field(() => Int, { description: 'computed from the layout' })
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
