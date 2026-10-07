import { VenueService } from './venue.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { SectionKind, SectionSpacing, VenueType } from '../../libs/enums/event.enum';

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

	beforeEach(() => {
		venueModel = {
			create: jest.fn().mockImplementation(async (doc) => doc),
			findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'v1' }) }),
		};
		service = new VenueService(venueModel);
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
});
