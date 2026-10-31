import { model, Types } from 'mongoose';
import VenueSchema from './Venue.model';
import EventSchema from './Event.model';
import OrderSchema from './Order.model';
import { instantiateTemplate } from '../venue-templates';

/** Mongoose drops a field the schema does not know: these fields must survive a save (DECISIONS #127 to #129) */
describe('schemas keep the new fields', () => {
	const Venue = model('SchemaSpecVenue', VenueSchema);
	const Event = model('SchemaSpecEvent', EventSchema);
	const Order = model('SchemaSpecOrder', OrderSchema);

	it('a venue keeps section levels and the focal area, and defaults a missing level to 0', () => {
		const layout: any = instantiateTemplate('FOOTBALL_STADIUM');
		delete layout.sections[0].level;
		const venue = new Venue({ venueName: 'v', venueType: 'STADIUM', venueCity: 'c', venueAddress: 'a', venueCapacity: 1, memberId: new Types.ObjectId(), venueLayout: layout });
		const plain: any = venue.toObject();
		expect(plain.venueLayout.focalArea).toMatchObject({ type: 'PITCH', width: 420, height: 272 });
		expect(plain.venueLayout.sections[0].level).toBe(0);
		expect(plain.venueLayout.sections.map((section: any) => section.level)).toContain(2);
		expect(venue.validateSync()).toBeUndefined();
	});

	it('an event keeps its refund policy; an order keeps its snapshot and the acknowledgement time', () => {
		const event: any = new Event({ refundPolicy: { policyType: 'NON_REFUNDABLE', daysBefore: 0 } }).toObject();
		expect(event.refundPolicy).toEqual({ policyType: 'NON_REFUNDABLE', daysBefore: 0 });
		const when = new Date();
		const order: any = new Order({ refundPolicy: { policyType: 'REFUNDABLE', daysBefore: 3 }, nonRefundableAcknowledgedAt: when }).toObject();
		expect(order.refundPolicy).toEqual({ policyType: 'REFUNDABLE', daysBefore: 3 });
		expect(order.nonRefundableAcknowledgedAt).toEqual(when);
	});

	it('an event without a policy stays without one in the document (it reads as the default in code)', () => {
		expect((new Event({}).toObject() as any).refundPolicy).toBeUndefined();
	});
});
