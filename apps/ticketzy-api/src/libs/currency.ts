import { TicketCurrency } from './enums/ticket.enum';

/** every event sells in one currency, and it is KRW: payouts add the orders of an event up as whole won (DECISIONS #76, #95) */
export const EVENT_CURRENCY = TicketCurrency.KRW;

export interface CurrencyRow {
	_id: unknown;
	eventId: unknown;
	ticketCurrency?: string;
	soldQuantity?: number;
}

export interface CurrencyReport {
	/** ticket types that are not in KRW */
	otherCurrencyTicketTypes: string[];
	/** events whose ticket types use more than one currency, or that sold tickets in another currency */
	mixedEvents: string[];
	/** ticket types in another currency that already sold tickets: their orders cannot be rewritten */
	soldOtherCurrency: string[];
}

/** read-only report of ticket types that break the one-currency rule (existing data is never rewritten) */
export const findCurrencyIssues = (rows: CurrencyRow[]): CurrencyReport => {
	const byEvent = new Map<string, Set<string>>();
	const report: CurrencyReport = { otherCurrencyTicketTypes: [], mixedEvents: [], soldOtherCurrency: [] };
	for (const row of rows) {
		const currency = String(row.ticketCurrency ?? '');
		const eventId = String(row.eventId);
		byEvent.set(eventId, (byEvent.get(eventId) ?? new Set()).add(currency));
		if (currency !== EVENT_CURRENCY) {
			report.otherCurrencyTicketTypes.push(String(row._id));
			if ((row.soldQuantity ?? 0) > 0) report.soldOtherCurrency.push(String(row._id));
		}
	}
	report.mixedEvents = [...byEvent.entries()].filter(([, currencies]) => currencies.size > 1).map(([eventId]) => eventId);
	return report;
};
