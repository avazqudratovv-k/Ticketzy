import { BadRequestException } from '@nestjs/common';
import { VenueService } from './venue.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { FakeModel } from '../../../test/fake-model';
import { FocalAreaType, VenueType } from '../../libs/enums/event.enum';
import { DEFAULT_STAGE, FIXED_PITCH } from '../../libs/focal-area';
import { instantiateTemplate } from '../../libs/venue-templates';
import { VenueResolver, VenueLayoutResolver, VenueSectionResolver } from './venue.resolver';

const input = (layout: any, over: any = {}): any => ({
	venueName: 'Ground',
	venueType: VenueType.STADIUM,
	venueCity: 'Seoul',
	venueAddress: '1 Main Street',
	venueLayout: layout,
	...over,
});

describe('VenueService focal area and level (DECISIONS #127, #128)', () => {
	let venueModel: any;
	let service: VenueService;
	let stored: any;

	beforeEach(() => {
		stored = null;
		venueModel = {
			create: jest.fn().mockImplementation(async (doc) => doc),
			findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'v1' }) }),
			findOne: jest.fn().mockImplementation(() => ({ select: () => ({ lean: () => ({ exec: async () => stored }) }) })),
		};
		service = new VenueService(venueModel, new FakeModel() as any, new FakeModel() as any);
	});

	it('stores a PITCH with the fixed geometry even when the client sends none', async () => {
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		layout.focalArea = { type: FocalAreaType.PITCH } as any;
		await service.createVenue(input(layout));
		expect(venueModel.create.mock.calls[0][0].venueLayout.focalArea).toEqual(FIXED_PITCH);
	});

	it('refuses a created PITCH with a moved or resized geometry, and creates nothing', async () => {
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		layout.focalArea = { ...FIXED_PITCH, x: FIXED_PITCH.x + 40 };
		await expect(service.createVenue(input(layout))).rejects.toThrow(new BadRequestException(Message.FOCAL_AREA_PITCH_FIXED));
		expect(venueModel.create).not.toHaveBeenCalled();
	});

	it('refuses an UPDATE that moves or resizes the pitch, and writes nothing', async () => {
		stored = { venueLayout: { sections: [], focalArea: FIXED_PITCH } };
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		layout.focalArea = { ...FIXED_PITCH, width: 500, height: 272 };
		await expect(service.updateVenue('o1' as any, MemberType.ORGANIZER, { _id: 'v1', venueLayout: layout } as any)).rejects.toThrow(
			new BadRequestException(Message.FOCAL_AREA_PITCH_FIXED),
		);
		expect(venueModel.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('also refuses it for an admin (the rule is on the data, not on the role)', async () => {
		const layout = instantiateTemplate('FOOTBALL_STADIUM');
		layout.focalArea = { ...FIXED_PITCH, y: 0 };
		await expect(service.updateVenue('a1' as any, MemberType.ADMIN, { _id: 'v1', venueLayout: layout } as any)).rejects.toThrow(
			Message.FOCAL_AREA_PITCH_FIXED,
		);
	});

	it('lets an organizer move and resize a STAGE', async () => {
		const layout = instantiateTemplate('CONCERT_HALL');
		layout.focalArea = { type: FocalAreaType.STAGE, x: 200, y: 20, width: 500, height: 60 };
		await service.updateVenue('o1' as any, MemberType.ORGANIZER, { _id: 'v1', venueLayout: layout } as any);
		expect(venueModel.findOneAndUpdate.mock.calls[0][1].venueLayout.focalArea).toEqual({ type: FocalAreaType.STAGE, x: 200, y: 20, width: 500, height: 60 });
	});

	it('keeps the stored focal area when an update sends a layout without one', async () => {
		stored = { venueLayout: { sections: [], focalArea: { type: FocalAreaType.STAGE, x: 100, y: 5, width: 300, height: 30 } } };
		const layout: any = instantiateTemplate('COMEDY_CLUB');
		delete layout.focalArea;
		await service.updateVenue('o1' as any, MemberType.ORGANIZER, { _id: 'v1', venueLayout: layout } as any);
		expect(venueModel.findOneAndUpdate.mock.calls[0][1].venueLayout.focalArea).toEqual({ type: FocalAreaType.STAGE, x: 100, y: 5, width: 300, height: 30 });
	});

	it('gives a new venue the default stage when none is sent', async () => {
		const layout: any = instantiateTemplate('COMEDY_CLUB');
		delete layout.focalArea;
		await service.createVenue(input(layout));
		expect(venueModel.create.mock.calls[0][0].venueLayout.focalArea).toEqual(DEFAULT_STAGE);
	});

	it('refuses a section level other than 0, 1 or 2', async () => {
		for (const level of [3, -1, 1.5]) {
			const layout = instantiateTemplate('COMEDY_CLUB');
			layout.sections[0].level = level;
			await expect(service.createVenue(input(layout))).rejects.toThrow(Message.VENUE_LAYOUT_BAD_LEVEL);
		}
	});

	it('accepts levels 0, 1 and 2 and keeps a section without a level (the schema defaults it to 0)', async () => {
		const layout = instantiateTemplate('CONCERT_HALL');
		await service.createVenue(input(layout));
		const levels = venueModel.create.mock.calls[0][0].venueLayout.sections.map((section: any) => section.level);
		expect(new Set(levels)).toEqual(new Set([0, 1, 2]));
		const bare = instantiateTemplate('COMEDY_CLUB');
		delete bare.sections[0].level;
		await expect(service.createVenue(input(bare))).resolves.toBeDefined();
	});
});

describe('layout field resolvers for data saved before focal areas and levels', () => {
	it('a layout without a focal area reads as the default stage; a section without a level as the floor', () => {
		expect(new VenueLayoutResolver().focalArea({ sections: [] } as any)).toEqual(DEFAULT_STAGE);
		expect(new VenueSectionResolver().level({ key: 'A' } as any)).toBe(0);
		expect(new VenueSectionResolver().level({ key: 'A', level: 2 } as any)).toBe(2);
	});

	it('getVenueTemplates returns the four templates with their capacity', () => {
		const resolver = new VenueResolver({} as any);
		const templates = resolver.getVenueTemplates();
		expect(templates.map((template) => template.key).sort()).toEqual(['ARENA', 'COMEDY_CLUB', 'CONCERT_HALL', 'FOOTBALL_STADIUM']);
		expect(templates.every((template) => template.capacity > 0 && template.layout.focalArea)).toBe(true);
	});
});
