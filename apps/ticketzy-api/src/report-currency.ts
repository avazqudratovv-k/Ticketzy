/**
 * npm run report:currency
 * Read-only: lists ticket types that are not in KRW and events that mix currencies (DECISIONS #95).
 * It never writes anything; existing data is only reported.
 */
import { config } from 'dotenv';
import { connect, connection, model } from 'mongoose';
import TicketTypeSchema from './libs/schemas/TicketType.model';
import { getMongoUriKey } from './libs/env.validation';
import { EVENT_CURRENCY, findCurrencyIssues } from './libs/currency';

async function report(): Promise<void> {
	config();
	const uriKey = getMongoUriKey();
	const uri = process.env[uriKey];
	if (!uri) throw new Error(`${uriKey} is missing`);

	await connect(uri);
	const rows = await model('TicketType', TicketTypeSchema).find({}).select('eventId ticketCurrency soldQuantity').lean().exec();
	const result = findCurrencyIssues(rows as any);

	console.log(`Ticket types checked: ${rows.length} (rule: every ticket type is in ${EVENT_CURRENCY})`);
	console.log(`Ticket types in another currency: ${result.otherCurrencyTicketTypes.length}`);
	for (const id of result.otherCurrencyTicketTypes) console.log(`  ticket type ${id}`);
	console.log(`Events that mix currencies: ${result.mixedEvents.length}`);
	for (const id of result.mixedEvents) console.log(`  event ${id}`);
	console.log(`Ticket types in another currency that already sold tickets: ${result.soldOtherCurrency.length}`);
	for (const id of result.soldOtherCurrency) console.log(`  ticket type ${id}`);
	console.log('Nothing was changed.');
}

report()
	.catch((err) => {
		console.error(`Report failed: ${err.message}`);
		process.exitCode = 1;
	})
	.finally(() => connection.close());
