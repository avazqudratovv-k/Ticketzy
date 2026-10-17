# 04 - Data model

**What this file covers.** Every MongoDB collection the backend uses: fields with types and meaning, defaults, indexes and why they exist, relations to other collections, which code writes the collection, and the counters that are kept in sync by hand. It also covers the two demo-seed collections. Definitions live in `apps/ticketzy-api/src/libs/schemas/*.model.ts` (Mongoose schemas); the matching GraphQL types are in `apps/ticketzy-api/src/libs/dto/`. Nineteen product collections plus `ai_usage` and `demo_seed_records` exist: 21 in total.

**Mongo for beginners.** A *collection* is like a table, a *document* like a row, but documents are JSON-like objects and can nest other objects and arrays. `_id` is an `ObjectId` (12 bytes, shown as 24 hex characters) added automatically. There are no foreign keys; a "relation" is just a field holding another document's `_id` (Mongoose calls the target with `ref`). A *join* is done in an aggregation with `$lookup`. An *index* makes queries on a field fast; a *unique* index also refuses duplicates, which this project uses to decide races. `timestamps: true` adds `createdAt` and `updatedAt`.

Every schema uses the explicit `collection:` name shown in the headings. `autoIndex` is on in the API (`MONGO_AUTO_INDEX`, default true) and always off in the batch app (`apps/ticketzy-batch/src/database/database.module.ts`).

Relations at a glance:

```
Member(organizer) 1--* Venue          (Venue.memberId)
Member(organizer) 1--* Event          (Event.organizerId)       Venue 1--* Event (Event.venueId)
Event 1--* TicketType                 (TicketType.eventId)
Event 1--* EventSeat                  (EventSeat.eventId)       TicketType 1--* EventSeat (ticketTypeId)
Member(buyer) 1--* Order              (Order.buyerId)           Event 1--* Order (Order.eventId)
Order 1--* Ticket                     (Ticket.orderId)          Order 1--* Payment, Order 1--1 Refund
Event 1--0..1 Payout                  (Payout.eventId, unique)
Event 1--0..1 Conversation (event)    Member(organizer) 1--0..1 Conversation (support)
Conversation 1--* Message
```

---

## 1. `members` (`Member.model.ts`; also the DTO `libs/dto/member/member.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `memberType` | enum USER/ORGANIZER/ADMIN | USER | role; set only by the server |
| `memberStatus` | enum PENDING/ACTIVE/REJECTED/SUSPENDED/DELETE | ACTIVE | account state (`02-state-and-rules.md` 1.1) |
| `memberAuthType` | enum PHONE/EMAIL | EMAIL | how the account signed up; always EMAIL in current code |
| `memberEmail` | string | required, lowercase, trimmed, regex-checked; unique among live members (index on `memberEmail` + `deletedAt`, #124) | login id; a deleted account keeps it |
| `memberPhone` | string | sparse unique together with `deletedAt` (#124) | optional phone |
| `memberNick` | string | unique, sparse | nickname; for organizers it is the organization name (decision #113) |
| `memberPassword` | string | required, `select: false` | bcrypt hash; never returned unless a query adds `+memberPassword` |
| `memberFullName`, `memberAddress`, `memberDesc` | string | | profile; full name and address are public only for organizers |
| `memberImage` | string | '' | upload path |
| `memberEvents` | number | 0 | events the organizer created (drafts included; decremented on cancel and draft removal) |
| `completedEvents` | number | 0 | ended events; drives commission tiers; incremented by the batch job |
| `memberLikes`, `memberViews`, `memberComments` | number | 0 | counters; `memberComments` is declared but nothing increments it (comments exist on events only) |
| `memberRank` | number | 0 | written by the batch rank job |
| `rejectReason` | string | | why an organizer was rejected |
| `commissionOverride` | `{ rate 0..100, endsAt?, reason }` | none | admin override of the commission |
| `approvalCelebrationPending` | boolean | false (missing on old accounts, read as false) | true from an approval (verify, or reinstate of a REJECTED organizer) until `markApprovalCelebrationDone`; readable by the member only (#120) |
| `memberWarnings`, `memberBlocks` | number | 0 | declared and exposed to self/admin; no code increments them (see oddities) |
| `deletedAt` | date | none (live accounts have none) | set by `deleteMyAccount` (#123); admin-only tag |
| `emailReusableAt` | date | none | `deletedAt` + 30 days: first moment the email may open a new account (#124); admin-only tag |
| `previousAccountId` | ObjectId | none | on a new account that reused a deleted account's email; admin-only tag |
| `reusedByMemberId` | ObjectId | none | on the deleted account whose email was reused; admin-only tag |

Indexes (names in `libs/member-indexes.ts`): unique `(memberEmail, deletedAt)` named `memberEmail_1_deletedAt_1`; sparse unique `(memberPhone, deletedAt)` named `memberPhone_1_deletedAt_1`; sparse unique `memberNick` (a deleted nick stays reserved). Databases built before #124 still hold the old plain `memberEmail_1` / `memberPhone_1`; `npm run migrate:member-indexes` swaps them; compound `{ memberType, memberStatus, createdAt: -1 }` for organizer lists and the rank job.

Written by: `MemberService` (sign-up, `updateMember`, `updateMemberByAdmin`), `OrganizerService` (status, `rejectReason`, `commissionOverride`), `memberStatsEditor` (counter `$inc`), `BatchService` (`memberRank`, `completedEvents`), `seed.ts` / `libs/admin-seed.ts` (admins), the demo seeder.

## 2. `venues` (`Venue.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `venueName`, `venueCity`, `venueAddress` | string | required | |
| `venueType` | enum STADIUM/THEATER/CLUB/HALL/OPEN_AIR/ONLINE | required | |
| `venueCoordinates` | [number] | | used by `looksLikeSamePlace` for the admin conflict hint |
| `venueTimezone` | string | `Asia/Seoul` | IANA zone; used for refund deadline and payout date |
| `venueLayout` | `{ sections[] }` | optional | seat map definition |
| `venueLayout.sections[]` | `{ key, name, kind SEATED/STANDING, rows 1-100, seatsPerRow 1-100, capacity?, x, y, rotation, spacing COMPACT/NORMAL/WIDE, tierKey? }` | `_id: false` | one block of seats or a standing area |
| `venueCapacity` | number | required, computed by the server | rows x seatsPerRow for SEATED, `capacity` for STANDING |
| `venueImages` | [string] | [] | |
| `venueStatus` | enum ACTIVE/CLOSED/DELETE | ACTIVE | |
| `memberId` | ObjectId -> Member | required | creator |

Indexes: unique `(venueCity, venueName, venueAddress)` (stops duplicate places); `(venueStatus, venueCity)` for `getVenues`.
Written by: `VenueService`. Layout is read by event approval (`generateEventSeats`) and `getEventSeatMap`. Venues without a layout (created before layouts existed) can host GENERAL events only.

## 3. `events` (`Event.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `eventCategory` | enum CONCERT/SPORT/FOOTBALL/COMEDY/THEATER/CONFERENCE/FESTIVAL/OTHER | required | |
| `eventStatus` | enum DRAFT/PENDING/APPROVED/REJECTED/CANCELLED/ENDED | DRAFT | `02` 1.3 |
| `seatingType` | enum GENERAL/RESERVED | GENERAL | quantity tickets vs seats |
| `eventTitle` | string | required | |
| `eventDesc` | string | | |
| `eventImages` | [string] | required | paths |
| `eventTranslations` | `[{ locale en/ko/ru/uz, title, description? }]` | [] | organizer-saved translations |
| `eventMinPrice` | number | 0 | cheapest non-paused ticket price, kept by `refreshEventMinPrice` |
| `eventViews`, `eventLikes`, `eventComments`, `eventRank` | number | 0 | counters; `eventRank` by the batch job |
| `organizerId` | ObjectId -> Member | required | owner |
| `venueId` | ObjectId -> Venue | required | |
| `startAt`, `endAt` | date | required | |
| `saleStartAt`, `saleEndAt` | date | | event-level sales window |
| `rejectReason`, `cancelReason` | string | | visible to owner/admin |
| `eventModeration` | `{ checked, flags[{type,reason,confidence}], reason, confidence, model, checkedAt }` | | AI hint for admins |
| `deletedAt` | date | | declared; never written |

Computed (not stored) on read: `eventTotalSeats`, `eventSoldSeats`, `memberData`, `venueData`, `meLiked`, `possibleVenueConflicts`.

Indexes and why:

- unique `(organizerId, venueId, eventTitle, startAt)`: the same organizer cannot create two identical events (race-safe duplicate guard).
- `(eventCategory, eventStatus, startAt)`: public list filtered by category.
- `(eventStatus, createdAt: -1)`: default public/admin list order.
- `(eventStatus, endAt)`: the batch job that ends finished events.
- `(venueId, startAt)`: venue clash checks and conflict hints.

Written by: `EventService`, `BatchService` (`eventRank`, ENDED), `AiModerationService.store` (`eventModeration`), `TicketTypeService.refreshEventMinPrice`, counters from `like`/`view`/`comment` code.

## 4. `ticketTypes` (`TicketType.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `eventId` | ObjectId -> Event | required | |
| `ticketTypeName` | string | required | |
| `ticketPrice` | number | required, min 0 | KRW for new data |
| `ticketCurrency` | enum USD/EUR/KRW/UZS | required | only KRW accepted by the API |
| `tierKey` | string | | links to SEATED sections of the layout |
| `totalQuantity` | number | required, min 0 | stock; for RESERVED events set from seats |
| `soldQuantity` | number | 0, min 0 | sold **plus unpaid reservations** for GENERAL events; seats of PAID orders for RESERVED events |
| `maxPerOrder` | number | required, min 1 | |
| `saleStartAt`, `saleEndAt` | date | | per-ticket-type window |
| `ticketTypeStatus` | enum ACTIVE/PAUSED/SOLD_OUT | ACTIVE | |

Indexes: unique `(eventId, ticketTypeName)`; unique partial `(eventId, tierKey)` where `tierKey` is a string ("one ticket type per tier, so every seat has exactly one ticket type").
Written by: `TicketTypeService` (create, update, `reserve`, `release`, `addSold`), `order-expiry.ts` (stock give-back), `generateEventSeats` (sets `totalQuantity`).

## 5. `eventSeats` (`EventSeat.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `eventId` | ObjectId -> Event | required | |
| `ticketTypeId` | ObjectId -> TicketType | required | price tier of this seat |
| `sectionKey` | string | required | which layout section |
| `row`, `number` | number | required, min 1 | counted from 1 |
| `seatStatus` | enum AVAILABLE/HELD/SOLD | AVAILABLE | `02` 1.5 |
| `heldBy` | ObjectId -> Member | | holder while HELD |
| `heldUntil` | date | | hold deadline |
| `orderId` | ObjectId -> Order | | set while SOLD |

Indexes: unique `(eventId, sectionKey, row, number)` (idempotent generation); `(eventId, seatStatus)` (seat map); `(seatStatus, heldUntil)` (hold sweep); `(eventId, heldBy)` (a member's holds on an event).
Written by: `EventService.generateEventSeats` (insert via `$setOnInsert` upsert), `SeatService`, `order-expiry.ts`, `RefundService.releaseStock` (through `SeatService.releaseSoldSeats`). A real event can have thousands of seats (the demo seed writes several thousand documents).

## 6. `orders` (`Order.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `orderNumber` | string | required, **unique** | human reference, `TZ-<time>-<random>` |
| `orderStatus` | enum PENDING_PAYMENT/PAID/FAILED/CANCELLED/EXPIRED/REFUNDED | PENDING_PAYMENT | `02` 1.6 |
| `buyerId` | ObjectId -> Member | required | |
| `eventId` | ObjectId -> Event | required | |
| `items` | `[{ ticketTypeId, quantity >= 1, unitPrice }]` | required | purchased lines; `_id: false` |
| `seatIds` | [ObjectId -> EventSeat] | [] | RESERVED orders only |
| `currency` | string | | |
| `subtotal`, `commissionRate`, `commissionAmount`, `totalAmount` | number | required | frozen at checkout; rate in percent; `totalAmount` = what the buyer pays (= subtotal) |
| `expiresAt` | date | required | when an unpaid order dies |
| `paidAt`, `refundedAt` | date | | |

Indexes: unique `orderNumber`; `(buyerId, createdAt: -1)` (my orders); `(eventId, orderStatus)` (sales, payouts, seat counts); `(orderStatus, expiresAt)` (expiry sweep).
Written by: `OrderService`, `RefundService` (REFUNDED), `order-expiry.ts` (EXPIRED).

## 7. `tickets` (`Ticket.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `ticketCode` | string | required, **unique** | random 20-hex code |
| `ticketStatus` | enum VALID/USED/REFUNDED/CANCELLED | VALID | `02` 1.8 |
| `qrToken` | string | required | `<ticketId>.<hex HMAC-SHA256>`; the schema comment says "HMAC of the ticket id", the stored value also contains the id |
| `seatId` | ObjectId -> EventSeat | | RESERVED only |
| `orderId`, `ticketTypeId`, `eventId`, `ownerId` | ObjectId | required | owner = buyer |
| `checkedInAt` | date | | set on check-in |

Indexes: unique `ticketCode`; `(ownerId, createdAt: -1)`; `(orderId)` (refunds); `(eventId, ticketStatus)` (attendees).
Written by: `OrderService.payOrder` (insert), `TicketService.checkInTicket`, `RefundService`. The `_id` is generated in code *before* insert so the QR token can contain it.

## 8. `payments` (`Payment.model.ts`)

| Field | Type | Default / rule | Meaning |
|---|---|---|---|
| `orderId` | ObjectId -> Order | required | |
| `paymentProvider` | enum MANUAL/MOCK/STRIPE/PAYME/CLICK | required | only MOCK is written |
| `providerRef` | string | required, **unique** | `MOCK-<orderNumber>-<hex>` |
| `paymentStatus` | enum INITIATED/CAPTURED/FAILED/REFUNDED | INITIATED | |
| `amount` | number | required | the order's `totalAmount` |

Index: `(orderId, paymentStatus)`. Written by `PaymentService`.

## 9. `refunds` (`Refund.model.ts`)

| Field | Type | Meaning |
|---|---|---|
| `orderId` | ObjectId, required, **unique** | refund unit = whole order; the unique index is the lock |
| `eventId`, `buyerId` | ObjectId | |
| `amount`, `currency` | number, string | copy of the order total |
| `refundStatus` | PENDING (default) / COMPLETED / FAILED | |
| `refundSource` | BUYER / ADMIN / EVENT_CANCELLED | required |
| `reason` | string | |
| `requestedBy` | ObjectId -> Member | buyer or admin |
| `requestedAt`, `completedAt` | date | |
| `stockReleased` | boolean, default false | seats/stock given back once |
| `lockedAt` | date | marks a live run; a stale one (5 minutes) may be taken over |
| `failureReason` | string | |

Index: `(eventId, refundStatus)`. Written only by `RefundService`.

## 10. `payouts` (`Payout.model.ts`)

One document per event, created only when an admin marks it paid (a mock record; no money moves). Fields: `eventId` (required, **unique**), `organizerId`, `gross`, `commission`, `net` (min 1), `orderCount` (min 1), `paidAt`, `paidBy` (admin), `note` (max 300). Index: `(organizerId, paidAt: -1)`. Written by `PayoutService.markPayoutPaidByAdmin`. Status is never stored (`02` 1.10). Note `net` has `min: 1`, so a net of 0 can never be stored, matching the `NOTHING_TO_PAY` rule.

## 11. `conversations` and `messages` (`Conversation.model.ts`, `Message.model.ts`)

`conversations`: `eventId?` (absent for support), `isSupport` (default false), `organizerId` (required), `adminId` (default null; first admin to reply), `lastMessageAt` (default now), `unreadForOrganizer`, `unreadForAdmin` (default 0, min 0).
Indexes: unique partial `eventId` (only when it is an ObjectId); unique partial `organizerId` where `isSupport` is true; `(organizerId, lastMessageAt: -1)`; `(lastMessageAt: -1)`.

`messages` (GraphQL type `ChatMessage`): `conversationId`, `senderId`, `body` (trimmed, max 2000), `readAt`; `createdAt` only (no `updatedAt`). Index `(conversationId, createdAt: -1)`.
Written by `ConversationService`.

## 12. `notifications` (`Notification.model.ts`)

Fields: `notificationType` (LIKE, COMMENT, ORDER_PAID, EVENT_REMINDER, ORGANIZER_VERIFIED/REJECTED/SUSPENDED/REINSTATED, COMMISSION_UPDATED, EVENT_APPROVED/REJECTED/CANCELLED, REFUND_COMPLETED, ORDER_REFUNDED, NEW_MESSAGE, PAYOUT_PAID, PAYOUT_DUE), `notificationStatus` (WAIT default / READ), `notificationGroup` (MEMBER, EVENT, ORDER, CONVERSATION), `notificationTitle`, `notificationDesc`, `authorId`, `receiverId`, optional `eventId`, `orderId`, `conversationId`. Index `(receiverId, notificationStatus, createdAt: -1)`. Written only by `NotificationService.createNotification`. `EVENT_REMINDER` is in the enum; only the demo seeder (`demo-seeder.ts`, `extraNotifications`) creates one, no API code does.

## 13. `audit_logs` (`AuditLog.model.ts`)

Fields: `actorId`, `action` (22 values of `AuditAction`), `targetType` (MEMBER, EVENT, ORDER, NOTICE, COMMENT, CONVERSATION), `targetId`, `meta` (Mixed, default {}). Indexes: `(createdAt: -1)`, `(targetId, createdAt: -1)`, `(actorId, createdAt: -1)`. Written only by `AuditLogService.record`. Rule (`AGENTS.md`, decision #94): `meta` holds field names, reasons and ids, never personal values or secrets. Read by `getAuditLogsByAdmin`.

## 14. Social and content collections

| Collection | File | Fields | Indexes | Writer |
|---|---|---|---|---|
| `comments` | `Comment.model.ts` | `commentStatus` (ACTIVE/DELETE), `commentGroup` (EVENT), `commentContent`, `commentRefId`, `memberId` | `(commentRefId, commentGroup, commentStatus, createdAt: -1)` | `CommentService` |
| `likes` | `Like.model.ts` | `likeGroup` (MEMBER/EVENT), `likeRefId`, `memberId` | unique `(memberId, likeRefId, likeGroup)` | `LikeService.toggleLike` |
| `views` | `View.model.ts` | `viewGroup` (MEMBER/EVENT), `viewRefId`, `memberId` | unique `(memberId, viewRefId, viewGroup)` | `ViewService.recordView` |
| `follows` (legacy, #122) | none in the API (`LegacyFollow.model.ts`, demo scripts only) | `followingId`, `followerId` | the old unique indexes stay in the database; nothing creates them | nothing; kept untouched, `reset:demo` removes the seeded ones through the manifest |
| `notices` | `Notice.model.ts` | `noticeCategory` (FAQ/TERMS/INQUIRY), `noticeStatus` (HOLD/ACTIVE/DELETE), `noticeTitle`, `noticeContent`, `memberId` | `(noticeStatus, createdAt: -1)` | `NoticeService` |

`likes` and `views` use the same group enums and are the source for "favorites" and "visited" lists.

## 15. `ai_usage` (`AiUsage.model.ts`)

Counters of AI use per UTC day. `usageKey` (required, unique) is `global:<day>` (model calls of the whole app) or `key:<day>:<member id or ip>` (assistant operations of one caller); `day` (`YYYY-MM-DD`); `count` (default 0); `expireAt` (required). TTL index `expireAt` with `expireAfterSeconds: 0` removes a counter after `expireAt`. Only counts and keys are stored, never prompts. Written by `AiUsageService.consume`. The service sets `expireAt` to 3 days after the day starts (`3 * DAY_MS`); the schema comment says two days (oddity).

## 16. Demo seed collection `demo_seed_records` (`DemoSeedRecord.model.ts`)

The manifest of the demo seed. One row per *root* document the seed created: `runId` (string), `recordType` (`Member`, `Venue` or `Event`), `recordId`; only `createdAt`. Unique index `(recordType, recordId)`. Written by the seeder (`DemoSeeder.track` in `apps/ticketzy-api/src/demo-seeder.ts`) *before* it creates each root, so a crash leaves a complete manifest. The API never reads it. `reset:demo` derives everything that hangs off those roots (ticket types, seats, orders, tickets, payments, refunds, payouts, comments, likes, views, (old follows, #122), conversations, messages, notifications, audit entries) from the roots (`libs/demo-manifest.ts`, `removeDemoData`). A member is removed only if its id is in the manifest **and** its email ends with `@ticketzy.demo`, and never if it is an ADMIN. An event that somebody else bought tickets for stays, with its organizer, venue and orders, and is reported.

## 17. Counters kept in sync by hand

Counters are separate writes after the main change; none is wrapped in a transaction. The recomputation source is in the right-hand column.

| Counter | Where | Changed by | Recompute from |
|---|---|---|---|
| `Member.memberEvents` | member | +1 `createEvent`; -1 cancel (`cancelEvent`) and draft removal | count of events (the public page shows a live count of APPROVED events instead, `useVisibleEventCount`) |
| `Member.completedEvents` | member | +1 `BatchService.batchEndEvents` | ENDED events |
| `Member.memberLikes`, `Event.eventLikes` | | `likeTargetMember`, `likeTargetEvent` via `toggleLike` | `likes` |
| `Member.memberViews`, `Event.eventViews` | | `getMember`, `getEvent` when `recordView` inserted | `views` (never decremented by design) |
| `Event.eventComments` | event | +1 create, -1 soft delete or admin remove | `comments` |
| `Member.memberRank`, `Event.eventRank` | | batch rank jobs (computed then written) | formula in `apps/ticketzy-batch/src/lib/rank.ts` |
| `TicketType.soldQuantity` | | `reserve`, `release`, `addSold`, expiry | paid orders (reserved) / paid + unpaid reservations (general) |
| `Event.eventMinPrice` | | `refreshEventMinPrice` | ticket types |
| `Conversation.unreadFor*` | | `sendMessage`, `markConversationRead` | `messages.readAt` |
| `eventTotalSeats`, `eventSoldSeats` | not stored | `attachSeatCounts` at read time | ticket types, paid orders |

The demo consistency check (`libs/demo-consistency.ts`) compares several of these with the records they count (sold counters vs paid orders, no oversold type, SOLD_OUT flag vs counts, seats vs tickets vs orders, commission tiers, payouts adding up).
