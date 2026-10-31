import { Logger } from '@nestjs/common';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { MailService } from './mail.service';
import { EventLocale } from '../../libs/enums/event.enum';

const send = jest.fn();
const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send } }));
jest.mock('resend', () => ({
	Resend: function (key: string) {
		return ResendMock(key);
	},
}));

const LINK = 'https://shop.example/reset-password?token=SECRET_TOKEN_VALUE';
const input = (over: any = {}) => ({ to: 'real@example.com', lang: EventLocale.EN, purpose: EmailTokenPurpose.RESET_PASSWORD, link: LINK, memberStatus: MemberStatus.ACTIVE, ...over });

describe('MailService (DECISIONS #135)', () => {
	const env = { ...process.env };
	let logged: string[];
	let service: MailService;

	beforeEach(() => {
		send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
		ResendMock.mockClear();
		logged = [];
		for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
			jest.spyOn(Logger.prototype, level).mockImplementation((message: any) => void logged.push(String(message)));
		}
		process.env = { ...env, NODE_ENV: 'test', RESEND_API_KEY: 're_test_key_123', MAIL_FROM: 'Ticketzy <noreply@shop.example>', SITE_URL: 'https://shop.example' };
		service = new MailService();
	});
	afterEach(() => {
		jest.restoreAllMocks();
		process.env = { ...env };
	});

	it('sends through Resend with the sender, an HTML and a text version, in the language of the member', async () => {
		await expect(service.send(input({ lang: EventLocale.KO }))).resolves.toBe('sent');
		expect(ResendMock).toHaveBeenCalledWith('re_test_key_123');
		const payload = send.mock.calls[0][0];
		expect(payload).toMatchObject({ from: 'Ticketzy <noreply@shop.example>', to: 'real@example.com' });
		expect(payload.html).toContain(LINK);
		expect(payload.text).toContain(LINK);
		expect(payload.subject).toContain('비밀번호');
	});

	it('does not send to @ticketzy.demo addresses or to deleted accounts', async () => {
		await expect(service.send(input({ to: 'buyer@ticketzy.demo' }))).resolves.toBe('skipped');
		await expect(service.send(input({ memberStatus: MemberStatus.DELETE }))).resolves.toBe('skipped');
		expect(send).not.toHaveBeenCalled();
	});

	it('dev mode (no key, not production): logs the link instead of sending', async () => {
		process.env.RESEND_API_KEY = '';
		process.env.MAIL_FROM = '';
		await expect(service.send(input())).resolves.toBe('dev');
		expect(send).not.toHaveBeenCalled();
		expect(logged.join('\n')).toContain(LINK);
	});

	it('production without a key sends nothing and logs no token or link', async () => {
		process.env = { ...env, NODE_ENV: 'production', RESEND_API_KEY: '', MAIL_FROM: '', SITE_URL: 'https://shop.example' };
		await expect(service.send(input())).resolves.toBe('failed');
		expect(send).not.toHaveBeenCalled();
		expect(logged.join('\n')).not.toContain('SECRET_TOKEN_VALUE');
		expect(logged.join('\n')).not.toContain(LINK);
	});

	it('production with a key sends and never logs the token, the link, the address or the key, even when the provider fails', async () => {
		process.env = { ...env, NODE_ENV: 'production', RESEND_API_KEY: 're_prod_key_123', MAIL_FROM: 'noreply@shop.example', SITE_URL: 'https://shop.example' };
		await expect(service.send(input())).resolves.toBe('sent');
		send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: `bad ${LINK} real@example.com` } });
		await expect(service.send(input())).resolves.toBe('failed');
		send.mockRejectedValue(Object.assign(new Error(`down ${LINK}`), { name: 'FetchError' }));
		await expect(service.send(input())).resolves.toBe('failed');
		const log = logged.join('\n');
		expect(log).not.toContain('SECRET_TOKEN_VALUE');
		expect(log).not.toContain('real@example.com');
		expect(log).not.toContain('re_prod_key_123');
		expect(log).toContain('validation_error');
	});

	it('never throws', async () => {
		send.mockRejectedValue(new Error('network'));
		await expect(service.send(input())).resolves.toBe('failed');
	});
});
