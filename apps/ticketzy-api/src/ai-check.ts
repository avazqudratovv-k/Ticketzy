/**
 * npm run ai:check (or yarn ai:check)
 * Tests the AI setup from .env: which settings are set (never their values), the models Google offers, and one tiny
 * "Say hello" request with the configured model. Exit code 0 when it works, 1 when it does not. Prints no secrets.
 */
import { config } from 'dotenv';
import { runAiCheck } from './libs/ai-check';
import { createAiProvider } from './components/ai/providers/create-ai-provider';

config();
runAiCheck(process.env, { fetchFn: (url, init) => fetch(url, init), createProvider: createAiProvider }, (line) => console.log(line))
	.then((code) => process.exit(code))
	.catch(() => {
		console.log('FAILED: the check itself crashed');
		process.exit(1);
	});
