import { ObjectId } from 'bson';
import { FakeModel } from '../../test/fake-model';
import { MemberType } from './enums/member.enum';
import { DemoModels } from './demo-manifest';
import { KEEP_LINKED_ENV } from './demo-links';
import { isDryRun, runDemoLinkGate } from './demo-gate';

const names = ['manifest', 'member', 'venue', 'event', 'ticketType', 'eventSeat', 'order', 'ticket', 'payment', 'refund', 'payout', 'comment', 'like', 'view', 'follow', 'conversation', 'message', 'notification', 'auditLog'] as const;
const id = () => new ObjectId();

const world = (withForeignOrder: boolean) => {
	const m = Object.fromEntries(names.map((name) => [name, new FakeModel()])) as Record<(typeof names)[number], FakeModel>;
	const organizer = { _id: id(), memberEmail: 'organizer@ticketzy.demo', memberType: MemberType.ORGANIZER };
	const buyer = { _id: id(), memberEmail: 'buyer@ticketzy.demo', memberType: MemberType.USER };
	const real = { _id: id(), memberEmail: 'fan@example.org', memberType: MemberType.USER };
	m.member.docs.push(organizer, buyer, real);
	const venue = { _id: id(), memberId: organizer._id };
	const event = { _id: id(), organizerId: organizer._id, venueId: venue._id };
	m.venue.docs.push(venue);
	m.event.docs.push(event);
	for (const [recordType, recordId] of [['Member', organizer._id], ['Member', buyer._id], ['Venue', venue._id], ['Event', event._id]] as const) m.manifest.docs.push({ _id: id(), recordType, recordId });
	m.order.docs.push({ _id: id(), buyerId: buyer._id, eventId: event._id });
	if (withForeignOrder) {
		m.order.docs.push({ _id: id(), buyerId: real._id, eventId: event._id });
		m.comment.docs.push({ _id: id(), memberId: real._id, commentRefId: event._id });
	}
	return { m, models: m as unknown as DemoModels };
};
const state = (m: Record<string, FakeModel>) => JSON.stringify(Object.entries(m).map(([name, model]) => [name, model.docs]));

describe('the check before the demo seed or reset removes anything (DECISIONS #132)', () => {
	it('reads --dry-run from the arguments', () => {
		expect(isDryRun(['node', 'seed-demo.ts', '--dry-run'])).toBe(true);
		expect(isDryRun(['node', 'seed-demo.ts'])).toBe(false);
	});

	describe('dry run', () => {
		it('prints the counts per collection, changes nothing, and tells the caller to stop', async () => {
			const { m, models } = world(true);
			const before = state(m);
			const lines: string[] = [];
			const result = await runDemoLinkGate(models, {}, 'seed', true, (line) => lines.push(line));
			const text = lines.join('\n');

			expect(result.stop).toBe(true);
			expect(state(m)).toBe(before);
			expect(text).toMatch(/orders\s+1/);
			expect(text).toMatch(/comments\s+1/);
			expect(text).toMatch(/total\s+2/);
			expect(text).toContain('nothing was changed');
			expect(text).toContain(`unless ${KEEP_LINKED_ENV}=true`);
		});

		it('says a real run would go ahead when nothing points at demo data', async () => {
			const { models } = world(false);
			const lines: string[] = [];
			const result = await runDemoLinkGate(models, {}, 'seed', true, (line) => lines.push(line));
			expect(result.stop).toBe(true);
			expect(lines.join('\n')).toContain('A real seed would go ahead');
		});

		it('never throws, also with records linked and no flag', async () => {
			const { models } = world(true);
			await expect(runDemoLinkGate(models, {}, 'reset', true, () => undefined)).resolves.toMatchObject({ stop: true });
		});
	});

	describe('real run', () => {
		it('goes on when nothing points at demo data', async () => {
			const { models } = world(false);
			const result = await runDemoLinkGate(models, {}, 'seed', false, () => undefined);
			expect(result).toMatchObject({ stop: false, keepLinked: false });
			expect(result.links.total).toBe(0);
		});

		it('stops with a clear error when the count is not 0, and changes nothing', async () => {
			const { m, models } = world(true);
			const before = state(m);
			await expect(runDemoLinkGate(models, {}, 'seed', false, () => undefined)).rejects.toThrow(
				/Refusing to seed demo data: 2 record\(s\) written by other accounts point at demo events, venues or organizers \(orders: 1, comments: 1\)\. Nothing was changed/,
			);
			expect(state(m)).toBe(before);
		});

		it('the same stop applies to a reset', async () => {
			const { models } = world(true);
			await expect(runDemoLinkGate(models, {}, 'reset', false, () => undefined)).rejects.toThrow(/Refusing to reset demo data/);
		});

		it('goes on with the flag, says which records stay, and asks the seed to keep them', async () => {
			const { models } = world(true);
			const lines: string[] = [];
			const result = await runDemoLinkGate(models, { [KEEP_LINKED_ENV]: 'true' }, 'seed', false, (line) => lines.push(line));
			expect(result).toMatchObject({ stop: false, keepLinked: true });
			expect(lines.join('\n')).toContain('are kept as they are');
		});

		it('the flag changes nothing when nothing is linked', async () => {
			const { models } = world(false);
			const result = await runDemoLinkGate(models, { [KEEP_LINKED_ENV]: 'true' }, 'seed', false, () => undefined);
			expect(result.keepLinked).toBe(false);
		});
	});
});
