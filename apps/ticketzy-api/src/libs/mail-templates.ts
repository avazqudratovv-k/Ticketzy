import { EmailTokenPurpose } from './enums/email-token.enum';
import { EventLocale } from './enums/event.enum';

interface Copy {
	subject: string;
	sentence: string;
	button: string;
	valid: string;
	ignore: string;
}

type Kind = EmailTokenPurpose;

/** the four site languages; short on purpose: one sentence, one button, how long it works, what to do if it was not you (#135) */
const COPY: Record<EventLocale, Record<Kind, Copy>> = {
	[EventLocale.EN]: {
		[EmailTokenPurpose.VERIFY_EMAIL]: {
			subject: 'Verify your email',
			sentence: 'Confirm your email address to finish setting up your Ticketzy account.',
			button: 'Verify email',
			valid: 'This link is valid for 24 hours.',
			ignore: "If this wasn't you, you can ignore this email.",
		},
		[EmailTokenPurpose.CHANGE_EMAIL]: {
			subject: 'Confirm your new email',
			sentence: 'Confirm this address to use it for your Ticketzy account. Your current address stays in use until you do.',
			button: 'Confirm email',
			valid: 'This link is valid for 24 hours.',
			ignore: "If this wasn't you, you can ignore this email.",
		},
		[EmailTokenPurpose.RESET_PASSWORD]: {
			subject: 'Reset your password',
			sentence: 'We received a request to reset the password of your Ticketzy account.',
			button: 'Reset password',
			valid: 'This link is valid for 30 minutes.',
			ignore: "If this wasn't you, you can ignore this email.",
		},
	},
	[EventLocale.KO]: {
		[EmailTokenPurpose.VERIFY_EMAIL]: {
			subject: '이메일 주소를 인증해 주세요',
			sentence: 'Ticketzy 계정 설정을 마치려면 이메일 주소를 인증해 주세요.',
			button: '이메일 인증',
			valid: '이 링크는 24시간 동안 유효합니다.',
			ignore: '본인이 요청한 것이 아니라면 이 메일을 무시해 주세요.',
		},
		[EmailTokenPurpose.CHANGE_EMAIL]: {
			subject: '새 이메일 주소를 확인해 주세요',
			sentence: 'Ticketzy 계정에 이 주소를 사용하려면 확인해 주세요. 확인하기 전까지는 기존 주소가 계속 사용됩니다.',
			button: '이메일 확인',
			valid: '이 링크는 24시간 동안 유효합니다.',
			ignore: '본인이 요청한 것이 아니라면 이 메일을 무시해 주세요.',
		},
		[EmailTokenPurpose.RESET_PASSWORD]: {
			subject: '비밀번호를 재설정하세요',
			sentence: 'Ticketzy 계정의 비밀번호 재설정 요청을 받았습니다.',
			button: '비밀번호 재설정',
			valid: '이 링크는 30분 동안 유효합니다.',
			ignore: '본인이 요청한 것이 아니라면 이 메일을 무시해 주세요.',
		},
	},
	[EventLocale.RU]: {
		[EmailTokenPurpose.VERIFY_EMAIL]: {
			subject: 'Подтвердите адрес электронной почты',
			sentence: 'Подтвердите свой адрес, чтобы завершить настройку аккаунта Ticketzy.',
			button: 'Подтвердить почту',
			valid: 'Ссылка действует 24 часа.',
			ignore: 'Если это были не вы, просто проигнорируйте это письмо.',
		},
		[EmailTokenPurpose.CHANGE_EMAIL]: {
			subject: 'Подтвердите новый адрес почты',
			sentence: 'Подтвердите этот адрес, чтобы использовать его в аккаунте Ticketzy. Пока вы этого не сделаете, действует прежний адрес.',
			button: 'Подтвердить адрес',
			valid: 'Ссылка действует 24 часа.',
			ignore: 'Если это были не вы, просто проигнорируйте это письмо.',
		},
		[EmailTokenPurpose.RESET_PASSWORD]: {
			subject: 'Сброс пароля',
			sentence: 'Мы получили запрос на сброс пароля вашего аккаунта Ticketzy.',
			button: 'Сбросить пароль',
			valid: 'Ссылка действует 30 минут.',
			ignore: 'Если это были не вы, просто проигнорируйте это письмо.',
		},
	},
	[EventLocale.UZ]: {
		[EmailTokenPurpose.VERIFY_EMAIL]: {
			subject: 'Elektron pochtangizni tasdiqlang',
			sentence: 'Ticketzy hisobingizni sozlashni yakunlash uchun elektron pochta manzilingizni tasdiqlang.',
			button: 'Pochtani tasdiqlash',
			valid: 'Havola 24 soat amal qiladi.',
			ignore: "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.",
		},
		[EmailTokenPurpose.CHANGE_EMAIL]: {
			subject: 'Yangi pochta manzilini tasdiqlang',
			sentence: "Ticketzy hisobingizda shu manzildan foydalanish uchun uni tasdiqlang. Tasdiqlamaguningizcha eski manzil ishlayveradi.",
			button: 'Manzilni tasdiqlash',
			valid: 'Havola 24 soat amal qiladi.',
			ignore: "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.",
		},
		[EmailTokenPurpose.RESET_PASSWORD]: {
			subject: 'Parolni tiklash',
			sentence: "Ticketzy hisobingiz parolini tiklash so'rovi olindi.",
			button: 'Parolni tiklash',
			valid: 'Havola 30 daqiqa amal qiladi.',
			ignore: "Agar bu siz bo'lmasangiz, bu xatga e'tibor bermang.",
		},
	},
};

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const isEventLocale = (value: unknown): value is EventLocale => Object.values(EventLocale).includes(value as EventLocale);

export interface RenderedMail {
	subject: string;
	html: string;
	text: string;
}

/** plain HTML and a text version; no images, no tracking pixels, no wrapped links. An unknown language falls back to English. */
export const renderMail = (purpose: EmailTokenPurpose, lang: unknown, link: string): RenderedMail => {
	const copy = COPY[isEventLocale(lang) ? lang : EventLocale.EN][purpose];
	const href = escapeHtml(link);
	const html =
		`<!doctype html><html lang="${isEventLocale(lang) ? lang : EventLocale.EN}"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5">` +
		`<p>${escapeHtml(copy.sentence)}</p>` +
		`<p><a href="${href}" style="display:inline-block;padding:10px 20px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(copy.button)}</a></p>` +
		`<p>${escapeHtml(copy.valid)}</p>` +
		`<p style="color:#666">${escapeHtml(copy.ignore)}</p>` +
		`</body></html>`;
	const text = `${copy.sentence}\n\n${copy.button}: ${link}\n\n${copy.valid}\n${copy.ignore}\n`;
	return { subject: copy.subject, html, text };
};
