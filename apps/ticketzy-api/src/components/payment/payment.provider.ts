import { PaymentProvider as PaymentProviderName, PaymentSimulation } from '../../libs/enums/ticket.enum';

export interface ChargeRequest {
	orderId: string;
	orderNumber: string;
	amount: number;
	currency?: string;
	/** only the mock provider reads this; a real provider ignores it */
	simulate?: PaymentSimulation;
}

export interface ChargeResult {
	success: boolean;
	providerRef: string;
	failureReason?: string;
}

/** the seam a real provider (Stripe, Payme, Click) plugs into; PaymentService only talks to this */
export interface PaymentProvider {
	readonly name: PaymentProviderName;
	charge(request: ChargeRequest): Promise<ChargeResult>;
	refund(providerRef: string): Promise<void>;
}

/** Nest injection token for the active PaymentProvider */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
