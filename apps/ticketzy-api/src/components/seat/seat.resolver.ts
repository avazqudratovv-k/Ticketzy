import { Args, Mutation, Resolver, Int } from '@nestjs/graphql';
import { Logger, UseGuards } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { SeatService } from './seat.service';
import { SeatHold } from '../../libs/dto/event/event-seat';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

@Resolver()
export class SeatResolver {
	private readonly logger = new Logger(SeatResolver.name);

	constructor(private readonly seatService: SeatService) {}

	@UseGuards(AuthGuard)
	@Mutation(() => SeatHold)
	public async holdSeats(
		@Args('eventId') eventId: string,
		@Args('seatIds', { type: () => [String] }) seatIds: string[],
		@AuthMember('_id') memberId: ObjectId,
	): Promise<SeatHold> {
		this.logger.log('Mutation: holdSeats');
		return await this.seatService.holdSeats(memberId, shapeIntoMongoObjectId(eventId), seatIds as any);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Int, { description: 'releases the caller\'s own holds on the event and returns how many seats were freed' })
	public async releaseSeats(@Args('eventId') eventId: string, @AuthMember('_id') memberId: ObjectId): Promise<number> {
		this.logger.log('Mutation: releaseSeats');
		return await this.seatService.releaseSeats(memberId, shapeIntoMongoObjectId(eventId));
	}
}
