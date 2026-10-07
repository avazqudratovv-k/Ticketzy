import { VenueService } from './venue.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { FakeModel } from '../../../test/fake-model';
import { EventStatus, SectionKind, SectionSpacing, VenueType } from '../../libs/enums/event.enum';

const section = (over: any = {}) => ({
	key: 'A',
	name: 'Floor A',
	kind: SectionKind.SEATED,
	rows: 2,
	seatsPerRow: 5,
	x: 0,
	y: 0,
	rotation: 0,
	spacing: SectionSpacing.NORMAL,
	tierKey: 'vip',
	...over,
});
const venueInput = (over: any = {}): any => ({
	venueName: 'Arena',
	venueType: VenueType.HALL,
	venueCity: 'Seoul',
	venueAddress: '1 Main Street',
	venueLayout: { sections: [section(), section({ key: 'S', kind: SectionKind.STANDING, capacity: 90, tierKey: undefined })] },
	...over,
});

describe('VenueService layout and capacity', () => {
	let venueModel: any;
	let service: VenueService;
	let eventModel: FakeModel;
	let eventSeatModel: FakeModel;

	beforeEach(() => {
		eventModel = new FakeModel();
		eventSeatModel = new FakeModel();
		venueModel = {
			create: jest.fn().mockImplementation(async (doc) => doc),
			findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'v1' }) }),
		};
		service = new VenueService(venueModel, eventModel as any, eventSeatModel as any);
	});

	it('computes venueCapacity from the layout when a venue is created', async () => {
		await service.createVenue(venueInput());
		expect(venueModel.create.mock.calls[0][0].venueCapacity).toBe(100);
	});

	it('ignores a capacity the client tries to smuggle in', async () => {
		await service.createVenue(venueInput({ venueCapacity: 99999 }));
		expect(venueModel.create.mock.calls[0][0].venueCapacity).toBe(100);
	});

	it('leaves the timezone to the schema default and accepts a valid one', async () => {
		await service.createVenue(venueInput());
		expect(venueModel.create.mock.calls[0][0].venueTimezone).toBeUndefined();
		await service.createVenue(venueInput({ venueTimezone: 'Asia/Tashkent' }));
		expect(venueModel.create.mock.calls[1][0].venueTimezone).toBe('Asia/Tashkent');
	});

	it('rejects an invalid timezone and an invalid layout without writing', async () => {
		await expect(service.createVenue(venueInput({ venueTimezone: 'Mars/Olympus' }))).rejects.toThrow(Message.INVALID_VENUE_TIMEZONE);
		await expect(service.createVenue(venueInput({ venueLayout: { sections: [] } }))).rejects.toThrow(Message.VENUE_LAYOUT_NO_SECTIONS);
		await expect(
			service.createVenue(venueInput({ venueLayout: { sections: [section({ rows: 101 })] } })),
		).rejects.toThrow(Message.VENUE_LAYOUT_BAD_SEAT_GRID);
		expect(venueModel.create).not.toHaveBeenCalled();
	});

	it('recomputes venueCapacity when the layout is updated, and leaves it alone otherwise', async () => {
		await service.updateVenue('m1' as any, MemberType.ORGANIZER, { _id: 'v1', venueLayout: { sections: [section({ rows: 3 })] } } as any);
		expect(venueModel.findOneAndUpdate.mock.calls[0][1].venueCapacity).toBe(15);

		await service.updateVenue('m1' as any, MemberType.ORGANIZER, { _id: 'v1', venueName: 'New name' } as any);
		expect(venueModel.findOneAndUpdate.mock.calls[1][1]).not.toHaveProperty('venueCapacity');
	});

	it('rejects an invalid layout on update without writing', async () => {
		await expect(
			service.updateVenue('m1' as any, MemberType.ORGANIZER, { _id: 'v1', venueLayout: { sections: [section(), section()] } } as any),
		).rejects.toThrow(Message.VENUE_LAYOUT_DUPLICATE_SECTION_KEY);
		expect(venueModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	describe('layout lock', () => {
		const layoutUpdate = () => ({ _id: 'v1', venueLayout: { sections: [section({ rows: 3 })] } }) as any;
		const withEvent = (eventStatus: EventStatus, seats: number) => {
			eventModel.docs.push({ _id: `e-${eventStatus}`, venueId: 'v1', eventStatus });
			for (let i = 0; i < seats; i++) eventSeatModel.docs.push({ _id: `s${i}`, eventId: `e-${eventStatus}` });
		};

		it('refuses a layout change when a non-DRAFT event of the venue has generated seats', async () => {
			withEvent(EventStatus.APPROVED, 3);
			await expect(service.updateVenue('m1' as any, MemberType.ORGANIZER, layoutUpdate())).rejects.toThrow(Message.VENUE_LAYOUT_LOCKED);
			expect(venueModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('keeps the lock for ENDED events too, and applies to admins', async () => {
			withEvent(EventStatus.ENDED, 1);
			await expect(service.updateVenue('admin' as any, MemberType.ADMIN, layoutUpdate())).rejects.toThrow(Message.VENUE_LAYOUT_LOCKED);
		});

		it('still edits every other venue field while the layout is locked', async () => {
			withEvent(EventStatus.APPROVED, 3);
			await service.updateVenue('m1' as any, MemberType.ORGANIZER, { _id: 'v1', venueName: 'Renamed', venueCity: 'Busan' } as any);
			expect(venueModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ _id: 'v1', venueName: 'Renamed', venueCity: 'Busan' });
		});

		it('allows the change while the only events using the venue are DRAFT or have no seats yet', async () => {
			withEvent(EventStatus.DRAFT, 3); // DRAFT events never hold generated seats that matter
			withEvent(EventStatus.PENDING, 0); // not approved yet, nothing generated
			await service.updateVenue('m1' as any, MemberType.ORGANIZER, layoutUpdate());
			expect(venueModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
		});

		it('ignores seats of events at other venues', async () => {
			eventModel.docs.push({ _id: 'other', venueId: 'v2', eventStatus: EventStatus.APPROVED });
			eventSeatModel.docs.push({ _id: 's', eventId: 'other' });
			await service.updateVenue('m1' as any, MemberType.ORGANIZER, layoutUpdate());
			expect(venueModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
		});
	});
});
