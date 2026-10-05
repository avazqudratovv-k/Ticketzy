import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VenueResolver } from './venue.resolver';
import { VenueService } from './venue.service';
import VenueSchema from '../../libs/schemas/Venue.model';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'Venue', schema: VenueSchema }]), AuthModule],
	providers: [VenueResolver, VenueService],
	exports: [VenueService],
})
export class VenueModule {}
