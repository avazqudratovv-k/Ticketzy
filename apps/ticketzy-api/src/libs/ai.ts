import { EventLocale, ModerationFlagType } from './enums/event.enum';

export const MAX_FLAGS = 10;
export const MAX_REASON_LENGTH = 500;

export interface ModerationResult {
	flags: { type: ModerationFlagType; reason?: string; confidence?: number }[];
	reason?: string;
	confidence?: number;
}

export interface TranslationResult {
	locale: EventLocale;
	title: string;
	description?: string;
}

/** the model's answer as a JSON value: tolerates a ```json fence or text around one object, nothing else */
export const extractJson = (text: string): unknown => {
	const trimmed = (text ?? '').trim();
	const start = trimmed.indexOf('{');
	const end = trimmed.lastIndexOf('}');
	if (start === -1 || end <= start) throw new Error('no JSON object');
	return JSON.parse(trimmed.slice(start, end + 1));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isConfidence = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isShortText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/**
 * Strict check of the moderation answer. Only the known fields are copied out, so whatever else the model (or text it was
 * tricked by) added never reaches the database. Anything out of shape throws and the caller marks the event "not checked".
 */
export const parseModerationResult = (raw: unknown): ModerationResult => {
	if (!isPlainObject(raw) || !Array.isArray(raw.flags) || raw.flags.length > MAX_FLAGS) throw new Error('bad moderation shape');

	const flags = raw.flags.map((flag) => {
		if (!isPlainObject(flag)) throw new Error('bad flag');
		if (!Object.values(ModerationFlagType).includes(flag.type as ModerationFlagType)) throw new Error('bad flag type');
		if (!isShortText(flag.reason, MAX_REASON_LENGTH)) throw new Error('bad flag reason');
		if (!isConfidence(flag.confidence)) throw new Error('bad flag confidence');
		return { type: flag.type as ModerationFlagType, reason: flag.reason.trim(), confidence: flag.confidence };
	});

	if (!isShortText(raw.reason, MAX_REASON_LENGTH)) throw new Error('bad reason');
	if (!isConfidence(raw.confidence)) throw new Error('bad confidence');
	return { flags, reason: raw.reason.trim(), confidence: raw.confidence };
};

/** Strict check of the translation answer: exactly the requested locales, once each, with a title (and a description when the source had one) */
export const parseTranslationResult = (raw: unknown, locales: EventLocale[], hasDescription: boolean): TranslationResult[] => {
	if (!isPlainObject(raw) || !Array.isArray(raw.translations) || raw.translations.length !== locales.length) {
		throw new Error('bad translation shape');
	}
	const seen = new Set<string>();
	const result = raw.translations.map((item) => {
		if (!isPlainObject(item)) throw new Error('bad translation');
		const locale = item.locale as EventLocale;
		if (!locales.includes(locale) || seen.has(locale)) throw new Error('bad locale');
		seen.add(locale);
		// the same limits as EventTranslationInput, so the organizer can save the suggestion with updateEvent as it is
		if (typeof item.title !== 'string' || item.title.trim().length < 3 || item.title.trim().length > 100) throw new Error('bad title');
		const translated: TranslationResult = { locale, title: item.title.trim() };
		if (hasDescription) {
			if (typeof item.description !== 'string' || item.description.trim().length < 5 || item.description.trim().length > 2000) {
				throw new Error('bad description');
			}
			translated.description = item.description.trim();
		}
		return translated;
	});
	return result;
};

/** keeps untrusted text bounded before it goes into a prompt */
export const clip = (text: unknown, max: number): string => String(text ?? '').slice(0, max);
