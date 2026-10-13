import { EVENT_CURRENCY, findCurrencyIssues } from './currency';

describe('currency report (read only)', () => {
	it('the event currency is KRW', () => expect(EVENT_CURRENCY).toBe('KRW'));

	it('reports nothing for an all-KRW catalog', () => {
		const rows = [
			{ _id: 't1', eventId: 'e1', ticketCurrency: 'KRW', soldQuantity: 4 },
			{ _id: 't2', eventId: 'e1', ticketCurrency: 'KRW' },
			{ _id: 't3', eventId: 'e2', ticketCurrency: 'KRW' },
		];
		expect(findCurrencyIssues(rows)).toEqual({ otherCurrencyTicketTypes: [], mixedEvents: [], soldOtherCurrency: [] });
	});

	it('lists other-currency types, mixed events, and other-currency types that already sold', () => {
		const rows = [
			{ _id: 't1', eventId: 'e1', ticketCurrency: 'KRW' },
			{ _id: 't2', eventId: 'e1', ticketCurrency: 'USD', soldQuantity: 2 },
			{ _id: 't3', eventId: 'e2', ticketCurrency: 'EUR', soldQuantity: 0 },
			{ _id: 't4', eventId: 'e3', ticketCurrency: undefined },
		];
		expect(findCurrencyIssues(rows)).toEqual({
			otherCurrencyTicketTypes: ['t2', 't3', 't4'],
			mixedEvents: ['e1'],
			soldOtherCurrency: ['t2'],
		});
	});

	it('does not mutate its input', () => {
		const rows = [{ _id: 't1', eventId: 'e1', ticketCurrency: 'USD', soldQuantity: 1 }];
		const copy = JSON.stringify(rows);
		findCurrencyIssues(rows);
		expect(JSON.stringify(rows)).toBe(copy);
	});
});
