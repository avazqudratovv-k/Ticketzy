import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import PaymentSchema from '../../libs/schemas/Payment.model';
import { PaymentService } from './payment.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment.provider';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'Payment', schema: PaymentSchema }])],
	// swap useClass for a real provider to leave the mock behind
	providers: [PaymentService, { provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider }],
	exports: [PaymentService],
})
export class PaymentModule {}
