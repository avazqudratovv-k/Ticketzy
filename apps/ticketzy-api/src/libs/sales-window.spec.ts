import { Message } from './enums/common.enum';
import { getPurchaseWindowError, getSalesWindowError } from './sales-window';

const at = (hours: number) => new Date(Date.UTC(2030, 0, 10, 12) + hours * 3600000);
const END = at(10);

describe('getSalesWindowError', () => {
	it('accepts no window, a half window and a valid window', () => {
		expect(getSalesWindowError(END, undefined, undefined)).toBeNull();
		expect(getSalesWindowError(END, at(1), undefined)).toBeNull();
		expect(getSalesWindowError(END, undefined, at(5))).toBeNull();
		expect(getSalesWindowError(END, at(1), at(5))).toBeNull();
	});

	it('sales start must be before sales end', () => {
		expect(getSalesWindowError(END, at(5), at(1))).toBe(Message.SALES_START_NOT_BEFORE_SALES_END);
		expect(getSalesWindowError(END, at(5), at(5))).toBe(Message.SALES_START_NOT_BEFORE_SALES_END);
	});

	it('sales end may equal the event end but not pass it', () => {
		expect(getSalesWindowError(END, at(1), END)).toBeNull();
		expect(getSalesWindowError(END, at(1), at(10.01))).toBe(Message.SALES_END_AFTER_EVENT_END);
		expect(getSalesWindowError(END, undefined, at(11))).toBe(Message.SALES_END_AFTER_EVENT_END);
	});

	it('sales start must be before the event end', () => {
		expect(getSalesWindowError(END, END, undefined)).toBe(Message.SALES_START_NOT_BEFORE_EVENT_END);
		expect(getSalesWindowError(END, at(12), undefined)).toBe(Message.SALES_START_NOT_BEFORE_EVENT_END);
		expect(getSalesWindowError(END, at(9.99), undefined)).toBeNull();
	});

	it('reports the sales order first, then the end, then the start', () => {
		expect(getSalesWindowError(END, at(20), at(15))).toBe(Message.SALES_START_NOT_BEFORE_SALES_END);
		expect(getSalesWindowError(END, at(1), at(15))).toBe(Message.SALES_END_AFTER_EVENT_END);
		expect(getSalesWindowError(END, at(15), at(16))).toBe(Message.SALES_END_AFTER_EVENT_END);
	});
});

describe('getPurchaseWindowError', () => {
	const now = at(0);
	it('allows an event that is running with no window or inside it', () => {
		expect(getPurchaseWindowError({ endAt: at(5) }, now)).toBeNull();
		expect(getPurchaseWindowError({ endAt: at(5), saleStartAt: at(-1), saleEndAt: at(1) }, now)).toBeNull();
	});
	it('refuses an event that has ended, even inside its sales window', () => {
		expect(getPurchaseWindowError({ endAt: at(-1) }, now)).toBe(Message.EVENT_ENDED_NO_SALES);
		expect(getPurchaseWindowError({ endAt: at(-1), saleStartAt: at(-5), saleEndAt: at(5) }, now)).toBe(Message.EVENT_ENDED_NO_SALES);
	});
	it('refuses before the sales start and after the sales end', () => {
		expect(getPurchaseWindowError({ endAt: at(5), saleStartAt: at(1) }, now)).toBe(Message.SALES_NOT_STARTED);
		expect(getPurchaseWindowError({ endAt: at(5), saleEndAt: at(-1) }, now)).toBe(Message.SALES_CLOSED);
	});
});
