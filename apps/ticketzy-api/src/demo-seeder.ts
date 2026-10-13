/**
 * Creates the demo data by walking the plan of libs/demo-plan.ts and calling the real services (DECISIONS #108): events go
 * through create, submit and approve, every order through holdSeats, createCheckout and payOrder, refunds, check-ins,
 * cancellations and payouts through their services, so seat counters, sold counters, commission and audit entries are what the
 * API itself would have produced. Dates are then moved back in time with direct updates, because the API only works "now".
 * Console output is counts and progress only.
 */
import * as bcrypt from 'bcryptjs';
import { INestApplicationContext } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { BatchService } from '../../ticketzy-batch/src/batch.service';
import { getEventRank, getOrganizerRank } from '../../ticketzy-batch/src/lib/rank';
import { EventService } from './components/event/event.service';
import { VenueService } from './components/venue/venue.service';
import { TicketTypeService } from './components/ticket-type/ticket-type.service';
import { OrganizerService } from './components/organizer/organizer.service';
import { SeatService } from './components/seat/seat.service';
import { OrderService } from './components/order/order.service';
import { RefundService } from './components/refund/refund.service';
import { TicketService } from './components/ticket/ticket.service';
import { PayoutService } from './components/payout/payout.service';
import { ConversationService } from './components/conversation/conversation.service';
import { NotificationService } from './components/notification/notification.service';
import { MemberService } from './components/member/member.service';
import { FollowService } from './components/follow/follow.service';
import { CommentService } from './components/comment/comment.service';
import { ViewService } from './components/view/view.service';
import { getCommissionRate } from './libs/commission';
import {
	DEMO_BUYERS,
	DEMO_COMMENTS,
	DEMO_ORGANIZERS,
	DEMO_REPLIES,
	DEMO_VENUES,
	DemoLocale,
	OrganizerKey,
	VenueKey,
	demoImage,
} from './libs/demo-data';
import { DemoPasswordKey } from './libs/demo-guards';
import {
	PlanEvent,
	PlanSeat,
	buildDemoPlan,
	buildSeatRuns,
	createRng,
	pickBuyers,
	planQuantityOrders,
	randomInt,
	shuffled,
	takeRunOfSize,
	takeSeatRuns,
	Rng,
} from './libs/demo-plan';
import { getPayoutDate } from './libs/payout';
import { AuditAction } from './libs/enums/audit-log.enum';
import { CommentGroup } from './libs/enums/comment.enum';
import { EventStatus, SeatStatus, SeatingType } from './libs/enums/event.enum';
import { LikeGroup } from './libs/enums/like.enum';
import { MemberAuthType, MemberStatus, MemberType } from './libs/enums/member.enum';
import { NotificationGroup, NotificationStatus, NotificationType } from './libs/enums/notification.enum';
import { OrderStatus, PaymentSimulation, TicketCurrency, TicketStatus } from './libs/enums/ticket.enum';
import { ViewGroup } from './libs/enums/view.enum';
import { DemoRecordType } from './libs/demo-manifest';
import { DemoMongoModels } from './demo-snapshot';
import { getDemoModels } from './demo-app';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REFUND_REASONS = ['Change of plans, cannot attend.', 'Two of us are sick.', 'Bought the wrong date.', 'Found a cheaper option.'];

const hashString = (text: string): number => [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);
const at = (rng: Rng, from: number, to: number): Date => new Date(from + Math.floor(rng() * Math.max(1, to - from)));

interface Placed {
	orderId: any;
	buyerId: any;
	outcome: 'paid' | 'cancelled' | 'failed';
	toRefund: boolean;
	protectedOrder: boolean;
	checkIn: boolean;
	at?: Date;
}

interface Built {
	plan: PlanEvent;
	event: any;
	ticketTypes: any[];
}

export class DemoSeeder {
	private readonly models: DemoMongoModels;
	private readonly now = new Date();
	private readonly runId = this.now.getTime().toString(36);
	private readonly log: (line: string) => void;

	private admin: any;
	private organizers = {} as Record<OrganizerKey, any>;
	private buyers: any[] = [];
	private venues = {} as Record<VenueKey, any>;
	private built = new Map<string, Built>();
	/** every event of the plan by key, whatever its status */
	private created = new Map<string, any>();
	/** when an organizer's commission last dropped to a lower tier: later orders must be sold after it */
	private tierFloor = new Map<OrganizerKey, number>();

	private readonly eventService: EventService;
	private readonly ticketTypeService: TicketTypeService;
	private readonly seatService: SeatService;
	private readonly orderService: OrderService;
	private readonly refundService: RefundService;
	private readonly ticketService: TicketService;
	private readonly organizerService: OrganizerService;
	private readonly venueService: VenueService;
	private readonly payoutService: PayoutService;
	private readonly conversationService: ConversationService;
	private readonly notificationService: NotificationService;
	private readonly memberService: MemberService;
	private readonly followService: FollowService;
	private readonly commentService: CommentService;
	private readonly viewService: ViewService;
	private readonly batch: BatchService;

	constructor(app: INestApplicationContext, log: (line: string) => void = console.log) {
		const get = <T>(type: new (...args: any[]) => T): T => app.get(type, { strict: false });
		this.log = log;
		this.models = getDemoModels(app);
		this.eventService = get(EventService);
		this.ticketTypeService = get(TicketTypeService);
		this.seatService = get(SeatService);
		this.orderService = get(OrderService);
		this.refundService = get(RefundService);
		this.ticketService = get(TicketService);
		this.organizerService = get(OrganizerService);
		this.venueService = get(VenueService);
		this.payoutService = get(PayoutService);
		this.conversationService = get(ConversationService);
		this.notificationService = get(NotificationService);
		this.memberService = get(MemberService);
		this.followService = get(FollowService);
		this.commentService = get(CommentService);
		this.viewService = get(ViewService);
		// the batch jobs are plain classes over models: the seed uses the real "end finished events" job, limited to its own events
		this.batch = new BatchService(this.models.event, this.models.member, this.models.order, this.models.ticketType, this.models.eventSeat);
		// a seeded conversation sends many messages in a second; the limit is per process and does not apply to this one
		(this.conversationService as any).sendLimiter = { tryConsume: () => true };
	}

	public async run(passwords: Record<DemoPasswordKey, string>): Promise<void> {
		this.admin = await this.models.member.findOne({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE }).sort({ createdAt: 1 }).lean().exec();
		if (!this.admin) throw new Error('No admin exists yet. Run `npm run seed` first (it needs ADMIN_EMAIL and ADMIN_PASSWORD).');

		await this.createAccounts(passwords);
		await this.createVenues();
		const plan = buildDemoPlan(this.now);
		let done = 0;
		for (const event of plan.events) {
			await this.processEvent(event);
			done++;
			if (done % 8 === 0 || done === plan.events.length) this.log(`  events ${done}/${plan.events.length}`);
		}
		await this.payouts(plan.events);
		await this.followAndLike();
		await this.chats(plan.events);
		await this.extraNotifications(plan.events);
		// the moderation check that submit starts runs in the background; let it finish before its trail is dated
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await this.dateTheAdminTrail(plan.events);
		await this.writeRanks();
		await this.markOldNotificationsRead();
	}

	/** MANIFEST: a root document is written here before it is created, so a run that dies half way is still cleaned up by reset */

	private async track(type: DemoRecordType, ids: unknown[]): Promise<void> {
		await this.models.manifest.insertMany(ids.map((recordId) => ({ runId: this.runId, recordType: type, recordId })), { ordered: false });
	}

	private async setTimes(model: Model<any>, filter: any, createdAt: Date, extra: Record<string, Date> = {}): Promise<void> {
		await model.updateMany(filter, { $set: { createdAt, updatedAt: createdAt, ...extra } }, { timestamps: false } as any).exec();
	}

	/** gives every matching document a random creation time between `from` and `to` (one update, the database picks the numbers) */
	private async spreadTimes(model: Model<any>, filter: any, from: Date, to: Date): Promise<void> {
		const fromMs = from.getTime();
		const span = Math.max(1, to.getTime() - fromMs);
		const when = { $toDate: { $add: [fromMs, { $multiply: [{ $rand: {} }, span] }] } };
		await model.updateMany(filter, [{ $set: { createdAt: when } }, { $set: { updatedAt: '$createdAt' } }] as any, { timestamps: false } as any).exec();
	}

	private async inChunks<T>(items: T[], size: number, work: (item: T) => Promise<unknown>): Promise<void> {
		for (let start = 0; start < items.length; start += size) await Promise.all(items.slice(start, start + size).map(work));
	}

	/** ACCOUNTS */

	private async createAccounts(passwords: Record<DemoPasswordKey, string>): Promise<void> {
		const hash = async (value: string) => await bcrypt.hash(value, await bcrypt.genSalt());
		const hashes = {
			buyer: await hash(passwords.buyer),
			organizer: await hash(passwords.organizer),
			pending: await hash(passwords.pending),
			rejected: await hash(passwords.rejected),
		};
		const joined = new Date(this.now.getTime() - 400 * DAY);

		for (const account of DEMO_ORGANIZERS) {
			const _id = new Types.ObjectId();
			await this.track('Member', [_id]);
			await this.models.member.create({
				_id,
				memberEmail: account.email,
				memberPassword: account.key === 'pending' ? hashes.pending : account.key === 'rejected' ? hashes.rejected : hashes.organizer,
				memberType: MemberType.ORGANIZER,
				memberStatus: MemberStatus.PENDING, // organizers sign up as PENDING; the admin action below brings them to their final status
				memberAuthType: MemberAuthType.EMAIL,
				memberNick: account.nick,
				memberFullName: account.fullName,
				memberAddress: account.address,
				memberDesc: account.desc,
				memberImage: demoImage(`organizer-${account.key}`, 300, 300),
			});
			if (account.outcome === 'verify') await this.organizerService.verifyOrganizerByAdmin(this.admin._id, _id as any);
			if (account.outcome === 'reject') await this.organizerService.rejectOrganizerByAdmin(this.admin._id, { memberId: _id, reason: account.rejectReason } as any);
			this.organizers[account.key] = await this.models.member.findById(_id).lean().exec();
		}

		const ids = DEMO_BUYERS.map(() => new Types.ObjectId());
		await this.track('Member', ids);
		await this.models.member.insertMany(
			DEMO_BUYERS.map((buyer, index) => ({
				_id: ids[index],
				memberEmail: buyer.email,
				memberPassword: hashes.buyer,
				memberType: MemberType.USER,
				memberStatus: MemberStatus.ACTIVE,
				memberAuthType: MemberAuthType.EMAIL,
				memberNick: buyer.nick,
				memberFullName: buyer.fullName,
				memberImage: demoImage(`buyer-${buyer.nick}`, 300, 300),
			})),
		);
		this.buyers = await this.models.member.find({ _id: { $in: ids } }).lean().exec();
		this.buyers.sort((a, b) => ids.findIndex((id) => id.equals(a._id)) - ids.findIndex((id) => id.equals(b._id)));

		const all = [...ids, ...Object.values(this.organizers).map((member: any) => member._id)];
		await this.setTimes(this.models.member, { _id: { $in: all } }, joined);
		this.log(`  accounts: ${DEMO_ORGANIZERS.length} organizers, ${DEMO_BUYERS.length} buyers`);
	}

	private async createVenues(): Promise<void> {
		for (const venue of DEMO_VENUES) {
			const _id = new Types.ObjectId();
			await this.track('Venue', [_id]);
			this.venues[venue.key] = await this.venueService.createVenue({
				_id,
				venueName: venue.name,
				venueType: venue.type,
				venueCity: venue.city,
				venueAddress: venue.address,
				venueCoordinates: venue.coordinates,
				venueTimezone: 'Asia/Seoul',
				venueLayout: { sections: venue.sections },
				venueImages: [demoImage(`venue-${venue.key}`), demoImage(`venue-${venue.key}-b`)],
				memberId: this.organizers[venue.owner]._id,
			} as any);
			await this.setTimes(this.models.venue, { _id }, new Date(this.now.getTime() - 395 * DAY));
		}
		this.log(`  venues: ${DEMO_VENUES.length}`);
	}

	/** ONE EVENT */

	private async processEvent(plan: PlanEvent): Promise<void> {
		const organizer = this.organizers[plan.organizer];
		const shift = plan.shiftDays * DAY;
		const eventId = new Types.ObjectId();
		await this.track('Event', [eventId]);

		const event: any = await this.eventService.createEvent({
			_id: eventId,
			eventCategory: plan.category,
			seatingType: plan.seating,
			eventTitle: plan.title,
			eventDesc: plan.desc,
			eventTranslations: plan.translations,
			eventImages: plan.images,
			venueId: this.venues[plan.venue]._id,
			startAt: new Date(plan.startAt.getTime() + shift),
			endAt: new Date(plan.endAt.getTime() + shift),
			saleStartAt: plan.saleStartAt,
			organizerId: organizer._id,
		} as any);

		this.created.set(plan.key, event);
		const ticketTypes: any[] = [];
		for (const type of plan.ticketTypes) {
			ticketTypes.push(
				await this.ticketTypeService.createTicketType(organizer._id, MemberType.ORGANIZER, {
					eventId,
					ticketTypeName: type.name,
					ticketPrice: type.price,
					ticketCurrency: TicketCurrency.KRW,
					tierKey: type.tierKey,
					totalQuantity: type.quantity,
					maxPerOrder: type.maxPerOrder,
				} as any),
			);
		}
		if (plan.status === EventStatus.DRAFT) return;

		await this.eventService.submitEventForApproval(organizer._id, eventId as any);
		if (plan.status === EventStatus.PENDING) return;
		if (plan.status === EventStatus.REJECTED) {
			await this.eventService.rejectEventByAdmin(this.admin._id, { eventId, reason: plan.reason } as any);
			return;
		}
		await this.eventService.approveEventByAdmin(this.admin._id, eventId as any); // RESERVED events get their seats here

		const built: Built = { plan, event, ticketTypes: await this.models.ticketType.find({ eventId }).lean().exec() };
		this.built.set(plan.key, built);
		const placed = plan.noSales ? [] : await this.sell(built);
		await this.social(built);
		if (plan.status === EventStatus.CANCELLED) await this.cancel(built, placed);
		if (plan.status === EventStatus.ENDED) await this.finish(built, placed);
	}

	/** SALES */

	private salesWindow(plan: PlanEvent): [number, number] {
		const now = this.now.getTime();
		let from = plan.approvedAt.getTime() + HOUR;
		const floor = this.tierFloor.get(plan.organizer);
		if (floor) from = Math.max(from, floor + 10 * MINUTE);
		let to = plan.status === EventStatus.CANCELLED ? plan.decidedAt.getTime() - HOUR : plan.shiftDays ? plan.startAt.getTime() - 2 * HOUR : now;
		to = Math.min(to, now - 5 * MINUTE);
		if (from >= to) from = to - DAY;
		return [from, to];
	}

	private async sell(built: Built): Promise<Placed[]> {
		const { plan, event, ticketTypes } = built;
		const rng = createRng(hashString(plan.key));
		const buyerCount = this.buyers.length;
		const maxPerOrder = Math.min(...ticketTypes.map((type) => type.maxPerOrder));
		const stockTotal = ticketTypes.reduce((sum, type) => sum + type.totalQuantity, 0);
		const forcedPaid = plan.buyerOrders.filter((order) => order.outcome === 'paid' || order.outcome === 'refunded').reduce((sum, order) => sum + order.quantity, 0);
		const target = plan.fill ? Math.ceil(plan.fill * stockTotal) - forcedPaid : undefined;
		const limit = target !== undefined ? { tickets: target } : { orders: randomInt(rng, plan.orders[0], plan.orders[1]) };

		type Spec = { buyerIndex: number; seatIds?: string[]; items?: { ticketTypeId: any; quantity: number }[]; forced?: Placed['outcome'] | 'refunded'; checkIn?: boolean };
		const specs: Spec[] = [];

		if (plan.seating === SeatingType.RESERVED) {
			const seats: any[] = await this.models.eventSeat.find({ eventId: event._id, seatStatus: SeatStatus.AVAILABLE }).select('sectionKey row number').lean().exec();
			const planSeats: PlanSeat[] = seats.map((seat) => ({ id: String(seat._id), sectionKey: seat.sectionKey, row: seat.row, number: seat.number }));
			const runs = buildSeatRuns(planSeats, maxPerOrder, rng);
			for (const forced of plan.buyerOrders) {
				specs.push({ buyerIndex: 0, seatIds: takeRunOfSize(runs, forced.quantity), forced: forced.outcome, checkIn: forced.checkIn });
			}
			for (const seatIds of takeSeatRuns(runs, limit)) specs.push({ buyerIndex: -1, seatIds });
		} else {
			const stock = ticketTypes.map((type) => ({ id: String(type._id), remaining: type.totalQuantity, maxPerOrder: type.maxPerOrder }));
			for (const forced of plan.buyerOrders) {
				if (forced.outcome === 'paid' || forced.outcome === 'refunded') stock[0].remaining -= forced.quantity;
				specs.push({ buyerIndex: 0, items: [{ ticketTypeId: ticketTypes[0]._id, quantity: forced.quantity }], forced: forced.outcome, checkIn: forced.checkIn });
			}
			for (const order of planQuantityOrders(stock, limit, rng)) {
				specs.push({ buyerIndex: -1, items: [{ ticketTypeId: new Types.ObjectId(order.ticketTypeId), quantity: order.quantity }] });
			}
		}

		const regular = specs.filter((spec) => spec.buyerIndex < 0);
		const buyers = pickBuyers(regular.length, buyerCount, rng);
		regular.forEach((spec, index) => (spec.buyerIndex = buyers[index]));

		const [from, to] = this.salesWindow(plan);
		const times = specs.map(() => at(rng, from, to)).sort((a, b) => a.getTime() - b.getTime());
		const placed: Placed[] = [];
		for (const [index, spec] of shuffled(rng, specs).entries()) {
			const buyer = this.buyers[spec.buyerIndex];
			const result = await this.placeOrder(buyer, event, spec, plan);
			result.at = times[index];
			result.checkIn = !!spec.checkIn;
			result.toRefund = spec.forced === 'refunded';
			result.protectedOrder = spec.buyerIndex === 0 && (spec.forced === 'paid' || !!spec.checkIn);
			await this.dateOrder(result, rng);
			placed.push(result);
		}

		if (!plan.fill && plan.status !== EventStatus.CANCELLED) await this.refunds(built, placed, rng);
		return placed;
	}

	/** hold, checkout and pay (or cancel or fail) exactly as the API's three calls do */
	private async placeOrder(buyer: any, event: any, spec: { seatIds?: string[]; items?: any[]; forced?: string }, plan: PlanEvent): Promise<Placed> {
		if (spec.seatIds) await this.seatService.holdSeats(buyer._id, event._id, spec.seatIds as any);
		const order: any = await this.orderService.createCheckout(buyer._id, { eventId: event._id, seatIds: spec.seatIds, items: spec.items } as any);
		const base = { orderId: order._id, buyerId: buyer._id, toRefund: false, protectedOrder: false, checkIn: false };
		if (spec.forced === 'cancelled') {
			await this.orderService.cancelPendingOrder(buyer._id, order._id);
			return { ...base, outcome: 'cancelled' };
		}
		if (spec.forced === 'failed') {
			const failed: any = await this.orderService.payOrder(buyer._id, order._id, PaymentSimulation.FAILURE);
			if (failed.orderStatus !== OrderStatus.FAILED) throw new Error(`Order of ${plan.key} did not fail as planned`);
			return { ...base, outcome: 'failed' };
		}
		const paid: any = await this.orderService.payOrder(buyer._id, order._id, PaymentSimulation.SUCCESS);
		if (paid.orderStatus !== OrderStatus.PAID) throw new Error(`Order of ${plan.key} was not paid`);
		return { ...base, outcome: 'paid' };
	}

	/** the order, its tickets, payment and notifications get the time of the sale */
	private async dateOrder(placed: Placed, rng: Rng): Promise<void> {
		const paidAt = placed.at;
		const createdAt = new Date(paidAt.getTime() - randomInt(rng, 1, 9) * MINUTE);
		const filter = { orderId: placed.orderId };
		await Promise.all([
			this.models.order.updateOne({ _id: placed.orderId }, { $set: { createdAt, updatedAt: paidAt, ...(placed.outcome === 'paid' ? { paidAt } : {}) } }, { timestamps: false } as any).exec(),
			this.setTimes(this.models.ticket, filter, paidAt),
			this.setTimes(this.models.payment, filter, paidAt),
			this.setTimes(this.models.notification, filter, paidAt),
		]);
	}

	/** REFUNDS: buyers ask for some, an admin does one or two; all while the event is still ahead, as the refund policy needs */

	private async refunds(built: Built, placed: Placed[], rng: Rng): Promise<void> {
		const { plan } = built;
		const paid = placed.filter((item) => item.outcome === 'paid');
		const free = paid.filter((item) => !item.protectedOrder);
		let chosen: Placed[];
		if (plan.refundAll) chosen = free;
		else {
			const count = Math.max(paid.length >= 5 ? 1 : 0, Math.round(paid.length * plan.refundShare));
			chosen = shuffled(rng, free.filter((item) => !item.toRefund)).slice(0, count);
		}
		const byBuyer = paid.filter((item) => item.toRefund);
		const byAdmin = plan.refundAll ? [] : shuffled(rng, free.filter((item) => !chosen.includes(item) && !item.toRefund)).slice(0, plan.adminRefunds);

		const limit = Math.min(this.now.getTime() - 10 * MINUTE, plan.shiftDays ? plan.startAt.getTime() - DAY : Infinity);
		const when = (item: Placed) => new Date(Math.min(limit, item.at.getTime() + randomInt(rng, 2, 120) * HOUR));
		for (const item of [...byBuyer, ...chosen]) {
			await this.refundService.requestRefund(item.buyerId, item.orderId, REFUND_REASONS[randomInt(rng, 0, REFUND_REASONS.length - 1)]);
			await this.dateRefund(item.orderId, when(item));
		}
		for (const item of byAdmin) {
			await this.refundService.refundOrderByAdmin(this.admin._id, { orderId: item.orderId, reason: 'Refunded after a support request.' } as any);
			await this.dateRefund(item.orderId, when(item));
		}
	}

	private async dateRefund(orderId: any, when: Date): Promise<void> {
		await Promise.all([
			this.models.refund.updateOne({ orderId }, { $set: { requestedAt: when, completedAt: new Date(when.getTime() + MINUTE), createdAt: when, updatedAt: when } }, { timestamps: false } as any).exec(),
			this.models.order.updateOne({ _id: orderId }, { $set: { refundedAt: when } }, { timestamps: false } as any).exec(),
			this.setTimes(this.models.notification, { orderId, notificationType: { $in: [NotificationType.REFUND_COMPLETED, NotificationType.ORDER_REFUNDED] } }, when),
			this.setTimes(this.models.auditLog, { targetId: orderId }, when),
		]);
	}

	/** SOCIAL: views, likes and comments of a public event, spread over the time it was on sale */

	private async social(built: Built): Promise<void> {
		const { plan, event } = built;
		const organizer = this.organizers[plan.organizer];
		const rng = createRng(hashString(`social-${plan.key}`));
		const viewers = shuffled(rng, this.buyers).slice(0, Math.min(this.buyers.length, 3 + Math.round(plan.popularity * 40)));
		const from = plan.approvedAt;
		const to = new Date(Math.min(this.now.getTime() - HOUR, plan.shiftDays ? plan.startAt.getTime() - HOUR : this.now.getTime()));

		let newViews = 0;
		await this.inChunks(viewers, 10, async (viewer) => {
			const created = await this.viewService.recordView({ memberId: viewer._id, viewRefId: event._id, viewGroup: ViewGroup.EVENT } as any);
			if (created) newViews++;
		});
		await this.models.event.updateOne({ _id: event._id }, { $inc: { eventViews: newViews } }, { timestamps: false } as any).exec();

		const likers = viewers.slice(0, Math.round(viewers.length * 0.35 * (0.5 + plan.popularity)));
		await this.inChunks(likers, 10, (liker) => this.eventService.likeTargetEvent(liker._id, event._id));

		const commenters = viewers.slice(0, Math.max(1, Math.round(plan.popularity * 3)));
		for (const commenter of commenters) {
			const locale = this.localeOf(commenter);
			const text = DEMO_COMMENTS[randomInt(rng, 0, DEMO_COMMENTS.length - 1)][locale];
			await this.commentService.createComment(commenter._id, { commentGroup: CommentGroup.EVENT, commentContent: text, commentRefId: event._id } as any);
			// comments have no reply field, so the organizer answers with a comment that names the author
			if (rng() < 0.5) {
				await this.commentService.createComment(organizer._id, { commentGroup: CommentGroup.EVENT, commentContent: `@${commenter.memberNick} ${DEMO_REPLIES[locale]}`, commentRefId: event._id } as any);
			}
		}

		const ids = { $in: [event._id] };
		await this.spreadTimes(this.models.view, { viewGroup: ViewGroup.EVENT, viewRefId: ids }, from, to);
		await this.spreadTimes(this.models.like, { likeGroup: LikeGroup.EVENT, likeRefId: ids }, from, to);
		await this.spreadTimes(this.models.comment, { commentRefId: ids }, from, to);
		await this.spreadTimes(this.models.notification, { eventId: event._id, notificationType: { $in: [NotificationType.LIKE, NotificationType.COMMENT] } }, from, to);
	}

	private localeOf(buyer: any): DemoLocale {
		const index = this.buyers.findIndex((item) => item._id.equals(buyer._id));
		return index <= 14 ? 'ko' : index <= 26 ? 'en' : index <= 38 ? 'ru' : 'uz';
	}

	/** CANCELLED AND ENDED EVENTS */

	private async cancel(built: Built, placed: Placed[]): Promise<void> {
		const { plan, event } = built;
		const orderIds = placed.filter((item) => item.outcome === 'paid').map((item) => item.orderId);
		await this.eventService.cancelEventByAdmin(this.admin._id, { eventId: event._id, reason: plan.reason } as any);
		const when = new Date(plan.decidedAt.getTime() + 3 * MINUTE);
		await Promise.all([
			this.models.refund.updateMany({ eventId: event._id }, { $set: { requestedAt: when, completedAt: new Date(when.getTime() + MINUTE), createdAt: when, updatedAt: when } }, { timestamps: false } as any).exec(),
			this.models.order.updateMany({ _id: { $in: orderIds }, orderStatus: OrderStatus.REFUNDED }, { $set: { refundedAt: when } }, { timestamps: false } as any).exec(),
			this.setTimes(this.models.notification, { orderId: { $in: orderIds }, notificationType: { $in: [NotificationType.REFUND_COMPLETED, NotificationType.ORDER_REFUNDED] } }, when),
		]);
		const left = await this.models.order.countDocuments({ eventId: event._id, orderStatus: OrderStatus.PAID }).exec();
		if (left) throw new Error(`${left} order(s) of the cancelled event ${plan.key} were not refunded`);
	}

	private async finish(built: Built, placed: Placed[]): Promise<void> {
		const { plan, event } = built;
		const rng = createRng(hashString(`gate-${plan.key}`));
		const organizer = this.organizers[plan.organizer];

		// the gate scans tickets while the event is still APPROVED (the check-in refuses anything else)
		const forced = new Set(placed.filter((item) => item.checkIn).map((item) => String(item.orderId)));
		const tickets: any[] = await this.models.ticket.find({ eventId: event._id, ticketStatus: TicketStatus.VALID }).lean().exec();
		const scanned = tickets.filter((ticket) => forced.has(String(ticket.orderId)) || rng() < plan.checkInShare);
		const start = plan.startAt.getTime();
		await this.inChunks(scanned, 10, async (ticket) => {
			await this.ticketService.checkInTicket(organizer._id, MemberType.ORGANIZER, ticket.qrToken, event._id);
			const when = new Date(start - 40 * MINUTE + Math.floor(rng() * 70 * MINUTE));
			await this.models.ticket.updateOne({ _id: ticket._id }, { $set: { checkedInAt: when, updatedAt: when } }, { timestamps: false } as any).exec();
		});

		// the event was created ahead of its date; now its real, past dates are written and the real job ends it
		await this.models.event.updateOne({ _id: event._id }, { $set: { startAt: plan.startAt, endAt: plan.endAt } }, { timestamps: false } as any).exec();
		const before: any = await this.models.member.findById(organizer._id).select('completedEvents commissionOverride').lean().exec();
		await this.batch.batchEndEvents([event._id]);
		const ended: any = await this.models.event.findById(event._id).select('eventStatus').lean().exec();
		if (ended.eventStatus !== EventStatus.ENDED) throw new Error(`Event ${plan.key} was not ended`);
		const after: any = await this.models.member.findById(organizer._id).select('completedEvents commissionOverride').lean().exec();
		if (getCommissionRate(after) < getCommissionRate(before)) this.tierFloor.set(plan.organizer, plan.endAt.getTime());
	}

	/** PAYOUTS: the real mark-as-paid for the events the plan wants paid out, then dated three days after the payout date */

	private async payouts(events: PlanEvent[]): Promise<void> {
		let paid = 0;
		for (const plan of events.filter((item) => item.payout === 'paid')) {
			const built = this.built.get(plan.key);
			await this.payoutService.markPayoutPaidByAdmin(this.admin._id, { eventId: built.event._id, note: 'Bank transfer' } as any);
			const rng = createRng(hashString(`payout-${plan.key}`));
			const when = new Date(Math.min(this.now.getTime() - HOUR, getPayoutDate(plan.endAt, 'Asia/Seoul').getTime() + randomInt(rng, 1, 40) * HOUR));
			await Promise.all([
				this.setTimes(this.models.payout, { eventId: built.event._id }, when, { paidAt: when }),
				this.setTimes(this.models.auditLog, { targetId: built.event._id, action: AuditAction.PAYOUT_MARKED_PAID }, when),
				this.setTimes(this.models.notification, { eventId: built.event._id, notificationType: NotificationType.PAYOUT_PAID }, when),
			]);
			paid++;
		}
		this.log(`  payouts marked as paid: ${paid}`);
	}

	/** ORGANIZER SOCIAL: profile views, likes and follows of the active organizers */

	private async followAndLike(): Promise<void> {
		const active = DEMO_ORGANIZERS.filter((item) => item.outcome === 'verify').map((item) => this.organizers[item.key]);
		const rng = createRng(77);
		for (const [index, buyer] of this.buyers.entries()) {
			for (const organizer of shuffled(rng, active).slice(0, 1 + (index % 4))) {
				await this.memberService.getMember(buyer._id, organizer._id); // records the view and counts it
				if (rng() < 0.6) await this.followService.subscribe(buyer._id, organizer._id);
				if (rng() < 0.35) await this.memberService.likeTargetMember(buyer._id, organizer._id);
			}
		}
		const ids = active.map((organizer) => organizer._id);
		const from = new Date(this.now.getTime() - 380 * DAY);
		const to = new Date(this.now.getTime() - HOUR);
		await this.spreadTimes(this.models.view, { viewGroup: ViewGroup.MEMBER, viewRefId: { $in: ids } }, from, to);
		await this.spreadTimes(this.models.like, { likeGroup: LikeGroup.MEMBER, likeRefId: { $in: ids } }, from, to);
		await this.spreadTimes(this.models.follow, { followingId: { $in: ids } }, from, to);
	}

	/** CHATS between organizers and the admin: approval, a rejection with its reason, a payout question, event reviews */

	private async chats(events: PlanEvent[]): Promise<void> {
		const find = (organizer: OrganizerKey, base: string, status: EventStatus) =>
			({ event: this.created.get(events.find((item) => item.organizer === organizer && item.baseId === base && item.status === status)?.key) });
		const admin = this.admin;
		const day = (days: number) => new Date(this.now.getTime() - days * DAY);
		const talk = async (conversation: any, lines: [any, string, Date][], adminReads: boolean, organizerReads: boolean) => {
			for (const [sender, body, when] of lines) {
				const message: any = await this.conversationService.sendMessage(sender, conversation._id, body);
				await this.models.message.updateOne({ _id: message._id }, { $set: { createdAt: when } }, { timestamps: false } as any).exec();
			}
			const last = lines[lines.length - 1][2];
			await this.models.conversation.updateOne({ _id: conversation._id }, { $set: { createdAt: lines[0][2], updatedAt: last, lastMessageAt: last } }, { timestamps: false } as any).exec();
			await this.setTimes(this.models.notification, { conversationId: conversation._id }, last);
			if (adminReads) await this.conversationService.markConversationRead(admin, conversation._id);
			if (organizerReads) await this.conversationService.markConversationRead(this.organizers.hanbit, conversation._id);
			await this.models.message.updateMany({ conversationId: conversation._id, readAt: { $ne: null } }, [{ $set: { readAt: { $add: ['$createdAt', HOUR] } } }] as any).exec();
		};
		const hanbit = this.organizers.hanbit;

		// the rich organizer: approval, how reviews and payouts work, then a question about a payout that is due
		const support: any = await this.conversationService.startConversation(hanbit);
		await talk(
			support,
			[
				[hanbit, 'Hello! Our organizer account was approved today. How does the review of an event work?', day(399)],
				[admin, 'Welcome to Ticketzy! Every event is reviewed before it goes on sale: we check the dates, the venue slot and the description, usually within two working days.', new Date(day(399).getTime() + 3 * HOUR)],
				[hanbit, 'Thanks. And when do we get the money for an event?', new Date(day(399).getTime() + 5 * HOUR)],
				[admin, 'The payout is due three days after the event ends, in the time zone of the venue. An admin then marks it as paid and you get a notification.', new Date(day(398).getTime() + 2 * HOUR)],
				[hanbit, 'One of our shows ended last week and its payout is shown as due, but it is not paid yet. Could you check it?', day(3)],
				[admin, 'Thanks for the reminder. The payout is due and will be marked as paid in the next round. We will write here when it is done.', new Date(day(3).getTime() + 4 * HOUR)],
			],
			true,
			false,
		);

		// an event that waits for the review, and an event that was rejected
		const jazz = find('hanbit', 'jazz', EventStatus.PENDING)?.event;
		if (jazz) {
			const conversation: any = await this.conversationService.startConversation(hanbit, jazz._id);
			await talk(
				conversation,
				[
					[hanbit, 'We submitted Late Night Jazz Sessions for review. Is anything missing?', day(4)],
					[admin, 'Looking at it now. Could you confirm the guest players so we can check the description?', new Date(day(4).getTime() + 2 * HOUR)],
					[hanbit, 'Confirmed: the trio plus two guest players. I will add their names to the description today.', day(3)],
				],
				false,
				false,
			);
		}
		const charity = find('hanbit', 'charity', EventStatus.REJECTED)?.event;
		if (charity) {
			const conversation: any = await this.conversationService.startConversation(hanbit, charity._id);
			await talk(
				conversation,
				[
					[hanbit, 'We added the confirmed players and the charity partner to the Charity Legends Match. Can you review it again?', day(5)],
					[admin, 'Thank you. Please submit the event again and we will look at it first thing tomorrow.', new Date(day(5).getTime() + 3 * HOUR)],
				],
				true,
				true,
			);
		}

		// a pending organizer who waits, and a rejected one who was told why and answered
		const pending = this.organizers.pending;
		const waiting: any = await this.conversationService.startConversation(pending);
		await talk(waiting, [[pending, 'Hi, I applied as an organizer last week. How long does the approval take?', day(2)]], false, false);

		const rejected = this.organizers.rejected;
		const reply: any = await this.conversationService.startConversationWithOrganizer(admin, rejected._id);
		await talk(
			reply,
			[
				[admin, `Your organizer application was rejected: ${rejected.rejectReason}`, day(19)],
				[rejected, 'Thank you for telling me. I will send the registration certificate tomorrow.', new Date(day(19).getTime() + 6 * HOUR)],
			],
			true,
			false,
		);
		await this.models.conversation.updateOne({ _id: reply._id }, { $set: { unreadForOrganizer: 0 } }, { timestamps: false } as any).exec();
		await this.models.message.updateMany({ conversationId: reply._id, senderId: admin._id }, { $set: { readAt: new Date(day(19).getTime() + 5 * HOUR) } }).exec();
		this.log('  chats: 5 conversations');
	}

	private async extraNotifications(events: PlanEvent[]): Promise<void> {
		const next = events.filter((item) => item.status === EventStatus.APPROVED && item.buyerOrders.some((order) => order.outcome === 'paid')).slice(0, 3);
		for (const plan of next) {
			const built = this.built.get(plan.key);
			await this.notificationService.createNotification({
				notificationType: NotificationType.EVENT_REMINDER,
				notificationGroup: NotificationGroup.EVENT,
				notificationTitle: 'Your event is coming up',
				notificationDesc: plan.title,
				authorId: this.admin._id,
				receiverId: this.buyers[0]._id,
				eventId: built.event._id,
			} as any);
		}
	}

	/** DATES OF THE ADMIN TRAIL: audit entries and notifications the admin flows wrote "now" are moved to when they would have happened */

	private async dateTheAdminTrail(events: PlanEvent[]): Promise<void> {
		for (const plan of events) {
			const eventId = this.created.get(plan.key)?._id;
			if (!eventId) continue;
			const trail: [AuditAction, NotificationType | null, Date][] = [
				[AuditAction.EVENT_APPROVED, NotificationType.EVENT_APPROVED, plan.approvedAt],
				[AuditAction.EVENT_REJECTED, NotificationType.EVENT_REJECTED, plan.decidedAt ?? plan.approvedAt],
				[AuditAction.EVENT_CANCELLED, NotificationType.EVENT_CANCELLED, plan.decidedAt ?? plan.approvedAt],
				[AuditAction.EVENT_REFUNDS_PROCESSED, null, new Date((plan.decidedAt ?? plan.approvedAt).getTime() + 5 * MINUTE)],
				[AuditAction.EVENT_MODERATION_RUN, null, new Date(plan.createdAt.getTime() + 5 * MINUTE)],
			];
			for (const [action, notification, when] of trail) {
				await this.setTimes(this.models.auditLog, { targetId: eventId, action }, when);
				if (notification) await this.setTimes(this.models.notification, { eventId, notificationType: notification }, when);
			}
			await this.models.event.updateOne({ _id: eventId }, { $set: { createdAt: plan.createdAt } }, { timestamps: false } as any).exec();
			await this.setTimes(this.models.ticketType, { eventId }, plan.createdAt);
		}
		for (const account of DEMO_ORGANIZERS) {
			const member = this.organizers[account.key];
			const when = new Date(this.now.getTime() - 399 * DAY);
			await this.setTimes(this.models.auditLog, { targetId: member._id }, when);
			await this.setTimes(this.models.notification, { receiverId: member._id, notificationType: { $in: [NotificationType.ORGANIZER_VERIFIED, NotificationType.ORGANIZER_REJECTED] } }, when);
		}
		// admin trail of the rejection chat: the admin opened it nineteen days ago
		await this.setTimes(this.models.auditLog, { action: AuditAction.SUPPORT_CONVERSATION_STARTED, actorId: this.admin._id, 'meta.organizerId': this.organizers.rejected._id }, new Date(this.now.getTime() - 19 * DAY));
	}

	/** RANKS: the formulas of the rank job (rank.ts), applied to the demo documents only */

	private async writeRanks(): Promise<void> {
		const events: any[] = await this.models.event.find({ _id: { $in: [...this.built.values()].map((item) => item.event._id) }, eventStatus: EventStatus.APPROVED }).lean().exec();
		for (const event of events) await this.models.event.updateOne({ _id: event._id }, { $set: { eventRank: getEventRank(event) } }, { timestamps: false } as any).exec();
		const organizers: any[] = await this.models.member.find({ _id: { $in: Object.values(this.organizers).map((member: any) => member._id) }, memberStatus: MemberStatus.ACTIVE }).lean().exec();
		for (const organizer of organizers) await this.models.member.updateOne({ _id: organizer._id }, { $set: { memberRank: getOrganizerRank(organizer) } }, { timestamps: false } as any).exec();
	}

	/** older notifications were read long ago; the recent ones stay unread so the badge shows a number */
	private async markOldNotificationsRead(): Promise<void> {
		const members = [...this.buyers, ...Object.values(this.organizers)].map((member: any) => member._id);
		await this.models.notification
			.updateMany({ receiverId: { $in: members }, createdAt: { $lt: new Date(this.now.getTime() - 3 * DAY) } }, { $set: { notificationStatus: NotificationStatus.READ } }, { timestamps: false } as any)
			.exec();
	}
}
