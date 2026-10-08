import { isExpectedDomainError } from './expected-errors';
import { Message } from './enums/common.enum';

describe('isExpectedDomainError', () => {
	it('knows a not verified account and a wrong password', () => {
		expect(isExpectedDomainError({ code: 'ACCOUNT_NOT_VERIFIED', message: Message.ACCOUNT_NOT_VERIFIED })).toBe(true);
		expect(isExpectedDomainError({ code: 'UNAUTHENTICATED', message: Message.WRONG_EMAIL_OR_PASSWORD })).toBe(true);
	});

	it('keeps every other error unexpected, including other UNAUTHENTICATED ones', () => {
		expect(isExpectedDomainError({ code: 'UNAUTHENTICATED', message: Message.NOT_AUTHENTICATED })).toBe(false);
		expect(isExpectedDomainError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' })).toBe(false);
		expect(isExpectedDomainError({})).toBe(false);
		expect(isExpectedDomainError(undefined as any)).toBe(false);
	});
});
