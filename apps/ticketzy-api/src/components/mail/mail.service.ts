import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { getMailConfig } from '../../libs/env.validation';
import { EmailTokenPurpose } from '../../libs/enums/email-token.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { isMailableAddress } from '../../libs/email-token';
import { renderMail } from '../../libs/mail-templates';

export type MailResult = 'sent' | 'dev' | 'skipped' | 'failed';

export interface MailInput {
	to: string;
	lang: unknown;
	purpose: EmailTokenPurpose;
	link: string;
	/** a DELETE account gets no mail: its address may belong to someone else by now */
	memberStatus?: MemberStatus;
}

/**
 * Sends the one-time-link emails through Resend (DECISIONS #135). It never throws: a failed send is logged by error name
 * and the caller carries on, so mail trouble cannot fail a sign-up or tell a stranger anything about an account.
 * Without RESEND_API_KEY outside production the link is logged instead (dev mode); in production no token or link is
 * ever logged.
 */
@Injectable()
export class MailService {
	private readonly logger = new Logger(MailService.name);
	private client: { key: string; resend: Resend } | null = null;

	public async send(input: MailInput): Promise<MailResult> {
		// demo accounts and deleted accounts have no real inbox; the caller gets the same answer either way
		if (input.memberStatus === MemberStatus.DELETE || !isMailableAddress(input.to)) return 'skipped';

		try {
			const config = getMailConfig();
			const mail = renderMail(input.purpose, input.lang, input.link);

			if (!config.apiKey) {
				if (process.env.NODE_ENV === 'production') {
					this.logger.error(`Mail not sent (${input.purpose}): RESEND_API_KEY is not set`);
					return 'failed';
				}
				// the only place a link is logged: no key and not production, so a developer can follow the link by hand
				this.logger.warn(`DEV MAIL (${input.purpose}) to ${input.to}: ${input.link}`);
				return 'dev';
			}

			if (!this.client || this.client.key !== config.apiKey) this.client = { key: config.apiKey, resend: new Resend(config.apiKey) };
			const { error } = await this.client.resend.emails.send({
				from: config.from,
				to: input.to,
				subject: mail.subject,
				html: mail.html,
				text: mail.text,
			});
			if (error) {
				this.logger.error(`Mail not sent (${input.purpose}): ${String((error as any)?.name ?? 'provider error')}`);
				return 'failed';
			}
			return 'sent';
		} catch (err) {
			this.logger.error(`Mail not sent (${input.purpose}): ${String((err as Error)?.name ?? 'Error')}`);
			return 'failed';
		}
	}
}
