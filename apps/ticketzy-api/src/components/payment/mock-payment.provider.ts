import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PaymentProvider as PaymentProviderName, PaymentSimulation } from '../../libs/enums/ticket.enum';
import { ChargeRequest, ChargeResult, PaymentProvider } from './payment.provider';

/** no money moves: the caller picks the outcome with `simulate` (SUCCESS by default) */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
	public readonly name = PaymentProviderName.MOCK;

	public async charge(request: ChargeRequest): Promise<ChargeResult> {
		const providerRef = `MOCK-${request.orderNumber}-${randomBytes(3).toString('hex')}`.toUpperCase();
		if (request.simulate === PaymentSimulation.FAILURE) {
			return { success: false, providerRef, failureReason: 'Simulated payment failure' };
		}
		return { success: true, providerRef };
	}

	public async refund(_providerRef: string): Promise<void> {
		// nothing was charged, nothing to give back
	}
}
