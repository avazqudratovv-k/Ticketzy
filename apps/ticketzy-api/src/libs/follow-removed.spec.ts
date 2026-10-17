import { existsSync } from 'fs';
import { join } from 'path';
import MemberSchema from './schemas/Member.model';
import { Message } from './enums/common.enum';

/** following organizers was removed (#122); the GraphQL side is checked in schema.spec.ts */
describe('follow feature removed (#122)', () => {
	it('has no follow module, schema or DTO files', () => {
		for (const path of ['../components/follow', './dto/follow', './schemas/Follow.model.ts']) {
			expect(existsSync(join(__dirname, path))).toBe(false);
		}
	});

	it('new members are not given follow counters', () => {
		expect(Object.keys(MemberSchema.paths).filter((name) => /follow/i.test(name))).toEqual([]);
	});

	it('the follow messages are gone', () => {
		expect(Object.keys(Message).filter((name) => /FOLLOW|SUBSCRIPTION/.test(name))).toEqual([]);
	});
});
