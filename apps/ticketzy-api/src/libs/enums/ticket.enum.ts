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
	PENDING_PAYMENT = 'PENDING_PAYMENT',
	PAID = 'PAID',
	FAILED = 'FAILED',
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
	MOCK = 'MOCK',
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

/** the mock provider only: which outcome payOrder should simulate */
export enum PaymentSimulation {
	SUCCESS = 'SUCCESS',
	FAILURE = 'FAILURE',
}
registerEnumType(PaymentSimulation, {
	name: 'PaymentSimulation',
});

export enum TicketTimeFilter {
	UPCOMING = 'UPCOMING',
	PAST = 'PAST',
}
registerEnumType(TicketTimeFilter, {
	name: 'TicketTimeFilter',
});

export enum RefundStatus {
	PENDING = 'PENDING',
	COMPLETED = 'COMPLETED',
	FAILED = 'FAILED',
}
registerEnumType(RefundStatus, {
	name: 'RefundStatus',
});

/** who started the refund: the buyer, an admin override, or the cancellation of the event */
export enum RefundSource {
	BUYER = 'BUYER',
	ADMIN = 'ADMIN',
	EVENT_CANCELLED = 'EVENT_CANCELLED',
}
registerEnumType(RefundSource, {
	name: 'RefundSource',
});
