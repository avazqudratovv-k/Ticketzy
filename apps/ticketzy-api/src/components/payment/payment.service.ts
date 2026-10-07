import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../../libs/dto/order/order';
import { PaymentStatus, PaymentSimulation } from '../../libs/enums/ticket.enum';
import { ChargeResult, PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';

@Injectable()
export class PaymentService {
	constructor(
		@InjectModel('Payment') private readonly paymentModel: Model<any>,
		@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
	) {}

	public charge(order: Order, simulate: PaymentSimulation): Promise<ChargeResult> {
		return this.provider.charge({
			orderId: String(order._id),
			orderNumber: order.orderNumber,
			amount: order.totalAmount,
			currency: order.currency,
			simulate: simulate,
		});
	}

	/** keeps a record of the attempt, successful or not; the amount is always the order's server-side total */
	public async record(order: Order, result: ChargeResult): Promise<void> {
		await this.paymentModel.create({
			orderId: order._id,
			paymentProvider: this.provider.name,
			providerRef: result.providerRef,
			paymentStatus: result.success ? PaymentStatus.CAPTURED : PaymentStatus.FAILED,
			amount: order.totalAmount,
		});
	}

	public async deleteRecords(order: Order): Promise<void> {
		await this.paymentModel.deleteMany({ orderId: order._id }).exec();
	}

	public refund(providerRef: string): Promise<void> {
		return this.provider.refund(providerRef);
	}
}
