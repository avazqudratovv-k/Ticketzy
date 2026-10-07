import { InternalServerErrorException } from '@nestjs/common';
import { EventService } from './event.service';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { EventStatus } from '../../libs/enums/event.enum';

const exec = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });
const lean = (value: any) => ({ lean: () => exec(value) });

describe('EventService public queries hide events of organizers that are not ACTIVE', () => {
	let eventModel: any;
	let memberService: any;
	let viewService: any;
	let service: EventService;

	beforeEach(() => {
		eventModel = {
			findOne: jest.fn(),
			aggregate: jest.fn().mockReturnValue(exec([{ list: [], metaCounter: [] }])),
		};
		memberService = { getMember: jest.fn() };
		viewService = { recordView: jest.fn() };
		service = new EventService(eventModel, { findById: jest.fn().mockReturnValue(lean(null)) } as any, memberService, viewService, {} as any, {} as any);
	});

	it('getEvents drops events of a non-ACTIVE organizer before sorting and pagination', async () => {
		await service.getEvents(null as any, { page: 1, limit: 10, search: {} } as any);

		const pipeline = eventModel.aggregate.mock.calls[0][0];
		const matchIndex = pipeline.findIndex((s: any) => s.$match?.['memberData.memberStatus'] === MemberStatus.ACTIVE);
		const facetIndex = pipeline.findIndex((s: any) => s.$facet);
		expect(matchIndex).toBeGreaterThan(-1);
		expect(matchIndex).toBeLessThan(facetIndex);
	});

	it('getEvent answers NO_DATA_FOUND and records no view when the organizer is not ACTIVE', async () => {
		eventModel.findOne.mockReturnValue(lean({ _id: 'e1', organizerId: 'o1', eventStatus: EventStatus.ON_SALE, eventViews: 0 }));
		memberService.getMember.mockRejectedValue(new InternalServerErrorException(Message.NO_DATA_FOUND));

		await expect(service.getEvent('viewer' as any, 'e1' as any)).rejects.toThrow(Message.NO_DATA_FOUND);
		expect(viewService.recordView).not.toHaveBeenCalled();
	});
});
