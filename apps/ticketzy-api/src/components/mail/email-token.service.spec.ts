import { FakeModel } from '../../../test/fake-model';
import { hashEmailToken } from '../../libs/email-token';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { EmailTokenService } from './email-token.service';

const MEMBER = 'member-1';
const OTHER = 'member-2';
const minutes = (count: number) => count * 60_000;

describe('EmailTokenService (DECISIONS #135)', () => {
	let model: FakeModel;
	let service: EmailTokenService;

	beforeEach(() => {
		model = new FakeModel();
		service = new EmailTokenService(model as any);
	});

	it('stores the hash and the expiry, never the token', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.VERIFY_EMAIL);
		expect(token).toHaveLength(43);
		expect(model.docs).toHaveLength(1);
		expect(model.docs[0].tokenHash).toBe(hashEmailToken(token));
		expect(JSON.stringify(model.docs)).not.toContain(token);
		expect(model.docs[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(minutes(60 * 24) - 5000);
		expect(model.docs[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(minutes(60 * 24));
	});

	it('a reset link lasts 30 minutes', async () => {
		await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		const lasts = model.docs[0].expiresAt.getTime() - Date.now();
		expect(lasts).toBeGreaterThan(minutes(30) - 5000);
		expect(lasts).toBeLessThanOrEqual(minutes(30));
	});

	it('redeems a valid token once: the second use is refused', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.VERIFY_EMAIL);
		await expect(service.redeem(token, [EmailTokenPurpose.VERIFY_EMAIL])).resolves.toMatchObject({ memberId: MEMBER, purpose: EmailTokenPurpose.VERIFY_EMAIL });
		const error: any = await service.redeem(token, [EmailTokenPurpose.VERIFY_EMAIL]).catch((err) => err);
		expect(error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
	});

	it('refuses an expired token', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD, { now: new Date(Date.now() - minutes(31)) });
		await expect(service.redeem(token, [EmailTokenPurpose.RESET_PASSWORD])).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
		// and 29 minutes old still works
		const fresh = await service.issue(OTHER as any, EmailTokenPurpose.RESET_PASSWORD, { now: new Date(Date.now() - minutes(29)) });
		await expect(service.redeem(fresh, [EmailTokenPurpose.RESET_PASSWORD])).resolves.toBeDefined();
	});

	it('refuses a wrong, malformed or foreign token with the same error', async () => {
		await service.issue(MEMBER as any, EmailTokenPurpose.VERIFY_EMAIL);
		for (const bad of ['x'.repeat(43), 'short', '', undefined, { $ne: 'x' }]) {
			await expect(service.redeem(bad, [EmailTokenPurpose.VERIFY_EMAIL])).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN', message: expect.any(String) });
		}
	});

	it('a token only works for its own purpose', async () => {
		const reset = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		await expect(service.redeem(reset, [EmailTokenPurpose.VERIFY_EMAIL, EmailTokenPurpose.CHANGE_EMAIL])).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
		// the refused attempt did not spend it
		await expect(service.redeem(reset, [EmailTokenPurpose.RESET_PASSWORD])).resolves.toBeDefined();
	});

	it('a new token of the same purpose invalidates the older ones, other purposes and members are untouched', async () => {
		const first = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		const verify = await service.issue(MEMBER as any, EmailTokenPurpose.VERIFY_EMAIL);
		const other = await service.issue(OTHER as any, EmailTokenPurpose.RESET_PASSWORD);
		const second = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);

		await expect(service.redeem(first, [EmailTokenPurpose.RESET_PASSWORD])).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
		await expect(service.redeem(second, [EmailTokenPurpose.RESET_PASSWORD])).resolves.toBeDefined();
		await expect(service.redeem(verify, [EmailTokenPurpose.VERIFY_EMAIL])).resolves.toBeDefined();
		await expect(service.redeem(other, [EmailTokenPurpose.RESET_PASSWORD])).resolves.toBeDefined();
	});

	it('keeps the new address of an email change with the token', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.CHANGE_EMAIL, { newEmail: 'new@example.com' });
		await expect(service.redeem(token, [EmailTokenPurpose.CHANGE_EMAIL])).resolves.toMatchObject({ newEmail: 'new@example.com' });
	});

	it('two redemptions at the same time: exactly one wins', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		const results = await Promise.allSettled([service.redeem(token, [EmailTokenPurpose.RESET_PASSWORD]), service.redeem(token, [EmailTokenPurpose.RESET_PASSWORD])]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
	});

	it('revokeOpen stops every open token of that purpose', async () => {
		const token = await service.issue(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		await service.revokeOpen(MEMBER as any, EmailTokenPurpose.RESET_PASSWORD);
		await expect(service.redeem(token, [EmailTokenPurpose.RESET_PASSWORD])).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
	});
});
