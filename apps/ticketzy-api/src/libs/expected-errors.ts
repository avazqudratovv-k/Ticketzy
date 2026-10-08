import { Message } from './enums/common.enum';

/** Domain errors a client causes in normal use; they are logged as one short warning, without a stack */
export const isExpectedDomainError = (error: { code?: string; message?: string }): boolean =>
	error?.code === 'ACCOUNT_NOT_VERIFIED' || (error?.code === 'UNAUTHENTICATED' && error?.message === Message.WRONG_EMAIL_OR_PASSWORD);
