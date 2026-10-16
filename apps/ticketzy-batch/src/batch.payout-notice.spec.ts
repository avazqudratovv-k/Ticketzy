import { BatchService, PAYOUT_NOTICE_MAX_AGE_MS } from './batch.service';
import { NotificationType } from 'apps/ticketzy-api/src/libs/enums/notification.enum';
import { buildPayoutPipeline } from 'apps/ticketzy-api/src/libs/payout';
import { PayoutStatus } from 'apps/ticketzy-api/src/libs/enums/payout.enum';

const NOW = new Date('2026-10-16T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

interface FakeEvent {
	_id: string;
	organizerId: string;
	eventTitle: string;
	net: number;
	payoutDate: Date;
	payoutDueNotifiedAt?: Date | null;
}

/**
 * Stands in for the events collection: the aggregation answers the DUE events that are not claimed yet (what the real
 * pipeline does with `notNotifiedOnly`), and `updateOne` applies the claim like MongoDB: only if the marker is still missing.
 */
const setup = (events: FakeEvent[], admins: string[] = ['admin-1', 'admin-2']) => {
	const eventModel: any = {
		aggregate: jest.fn(() => ({
			exec: async () => [
				{
					list: events
						.filter((event) => event.payoutDueNotifiedAt == null)
						.map((event) => ({ eventId: event._id, organizerId: event.organizerId, eventTitle: event.eventTitle, net: event.net, payoutDate: event.payoutDate })),
				},
			],
		})),
		updateOne: jest.fn((filter: any, update: any) => ({
			exec: async () => {
				const event = events.find((item) => item._id === filter._id);
				if (!event || event.payoutDueNotifiedAt != null) return { modifiedCount: 0 };
				event.payoutDueNotifiedAt = update.$set.payoutDueNotifiedAt;
				return { modifiedCount: 1 };
			},
		})),
	};
	const memberModel: any = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => admins.map((_id) => ({ _id })) }) }) })) };
	const sent: any[] = [];
	const notificationModel: any = { insertMany: jest.fn(async (docs: any[]) => void sent.push(...docs)) };
	const service = new BatchService(eventModel, memberModel, {} as any, {} as any, {} as any, notificationModel);
	return { service, eventModel, memberModel, notificationModel, sent, events };
};

const due = (id: string, payoutDate: Date, extra: Partial<FakeEvent> = {}): FakeEvent => ({
	_id: id,
	organizerId: `org-${id}`,
	eventTitle: `Final ${id}`,
	net: 1234567,
	payoutDate,
	...extra,
});

describe('BatchService.batchNotifyDuePayouts (DECISIONS #119)', () => {
	it('notifies the organizer once and every admin once, with the event and the amount in the text', async () => {
		const { service, sent } = setup([due('e1', daysAgo(1))]);

		expect(await service.batchNotifyDuePayouts(NOW)).toBe(1);

		expect(sent).toHaveLength(3);
		expect(sent.every((doc) => doc.notificationType === NotificationType.PAYOUT_DUE && doc.eventId === 'e1')).toBe(true);
		const organizerNotice = sent.find((doc) => doc.receiverId === 'org-e1');
		expect(organizerNotice).toMatchObject({ notificationTitle: 'Your payout is due', notificationDesc: 'Payout for Final e1 is due: 1,234,567 KRW', authorId: 'org-e1' });
		expect(sent.filter((doc) => ['admin-1', 'admin-2'].includes(doc.receiverId))).toHaveLength(2);
		expect(sent.find((doc) => doc.receiverId === 'admin-1').notificationTitle).toBe('A payout is due');
	});

	it('two runs send one set of notifications (the second finds the claim)', async () => {
		const { service, sent, events } = setup([due('e1', daysAgo(1))]);

		await service.batchNotifyDuePayouts(NOW);
		await service.batchNotifyDuePayouts(new Date(NOW.getTime() + 60 * 60 * 1000));

		expect(sent).toHaveLength(3);
		expect(events[0].payoutDueNotifiedAt).toEqual(NOW);
	});

	it('two instances at the same moment: only the one that wins the conditional claim writes notifications', async () => {
		const first = setup([due('e1', daysAgo(1))]);
		// the second instance sees the same list, but shares the first one's collection state
		const second = new BatchService(first.eventModel, first.memberModel, {} as any, {} as any, {} as any, first.notificationModel);

		await Promise.all([first.service.batchNotifyDuePayouts(NOW), second.batchNotifyDuePayouts(NOW)]);

		expect(first.sent).toHaveLength(3);
	});

	it('claims with a conditional update on a missing marker, without touching updatedAt', async () => {
		const { service, eventModel } = setup([due('e1', daysAgo(1))]);
		await service.batchNotifyDuePayouts(NOW);

		const [filter, update, options] = eventModel.updateOne.mock.calls[0];
		expect(filter).toEqual({ _id: 'e1', payoutDueNotifiedAt: null });
		expect(update).toEqual({ $set: { payoutDueNotifiedAt: NOW } });
		expect(options).toEqual({ timestamps: false });
	});

	it('7 day rule: a payout that became due more than 7 days ago is only marked, never announced', async () => {
		const { service, sent, events } = setup([
			due('old', new Date(NOW.getTime() - PAYOUT_NOTICE_MAX_AGE_MS - 1000)),
			due('recent', daysAgo(6)),
		]);

		expect(await service.batchNotifyDuePayouts(NOW)).toBe(1);

		expect(events.find((event) => event._id === 'old')!.payoutDueNotifiedAt).toEqual(NOW);
		expect(sent.some((doc) => doc.eventId === 'old')).toBe(false);
		expect(sent.some((doc) => doc.eventId === 'recent')).toBe(true);
	});

	it('first run over a backlog of old payouts sends nothing and marks every one', async () => {
		const { service, sent, events, memberModel } = setup([due('a', daysAgo(30)), due('b', daysAgo(90)), due('c', daysAgo(400))]);

		expect(await service.batchNotifyDuePayouts(NOW)).toBe(0);

		expect(sent).toHaveLength(0);
		expect(events.every((event) => event.payoutDueNotifiedAt != null)).toBe(true);
		expect(memberModel.find).not.toHaveBeenCalled(); // no need to look up the admins
	});

	it('an event already marked (the demo seed marks its due payouts) gets no notice', async () => {
		const { service, sent } = setup([due('seeded', daysAgo(2), { payoutDueNotifiedAt: daysAgo(2) })]);

		await service.batchNotifyDuePayouts(NOW);

		expect(sent).toHaveLength(0);
	});

	it('a failed notification write is logged, not thrown, and the job goes on with the next event', async () => {
		const { service, notificationModel, events } = setup([due('e1', daysAgo(1)), due('e2', daysAgo(1))]);
		notificationModel.insertMany.mockRejectedValueOnce(new Error('db down'));

		await expect(service.batchNotifyDuePayouts(NOW)).resolves.toBe(1);
		expect(events.every((event) => event.payoutDueNotifiedAt != null)).toBe(true);
	});

	it('asks for DUE events that are not claimed yet', async () => {
		const { service, eventModel } = setup([]);
		await service.batchNotifyDuePayouts(NOW);

		const pipeline = eventModel.aggregate.mock.calls[0][0];
		expect(pipeline).toEqual(buildPayoutPipeline({ now: NOW, payoutStatus: PayoutStatus.DUE, notNotifiedOnly: true, direction: -1, page: { skip: 0, limit: 200 } }));
		expect(pipeline[0].$match.payoutDueNotifiedAt).toBeNull();
	});
});

describe('buildPayoutPipeline notNotifiedOnly', () => {
	it('is not applied to the normal payout lists', () => {
		const normal: any = buildPayoutPipeline({ now: NOW });
		expect('payoutDueNotifiedAt' in normal[0].$match).toBe(false);
	});
});
