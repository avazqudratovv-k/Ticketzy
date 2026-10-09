import * as bcrypt from 'bcryptjs';
import { ensureExtraAdmin } from './admin-seed';
import { MemberStatus, MemberType } from './enums/member.enum';

const makeModel = (existing: { memberType: string } | null) => ({
	findOne: jest.fn().mockReturnValue({ select: () => ({ lean: () => Promise.resolve(existing) }) }),
	create: jest.fn().mockResolvedValue({}),
});
const makeLog = () => ({ log: jest.fn(), warn: jest.fn() });
const env = { ADMIN2_EMAIL: ' Second@Example.com ', ADMIN2_PASSWORD: 'Secret1234', ADMIN2_NICK: 'boss2' };

describe('ensureExtraAdmin', () => {
	it('creates an active admin with a hashed password when the email is unused', async () => {
		const model = makeModel(null);
		const log = makeLog();
		expect(await ensureExtraAdmin(model, env, log)).toBe('created');
		expect(model.findOne).toHaveBeenCalledWith({ memberEmail: 'second@example.com' });
		const doc = model.create.mock.calls[0][0];
		expect(doc).toMatchObject({
			memberEmail: 'second@example.com',
			memberType: MemberType.ADMIN,
			memberStatus: MemberStatus.ACTIVE,
			memberNick: 'boss2',
		});
		expect(doc.memberPassword).not.toBe('Secret1234');
		expect(await bcrypt.compare('Secret1234', doc.memberPassword)).toBe(true);
		const logged = JSON.stringify([...log.log.mock.calls, ...log.warn.mock.calls]);
		expect(logged).not.toContain('Secret1234');
		expect(logged).not.toContain(doc.memberPassword);
	});

	it('omits the nick when ADMIN2_NICK is not set', async () => {
		const model = makeModel(null);
		await ensureExtraAdmin(model, { ...env, ADMIN2_NICK: '' }, makeLog());
		expect(model.create.mock.calls[0][0]).not.toHaveProperty('memberNick');
	});

	it('skips an existing admin without writing', async () => {
		const model = makeModel({ memberType: MemberType.ADMIN });
		expect(await ensureExtraAdmin(model, env, makeLog())).toBe('exists');
		expect(model.create).not.toHaveBeenCalled();
	});

	it.each([
		['both missing', {}, false],
		['password missing', { ADMIN2_EMAIL: 'a@b.co' }, true],
		['email missing', { ADMIN2_PASSWORD: 'Secret1234' }, true],
		['invalid email', { ADMIN2_EMAIL: 'nope', ADMIN2_PASSWORD: 'Secret1234' }, true],
		['short password', { ADMIN2_EMAIL: 'a@b.co', ADMIN2_PASSWORD: 'short' }, true],
	])('skips without touching the database when %s', async (_n, vars, warns) => {
		const model = makeModel(null);
		const log = makeLog();
		expect(await ensureExtraAdmin(model, vars, log)).toBe('skipped');
		expect(model.findOne).not.toHaveBeenCalled();
		expect(model.create).not.toHaveBeenCalled();
		expect(log.warn).toHaveBeenCalledTimes(warns ? 1 : 0);
	});

	it.each([MemberType.USER, MemberType.ORGANIZER])('warns and leaves an existing %s account unchanged', async (type) => {
		const model = makeModel({ memberType: type });
		const log = makeLog();
		expect(await ensureExtraAdmin(model, env, log)).toBe('not-admin');
		expect(model.create).not.toHaveBeenCalled();
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('left unchanged'));
	});

	it('reports a duplicate key on create as a warning, not a crash', async () => {
		const model = makeModel(null);
		model.create.mockRejectedValue({ code: 11000 });
		const log = makeLog();
		expect(await ensureExtraAdmin(model, env, log)).toBe('failed');
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
	});
});
