import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Event } from '../../libs/dto/event/event';
import { EventSeat, HeldSeat, SeatConfig, SeatHold, SeatRefInput } from '../../libs/dto/event/event-seat';
import { Member } from '../../libs/dto/member/member';
import { Message } from '../../libs/enums/common.enum';
import { SeatStatus, SeatingType, publicEventStatus } from '../../libs/enums/event.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { getSeatHoldSeconds } from '../../libs/env.validation';
import { shapeIntoMongoObjectId } from '../../libs/config';

export const MAX_SEATS_PER_HOLD = 8;

/**
 * Seat holds. Every state change is one conditional findOneAndUpdate on the seat document,
 * so two members racing for the same seat can never both win.
 */
@Injectable()
export class SeatService {
	private readonly logger = new Logger(SeatService.name);

	constructor(
		@InjectModel('EventSeat') private readonly eventSeatModel: Model<EventSeat>,
		@InjectModel('Event') private readonly eventModel: Model<Event>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	/** unique, 1 to 8 seat ids */
	public normalizeSeatIds(seatIds: ObjectId[]): ObjectId[] {
		if (!Array.isArray(seatIds) || seatIds.length < 1) throw new BadRequestException(Message.BAD_REQUEST);
		if (seatIds.length > MAX_SEATS_PER_HOLD) throw new BadRequestException(Message.SEAT_HOLD_LIMIT);
		const ids = seatIds.map((id) => shapeIntoMongoObjectId(id));
		if (new Set(ids.map(String)).size !== ids.length) throw new BadRequestException(Message.BAD_REQUEST);
		return ids;
	}

	public getSeatConfig(): SeatConfig {
		return { seatHoldSeconds: getSeatHoldSeconds(), maxSeatsPerOrder: MAX_SEATS_PER_HOLD };
	}

	/**
	 * Turns the holdSeats input into seat ids. Exactly one of seatIds / seats is sent, and each entry of seats is either
	 * { _id } or { sectionKey, row, number }. Coordinates are resolved inside the given event with one query.
	 */
	public async resolveSeatInput(eventId: ObjectId, seatIds?: string[] | null, seats?: SeatRefInput[] | null): Promise<ObjectId[]> {
		if (seatIds && seats) throw new BadRequestException(Message.SEAT_INPUT_INVALID);
		if (!seatIds && !seats) throw new BadRequestException(Message.BAD_REQUEST);
		if (seatIds) return seatIds as any;
		if (seats.length < 1) throw new BadRequestException(Message.BAD_REQUEST);
		if (seats.length > MAX_SEATS_PER_HOLD) throw new BadRequestException(Message.SEAT_HOLD_LIMIT);

		type Place = { sectionKey: string; row: number; number: number };
		const refs = seats.map((ref) => {
			const hasId = ref._id !== undefined && ref._id !== null;
			const given = [ref.sectionKey, ref.row, ref.number].filter((v) => v !== undefined && v !== null).length;
			if (hasId && given === 0 && String(ref._id).trim()) return { id: ref._id as string };
			const complete =
				!hasId && given === 3 && typeof ref.sectionKey === 'string' && ref.sectionKey.trim() && ref.row >= 1 && ref.number >= 1;
			if (!complete) throw new BadRequestException(Message.SEAT_REF_INVALID);
			return { place: { sectionKey: ref.sectionKey.trim(), row: ref.row, number: ref.number } as Place };
		});

		const places = refs.filter((ref) => ref.place).map((ref) => ref.place);
		const keyOf = (p: Place) => `${p.sectionKey}|${p.row}|${p.number}`;
		const idByPlace = new Map<string, ObjectId>();
		if (places.length) {
			const found = await this.eventSeatModel
				.find({ eventId: eventId, $or: places })
				.select('sectionKey row number')
				.lean()
				.exec();
			found.forEach((seat) => idByPlace.set(keyOf(seat), seat._id));
		}
		return refs.map((ref) => {
			if (ref.id) return ref.id as any;
			const id = idByPlace.get(keyOf(ref.place));
			if (!id) throw new BadRequestException(Message.SEAT_NOT_FOUND);
			return id;
		});
	}

	/**
	 * Holds the seats for the member until now + SEAT_HOLD_SECONDS. A seat can be claimed when it is AVAILABLE,
	 * when its hold has run out, or when the same member already holds it. All or nothing: if one seat fails, the seats
	 * claimed in this call are released. Holds the member had on other seats of the event are released first.
	 */
	public async holdSeats(memberId: ObjectId, eventId: ObjectId, seatIds: ObjectId[]): Promise<SeatHold> {
		const ids = this.normalizeSeatIds(seatIds);
		const memberActive = await this.memberModel.exists({ _id: memberId, memberStatus: MemberStatus.ACTIVE });
		if (!memberActive) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		await this.assertEventOpenForSeats(eventId);

		// a member has one hold per event: seats held earlier (and not asked for again) go back to the pool
		await this.eventSeatModel
			.updateMany(
				{ eventId: eventId, heldBy: memberId, seatStatus: SeatStatus.HELD, _id: { $nin: ids } },
				{ seatStatus: SeatStatus.AVAILABLE, $unset: { heldBy: 1, heldUntil: 1 } },
			)
			.exec();

		const now = new Date();
		const heldUntil = new Date(now.getTime() + getSeatHoldSeconds() * 1000);
		const claimed: EventSeat[] = [];
		try {
			for (const seatId of ids) {
				const seat = await this.eventSeatModel
					.findOneAndUpdate(
						{
							_id: seatId,
							eventId: eventId,
							$or: [
								{ seatStatus: SeatStatus.AVAILABLE },
								{ seatStatus: SeatStatus.HELD, heldUntil: { $lte: now } },
								{ seatStatus: SeatStatus.HELD, heldBy: memberId },
							],
						},
						{ seatStatus: SeatStatus.HELD, heldBy: memberId, heldUntil: heldUntil },
						{ new: true },
					)
					.exec();
				if (!seat) {
					await this.releaseClaimed(memberId, claimed);
					throw new BadRequestException(Message.SEAT_JUST_TAKEN);
				}
				claimed.push(seat);
			}
		} catch (err) {
			if (!(err instanceof BadRequestException)) {
				this.logger.error(`Error, Service.model: ${err.message}`);
				await this.releaseClaimed(memberId, claimed);
			}
			throw err;
		}

		return {
			eventId: eventId,
			seats: claimed.map((seat): HeldSeat => ({
				_id: seat._id,
				ticketTypeId: seat.ticketTypeId,
				sectionKey: seat.sectionKey,
				row: seat.row,
				number: seat.number,
			})),
			heldUntil: heldUntil,
			holdSeconds: getSeatHoldSeconds(),
			serverTime: new Date(),
		};
	}

	/** gives back every seat the member holds on the event; returns how many */
	public async releaseSeats(memberId: ObjectId, eventId: ObjectId): Promise<number> {
		const result = await this.eventSeatModel
			.updateMany(
				{ eventId: eventId, heldBy: memberId, seatStatus: SeatStatus.HELD },
				{ seatStatus: SeatStatus.AVAILABLE, $unset: { heldBy: 1, heldUntil: 1 } },
			)
			.exec();
		return result.modifiedCount;
	}

	/** the seats of an event that the member holds right now, or null when any of them is not held (or the hold ran out) */
	public async findHeldSeats(memberId: ObjectId, eventId: ObjectId, seatIds: ObjectId[]): Promise<EventSeat[] | null> {
		const seats = await this.eventSeatModel
			.find({
				_id: { $in: seatIds },
				eventId: eventId,
				seatStatus: SeatStatus.HELD,
				heldBy: memberId,
				heldUntil: { $gt: new Date() },
			})
			.lean()
			.exec();
		return seats.length === seatIds.length ? seats : null;
	}

	/**
	 * HELD (by the member, still valid) to SOLD, one conditional update per seat. If any seat fails, the seats sold in
	 * this call go back to HELD and HOLD_EXPIRED is thrown, so a payment never ends with half an order.
	 */
	public async markSold(memberId: ObjectId, orderId: ObjectId, seatIds: ObjectId[]): Promise<EventSeat[]> {
		const sold: EventSeat[] = [];
		try {
			for (const seatId of seatIds) {
				const seat = await this.eventSeatModel
					.findOneAndUpdate(
						{ _id: seatId, heldBy: memberId, seatStatus: SeatStatus.HELD, heldUntil: { $gt: new Date() } },
						{ seatStatus: SeatStatus.SOLD, orderId: orderId },
						{ new: true },
					)
					.exec();
				if (!seat) {
					await this.revertSold(orderId, sold.map((done) => done._id));
					throw new BadRequestException(Message.HOLD_EXPIRED);
				}
				sold.push(seat);
			}
			return sold;
		} catch (err) {
			if (!(err instanceof BadRequestException)) {
				this.logger.error(`Error, Service.model: ${err.message}`);
				await this.revertSold(orderId, sold.map((done) => done._id));
			}
			throw err;
		}
	}

	/** SOLD back to HELD (same buyer, same heldUntil) for seats this order sold; used by rollbacks */
	public async revertSold(orderId: ObjectId, seatIds: ObjectId[]): Promise<void> {
		if (!seatIds.length) return;
		await this.eventSeatModel
			.updateMany(
				{ _id: { $in: seatIds }, orderId: orderId, seatStatus: SeatStatus.SOLD },
				{ seatStatus: SeatStatus.HELD, $unset: { orderId: 1 } },
			)
			.exec();
	}

	/** releases the buyer's own HELD seats of an order that failed, expired or was cancelled */
	public async releaseOrderSeats(buyerId: ObjectId, seatIds: ObjectId[]): Promise<void> {
		if (!seatIds?.length) return;
		await this.eventSeatModel
			.updateMany(
				{ _id: { $in: seatIds }, heldBy: buyerId, seatStatus: SeatStatus.HELD },
				{ seatStatus: SeatStatus.AVAILABLE, $unset: { heldBy: 1, heldUntil: 1 } },
			)
			.exec();
	}

	/** SOLD seats of a refunded order go back on sale; only seats this order sold match, so a retry changes nothing */
	public async releaseSoldSeats(orderId: ObjectId, seatIds: ObjectId[]): Promise<number> {
		if (!seatIds?.length) return 0;
		const result = await this.eventSeatModel
			.updateMany(
				{ _id: { $in: seatIds }, orderId: orderId, seatStatus: SeatStatus.SOLD },
				{ seatStatus: SeatStatus.AVAILABLE, $unset: { orderId: 1, heldBy: 1, heldUntil: 1 } },
			)
			.exec();
		return result.modifiedCount;
	}

	private async releaseClaimed(memberId: ObjectId, claimed: EventSeat[]): Promise<void> {
		await this.releaseOrderSeats(
			memberId,
			claimed.map((seat) => seat._id),
		);
	}

	private async assertEventOpenForSeats(eventId: ObjectId): Promise<void> {
		const event = await this.eventModel
			.findOne({ _id: eventId, eventStatus: publicEventStatus, seatingType: SeatingType.RESERVED, startAt: { $gt: new Date() } })
			.lean()
			.exec();
		const organizerActive =
			event && (await this.memberModel.exists({ _id: event.organizerId, memberStatus: MemberStatus.ACTIVE }));
		if (!organizerActive) throw new BadRequestException(Message.SEATS_NOT_AVAILABLE_FOR_EVENT);
	}
}
