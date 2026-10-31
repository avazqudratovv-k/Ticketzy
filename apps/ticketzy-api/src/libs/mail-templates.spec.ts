import { EmailTokenPurpose } from './enums/email-token.enum';

import { renderMail } from './mail-templates';
import { EventLocale } from './enums/event.enum';

const LINK = 'https://shop.example/reset-password?token=abc_DEF-123';

describe('email templates (DECISIONS #135)', () => {
	const cases = Object.values(EventLocale).flatMap((lang) => Object.values(EmailTokenPurpose).map((purpose) => [lang, purpose] as const));

	it.each(cases)('%s / %s: short subject, one button link, validity, ignore line, a text version with the link, no images or tracking', (lang, purpose) => {
		const mail = renderMail(purpose, lang, LINK);
		expect(mail.subject.length).toBeGreaterThan(3);
		expect(mail.subject.length).toBeLessThan(60);
		expect(mail.html.match(/<a /g)).toHaveLength(1);
		expect(mail.html).toContain(`href="${LINK}"`);
		expect(mail.html).not.toMatch(/<img|<script|<link|<iframe|pixel|track/i);
		expect(mail.html).toContain(`lang="${lang}"`);
		expect(mail.text).toContain(LINK);
		expect(mail.text.split('\n').filter(Boolean).length).toBeLessThanOrEqual(4);
		// how long it is valid
		expect(mail.text).toMatch(purpose === EmailTokenPurpose.RESET_PASSWORD ? /30/ : /24/);
	});

	it('speaks the language of the member, and the four languages differ', () => {
		const subjects = Object.values(EventLocale).map((lang) => renderMail(EmailTokenPurpose.VERIFY_EMAIL, lang, LINK).subject);
		expect(new Set(subjects).size).toBe(4);
		expect(renderMail(EmailTokenPurpose.RESET_PASSWORD, EventLocale.KO, LINK).text).toContain('비밀번호');
		expect(renderMail(EmailTokenPurpose.RESET_PASSWORD, EventLocale.RU, LINK).text).toContain('пароля');
		expect(renderMail(EmailTokenPurpose.RESET_PASSWORD, EventLocale.UZ, LINK).text).toContain('Parolni');
	});

	it('falls back to English for a missing or unknown language', () => {
		const english = renderMail(EmailTokenPurpose.VERIFY_EMAIL, EventLocale.EN, LINK);
		expect(renderMail(EmailTokenPurpose.VERIFY_EMAIL, undefined, LINK)).toEqual(english);
		expect(renderMail(EmailTokenPurpose.VERIFY_EMAIL, 'fr', LINK)).toEqual(english);
	});

	it('escapes the link inside the HTML', () => {
		const mail = renderMail(EmailTokenPurpose.VERIFY_EMAIL, EventLocale.EN, 'https://x.example/a?b=1&c="><script>');
		expect(mail.html).not.toContain('<script>');
		expect(mail.html).toContain('&amp;c=&quot;&gt;&lt;script&gt;');
	});
});
