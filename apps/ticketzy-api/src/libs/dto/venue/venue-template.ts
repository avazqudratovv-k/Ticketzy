import { Field, Int, ObjectType } from '@nestjs/graphql';
import { VenueType } from '../../enums/event.enum';
import { VenueLayout } from './venue';

/** the layout editor and the seed start from the same server-side data (DECISIONS #130) */
@ObjectType()
export class VenueTemplate {
	@Field(() => String, { description: 'CONCERT_HALL, ARENA, FOOTBALL_STADIUM or COMEDY_CLUB' })
	key: string;

	@Field(() => String)
	name: string;

	@Field(() => String)
	description: string;

	@Field(() => VenueType)
	venueType: VenueType;

	@Field(() => VenueLayout)
	layout: VenueLayout;

	@Field(() => Int, { description: 'seats and standing places of the layout' })
	capacity: number;
}
