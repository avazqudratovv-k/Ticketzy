import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { getEventRank, getOrganizerRank } from './lib/rank';
import * as batchConfig from './lib/config';
import { EventStatus } from 'apps/ticketzy-api/src/libs/enums/event.enum';
import { MemberStatus, MemberType } from 'apps/ticketzy-api/src/libs/enums/member.enum';

/** a tiny store: find() returns lean copies, bulkWrite() applies $set updates and records every state it leaves behind */
const store = (docs: any[], matches: (doc: any, filter: any) => boolean) => {
	const snapshots: any[][] = [];
	const model: any = {
		docs,
		find: jest.fn((filter: any) => {
			const chain: any = {};
			chain.select = () => chain;
			chain.lean = () => chain;
			chain.exec = async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc }));
			return chain;
		}),
		bulkWrite: jest.fn(async (operations: any[]) => {
			for (const { updateOne } of operations) {
				const doc = docs.find((item) => String(item._id) === String(updateOne.filter._id));
				Object.assign(doc, updateOne.update.$set);
				snapshots.push(docs.map((item) => ({ ...item })));
			}
		}),
		updateMany: jest.fn(),
		findByIdAndUpdate: jest.fn(),
	};
	return { model, snapshots };
};

const eventMatches = (doc: any, filter: any) => doc.eventStatus === filter.eventStatus;
const organizerMatches = (doc: any, filter: any) => doc.memberType === filter.memberType && doc.memberStatus === filter.memberStatus;

describe('rank formulas', () => {
	it('keeps the old weights: events likes*2 + views, organizers events*5 + likes*2 + views', () => {
		expect(getEventRank({ eventLikes: 3, eventViews: 10 })).toBe(16);
		expect(getOrganizerRank({ memberEvents: 2, memberLikes: 3, memberViews: 10 })).toBe(26);
	});

	it('treats missing or broken counters as 0', () => {
		expect(getEventRank({})).toBe(0);
		expect(getEventRank({ eventLikes: NaN, eventViews: undefined })).toBe(0);
		expect(getOrganizerRank({ memberEvents: 1 })).toBe(5);
	});
});

describe('BatchService ranking jobs never zero a rank', () => {
	it('batchTopEvents computes every public event, writes only the changed ranks, and no state ever holds a zero rank', async () => {
		const events = [
			{ _id: 'e1', eventStatus: EventStatus.APPROVED, eventLikes: 5, eventViews: 7, eventRank: 99 }, // old rank, now 17
			{ _id: 'e2', eventStatus: EventStatus.APPROVED, eventLikes: 1, eventViews: 1, eventRank: 3 }, // unchanged
			{ _id: 'e3', eventStatus: EventStatus.APPROVED, eventLikes: 2, eventViews: 0, eventRank: 0 }, // new, was 0
			{ _id: 'e4', eventStatus: EventStatus.CANCELLED, eventLikes: 9, eventViews: 9, eventRank: 40 }, // not public: untouched
		];
		const { model, snapshots } = store(events, eventMatches);
		const service = new BatchService(model, {} as any, {} as any, {} as any, {} as any);
		const hadRank = events.filter((event) => event.eventRank > 0).map((event) => event._id);

		await service.batchTopEvents();

		expect(events.map((event) => event.eventRank)).toEqual([17, 3, 4, 40]);
		expect(model.bulkWrite).toHaveBeenCalledTimes(1);
		expect(model.bulkWrite.mock.calls[0][0]).toHaveLength(2); // e2 did not change
		expect(model.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
		expect(model.updateMany).not.toHaveBeenCalled(); // no rollback step
		expect(snapshots.length).toBe(2);
		// an event that had a rank keeps a positive rank in every state the job leaves behind
		for (const snapshot of snapshots) {
			for (const event of snapshot.filter((item) => hadRank.includes(item._id))) expect(event.eventRank).toBeGreaterThan(0);
		}
	});

	it('batchTopOrganizers ranks ACTIVE organizers only and never writes 0 for one that has activity', async () => {
		const members = [
			{ _id: 'o1', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.ACTIVE, memberEvents: 2, memberLikes: 1, memberViews: 3, memberRank: 50 },
			{ _id: 'o2', memberType: MemberType.ORGANIZER, memberStatus: MemberStatus.SUSPENDED, memberEvents: 5, memberLikes: 0, memberViews: 0, memberRank: 7 },
			{ _id: 'u1', memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE, memberEvents: 0, memberLikes: 4, memberViews: 0, memberRank: 0 },
		];
		const { model, snapshots } = store(members, organizerMatches);
		const service = new BatchService({} as any, model, {} as any, {} as any, {} as any);

		await service.batchTopOrganizers();

		expect(members.map((member) => member.memberRank)).toEqual([15, 7, 0]);
		expect(model.updateMany).not.toHaveBeenCalled();
		for (const snapshot of snapshots) expect(snapshot[0].memberRank).toBeGreaterThan(0);
	});

	it('writes nothing when no rank changed, and chunks large writes', async () => {
		const same = [{ _id: 'e1', eventStatus: EventStatus.APPROVED, eventLikes: 1, eventViews: 1, eventRank: 3 }];
		const first = store(same, eventMatches);
		await new BatchService(first.model, {} as any, {} as any, {} as any, {} as any).batchTopEvents();
		expect(first.model.bulkWrite).not.toHaveBeenCalled();

		const many = Array.from({ length: 1201 }, (_, i) => ({ _id: `e${i}`, eventStatus: EventStatus.APPROVED, eventLikes: 1, eventViews: 0, eventRank: 0 }));
		const second = store(many, eventMatches);
		await new BatchService(second.model, {} as any, {} as any, {} as any, {} as any).batchTopEvents();
		expect(second.model.bulkWrite.mock.calls.map((call) => call[0].length)).toEqual([500, 500, 201]);
		expect(many.every((event) => event.eventRank === 2)).toBe(true);
	});

	it('a failing write leaves the old ranks in place instead of zeros', async () => {
		const events = [{ _id: 'e1', eventStatus: EventStatus.APPROVED, eventLikes: 5, eventViews: 7, eventRank: 99 }];
		const { model } = store(events, eventMatches);
		model.bulkWrite.mockRejectedValue(new Error('db down'));
		await expect(new BatchService(model, {} as any, {} as any, {} as any, {} as any).batchTopEvents()).rejects.toThrow('db down');
		expect(events[0].eventRank).toBe(99);
	});
});

describe('BatchController schedule', () => {
	const cron = (method: string) => Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', (BatchController.prototype as any)[method]);

	it('has no rollback job any more and keeps the other schedules', () => {
		expect((BatchController.prototype as any).batchRollback).toBeUndefined();
		expect((batchConfig as any).BATCH_ROLLBACK).toBeUndefined();
		expect(cron('batchTopEvents')).toMatchObject({ cronTime: '20 00 * * * *', name: batchConfig.BATCH_TOP_EVENTS });
		expect(cron('batchTopOrganizers')).toMatchObject({ cronTime: '40 00 * * * *', name: batchConfig.BATCH_TOP_ORGANIZERS });
		expect(cron('batchExpireOrders')).toMatchObject({ cronTime: '10 * * * * *' });
		expect(cron('batchEndEvents')).toMatchObject({ cronTime: '00 30 * * * *' });
	});
});
