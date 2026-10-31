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
import { withScenario } from './libs/demo-errors';
import { getRefundRoute, getRefundRouteReason } from './libs/demo-refunds';
import { demoLogoPath } from './libs/demo-logos';
import { getTrackedIds } from './libs/demo-manifest';
import { DEMO_EMAIL_PATTERN } from './libs/demo-guards';
import { RefundPolicyType } from './libs/enums/event.enum';
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
const VENUE_TIMEZONE = 'Asia/Seoul'; // every demo venue
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
	private moderationSkipped = 0;
	private refundCounts = { buyer: 0, admin: 0, adminAfterDeadline: 0, adminByPolicy: 0 };
	/**
	 * DEMO_SEED_KEEP_LINKED (#132): demo members, venues and events that other accounts' records point at were not reset. They are
	 * reused as they are: never created again, never changed, and the plan events that match a kept event are skipped.
	 */
	private keepMode = false;
	private keptMembers = new Map<string, any>();
	private keptVenues = new Map<string, any>();
	private keptEvents: any[] = [];
	private newOrganizers = new Set<OrganizerKey>();
	private skippedEvents = new Set<string>();
	/** events not created in keep mode because a kept venue has another layout, or a kept event already holds the slot */
	private skippedByLayout = 0;
	private skippedBySlot = 0;

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
		this.commentService = get(CommentService);
		this.viewService = get(ViewService);
		// the batch jobs are plain classes over models: the seed uses the real "end finished events" job, limited to its own events
		this.batch = new BatchService(this.models.event, this.models.member, this.models.order, this.models.ticketType, this.models.eventSeat, this.models.notification);
		// a seeded conversation sends many messages in a second; the limit is per process and does not apply to this one
		(this.conversationService as any).sendLimiter = { tryConsume: () => true };
		this.skipModeration();
	}

	/**
	 * Submitting an event starts the AI moderation in the background. A seed has no AI (and 56 "not checked" warnings tell
	 * nothing), so this one seeder instance swaps the moderation of its own EventService for a counter; the production service
	 * is untouched (DECISIONS #109). One summary line is logged at the end.
	 */
	private skipModeration(): void {
		(this.eventService as any).aiModerationService = {
			moderateEvent: async () => {
				this.moderationSkipped++;
				return { checked: false, flags: [] };
			},
		};
	}

	public async run(passwords: Record<DemoPasswordKey, string>, options: { keepLinked?: boolean } = {}): Promise<void> {
		this.admin = await this.models.member.findOne({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE }).sort({ createdAt: 1 }).lean().exec();
		if (!this.admin) throw new Error('No admin exists yet. Run `npm run seed` first (it needs ADMIN_EMAIL and ADMIN_PASSWORD).');

		this.keepMode = !!options.keepLinked;
		if (this.keepMode) await this.timed('load kept records', () => this.loadKept());
		await this.timed('accounts', () => withScenario('accounts', () => this.createAccounts(passwords)));
		await this.timed('venues', () => withScenario('venues', () => this.createVenues()));
		const plan = buildDemoPlan(this.now);
		let done = 0;
		for (const event of plan.events) {
			const started = Date.now();
			await withScenario(`event ${done + 1}/${plan.events.length} ${event.key} (${event.status})`, () => this.processEvent(event));
			this.phaseMs.set('events (create, sell, refund, social)', (this.phaseMs.get('events (create, sell, refund, social)') ?? 0) + Date.now() - started);
			done++;
			if (done % 8 === 0 || done === plan.events.length) this.log(`  events ${done}/${plan.events.length}`);
		}
		const { buyer, admin, adminAfterDeadline, adminByPolicy } = this.refundCounts;
		this.log(`  refunds: ${buyer} by buyers, ${admin} by an admin (${adminAfterDeadline} because the refund deadline had passed, ${adminByPolicy} because the event is non-refundable)`);
		if (this.skippedEvents.size) this.log(`  kept as they were: ${this.skippedEvents.size} event(s) that other accounts' records point at`);
		if (this.skippedByLayout || this.skippedBySlot) this.log(`  not created because of kept records: ${this.skippedByLayout} (the kept venue has another layout), ${this.skippedBySlot} (a kept event holds the slot)`);
		this.log(`  AI moderation skipped for ${this.moderationSkipped} submitted event(s) (the seed has no AI)`);
		await this.timed('payouts', () => withScenario('payouts', () => this.payouts(plan.events)));
		await this.timed('organizer likes', () => withScenario('organizer likes', () => this.likeOrganizers()));
		if (this.keptMembers.size) this.log('  chats skipped: kept organizers keep their conversations');
		else await this.timed('chats', () => withScenario('chats', () => this.chats(plan.events)));
		await this.timed('extra notifications', () => withScenario('extra notifications', () => this.extraNotifications(plan.events)));
		await this.timed('dating the admin trail', () => withScenario('dating the admin trail', () => this.dateTheAdminTrail(plan.events)));
		if (this.keepMode) await this.timed('end expired kept events', () => withScenario('end expired kept events', () => this.endExpiredKeptEvents()));
		await this.timed('ranks', () => withScenario('ranks', () => this.writeRanks()));
		await this.timed('old notifications', () => withScenario('old notifications', () => this.markOldNotificationsRead()));
		this.logTimes();
	}

	/** PHASE TIMES: simple wall-clock times per phase, printed at the end of the run */

	private readonly phaseMs = new Map<string, number>();

	private async timed(label: string, work: () => Promise<unknown>): Promise<void> {
		const started = Date.now();
		try {
			await work();
		} finally {
			this.phaseMs.set(label, (this.phaseMs.get(label) ?? 0) + Date.now() - started);
		}
	}

	private logTimes(): void {
		const format = (ms: number): string => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`);
		const total = [...this.phaseMs.values()].reduce((sum, ms) => sum + ms, 0);
		this.log('\nTime per phase:');
		for (const [label, ms] of this.phaseMs) this.log(`  ${label.padEnd(40)} ${format(ms)}`);
		this.log(`  ${'total (phases)'.padEnd(40)} ${format(total)}`);
	}

	/** MANIFEST: a root document is written here before it is created, so a run that dies half way is still cleaned up by reset */

	private async track(type: DemoRecordType, ids: unknown[]): Promise<void> {
		await this.models.manifest.insertMany(ids.map((recordId) => ({ runId: this.runId, recordType: type, recordId })), { ordered: false });
	}

	private async setTimes(model: Model<any>, filter: any, createdAt: Date, extra: Record<string, Date> = {}): Promise<void> {
		await model.updateMany(filter, { $set: { createdAt, updatedAt: createdAt, ...extra } }, { timestamps: false, overwriteImmutable: true } as any).exec();
	}

	/** gives every matching document a random creation time between `from` and `to` (one update, the database picks the numbers) */
	private async spreadTimes(model: Model<any>, filter: any, from: Date, to: Date): Promise<void> {
		const fromMs = from.getTime();
		const span = Math.max(1, to.getTime() - fromMs);
		const when = { $toDate: { $add: [fromMs, { $multiply: [{ $rand: {} }, span] }] } };
		await model.updateMany(filter, [{ $set: { createdAt: when } }, { $set: { updatedAt: '$createdAt' } }] as any, { timestamps: false, overwriteImmutable: true } as any).exec();
	}

	private async inChunks<T>(items: T[], size: number, work: (item: T) => Promise<unknown>): Promise<void> {
		for (let start = 0; start < items.length; start += size) await Promise.all(items.slice(start, start + size).map(work));
	}

	/** KEPT RECORDS (#132): demo roots that the reset left in place because other accounts use them */

	private async loadKept(): Promise<void> {
		const [memberIds, venueIds, eventIds] = await Promise.all([
			getTrackedIds(this.models as any, 'Member'),
			getTrackedIds(this.models as any, 'Venue'),
			getTrackedIds(this.models as any, 'Event'),
		]);
		const members: any[] = await this.models.member.find({ _id: { $in: memberIds }, memberEmail: DEMO_EMAIL_PATTERN, memberType: { $ne: MemberType.ADMIN } }).lean().exec();
		const venues: any[] = await this.models.venue.find({ _id: { $in: venueIds } }).lean().exec();
		this.keptMembers = new Map(members.map((member) => [member.memberEmail, member]));
		this.keptVenues = new Map(venues.map((venue) => [`${venue.venueCity}|${venue.venueName}`, venue]));
		this.keptEvents = await this.models.event.find({ $or: [{ _id: { $in: eventIds } }, { organizerId: { $in: members.map((member) => member._id) } }] }).lean().exec();
		if (this.keptMembers.size || this.keptVenues.size || this.keptEvents.length) {
			this.log(`  kept: ${this.keptMembers.size} account(s), ${this.keptVenues.size} venue(s), ${this.keptEvents.length} event(s) from an earlier run`);
		}
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
			const keptAccount = this.keptMembers.get(account.email);
			if (keptAccount) {
				this.organizers[account.key] = keptAccount;
				continue;
			}
			this.newOrganizers.add(account.key);
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
				memberPhone: account.phone,
				memberDesc: account.desc,
				memberImage: demoLogoPath(account.key), // a committed SVG monogram (#131)
			});
			if (account.outcome === 'verify') {
				await this.organizerService.verifyOrganizerByAdmin(this.admin._id, _id as any);
				// the seeded organizers were approved long ago: no celebration screen waits for them (#120)
				await this.models.member.updateOne({ _id }, { $set: { approvalCelebrationPending: false } }, { timestamps: false, overwriteImmutable: true } as any).exec();
			}
			if (account.outcome === 'reject') await this.organizerService.rejectOrganizerByAdmin(this.admin._id, { memberId: _id, reason: account.rejectReason } as any);
			this.organizers[account.key] = await this.models.member.findById(_id).lean().exec();
		}

		const missing = DEMO_BUYERS.filter((buyer) => !this.keptMembers.has(buyer.email));
		const ids = missing.map(() => new Types.ObjectId());
		if (ids.length) {
			await this.track('Member', ids);
			await this.models.member.insertMany(
				missing.map((buyer, index) => ({
					_id: ids[index],
					memberEmail: buyer.email,
					memberPassword: hashes.buyer,
					memberType: MemberType.USER,
					memberStatus: MemberStatus.ACTIVE,
					memberAuthType: MemberAuthType.EMAIL,
					memberNick: buyer.nick,
					memberFullName: buyer.fullName,
					memberPhone: buyer.phone,
					memberAddress: buyer.address,
				})),
			);
		}
		// all buyers in the order of the data, the new ones and the ones kept from an earlier run
		const everyBuyer: any[] = await this.models.member.find({ memberEmail: { $in: DEMO_BUYERS.map((buyer) => buyer.email) } }).lean().exec();
		this.buyers = DEMO_BUYERS.map((buyer) => everyBuyer.find((member) => member.memberEmail === buyer.email));

		const all = [...ids, ...[...this.newOrganizers].map((key) => this.organizers[key]._id)];
		await this.setTimes(this.models.member, { _id: { $in: all } }, joined);
		this.log(`  accounts: ${DEMO_ORGANIZERS.length} organizers, ${DEMO_BUYERS.length} buyers`);
	}

	private async createVenues(): Promise<void> {
		for (const venue of DEMO_VENUES) {
			const keptVenue = this.keptVenues.get(`${venue.city}|${venue.name}`);
			if (keptVenue) {
				this.venues[venue.key] = keptVenue;
				continue;
			}
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
				// templates bring their own stage or pitch and levels; a PITCH is stored with the server's fixed geometry (#127, #128)
				venueLayout: { sections: venue.sections, ...(venue.focalArea ? { focalArea: venue.focalArea } : {}) },
				venueImages: venue.images,
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
		// an event kept from an earlier run (other accounts' records point at it) is not created again and not touched
		if (this.keptEvents.some((kept) => String(kept.organizerId) === String(organizer._id) && String(kept.venueId) === String(this.venues[plan.venue]._id) && kept.eventTitle === plan.title)) {
			this.skippedEvents.add(plan.key);
			return;
		}
		if (this.keepMode && this.layoutDiffers(plan)) {
			this.skippedByLayout++;
			this.skippedEvents.add(plan.key);
			return;
		}
		const eventId = new Types.ObjectId();
		await this.track('Event', [eventId]);

		const event: any = await withScenario('create event', () => this.createOrSkip({
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
			refundPolicy: plan.refundPolicy,
			organizerId: organizer._id,
		}));
		if (!event) {
			this.skippedBySlot++;
			this.skippedEvents.add(plan.key);
			return;
		}

		this.created.set(plan.key, event);
		const ticketTypes: any[] = [];
		for (const type of plan.ticketTypes) {
			ticketTypes.push(
				await withScenario(`ticket type "${type.name}"`, () => this.ticketTypeService.createTicketType(organizer._id, MemberType.ORGANIZER, {
					eventId,
					ticketTypeName: type.name,
					ticketPrice: type.price,
					ticketCurrency: TicketCurrency.KRW,
					tierKey: type.tierKey,
					totalQuantity: type.quantity,
					maxPerOrder: type.maxPerOrder,
				} as any)),
			);
		}
		if (plan.status === EventStatus.DRAFT) return;

		await withScenario('submit', () => this.eventService.submitEventForApproval(organizer._id, eventId as any));
		if (plan.status === EventStatus.PENDING) return;
		if (plan.status === EventStatus.REJECTED) {
			await withScenario('reject', () => this.eventService.rejectEventByAdmin(this.admin._id, { eventId, reason: plan.reason } as any));
			return;
		}
		await withScenario('approve', () => this.eventService.approveEventByAdmin(this.admin._id, eventId as any)); // RESERVED events get their seats here

		const built: Built = { plan, event, ticketTypes: await this.models.ticketType.find({ eventId }).lean().exec() };
		this.built.set(plan.key, built);
		const placed = plan.noSales ? [] : await withScenario('sales', () => this.sell(built));
		await withScenario('views, likes and comments', () => this.social(built));
		if (plan.status === EventStatus.CANCELLED) await withScenario('cancel and refund all', () => this.cancel(built, placed));
		if (plan.status === EventStatus.ENDED) await withScenario('check-in and end', () => this.finish(built, placed));
	}

	/** keep mode: a kept venue keeps the layout it had, so an event whose ticket tiers do not match it cannot be created */
	private layoutDiffers(plan: PlanEvent): boolean {
		const venue = this.venues[plan.venue];
		if (plan.seating !== SeatingType.RESERVED || ![...this.keptVenues.values()].some((kept) => String(kept._id) === String(venue._id))) return false;
		const tiers = (list: (string | undefined)[]) => [...new Set(list.filter(Boolean))].sort().join(',');
		const venueTiers = tiers((venue.venueLayout?.sections ?? []).filter((section: any) => section.kind === 'SEATED').map((section: any) => section.tierKey));
		return venueTiers !== tiers(plan.ticketTypes.map((type) => type.tierKey));
	}

	/** keep mode: when a kept event already holds the venue slot the event is skipped (null) instead of stopping the whole seed */
	private async createOrSkip(input: any): Promise<any> {
		try {
			return await this.eventService.createEvent(input);
		} catch (err) {
			if (this.keepMode && /already booked/i.test(String(err?.message))) return null;
			throw err;
		}
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
		const ordered = shuffled(rng, specs);
		// the orders of one event share its seats and stock: they are placed one after the other
		for (const [index, spec] of ordered.entries()) {
			const buyer = this.buyers[spec.buyerIndex];
			const result = await withScenario(`order ${index + 1}/${ordered.length} (buyer ${spec.buyerIndex}, ${spec.forced ?? 'regular'})`, () => this.placeOrder(buyer, event, spec, plan));
			result.at = times[index];
			result.checkIn = !!spec.checkIn;
			result.toRefund = spec.forced === 'refunded';
			result.protectedOrder = spec.buyerIndex === 0 && (spec.forced === 'paid' || !!spec.checkIn);
			placed.push(result);
		}
		await withScenario('date the orders', () => this.dateOrders(placed, rng));

		if (!plan.fill && plan.status !== EventStatus.CANCELLED) await this.refunds(built, placed, rng);
		return placed;
	}

	/** hold, checkout and pay (or cancel or fail) exactly as the API's three calls do */
	private async placeOrder(buyer: any, event: any, spec: { seatIds?: string[]; items?: any[]; forced?: string }, plan: PlanEvent): Promise<Placed> {
		if (spec.seatIds) await this.seatService.holdSeats(buyer._id, event._id, spec.seatIds as any);
		// a non-refundable event needs the buyer's explicit confirmation, exactly as in the app (#129)
		const acknowledge = plan.refundPolicy.policyType === RefundPolicyType.NON_REFUNDABLE ? { acknowledgeNonRefundable: true } : {};
		const order: any = await this.orderService.createCheckout(buyer._id, { eventId: event._id, seatIds: spec.seatIds, items: spec.items, ...acknowledge } as any);
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

	/** the orders, their tickets, payments and notifications get the time of the sale: one bulk write per collection and event */
	private async dateOrders(placed: Placed[], rng: Rng): Promise<void> {
		if (!placed.length) return;
		const dated = placed.map((item) => ({ item, paidAt: item.at, createdAt: new Date(item.at.getTime() - randomInt(rng, 1, 9) * MINUTE) }));
		const opts = { timestamps: false, overwriteImmutable: true } as any;
		const byTime = (field: string) =>
			dated.map(({ item, paidAt }) => ({ updateMany: { filter: { [field]: item.orderId }, update: { $set: { createdAt: paidAt, updatedAt: paidAt } }, overwriteImmutable: true } }));
		await Promise.all([
			this.models.order.bulkWrite(
				dated.map(({ item, paidAt, createdAt }) => ({
					updateOne: { filter: { _id: item.orderId }, update: { $set: { createdAt, updatedAt: paidAt, ...(item.outcome === 'paid' ? { paidAt } : {}) } }, overwriteImmutable: true },
				})),
				opts,
			),
			this.models.ticket.bulkWrite(byTime('orderId'), opts),
			this.models.payment.bulkWrite(byTime('orderId'), opts),
			this.models.notification.bulkWrite(byTime('orderId'), opts),
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
		// A buyer is bound to the real refund deadline. An event that starts tomorrow (Seoul) is past it from midnight, so a
		// refund the plan gives to the buyer is then done by an admin, which the policy allows after the deadline (#109).
		const policy = plan.refundPolicy;
		const route = getRefundRoute(built.event.startAt, VENUE_TIMEZONE, new Date(), policy);
		const routeReason = getRefundRouteReason(built.event.startAt, VENUE_TIMEZONE, new Date(), policy);
		const asBuyer = [...byBuyer, ...chosen];
		const jobs: { item: Placed; byAdmin: boolean; label: string }[] = [
			...asBuyer.map((item) => ({ item, byAdmin: route === 'admin', label: route === 'admin' ? (routeReason === 'policy' ? 'admin, non-refundable' : 'admin, buyer deadline passed') : 'buyer' })),
			...byAdmin.map((item) => ({ item, byAdmin: true, label: 'admin' })),
		];
		for (const [index, job] of jobs.entries()) {
			await withScenario(`refund ${index + 1}/${jobs.length} (${job.label})`, async () => {
				if (job.byAdmin) {
					await this.refundService.refundOrderByAdmin(this.admin._id, { orderId: job.item.orderId, reason: 'Refunded after a support request.' } as any);
					this.refundCounts.admin++;
					if (job.label !== 'admin') this.refundCounts.adminAfterDeadline++;
				} else {
					await this.refundService.requestRefund(job.item.buyerId, job.item.orderId, REFUND_REASONS[randomInt(rng, 0, REFUND_REASONS.length - 1)]);
					this.refundCounts.buyer++;
				}
				await this.dateRefund(job.item.orderId, when(job.item));
			});
		}
	}

	private async dateRefund(orderId: any, when: Date): Promise<void> {
		await Promise.all([
			this.models.refund.updateOne({ orderId }, { $set: { requestedAt: when, completedAt: new Date(when.getTime() + MINUTE), createdAt: when, updatedAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec(),
			this.models.order.updateOne({ _id: orderId }, { $set: { refundedAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec(),
			this.setTimes(this.models.notification, { orderId, notificationType: { $in: [NotificationType.REFUND_COMPLETED, NotificationType.ORDER_REFUNDED] } }, when),
			this.setTimes(this.models.auditLog, { targetId: orderId }, when),
		]);
	}

	/** SOCIAL: views, likes and comments of a public event, spread over the time it was on sale */

	private async social(built: Built): Promise<void> {
		const { plan, event } = built;
		const organizer = this.organizers[plan.organizer];
		const rng = createRng(hashString(`social-${plan.key}`));
		const viewers = shuffled(rng, this.buyers).slice(0, Math.min(this.buyers.length, 5 + Math.round(plan.popularity * 44)));
		const from = plan.approvedAt;
		const to = new Date(Math.min(this.now.getTime() - HOUR, plan.shiftDays ? plan.startAt.getTime() - HOUR : this.now.getTime()));

		let newViews = 0;
		await this.inChunks(viewers, 10, async (viewer) => {
			const created = await this.viewService.recordView({ memberId: viewer._id, viewRefId: event._id, viewGroup: ViewGroup.EVENT } as any);
			if (created) newViews++;
		});
		await this.models.event.updateOne({ _id: event._id }, { $inc: { eventViews: newViews } }, { timestamps: false, overwriteImmutable: true } as any).exec();

		const likers = viewers.slice(0, Math.round(viewers.length * 0.5 * (0.5 + plan.popularity)));
		await this.inChunks(likers, 10, (liker) => this.eventService.likeTargetEvent(liker._id, event._id));

		const commenters = viewers.slice(0, Math.max(2, Math.round(plan.popularity * 8)));
		// the texts and the dice are drawn first, in order, so the data does not depend on which request finishes first
		const talk = commenters.map((commenter) => {
			const locale = this.localeOf(commenter);
			return { commenter, locale, text: DEMO_COMMENTS[randomInt(rng, 0, DEMO_COMMENTS.length - 1)][locale], reply: rng() < 0.5 };
		});
		await this.inChunks(talk, 4, async ({ commenter, locale, text, reply }) => {
			await this.commentService.createComment(commenter._id, { commentGroup: CommentGroup.EVENT, commentContent: text, commentRefId: event._id } as any);
			// comments have no reply field, so the organizer answers with a comment that names the author
			if (reply) {
				await this.commentService.createComment(organizer._id, { commentGroup: CommentGroup.EVENT, commentContent: `@${commenter.memberNick} ${DEMO_REPLIES[locale]}`, commentRefId: event._id } as any);
			}
		});

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
			this.models.refund.updateMany({ eventId: event._id }, { $set: { requestedAt: when, completedAt: new Date(when.getTime() + MINUTE), createdAt: when, updatedAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec(),
			this.models.order.updateMany({ _id: { $in: orderIds }, orderStatus: OrderStatus.REFUNDED }, { $set: { refundedAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec(),
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
			await this.models.ticket.updateOne({ _id: ticket._id }, { $set: { checkedInAt: when, updatedAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec();
		});

		// the event was created ahead of its date; now its real, past dates are written and the real job ends it
		await this.models.event.updateOne({ _id: event._id }, { $set: { startAt: plan.startAt, endAt: plan.endAt } }, { timestamps: false, overwriteImmutable: true } as any).exec();
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
			if (!built) continue; // kept from an earlier run
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
		await this.markDuePayoutsNotified(events);
	}

	/**
	 * The "payout is due" job (#119) would announce every seeded payout that is due at the moment of the seed. They are history,
	 * so each one is claimed here, the way the job claims it (the 7 day rule alone would let a payout that became due 3 days ago
	 * through). A payout that is not due yet is left alone: it is announced for real when it becomes due.
	 */
	private async markDuePayoutsNotified(events: PlanEvent[]): Promise<void> {
		const ids = events
			.filter((plan) => plan.status === EventStatus.ENDED && getPayoutDate(plan.endAt, VENUE_TIMEZONE).getTime() <= this.now.getTime())
			.map((plan) => this.built.get(plan.key)?.event._id)
			.filter(Boolean);
		await this.models.event.updateMany({ _id: { $in: ids }, payoutDueNotifiedAt: null }, { $set: { payoutDueNotifiedAt: this.now } }, { timestamps: false, overwriteImmutable: true } as any).exec();
	}

	/** ORGANIZER SOCIAL: profile views and likes of the active organizers */

	private async likeOrganizers(): Promise<void> {
		// an organizer kept from an earlier run keeps its likes: liking is a toggle and would take them back
		const active = DEMO_ORGANIZERS.filter((item) => item.outcome === 'verify' && this.newOrganizers.has(item.key)).map((item) => this.organizers[item.key]);
		if (!active.length) return;
		const rng = createRng(77);
		// the dice are drawn first, in order; each buyer then acts alone (one buyer's calls stay in sequence)
		const actions = this.buyers.map((buyer, index) => ({
			buyer,
			targets: shuffled(rng, active)
				.slice(0, 1 + (index % 4))
				.map((organizer) => ({ organizer, like: rng() < 0.35 })),
		}));
		await this.inChunks(actions, 5, async ({ buyer, targets }) => {
			for (const { organizer, like } of targets) {
				await this.memberService.getMember(buyer._id, organizer._id); // records the view and counts it
				if (like) await this.memberService.likeTargetMember(buyer._id, organizer._id);
			}
		});
		const ids = active.map((organizer) => organizer._id);
		const from = new Date(this.now.getTime() - 380 * DAY);
		const to = new Date(this.now.getTime() - HOUR);
		await this.spreadTimes(this.models.view, { viewGroup: ViewGroup.MEMBER, viewRefId: { $in: ids } }, from, to);
		await this.spreadTimes(this.models.like, { likeGroup: LikeGroup.MEMBER, likeRefId: { $in: ids } }, from, to);
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
				await this.models.message.updateOne({ _id: message._id }, { $set: { createdAt: when } }, { timestamps: false, overwriteImmutable: true } as any).exec();
			}
			const last = lines[lines.length - 1][2];
			await this.models.conversation.updateOne({ _id: conversation._id }, { $set: { createdAt: lines[0][2], updatedAt: last, lastMessageAt: last } }, { timestamps: false, overwriteImmutable: true } as any).exec();
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
					[hanbit, `We submitted ${jazz.eventTitle} for review. Is anything missing?`, day(4)],
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
					[hanbit, `We added the confirmed line-up and the charity partner to ${charity.eventTitle}. Can you review it again?`, day(5)],
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
		await this.models.conversation.updateOne({ _id: reply._id }, { $set: { unreadForOrganizer: 0 } }, { timestamps: false, overwriteImmutable: true } as any).exec();
		await this.models.message.updateMany({ conversationId: reply._id, senderId: admin._id }, { $set: { readAt: new Date(day(19).getTime() + 5 * HOUR) } }).exec();
		this.log('  chats: 5 conversations');
	}

	private async extraNotifications(events: PlanEvent[]): Promise<void> {
		const next = events.filter((item) => this.built.has(item.key) && item.status === EventStatus.APPROVED && item.buyerOrders.some((order) => order.outcome === 'paid')).slice(0, 3);
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
		// events are independent documents: eight at a time
		await this.inChunks(events, 8, async (plan) => {
			const eventId = this.created.get(plan.key)?._id;
			if (!eventId) return;
			const trail: [AuditAction, NotificationType | null, Date][] = [
				[AuditAction.EVENT_APPROVED, NotificationType.EVENT_APPROVED, plan.approvedAt],
				[AuditAction.EVENT_REJECTED, NotificationType.EVENT_REJECTED, plan.decidedAt ?? plan.approvedAt],
				[AuditAction.EVENT_CANCELLED, NotificationType.EVENT_CANCELLED, plan.decidedAt ?? plan.approvedAt],
				[AuditAction.EVENT_REFUNDS_PROCESSED, null, new Date((plan.decidedAt ?? plan.approvedAt).getTime() + 5 * MINUTE)],
			];
			await Promise.all([
				...trail.flatMap(([action, notification, when]) => [
					this.setTimes(this.models.auditLog, { targetId: eventId, action }, when),
					...(notification ? [this.setTimes(this.models.notification, { eventId, notificationType: notification }, when)] : []),
				]),
				this.models.event.updateOne({ _id: eventId }, { $set: { createdAt: plan.createdAt } }, { timestamps: false, overwriteImmutable: true } as any).exec(),
				this.setTimes(this.models.ticketType, { eventId }, plan.createdAt),
			]);
		});
		const joinedAt = new Date(this.now.getTime() - 399 * DAY);
		await this.inChunks(DEMO_ORGANIZERS.filter((account) => this.newOrganizers.has(account.key)), 5, async (account) => {
			const member = this.organizers[account.key];
			await Promise.all([
				this.setTimes(this.models.auditLog, { targetId: member._id }, joinedAt),
				this.setTimes(this.models.notification, { receiverId: member._id, notificationType: { $in: [NotificationType.ORGANIZER_VERIFIED, NotificationType.ORGANIZER_REJECTED] } }, joinedAt),
			]);
		});
		// admin trail of the rejection chat: the admin opened it nineteen days ago
		if (this.newOrganizers.has('rejected')) {
			await this.setTimes(this.models.auditLog, { action: AuditAction.SUPPORT_CONVERSATION_STARTED, actorId: this.admin._id, 'meta.organizerId': this.organizers.rejected._id }, new Date(this.now.getTime() - 19 * DAY));
		}
	}

	/** keep mode: time has passed for the events kept from an earlier run; the real hourly job ends the ones that are over */
	private async endExpiredKeptEvents(): Promise<void> {
		const ids = this.keptEvents.filter((event) => event.eventStatus === EventStatus.APPROVED && new Date(event.endAt) <= this.now).map((event) => event._id);
		if (ids.length) await this.batch.batchEndEvents(ids);
	}

	/** RANKS: the formulas of the rank job (rank.ts), applied to the demo documents only */

	private async writeRanks(): Promise<void> {
		const events: any[] = await this.models.event.find({ _id: { $in: [...[...this.built.values()].map((item) => item.event._id), ...this.keptEvents.map((event) => event._id)] }, eventStatus: EventStatus.APPROVED }).lean().exec();
		if (events.length) await this.models.event.bulkWrite(events.map((event) => ({ updateOne: { filter: { _id: event._id }, update: { $set: { eventRank: getEventRank(event) } } } })), { timestamps: false, overwriteImmutable: true } as any);
		const organizers: any[] = await this.models.member.find({ _id: { $in: Object.values(this.organizers).map((member: any) => member._id) }, memberStatus: MemberStatus.ACTIVE }).lean().exec();
		if (organizers.length) await this.models.member.bulkWrite(organizers.map((organizer) => ({ updateOne: { filter: { _id: organizer._id }, update: { $set: { memberRank: getOrganizerRank(organizer) } } } })), { timestamps: false, overwriteImmutable: true } as any);
	}

	/** older notifications were read long ago; the recent ones stay unread so the badge shows a number */
	private async markOldNotificationsRead(): Promise<void> {
		const members = [...this.buyers.filter((buyer) => !this.keptMembers.has(buyer.memberEmail)), ...[...this.newOrganizers].map((key) => this.organizers[key])].map((member: any) => member._id);
		await this.models.notification
			.updateMany({ receiverId: { $in: members }, createdAt: { $lt: new Date(this.now.getTime() - 3 * DAY) } }, { $set: { notificationStatus: NotificationStatus.READ } }, { timestamps: false, overwriteImmutable: true } as any)
			.exec();
	}
}
