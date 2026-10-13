/**
 * npm run seed:demo
 * Fills a development database with demo accounts, venues with seat layouts, events, orders, tickets, chats and
 * notifications. Safe to run again: it first removes what an earlier run created (members with a @ticketzy.demo
 * address and everything that hangs off them), then creates it again. `npm run seed` (admin only) is not touched,
 * and the existing admin is used, never changed or removed.
 *
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true.
 * Everything goes through the real services (event approval generates the seats, payOrder signs the QR tokens),
 * so the data is what the API itself would have produced.
 */
import { config } from 'dotenv';
import * as bcrypt from 'bcryptjs';
import * as moment from 'moment';
import { INestApplicationContext, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DatabaseModule } from './database/database.module';
import { ComponentsModule } from './components/components.module';
import { EventService } from './components/event/event.service';
import { VenueService } from './components/venue/venue.service';
import { TicketTypeService } from './components/ticket-type/ticket-type.service';
import { OrganizerService } from './components/organizer/organizer.service';
import { SeatService } from './components/seat/seat.service';
import { OrderService } from './components/order/order.service';
import { RefundService } from './components/refund/refund.service';
import { TicketService } from './components/ticket/ticket.service';
import { ConversationService } from './components/conversation/conversation.service';
import { NotificationService } from './components/notification/notification.service';
import { EventStatus, SeatingType, SeatStatus } from './libs/enums/event.enum';
import { MemberAuthType, MemberStatus, MemberType } from './libs/enums/member.enum';
import { NotificationGroup, NotificationStatus, NotificationType } from './libs/enums/notification.enum';
import { PaymentSimulation, TicketCurrency } from './libs/enums/ticket.enum';
import { getMongoUriKey } from './libs/env.validation';
import {
	assertDemoSeedAllowed,
	DEMO_ACCOUNTS,
	DEMO_EVENTS,
	DEMO_VENUES,
	DemoAccount,
	DemoEvent,
	DemoSummary,
	demoImage,
	ENDED_EVENT_DAYS_AGO,
	formatDemoSummary,
	getDemoPassword,
	pickSeatBlocks,
	removeDemoData,
	runDemoSeed,
} from './libs/demo-seed';

@Module({ imports: [ConfigModule.forRoot(), DatabaseModule, ComponentsModule] })
class DemoSeedModule {}

const LOCALES = ['en', 'ko', 'ru', 'uz'] as const;
const CROWD_BLOCK_SIZES = [8, 4, 6, 2, 8, 3, 5, 8, 4, 2, 6, 3];

type AnyModel = Model<any>;

class DemoSeeder {
	private readonly model = (name: string): AnyModel => this.app.get(getModelToken(name), { strict: false });
	private readonly service = <T>(type: new (...args: any[]) => T): T => this.app.get(type, { strict: false });

	constructor(private readonly app: INestApplicationContext) {}

	public cleanupModels() {
		return {
			member: this.model('Member'),
			venue: this.model('Venue'),
			event: this.model('Event'),
			ticketType: this.model('TicketType'),
			eventSeat: this.model('EventSeat'),
			order: this.model('Order'),
			ticket: this.model('Ticket'),
			payment: this.model('Payment'),
			refund: this.model('Refund'),
			conversation: this.model('Conversation'),
			message: this.model('Message'),
			notification: this.model('Notification'),
			auditLog: this.model('AuditLog'),
		};
	}

	public async create(password: string): Promise<DemoSummary> {
		const admin: any = await this.model('Member').findOne({ memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE }).lean().exec();
		if (!admin) throw new Error('No admin exists yet. Run `npm run seed` first (it needs ADMIN_EMAIL and ADMIN_PASSWORD).');

		const accounts = await this.createAccounts(admin, password);
		const organizer = accounts.organizer;
		const venues = await this.createVenues(organizer);
		const events = await this.createEvents(admin, organizer, venues);
		await this.sellTickets(admin, organizer, accounts.buyer, accounts.crowd, events);
		await this.closeEvents(admin, organizer, events);
		await this.createChats(admin, organizer, events);
		await this.createNotifications(admin, organizer, accounts.buyer, events);
		await this.setViewCounters(events);

		return {
			emails: [
				{ label: 'ADMIN (existing)', email: admin.memberEmail },
				{ label: 'USER buyer', email: accounts.buyer.memberEmail },
				{ label: 'ORGANIZER (ACTIVE)', email: organizer.memberEmail },
				{ label: 'ORGANIZER (PENDING)', email: accounts.pending.memberEmail },
				{ label: 'ORGANIZER (REJECTED)', email: accounts.rejected.memberEmail },
				{ label: 'USER filler buyer', email: accounts.crowd.memberEmail },
			],
			counts: await this.count(accounts, events),
		};
	}

	/** members */

	private async createAccounts(admin: any, password: string) {
		const memberModel = this.model('Member');
		const organizerService = this.service(OrganizerService);
		const memberPassword = await bcrypt.hash(password, await bcrypt.genSalt());
		const created: Record<string, any> = {};

		for (const account of DEMO_ACCOUNTS) {
			const member = await memberModel.create({
				memberEmail: account.email,
				memberPassword,
				memberType: account.memberType,
				// organizers sign up as PENDING; the admin actions below bring them to their final status
				memberStatus: account.memberType === MemberType.ORGANIZER ? MemberStatus.PENDING : MemberStatus.ACTIVE,
				memberAuthType: MemberAuthType.EMAIL,
				memberNick: account.nick,
				memberFullName: account.fullName,
				memberDesc: account.desc,
				memberImage: demoImage(`member-${account.key}`, 300, 300),
			});
			created[account.key] = await this.applyOutcome(organizerService, admin, member._id, account);
		}
		return created as Record<DemoAccount['key'], any>;
	}

	private async applyOutcome(organizerService: OrganizerService, admin: any, memberId: any, account: DemoAccount) {
		if (account.outcome === 'verify') await organizerService.verifyOrganizerByAdmin(admin._id, memberId);
		if (account.outcome === 'reject') {
			await organizerService.rejectOrganizerByAdmin(admin._id, { memberId, reason: account.rejectReason });
		}
		return await this.model('Member').findById(memberId).lean().exec();
	}

	/** venues */

	private async createVenues(organizer: any) {
		const venueService = this.service(VenueService);
		const venues: Record<string, any> = {};
		for (const venue of DEMO_VENUES) {
			venues[venue.key] = await venueService.createVenue({
				venueName: venue.name,
				venueType: venue.type,
				venueCity: venue.city,
				venueAddress: venue.address,
				venueCoordinates: venue.coordinates,
				venueTimezone: 'Asia/Seoul',
				venueLayout: { sections: venue.sections },
				venueImages: [demoImage(`venue-${venue.key}`), demoImage(`venue-${venue.key}-2`)],
				memberId: organizer._id,
			} as any);
		}
		return venues;
	}

	/** events: created as DRAFT through the service, then moved on with the real submit, approve and reject */

	private async createEvents(admin: any, organizer: any, venues: Record<string, any>): Promise<Map<string, CreatedEvent>> {
		const eventService = this.service(EventService);
		const ticketTypeService = this.service(TicketTypeService);
		const created = new Map<string, CreatedEvent>();

		for (const def of DEMO_EVENTS) {
			const startAt = moment.utc().add(def.daysFromNow, 'days').hour(def.startHourUtc).minute(0).second(0).millisecond(0);
			const event: any = await eventService.createEvent({
				eventCategory: def.category,
				seatingType: def.seating,
				eventTitle: def.title,
				eventDesc: def.desc,
				eventTranslations: LOCALES.map((locale) => ({ locale, ...def.translations[locale] })),
				eventImages: [demoImage(def.key), demoImage(`${def.key}-2`)],
				venueId: venues[def.venue]._id,
				startAt: startAt.toDate(),
				endAt: startAt.clone().add(def.durationHours, 'hours').toDate(),
				organizerId: organizer._id,
			} as any);

			const ticketTypes: any[] = [];
			for (const type of def.ticketTypes) {
				ticketTypes.push(
					await ticketTypeService.createTicketType(organizer._id, MemberType.ORGANIZER, {
						eventId: event._id,
						ticketTypeName: type.name,
						ticketPrice: type.price,
						ticketCurrency: TicketCurrency.KRW,
						tierKey: type.tierKey,
						// RESERVED events take the quantity from the seats
						totalQuantity: def.seating === SeatingType.GENERAL ? type.quantity : undefined,
						maxPerOrder: type.maxPerOrder,
					} as any),
				);
			}

			if (def.status !== EventStatus.DRAFT) await eventService.submitEventForApproval(organizer._id, event._id);
			if (def.status === EventStatus.REJECTED) {
				await eventService.rejectEventByAdmin(admin._id, { eventId: event._id, reason: def.reason } as any);
			} else if (needsApproval(def)) {
				await eventService.approveEventByAdmin(admin._id, event._id); // generates the seats of RESERVED events
			}
			created.set(def.key, { def, event, ticketTypes });
		}
		return created;
	}

	/** orders: every one goes holdSeats / createCheckout / payOrder, the same calls the API makes */

	private async sellTickets(admin: any, organizer: any, buyer: any, crowd: any, events: Map<string, CreatedEvent>) {
		const orderService = this.service(OrderService);
		const refundService = this.service(RefundService);
		const ticketService = this.service(TicketService);
		const ticketModel = this.model('Ticket');

		// the demo buyer: two paid orders and one that is refunded
		await this.buySeats(buyer, events.get('football-incheon-seoul'), [{ sectionKey: 'LOWER_N', row: 3, numbers: [5, 6] }]);

		const showcase = await this.buySeats(buyer, events.get('comedy-spring-showcase'), [{ sectionKey: 'FRONT', row: 1, numbers: [3, 4] }]);
		const ticket: any = await ticketModel.findOne({ orderId: showcase._id }).sort({ _id: 1 }).lean().exec();
		await ticketService.checkInTicket(organizer._id, MemberType.ORGANIZER, ticket.qrToken, events.get('comedy-spring-showcase').event._id);

		const refunded = await this.buySeats(buyer, events.get('comedy-busan-late-night'), [{ sectionKey: 'FRONT', row: 2, numbers: [4, 5] }]);
		await refundService.requestRefund(buyer._id, refunded._id, 'Change of plans, cannot attend.');

		// the filler buyer makes the seat maps and the sales numbers look alive
		for (const created of events.values()) {
			if (!created.def.crowdOrders) continue;
			if (created.def.seating === SeatingType.RESERVED) await this.crowdSeats(crowd, created);
			else await this.crowdQuantities(orderService, crowd, created);
		}
	}

	private async buySeats(buyer: any, created: CreatedEvent, wanted: { sectionKey: string; row: number; numbers: number[] }[]) {
		const seats = await this.model('EventSeat')
			.find({
				eventId: created.event._id,
				seatStatus: SeatStatus.AVAILABLE,
				$or: wanted.map((w) => ({ sectionKey: w.sectionKey, row: w.row, number: { $in: w.numbers } })),
			})
			.lean()
			.exec();
		if (seats.length !== wanted.reduce((sum, w) => sum + w.numbers.length, 0)) {
			throw new Error(`Seats for the demo buyer are not free on ${created.def.title}`);
		}
		return await this.payForSeats(buyer, created.event._id, seats.map((seat: any) => seat._id));
	}

	private async payForSeats(buyer: any, eventId: any, seatIds: any[]) {
		const seatService = this.service(SeatService);
		const orderService = this.service(OrderService);
		await seatService.holdSeats(buyer._id, eventId, seatIds);
		const order: any = await orderService.createCheckout(buyer._id, { eventId, seatIds } as any);
		return await orderService.payOrder(buyer._id, order._id, PaymentSimulation.SUCCESS);
	}

	private async crowdSeats(crowd: any, created: CreatedEvent) {
		const free = await this.model('EventSeat').find({ eventId: created.event._id, seatStatus: SeatStatus.AVAILABLE }).lean().exec();
		const sizes = Array.from({ length: created.def.crowdOrders }, (_, i) => CROWD_BLOCK_SIZES[i % CROWD_BLOCK_SIZES.length]);
		const maxPerOrder = Math.min(...created.def.ticketTypes.map((type) => type.maxPerOrder));
		for (const seatIds of pickSeatBlocks(free as any, sizes, maxPerOrder)) {
			await this.payForSeats(crowd, created.event._id, seatIds);
		}
	}

	private async crowdQuantities(orderService: OrderService, crowd: any, created: CreatedEvent) {
		for (let i = 0; i < created.def.crowdOrders; i++) {
			const index = i % created.ticketTypes.length;
			const type = created.def.ticketTypes[index];
			const quantity = Math.min(type.maxPerOrder, 2 + (i % 3));
			const order: any = await orderService.createCheckout(crowd._id, {
				eventId: created.event._id,
				items: [{ ticketTypeId: created.ticketTypes[index]._id, quantity }],
			} as any);
			await orderService.payOrder(crowd._id, order._id, PaymentSimulation.SUCCESS);
		}
	}

	/** the CANCELLED event refunds its orders through the real cancel; the ENDED one is moved into the past */

	private async closeEvents(admin: any, organizer: any, events: Map<string, CreatedEvent>) {
		const eventService = this.service(EventService);
		for (const { def, event } of events.values()) {
			if (def.status === EventStatus.CANCELLED) {
				await eventService.cancelEventByAdmin(admin._id, { eventId: event._id, reason: def.reason } as any);
			}
			if (def.status === EventStatus.ENDED) {
				// the status machine only ends APPROVED events whose end passed, so the dates move back with it
				const startAt = moment.utc().subtract(ENDED_EVENT_DAYS_AGO, 'days').hour(def.startHourUtc).minute(0).second(0).millisecond(0);
				const ended = await this.model('Event')
					.updateOne(
						{ _id: event._id, eventStatus: EventStatus.APPROVED },
						{ eventStatus: EventStatus.ENDED, startAt: startAt.toDate(), endAt: startAt.clone().add(def.durationHours, 'hours').toDate() },
					)
					.exec();
				if (ended.modifiedCount) await this.model('Member').updateOne({ _id: organizer._id }, { $inc: { completedEvents: 1 } }).exec();
			}
		}
	}

	/** one support conversation and one about a pending event, a few messages each */

	private async createChats(admin: any, organizer: any, events: Map<string, CreatedEvent>) {
		const conversationService = this.service(ConversationService);
		const say = async (member: any, conversationId: any, body: string) => {
			await conversationService.sendMessage(member, conversationId, body);
		};

		const support = await conversationService.startConversation(organizer);
		await say(organizer, support._id, 'Hello! We joined last week. When are payouts for ticket sales prepared?');
		await say(admin, support._id, 'Welcome to Ticketzy! Payouts are prepared after the event has ended and all refunds are settled.');
		await say(organizer, support._id, 'Thanks. Can we still change the seat layout of a venue after an event is approved?');
		await say(admin, support._id, 'Not once the seats are generated. Create a new venue with the new layout and move a draft event there.');

		const jazz = events.get('concert-midnight-jazz');
		const eventChat = await conversationService.startConversation(organizer, jazz.event._id);
		await say(organizer, eventChat._id, 'We submitted Midnight Jazz Sessions for review. Is anything missing?');
		await say(admin, eventChat._id, 'Looking at it now. Could you confirm the guest players so we can check the description?');
		await say(organizer, eventChat._id, 'Confirmed: the trio plus two guest players. I will add the names to the description today.');
	}

	/** most notifications come from the flows above; these cover the ones no flow here triggers */

	private async createNotifications(admin: any, organizer: any, buyer: any, events: Map<string, CreatedEvent>) {
		const notificationService = this.service(NotificationService);
		const football = events.get('football-incheon-seoul');
		await notificationService.createNotification({
			notificationType: NotificationType.EVENT_REMINDER,
			notificationGroup: NotificationGroup.EVENT,
			notificationTitle: 'Your match is coming up',
			notificationDesc: football.def.title,
			authorId: admin._id,
			receiverId: buyer._id,
			eventId: football.event._id,
		} as any);
		// a mix of read and unread so the badge shows a number
		await this.model('Notification')
			.updateMany(
				{
					$or: [
						{ receiverId: organizer._id, notificationType: NotificationType.ORGANIZER_VERIFIED },
						{ receiverId: buyer._id, notificationType: NotificationType.ORDER_PAID },
					],
				},
				{ notificationStatus: NotificationStatus.READ },
			)
			.exec();
	}

	private async setViewCounters(events: Map<string, CreatedEvent>) {
		let views = 1800;
		for (const { def, event } of events.values()) {
			if (def.status !== EventStatus.APPROVED && def.status !== EventStatus.ENDED) continue;
			await this.model('Event').updateOne({ _id: event._id }, { eventViews: views }).exec();
			views = Math.round(views * 0.72);
		}
	}

	private async count(accounts: Record<string, any>, events: Map<string, CreatedEvent>) {
		const eventIds = [...events.values()].map(({ event }) => event._id);
		const memberIds = Object.values(accounts).map((member: any) => member._id);
		const orders = await this.model('Order').find({ eventId: { $in: eventIds } }).select('_id').lean().exec();
		const [tickets, seats, soldSeats, conversations, notifications] = await Promise.all([
			this.model('Ticket').countDocuments({ eventId: { $in: eventIds } }).exec(),
			this.model('EventSeat').countDocuments({ eventId: { $in: eventIds } }).exec(),
			this.model('EventSeat').countDocuments({ eventId: { $in: eventIds }, seatStatus: SeatStatus.SOLD }).exec(),
			this.model('Conversation').countDocuments({ organizerId: { $in: memberIds } }).exec(),
			this.model('Notification').countDocuments({ $or: [{ receiverId: { $in: memberIds } }, { eventId: { $in: eventIds } }] }).exec(),
		]);
		return {
			members: memberIds.length,
			venues: DEMO_VENUES.length,
			events: eventIds.length,
			eventSeats: seats,
			soldSeats,
			orders: orders.length,
			tickets,
			conversations,
			notifications,
		};
	}
}

interface CreatedEvent {
	def: DemoEvent;
	event: any;
	ticketTypes: any[];
}

/** every status except DRAFT, PENDING and REJECTED goes through approval */
const needsApproval = (def: DemoEvent): boolean =>
	[EventStatus.APPROVED, EventStatus.CANCELLED, EventStatus.ENDED].includes(def.status);

async function seedDemo(): Promise<void> {
	config();
	assertDemoSeedAllowed(process.env); // before anything connects
	const password = getDemoPassword(process.env);

	const uriKey = getMongoUriKey();
	for (const key of [uriKey, 'SECRET_TOKEN', 'QR_SECRET']) {
		if (!process.env[key]?.trim()) throw new Error(`${key} is missing`);
	}

	// the demo never calls an AI provider (submitting an event would start a moderation check), and the 30 second
	// default hold is too short for a slow connection; both only apply to this process
	process.env.AI_ENABLED = 'false';
	process.env.SEAT_HOLD_SECONDS = '300';
	process.env.PAYMENT_MODE = 'simulated'; // the demo buys through payOrder with the mock provider

	console.log(`Seeding demo data into ${uriKey === 'MONGO_PROD' ? 'the PRODUCTION database' : 'the development database'}...`);
	const app = await NestFactory.createApplicationContext(DemoSeedModule, { logger: ['error', 'warn'] });
	try {
		const seeder = new DemoSeeder(app);
		const { removed, summary } = await runDemoSeed({
			env: process.env,
			cleanup: () => removeDemoData(seeder.cleanupModels()),
			create: () => seeder.create(password),
		});
		// the moderation check that submit starts runs in the background; let it finish before the connection closes
		await new Promise((resolve) => setTimeout(resolve, 500));
		console.log(formatDemoSummary(summary, removed));
	} finally {
		await app.close();
	}
}

if (require.main === module) {
	seedDemo().catch((err) => {
		console.error(`Demo seed failed: ${err.message}`);
		process.exit(1);
	});
}
