import { FakeModel } from '../../test/fake-model';
import { runEmailVerifiedMigration } from './email-verified-migration';

const verifiedAt = new Date('2026-02-02T00:00:00Z');
const now = new Date('2026-11-01T00:00:00Z');
const build = () =>
	new FakeModel([
		{ _id: 'old-user', memberEmail: 'old@example.com' },
		{ _id: 'null-user', memberEmail: 'null@example.com', emailVerifiedAt: null },
		{ _id: 'demo', memberEmail: 'buyer@ticketzy.demo' },
		{ _id: 'deleted', memberEmail: 'gone@example.com', memberStatus: 'DELETE' },
		{ _id: 'verified', memberEmail: 'ok@example.com', emailVerifiedAt: verifiedAt },
	]);

describe('migrate:email-verified (DECISIONS #135)', () => {
	it('a dry run counts the members and changes nothing', async () => {
		const members = build();
		await expect(runEmailVerifiedMigration(members, { apply: false, now })).resolves.toEqual({ pending: 4, updated: 0 });
		expect(members.docs.filter((doc) => doc.emailVerifiedAt).length).toBe(1);
	});

	it('--apply marks every member without a value as verified (demo and deleted included) and leaves the others alone', async () => {
		const members = build();
		await expect(runEmailVerifiedMigration(members, { apply: true, now })).resolves.toEqual({ pending: 4, updated: 4 });
		for (const doc of members.docs) expect(doc.emailVerifiedAt).toBeInstanceOf(Date);
		expect(members.docs.find((doc) => doc._id === 'verified').emailVerifiedAt).toBe(verifiedAt);
		expect(members.docs.find((doc) => doc._id === 'demo').emailVerifiedAt).toBe(now);
	});

	it('running it again changes nothing', async () => {
		const members = build();
		await runEmailVerifiedMigration(members, { apply: true, now });
		await expect(runEmailVerifiedMigration(members, { apply: true, now: new Date() })).resolves.toEqual({ pending: 0, updated: 0 });
		expect(members.docs.find((doc) => doc._id === 'old-user').emailVerifiedAt).toBe(now);
	});
});
