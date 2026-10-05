import { registerEnumType } from '@nestjs/graphql';

export enum TicketTypeStatus {
	ACTIVE = 'ACTIVE',
	PAUSED = 'PAUSED',
	SOLD_OUT = 'SOLD_OUT',
}
registerEnumType(TicketTypeStatus, {
	name: 'TicketTypeStatus',
});

export enum TicketCurrency {
	USD = 'USD',
	EUR = 'EUR',
	KRW = 'KRW',
	UZS = 'UZS',
}
registerEnumType(TicketCurrency, {
	name: 'TicketCurrency',
});

export enum OrderStatus {
	PENDING = 'PENDING',
	PAID = 'PAID',
	CANCELLED = 'CANCELLED',
	EXPIRED = 'EXPIRED',
	REFUNDED = 'REFUNDED',
}
registerEnumType(OrderStatus, {
	name: 'OrderStatus',
});

export enum TicketStatus {
	VALID = 'VALID',
	USED = 'USED',
	REFUNDED = 'REFUNDED',
	CANCELLED = 'CANCELLED',
}
registerEnumType(TicketStatus, {
	name: 'TicketStatus',
});

export enum PaymentProvider {
	MANUAL = 'MANUAL',
	STRIPE = 'STRIPE',
	PAYME = 'PAYME',
	CLICK = 'CLICK',
}
registerEnumType(PaymentProvider, {
	name: 'PaymentProvider',
});

export enum PaymentStatus {
	INITIATED = 'INITIATED',
	CAPTURED = 'CAPTURED',
	FAILED = 'FAILED',
	REFUNDED = 'REFUNDED',
}
registerEnumType(PaymentStatus, {
	name: 'PaymentStatus',
});
