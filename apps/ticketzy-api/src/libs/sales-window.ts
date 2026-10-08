import * as moment from 'moment';
import { Message } from './enums/common.enum';

type DateLike = Date | string | null | undefined;

/**
 * The first rule the sales window of an event breaks, or null when it is valid.
 * Pure on purpose: used by create, update and submit with the values the event will have afterwards.
 */
export const getSalesWindowError = (
	endAt: DateLike,
	saleStartAt: DateLike,
	saleEndAt: DateLike,
): Message | null => {
	if (saleStartAt && saleEndAt && !moment(saleStartAt).isBefore(saleEndAt)) return Message.SALES_START_NOT_BEFORE_SALES_END;
	if (endAt && saleEndAt && moment(saleEndAt).isAfter(endAt)) return Message.SALES_END_AFTER_EVENT_END;
	if (endAt && saleStartAt && !moment(saleStartAt).isBefore(endAt)) return Message.SALES_START_NOT_BEFORE_EVENT_END;
	return null;
};

/** why tickets of an event cannot be bought at `now` (event over, sales not open yet, sales closed), or null when they can */
export const getPurchaseWindowError = (
	event: { endAt: DateLike; saleStartAt?: DateLike; saleEndAt?: DateLike },
	now: Date = new Date(),
): Message | null => {
	if (moment(event.endAt).isBefore(now)) return Message.EVENT_ENDED_NO_SALES;
	if (event.saleStartAt && moment(event.saleStartAt).isAfter(now)) return Message.SALES_NOT_STARTED;
	if (event.saleEndAt && moment(event.saleEndAt).isBefore(now)) return Message.SALES_CLOSED;
	return null;
};
