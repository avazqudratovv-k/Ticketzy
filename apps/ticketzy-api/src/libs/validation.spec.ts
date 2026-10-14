import { ApolloServer } from '@apollo/server';
import { ValidationFailedException } from './coded-exception';
import { MemberInput } from './dto/member/member.input';
import { MemberUpdate } from './dto/member/member.update';
import { Message } from './enums/common.enum';
import { formatGraphQLError } from './error-mapping';
import { createValidationPipe } from './validation';

const pipe = createValidationPipe();
const run = (metatype: any, value: object) => pipe.transform(value, { type: 'body', metatype });
const fail = async (metatype: any, value: object): Promise<ValidationFailedException> => {
	try {
		await run(metatype, value);
	} catch (err: any) {
		return err;
	}
	throw new Error('expected a validation error');
};

/** the exact shape `SignupForm.tsx` sends for an organizer: the organization name is the nick (frontend F21) */
const organizerForm = (organization: string) => ({
	memberEmail: 'ben@example.com',
	memberPassword: 'longenough1',
	memberFullName: 'Ben Parker',
	memberNick: organization,
});

describe('signupOrganizer input as the frontend sends it (#113)', () => {
	it('accepts "JJ Entertainment" as the organization name (16 characters, it was refused by Length(3, 12))', async () => {
		const result: any = await run(MemberInput, organizerForm('JJ Entertainment'));
		expect(result.memberNick).toBe('JJ Entertainment');
		expect(result.memberFullName).toBe('Ben Parker');
	});

	it('still refuses an organization name that is too short or longer than 50, naming memberNick and the rule', async () => {
		expect((await fail(MemberInput, organizerForm('JJ'))).fields).toEqual([{ field: 'memberNick', rules: ['isLength'] }]);
		expect((await fail(MemberInput, organizerForm('x'.repeat(51)))).fields).toEqual([{ field: 'memberNick', rules: ['isLength'] }]);
		await expect(run(MemberInput, organizerForm('x'.repeat(50)))).resolves.toBeDefined();
	});

	it('the profile update takes the same organization name length', async () => {
		await expect(run(MemberUpdate, { _id: '507f1f77bcf86cd799439011', memberNick: 'JJ Entertainment' })).resolves.toBeDefined();
		expect((await fail(MemberUpdate, { _id: '507f1f77bcf86cd799439011', memberNick: 'x'.repeat(51) })).fields).toEqual([{ field: 'memberNick', rules: ['isLength'] }]);
	});
});

describe('the validation error shape', () => {
	it('lists every failed field once with its rule names', async () => {
		const err = await fail(MemberInput, { memberEmail: 'nope', memberPassword: 'short', memberNick: 'ab', memberFullName: 'Be' });
		expect(err.code).toBe('VALIDATION_FAILED');
		expect(err.message).toBe(Message.VALIDATION_FAILED);
		expect(err.fields).toEqual([
			{ field: 'memberEmail', rules: ['isEmail'] },
			{ field: 'memberPassword', rules: ['minLength'] },
			{ field: 'memberNick', rules: ['isLength'] },
			{ field: 'memberFullName', rules: ['isLength'] },
		]);
	});

	it('reaches the client as { code, message, fields } and the log holds the same fields without any value', async () => {
		const secrets = { memberEmail: 'secret.person@example.com', memberPassword: 'hunter2', memberNick: 'x'.repeat(60) };
		const err = await fail(MemberInput, secrets);
		const logger = { warn: jest.fn(), error: jest.fn() };
		const server = new ApolloServer({
			typeDefs: 'type Query { a: String }',
			resolvers: { Query: { a: () => { throw err; } } },
			formatError: (formatted, original) => formatGraphQLError(formatted as any, original, logger) as any,
		});
		const body: any = (await server.executeOperation({ query: '{ a }' })).body;
		const answer = body.singleResult.errors[0];

		expect(answer).toEqual({
			code: 'VALIDATION_FAILED',
			message: Message.VALIDATION_FAILED,
			fields: [
				{ field: 'memberPassword', rules: ['minLength'] },
				{ field: 'memberNick', rules: ['isLength'] },
			],
		});
		expect(logger.warn).toHaveBeenCalledWith('VALIDATION_FAILED [memberPassword: minLength; memberNick: isLength]');
		expect(logger.error).not.toHaveBeenCalled();
		const everything = JSON.stringify([answer, logger.warn.mock.calls]);
		expect(everything).not.toMatch(/hunter2|secret\.person|xxxxx/);
	});
});
