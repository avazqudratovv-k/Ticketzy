import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
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

	/**
	 * Gives the money of an order back through the provider. The CAPTURED payment is claimed (set to REFUNDED) in one
	 * conditional update before the provider is called and put back if the provider fails, so two parallel refunds never
	 * reach the provider twice. An order whose payment is already REFUNDED is a no-op, which makes a retry safe.
	 */
	public async refundOrder(orderId: ObjectId): Promise<void> {
		const claimed = await this.paymentModel
			.findOneAndUpdate(
				{ orderId: orderId, paymentStatus: PaymentStatus.CAPTURED },
				{ paymentStatus: PaymentStatus.REFUNDED },
				{ new: true },
			)
			.exec();
		if (!claimed) return;

		try {
			await this.provider.refund(claimed.providerRef);
		} catch (err) {
			await this.paymentModel.updateOne({ _id: claimed._id }, { paymentStatus: PaymentStatus.CAPTURED }).exec();
			throw err;
		}
	}
}
