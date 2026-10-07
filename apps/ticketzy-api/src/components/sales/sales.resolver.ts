import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { ObjectId } from 'mongoose';
import { SalesService } from './sales.service';
import { Attendees, EventSales, MyEarnings } from '../../libs/dto/sales/sales';
import { AttendeesInquiry } from '../../libs/dto/sales/sales.input';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { shapeIntoMongoObjectId } from '../../libs/config';

/** owner only: every query checks that the event belongs to the calling organizer */
@Resolver()
export class SalesResolver {
	private readonly logger = new Logger(SalesResolver.name);

	constructor(private readonly salesService: SalesService) {}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query(() => EventSales)
	public async getEventSales(@Args('eventId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<EventSales> {
		this.logger.log('Query: getEventSales');
		return await this.salesService.getEventSales(memberId, shapeIntoMongoObjectId(input));
	}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query(() => Attendees)
	public async getEventAttendees(@Args('input') input: AttendeesInquiry, @AuthMember('_id') memberId: ObjectId): Promise<Attendees> {
		this.logger.log('Query: getEventAttendees');
		return await this.salesService.getEventAttendees(memberId, input);
	}

	@Roles(MemberType.ORGANIZER)
	@UseGuards(RolesGuard)
	@Query(() => MyEarnings)
	public async getMyEarnings(@AuthMember('_id') memberId: ObjectId): Promise<MyEarnings> {
		this.logger.log('Query: getMyEarnings');
		return await this.salesService.getMyEarnings(memberId);
	}
}
