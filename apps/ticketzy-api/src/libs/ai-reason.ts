export const MAX_REASON_LENGTH = 300;

const SECRET_PATTERNS: RegExp[] = [
	/AIza[0-9A-Za-z_-]{16,}/g, // Google API keys
	/sk-[0-9A-Za-z_-]{10,}/g, // Anthropic style keys
	/Bearer\s+[0-9A-Za-z._~+/=-]{8,}/gi,
	/(?:key|token|secret|password)=\S+/gi,
];

/**
 * Turns the text of a vendor error (Google answers `{"error":{"code":400,"message":"...","status":"INVALID_ARGUMENT"}}`)
 * into one short line that is safe to log: the status text and message only, the configured secrets and anything key
 * shaped removed, long quoted passages (they could be a piece of the prompt) replaced, at most 300 characters.
 */
export const sanitizeProviderReason = (raw: unknown, secrets: string[] = []): string => {
	let text = typeof raw === 'string' ? raw : '';
	try {
		const parsed = JSON.parse(text);
		const error = parsed?.error ?? parsed;
		if (error && typeof error === 'object' && (error.message || error.status)) {
			text = [error.status, error.message].filter((part) => typeof part === 'string' && part).join(': ');
		}
	} catch {
		// not JSON: use the text as it is
	}
	for (const secret of secrets) if (secret && secret.length >= 4) text = text.split(secret).join('[redacted]');
	for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
	text = text.replace(/(["'`])[^"'`]{40,}\1/g, '$1[text]$1');
	text = text.replace(/\s+/g, ' ').trim();
	return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 3)}...` : text;
};
