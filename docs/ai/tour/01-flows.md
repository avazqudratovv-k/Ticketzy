# 01 - The twelve most important flows

**What this file covers.** Twelve end-to-end flows, each as numbered steps from the user's action (a GraphQL call from the frontend) down to MongoDB and back. Every step names the file and the function that does it. Paths start at `apps/ticketzy-api/src/` unless written otherwise; `components/x/x.service.ts` means `apps/ticketzy-api/src/components/x/x.service.ts`. The state machines are in `02-state-and-rules.md`, the full operation list in `03-api.md`.

Three NestJS ideas you need first, because every flow uses them:

1. **Request pipeline.** A GraphQL request goes through: Express middleware in `main.ts` (helmet, CORS, general rate limit on `/graphql`, upload token check) -> Apollo -> for each operation, the **guards** on the resolver method -> the global **ValidationPipe** that checks and cleans the input (`libs/validation.ts`: `whitelist: true` strips fields without a validator decorator, `transform: true` turns plain objects into DTO class instances) -> the resolver method -> the service -> Mongoose -> MongoDB. Errors come back through `formatGraphQLError` (`libs/error-mapping.ts`).
2. **Who is calling.** A guard verifies the `Authorization: Bearer <jwt>` header, loads the member from the database, and stores it on `request.body.authMember`. The decorator `@AuthMember('_id')` (`components/auth/decorators/authMember.decorator.ts`) then hands it to the resolver. The token holds only `{ _id, memberType }` (`TokenPayload`, `auth.service.ts`), so a suspended account is refused on the very next request.
3. **No transactions.** MongoDB here runs without a replica set, so races are decided by *conditional updates*: `findOneAndUpdate(filter containing the expected state, update)`. If the filter does not match, someone else changed the document first and nothing is written (decision #17). You will see this pattern in almost every flow.

---

## Flow 1 - Sign up and sign in

**Sign up** (`signupUser` for buyers, `signupOrganizer` for organizers)

1. The frontend calls the mutation `signupUser(input: MemberInput)`. No guard: `components/member/member.resolver.ts` `signupUser`.
2. `enforceSignupLimit(context.req)` (`libs/rate-limit.ts`) counts the call against the per-IP signup window (default 5 per hour). Over the limit it throws `CodedException` with code `RATE_LIMITED` and `retryAfterSeconds`.
3. The ValidationPipe checks `MemberInput` (`libs/dto/member/member.input.ts`): `memberEmail` (`IsEmail`, lower-cased and trimmed by `normalizeEmail`), `memberPassword` (min 8), optional `memberNick` (3 to 50), `memberFullName` (3 to 100). A failure becomes `VALIDATION_FAILED` with the field names (`libs/validation.ts`).
4. `MemberService.signup` (`components/member/member.service.ts`) hashes the password with `AuthService.hashPassword` (bcryptjs, a generated salt).
5. `memberModel.create({... memberType, memberStatus, memberAuthType: EMAIL })`. The **server** picks the role: `signupUser` passes `USER` + `ACTIVE`, `signupOrganizer` passes `ORGANIZER` + `PENDING`. The input has no role field (decision #23).
6. A duplicate email, nick or phone hits a unique index (`Member.model.ts`) and Mongo error code 11000; `signup` converts it to `BadRequestException(USED_MEMBER_EMAIL_NICK_OR_PHONE)`.
7. `AuthService.createToken` signs `{ _id, memberType }` with `SECRET_TOKEN`, valid 1 day (`auth.module.ts`: `expiresIn: '1d'`). The mutation returns the `Member` with `accessToken`. Private fields (email, phone) are hidden by field resolvers in `member.resolver.ts` unless the viewer is the member or an admin.

**Sign in** (`login`)

1. `MemberResolver.login` calls `enforceLoginLimit(req, memberEmail)`: one window per IP (10 per 15 min) and one per email (twice as many) so a distributed guess still hits one account.
2. `MemberService.login` loads the member with `select('+memberPassword')` (the password field is `select: false` in the schema).
3. `AuthService.comparePasswords` always runs bcrypt, against a dummy hash when the email is unknown, so a missing account costs the same time as a wrong password.
4. Unknown email or wrong password: `UnauthorizedException(WRONG_EMAIL_OR_PASSWORD)` (same text for both).
5. If the status is `REJECTED`, `SUSPENDED` or `DELETE` (`unverifiedMemberStatuses`, `member.enum.ts`) the answer is a `GraphQLError` with code `ACCOUNT_NOT_VERIFIED` (it must be a `GraphQLError`, not an `HttpException`, or Apollo would overwrite the code, decision #64). `PENDING` organizers *can* log in.
6. A token is created as in sign-up and returned.

**Every later request**

1. A guard (`AuthGuard`, `RolesGuard`, `WithoutGuard`, ... in `components/auth/guards/`) calls `AuthService.getBearerToken` then `authenticate` -> `verifyToken` (jwt) -> `loadMember` (database read, status check).
2. `WithoutGuard` never fails: a guest, a bad token or an unverified account all become `authMember = null`, so public queries can still personalise ("did I like this?").

---

## Flow 2 - Organizer approval

1. An organizer signs up (Flow 1): `memberType: ORGANIZER`, `memberStatus: PENDING`. They can log in and read their data.
2. Any organizer write (`createVenue`, `createEvent`, `createTicketType`, `submitEventForApproval`, `checkInTicket`, ...) is guarded by `@Roles(ORGANIZER)` + `RolesGuard` + `ActiveOrganizerGuard`. The last one (`components/auth/guards/organizer.guard.ts`) throws `ORGANIZER_NOT_APPROVED` while the status is not `ACTIVE`.
3. An admin lists candidates with `getOrganizersByAdmin` (`components/organizer/organizer.resolver.ts`, `OrganizerService.getOrganizersByAdmin`: filter by status and text on name/nick/email, `$facet` pagination).
4. The admin calls `verifyOrganizerByAdmin(memberId)`.
5. `OrganizerService.changeStatus(adminId, memberId, 'verify')` reads the rule from `organizerTransitions` (`libs/enums/member.enum.ts`): from `[PENDING]` to `ACTIVE`.
6. One conditional update: `findOneAndUpdate({ _id, memberType: ORGANIZER, memberStatus: { $in: from } }, { $set: { memberStatus: to }, $unset: { rejectReason } })`. If it matches nothing, the code reads the member again: not found -> `NO_ORGANIZER_FOUND`, otherwise `INVALID_STATUS_TRANSITION`. Two admins clicking at once cannot both succeed.
7. After the change: `AuditLogService.record` writes `ORGANIZER_VERIFIED` (meta has `fromStatus`, `toStatus`), `NotificationService.createNotification` tells the organizer, and `syncSockets` calls `ConversationRealtime.setMemberRestricted(id, false)` so open chat sockets get their rooms back. None of these three can throw.
8. `rejectOrganizerByAdmin` (PENDING to REJECTED, reason required, stored in `rejectReason`), `suspendOrganizerByAdmin` (ACTIVE to SUSPENDED, reason required), `reinstateOrganizerByAdmin` (SUSPENDED or REJECTED to ACTIVE) follow the same path. Reject/suspend restrict the sockets.
9. `updateMemberByAdmin` refuses to change an organizer's status or role (`USE_ORGANIZER_OPERATIONS`), so nothing bypasses audit and notification.
10. Commission: `setCommissionOverrideByAdmin` / `clearCommissionOverrideByAdmin` store or remove `commissionOverride { rate, endsAt, reason }` on the member (used in Flow 8).

---

## Flow 3 - Create a venue and its layout

1. (Optional) The organizer uploads photos with `imageUploader(file, target: "venue")` (`member.resolver.ts`). First `createUploadAuthMiddleware` (`libs/upload-guard.ts`) refuses any `multipart/*` request without a valid bearer token, *before* the multipart parser runs (decision #98). Then `AuthGuard`, then `saveVerifiedImage` (`libs/config.ts`) reads the first 8 bytes, accepts only PNG or JPEG signatures, and writes `uploads/venue/<uuid>.<ext>`. The mutation returns that relative path. `validUploadTargets` = `member`, `event`, `venue`.
2. The organizer calls `createVenue(input: VenueInput)`. Guards: `@Roles(ORGANIZER, ADMIN)`, `RolesGuard`, `ActiveOrganizerGuard` (`components/venue/venue.resolver.ts`). The resolver sets `input.memberId` from the token.
3. `VenueInput` (`libs/dto/venue/venue.input.ts`) validates name 2 to 100, type, city 2 to 100, address 3 to 200, optional coordinates and time zone, and `venueLayout.sections[]` (each: key 1 to 30 chars, name, `kind` SEATED/STANDING, `rows` and `seatsPerRow` 1 to 100, x, y, rotation, spacing, optional `capacity`, `tierKey`). There is **no** capacity field on the input.
4. `VenueService.createVenue` -> `assertValidLayoutAndTimezone`: `isValidTimezone` (tries `Intl.DateTimeFormat`), `getVenueLayoutError` (`libs/venue-layout.ts`: at least one section, unique keys, grid 1 to 100, STANDING needs capacity >= 1, SEATED needs a tier key), then `computeLayoutCapacity` (seated: rows x seatsPerRow, standing: capacity).
5. `venueModel.create({ ...input, venueCapacity })`. Any error here, including the unique index on `(venueCity, venueName, venueAddress)`, becomes `BadRequestException(CREATE_FAILED)`.
6. `updateVenue` can edit a venue (creator or admin). It refuses `venueLayout` in the input with `VENUE_LAYOUT_LOCKED` when any non-DRAFT event at that venue already has generated `EventSeat`s (`hasGeneratedSeats`), because seats are copies of the layout.

---

## Flow 4 - Create and submit an event

1. `createEvent(input: EventInput)` - organizer guards as above (`components/event/event.resolver.ts`). The resolver forces `organizerId` from the token and converts `venueId`.
2. `EventService.createEvent` (`components/event/event.service.ts`):
   - `assertValidDates`: `endAt` must not be before `startAt`; `getSalesWindowError` (`libs/sales-window.ts`) checks sales start < sales end <= event end.
   - `assertVenueUsable`: the venue must exist and be `ACTIVE`.
   - `assertVenueFree`: no PENDING/APPROVED/ENDED event of the same venue record may overlap `[startAt, endAt)` (`buildVenueClashFilter`, `libs/venue-conflicts.ts`). Check-then-write, so two simultaneous requests could both pass (decision #83).
   - `eventModel.create({ ...input, eventStatus: DRAFT })`, then `memberStatsEditor` adds 1 to the organizer's `memberEvents`.
3. For each price tier: `createTicketType(input)` (`components/ticket-type/ticket-type.service.ts`):
   - `assertCanManageEvent` (owner or admin, event not CANCELLED/ENDED).
   - currency must be KRW (`ONLY_KRW_TICKETS`) and the event must have no non-KRW type (`EVENT_HAS_OTHER_CURRENCY`).
   - `resolveTotalQuantity`: GENERAL events need `totalQuantity` from the client; RESERVED events *refuse* a client quantity and compute it from the seats of the sections whose `tierKey` matches (`countTierSeats`).
   - create, then `refreshEventMinPrice` sets `Event.eventMinPrice` to the cheapest non-paused ticket type.
4. Optionally `translateEvent` asks the AI for translations (Flow 5 explains the AI path); nothing is saved until the organizer sends the reviewed text with `updateEvent`.
5. `updateEvent` (DRAFT, REJECTED, or APPROVED) goes through `applyUpdate`: loads the event, checks `editableEventStatuses`, re-validates dates, venue and slot (only if they changed), then updates **conditionally on the status it just read**. An APPROVED event goes back to PENDING (needs a new review). PENDING, CANCELLED and ENDED answer `EVENT_NOT_EDITABLE`. Changing `venueId` or `seatingType` (the seat layout) is refused with `EVENT_LAYOUT_LOCKED` when the event is APPROVED or already has `EventSeat` rows (an approved, edited, then rejected event keeps its seats); in DRAFT and in REJECTED without seats it is allowed. Sending the current value again is not a change (`assertSeatLayoutUnlocked`, decision #117).
6. `submitEventForApproval(eventId)` -> `EventService.submitEventForApproval`:
   - owner-only lookup; `eventTransitions.submit` allows DRAFT or REJECTED.
   - `getEventSubmitError` (pure function) returns the first failure: title, at least one image, dates in the future, sales window, active venue, at least one ticket type, and for RESERVED events a seated section plus a ticket type for every seated tier (`getMissingTierKeys`).
   - `assertVenueFree` again.
   - conditional update to `PENDING` (and `$unset` of `rejectReason`).
   - fire and forget: `void this.aiModerationService.moderateEvent(id)` (never throws, never blocks).

---

## Flow 5 - Admin approval and AI moderation

**Moderation (runs automatically after submit)**

1. `AiModerationService.moderateEvent(eventId)` (`components/ai/ai-moderation.service.ts`) loads the event.
2. `AiClientService.reserve(key)` checks AI is enabled and keyed, applies the per-minute limit (`begin`, in memory) and the per-caller daily cap (`AiUsageService.consume`, in MongoDB). The key is `member:<organizerId>`, so moderation spends the organizer's daily AI allowance.
3. `buildPayload` collects title, description, translations, venue, ticket types and up to 30 other titles of the same organizer, each clipped. It is sent as **one JSON user message**; the system prompt calls it untrusted data.
4. `AiClientService.generateJson` runs the provider chain (details in `05-modules.md`): each attempt is charged against the global daily cap.
5. `parseModerationResult` (`libs/ai.ts`) is strict: unknown flag type, confidence outside 0..1, wrong types, or more than 10 flags throw. Only known fields are copied.
6. `store` writes `eventModeration { checked: true, flags, reason, confidence, model, checkedAt }`. Any failure (AI off, limit, timeout, bad JSON) is stored as `checked: false` with a reason. It only *flags*; it never changes the event status.
7. An admin can re-run it with `runEventModerationByAdmin(eventId)` (`ai.resolver.ts`), which also writes an audit entry `EVENT_MODERATION_RUN`.

**Approval**

1. The admin lists `getEventsByAdmin` (status/category/organizer/text filters, `limit` up to 200). `EventService.getEventsByAdmin` adds seat counts and `attachPossibleVenueConflicts` (admin-only hints about the same place under another venue record).
2. `approveEventByAdmin(eventId)` -> `EventService.approveEventByAdmin`:
   - reads the event; it is *approvable* if status is PENDING and the organizer is not the acting admin.
   - `assertVenueFree` once more (another event may have taken the slot while this one waited).
   - for RESERVED events: `generateEventSeats` loads the venue layout and ticket types, checks every seated tier has exactly one ticket type, builds one `updateOne ... upsert` per seat with `$setOnInsert` (so existing HELD/SOLD seats are never touched), runs `bulkWrite` in chunks of 5000 (`SEAT_BULK_SIZE`) with `ordered: false`, then sets each ticket type's `totalQuantity` to its seat count. Failure -> `SEAT_GENERATION_FAILED`, nothing else changed.
   - `changeStatusByAdmin(adminId, eventId, 'approve')`: conditional update `{ _id, eventStatus: {$in: [PENDING]}, organizerId: {$ne: adminId} }` -> APPROVED.
   - then `AuditLogService.record(EVENT_APPROVED)` and a notification `EVENT_APPROVED` to the organizer.
3. `rejectEventByAdmin({ eventId, reason })` is the same path (PENDING to REJECTED, reason required, stored as `rejectReason`, which only the owner and admins can read through field resolvers in `event.resolver.ts`).
4. `updateEventByAdmin` edits content without touching status; `removeEventByAdmin` deletes a DRAFT only, with its ticket types.

---

## Flow 6 - Browse and search events

1. `getEvents(input: EventsInquiry)` - `WithoutGuard`, so guests work (`event.resolver.ts`).
2. Validation: `page` 1 to 10000 and `limit` 1 to 100 through `PageField` / `LimitField` (`libs/dto/common/pagination.ts`); `sort` must be in `availableEventSorts` (`libs/config.ts`: createdAt, updatedAt, eventLikes, eventViews, eventRank, eventMinPrice, startAt).
3. `EventService.getEvents` builds `match = { eventStatus: APPROVED }` (`publicEventStatus`) and `shapeMatchQuery` adds: organizer, category list, venue, `cityList` (resolved to venue ids with `venueModel.distinct`), price range on `eventMinPrice`, period on `startAt`, and `text` (one `$or` over title, translated titles, category names, matching venues and matching organizers; case-insensitive; user text goes through `escapeRegExp`).
4. One aggregation: `$match`, then `lookupActiveOrganizer` (join the organizer and drop events whose organizer is not ACTIVE), `$sort`, then `$facet` with `list` (`$skip`, `$limit`, `lookupAuthMemberLiked`, `lookupVenue`) and `metaCounter` (`$count`).
5. `addSeatCounts` (`libs/seat-counts.ts`) adds `eventTotalSeats` and `eventSoldSeats` for the whole page with exactly two more aggregations (sum of `totalQuantity`; sum of paid-order quantities).
6. `getEvent(eventId)` returns one event: anyone sees APPROVED events of ACTIVE organizers; the owner and admins see any status. A hidden event answers `NO_DATA_FOUND`, same as a missing one. If a member is logged in and the event is public, `ViewService.recordView` does one upsert on the unique `(memberId, viewRefId, viewGroup)` key; only the call that inserts bumps `eventViews`.
7. Related public reads: `getTicketTypes(eventId)` (first frees stale unpaid orders for that event, `sweepStaleOrders`), `getVenue(s)`, `getComments`, `getOrganizers`, `getNotices`.

---

## Flow 7 - Select seats and hold them

1. The frontend asks `getSeatConfig` (public) for `{ seatHoldSeconds, maxSeatsPerOrder }` and `getEventSeatMap(eventId)` for the picture.
2. `EventService.getEventSeatMap` (404 `NO_DATA_FOUND` as a `CodedException` for anything that has no map): requires an APPROVED RESERVED event of an ACTIVE organizer and a venue with a layout. It returns the venue layout plus **only the seats that are not free**: `SOLD`, and `HELD` with `heldUntil > now` (an expired hold counts as free). The caller's own active holds carry `mine: true` and `holdExpiresAt`. `heldBy` is never returned.
3. The buyer selects seats and calls `holdSeats(eventId, seatIds? | seats?)` - `AuthGuard` (`components/seat/seat.resolver.ts`). Send exactly one of `seatIds` or `seats: [{_id}] / [{sectionKey,row,number}]`.
4. `SeatService.resolveSeatInput` turns coordinates into ids with one query inside the event (`SEAT_REF_INVALID`, `SEAT_INPUT_INVALID`, `SEAT_NOT_FOUND`).
5. `SeatService.holdSeats`:
   - `normalizeSeatIds`: 1 to 8, unique (`SEAT_HOLD_LIMIT`).
   - the buyer must be an ACTIVE member and `assertBuyerAccount` (`libs/buyer.ts`) requires `MemberType.USER`.
   - `assertEventOpenForSeats`: APPROVED, RESERVED, not started, organizer ACTIVE, `getPurchaseWindowError` passes.
   - the member's other holds on this event are released first (`updateMany` back to AVAILABLE).
   - for each seat, one conditional update: match `_id`, `eventId` and (`AVAILABLE`, or `HELD` with `heldUntil <= now`, or `HELD` by the same member); set `HELD`, `heldBy`, `heldUntil = now + SEAT_HOLD_SECONDS`.
   - if any seat does not match, the seats claimed in this call are released and `SEAT_JUST_TAKEN` is thrown.
6. The answer is `SeatHold { eventId, seats[], heldUntil, holdSeconds, serverTime }`; `serverTime` lets the client count down without trusting its own clock.
7. `releaseSeats(eventId)` frees the caller's own holds. Expired holds are freed by `releaseExpiredSeatHolds` in the batch job and lazily (Flow 8 and `02-state-and-rules.md`).

---

## Flow 8 - Checkout and simulated payment

**Checkout** (`createCheckout(input: CheckoutInput)`, `AuthGuard`, `components/order/order.resolver.ts`)

1. `OrderService.createCheckout` loads the buyer (ACTIVE, `assertBuyerAccount`), the APPROVED event, an ACTIVE organizer (with `completedEvents` and `commissionOverride`), and runs `getPurchaseWindowError` (`EVENT_ENDED_NO_SALES`, `SALES_NOT_STARTED`, `SALES_CLOSED`).
2. `getCommissionRate(organizer, now)` (`libs/commission.ts`): the override if it has no `endsAt` or `endsAt` is in the future, else 5 percent from 20 completed events, 7 from 5, otherwise 10.
3. **RESERVED event** -> `checkoutSeats`: input must have `seatIds` and no `items`; `SeatService.findHeldSeats` requires every seat to be HELD by this buyer with `heldUntil > now` (else `HOLD_EXPIRED`); `TicketTypeService.findSellable` loads the seats' ticket types (ACTIVE and inside their own sale window); prices come from the ticket types; `expiresAt` is the **earliest** `heldUntil`.
4. **GENERAL event** -> `checkoutQuantities`: input must have `items` and no `seatIds`; for each item `TicketTypeService.reserve(ticketTypeId, quantity)` does one conditional `findOneAndUpdate` whose filter holds status ACTIVE, `maxPerOrder >= quantity`, `soldQuantity + quantity <= totalQuantity` (via `$expr`) and the sale window, with `$inc: { soldQuantity: quantity }`. If it fails once it sweeps stale orders of that ticket type and retries once. When `soldQuantity` reaches `totalQuantity` a second conditional update sets `SOLD_OUT`. `expiresAt = now + SEAT_HOLD_SECONDS`. If a later item fails, earlier reservations are released.
5. `createOrderDocument` computes `subtotal`, `commissionAmount = round2(subtotal * rate / 100)` and `totalAmount = subtotal` (`calculateOrderAmounts`: the buyer pays the subtotal, the commission comes out of the organizer's share) and stores them with `orderNumber`, `status PENDING_PAYMENT`, `items[]`, `seatIds`, `currency`, `expiresAt`. The client never sends a price.

**Payment** (`payOrder(orderId, simulate: SUCCESS | FAILURE)`, `AuthGuard`)

1. `OrderService.payOrder`: `getPaymentMode() === 'disabled'` throws a `GraphQLError` with code `SERVICE_UNAVAILABLE` and text `PAYMENTS_DISABLED`.
2. The payer must be a `USER`; the order must be theirs. A `PAID` order is returned unchanged (idempotent). Any status other than `PENDING_PAYMENT` -> `ORDER_NOT_PAYABLE`. Past `expiresAt` -> `expireOrder` (conditional flip to EXPIRED, release seats or stock) and `HOLD_EXPIRED`.
3. `PaymentService.charge` -> `MockPaymentProvider.charge` (`components/payment/mock-payment.provider.ts`): `FAILURE` returns `{ success:false }`, otherwise a `providerRef` like `MOCK-<orderNumber>-<hex>`. No money moves.
4. Failure: `failOrder` flips PENDING_PAYMENT to FAILED (conditional), releases seats or stock, records a `FAILED` `Payment`, returns the order.
5. Success, reserved seats: `SeatService.markSold` does one conditional update per seat (HELD by this buyer, `heldUntil > now`) to `SOLD` with `orderId`. If one fails, `revertSold` puts the earlier ones back to HELD, the charge is refunded (`refundQuietly`) and `HOLD_EXPIRED` is thrown. A parallel `payOrder` that already won returns the PAID order.
6. The order is marked `PAID` with `paidAt` by a conditional update on `PENDING_PAYMENT`. If that fails (cancelled/expired meanwhile) the seats revert and the charge is refunded.
7. Still inside one try block: `TicketTypeService.addSold` (adds seat counts to `soldQuantity`, may set `SOLD_OUT`), `PaymentService.record` (`Payment` CAPTURED), `ticketModel.insertMany(buildTickets(...))` (Flow 9). If any of this throws, everything is undone (release counts, delete tickets and payment records, set the order back to PENDING_PAYMENT, revert seats, refund) and the buyer gets `SOMETHING_WENT_WRONG` and can retry while the hold lasts.
8. `notifyOrderPaid` tells the buyer ("Payment received") and the organizer ("New ticket sale"); it sits outside the try block so a notification problem never undoes a payment.
9. `cancelPendingOrder(orderId)` is a buyer's own cancel: conditional PENDING_PAYMENT to CANCELLED, then `releaseResources`.

---

## Flow 9 - Ticket creation and QR display

1. Tickets are created inside `payOrder` (step 7 above) by `OrderService.buildTickets`: one `Ticket` per seat (RESERVED) or per purchased quantity (GENERAL).
2. For each ticket a new ObjectId `_id` is generated *first*, then `qrToken = buildQrToken(_id)` (`libs/qr-token.ts`) = `<ticketId>.<hex HMAC-SHA256 of the id with QR_SECRET>`. `ticketCode` is `randomBytes(10)` as 20 upper-case hex characters from `OrderService.generateTicketCode` (random, not sequential, so it cannot be guessed; `orderNumber` is `TZ-<time base36>-<3 random bytes hex>`). Both tokens are stored on the document (`Ticket.model.ts`).
3. The buyer reads tickets with `getMyTickets(input: TicketsInquiry)` (page, limit, optional `timeFilter` UPCOMING = event not ended, PAST) or `getTicket(ticketId)`; both are `AuthGuard` and filter on `ownerId` = the caller (`components/ticket/ticket.service.ts`). They join event + venue (`lookupEventWithVenue`), ticket type and seat in one aggregation.
4. The `qrToken` field is returned only by these owner-only reads (`libs/dto/ticket/ticket.ts` description: "only the owner receives it"). The check-in result type never contains it.
5. The QR *picture* is drawn by the frontend from the `qrToken` text. The backend stores and returns text only; it does not render an image.

---

## Flow 10 - QR scan and check-in

1. The organizer's gate app calls `checkInPreview(qrToken, eventId?)` (a Query that changes nothing) and then `checkInTicket(qrToken, eventId?)` (the Mutation). Guards: `@Roles(ORGANIZER, ADMIN)`, `RolesGuard`, `ActiveOrganizerGuard` (`components/ticket/ticket.resolver.ts`).
2. `TicketService.validateScan` (`components/ticket/ticket.service.ts`), in this order:
   1. `parseQrToken`: regex `^([a-f0-9]{24})\.([a-f0-9]{64})$`, then `verifyQrToken` recomputes the HMAC and compares with `timingSafeEqual`. No database access yet; forged codes stop here with `QR_INVALID`.
   2. `ticketModel.findOne({ _id: ticketId, qrToken })` - the stored token must equal the scanned one (`QR_INVALID`).
   3. If the gate is set to an event: `ticket.eventId` must match (`TICKET_WRONG_EVENT`).
   4. Load the event; a non-admin scanner must be the event's organizer (`TICKET_WRONG_ORGANIZER`).
   5. Event must be `APPROVED` (`EVENT_NOT_OPEN_FOR_CHECKIN`).
   6. Ticket must be `VALID`; `USED` -> `TICKET_ALREADY_USED`, `REFUNDED` -> `TICKET_REFUNDED`, else `TICKET_NOT_VALID`.
3. `checkInTicket` then runs the single conditional update `findOneAndUpdate({ _id, ticketStatus: VALID }, { ticketStatus: USED, checkedInAt: now }, { projection: { qrToken: 0 } })`. Of two simultaneous scans only one matches; the loser reads the current status and gets `TICKET_ALREADY_USED`.
4. **Fallback by ticket code (decision #116).** When the camera fails, the gate app calls `checkInPreviewByCode(input)` and `checkInTicketByCode(input)` with `{ eventId, ticketCode }` (the 20 hex characters under the QR code). `enforceCheckInCodeLimit` counts the call (60 per minute per organizer), `normalizeTicketCode` removes spaces and dashes and upper-cases, then `validateCodeScan` loads the event, requires the caller to be its organizer or an admin, and finds the ticket by `ticketCode` **and** `eventId`. A bad format, an unknown code, a code of another event, an unknown event and a foreign event all give the same `TICKET_CODE_NOT_FOUND`. After that the shared `assertScannable` (organizer, event APPROVED, ticket VALID) and the same `markUsed` conditional update run, so the QR path and the code path cannot both check in one ticket. The QR operations are unchanged.
4. `buildResult` returns `CheckInResult { ticket, seat {sectionKey,row,number}, buyerName, ticketTypeName, ticketStatus }` - buyer name (full name or nick), no email, phone or token.
5. A used ticket cannot be refunded by a buyer (`REFUND_TICKET_CHECKED_IN`) - Flow 11.

---

## Flow 11 - Refund (buyer, admin, and cancelled event)

**Buyer**

1. `getRefundQuote(orderId)` returns `{ orderId, refundable, deadline, venueTimezone, refundableAmount, currency, reason }` (`RefundService.getRefundQuote`).
2. `requestRefund(orderId, reason?)` (`AuthGuard`, `refund.resolver.ts`) -> `RefundService.requestRefund`. An order that is already `REFUNDED` is returned unchanged.
3. `assess(...)` (pure): order must be `PAID` (`ORDER_NOT_REFUNDABLE`); no ticket may be `USED` (`REFUND_TICKET_CHECKED_IN`); all tickets must be VALID or already REFUNDED; for a buyer `now <= getRefundDeadline(event.startAt, venue.venueTimezone)` (`libs/refund-policy.ts`) else `REFUND_DEADLINE_PASSED`. The deadline is 23:59:59.999 on the day before the event starts on the wall clock of the venue's time zone (default `Asia/Seoul`), computed with `Intl`, DST-safe.
4. `processRefund` (all steps conditional or idempotent):
   1. `claimRefund`: `refundModel.create` with `orderId` unique. A duplicate-key error means someone else owns it; a `FAILED` refund, or a `PENDING` one whose `lockedAt` is older than 5 minutes (`REFUND_LOCK_MS`), is taken over with a conditional update. Otherwise `REFUND_IN_PROGRESS` (or the already-refunded order is returned).
   2. `markTicketsRefunded`: `updateMany` VALID to REFUNDED, then re-read; if a scan slipped in, restore and throw `REFUND_TICKET_CHECKED_IN`.
   3. `PaymentService.refundOrder`: claims the `CAPTURED` payment by flipping it to `REFUNDED` in one conditional update, calls the provider, puts it back if the provider throws.
   4. `releaseStock`: claims `stockReleased` on the Refund in one conditional update, then `SeatService.releaseSoldSeats` (SOLD seats of this order back to AVAILABLE) and `TicketTypeService.release` per item (lowers `soldQuantity`, lifts `SOLD_OUT`).
   5. Order flips PAID to REFUNDED (`refundedAt`); the Refund becomes `COMPLETED`; `notifyRefunded` tells the buyer (`REFUND_COMPLETED`) and the organizer (`ORDER_REFUNDED`).
   6. On error: before the money moved, tickets are restored; after, a re-run finishes without paying twice. The `Refund` becomes `FAILED` with `failureReason`.

**Admin** - `refundOrderByAdmin({ orderId, reason })`: reason required (`REFUND_REASON_REQUIRED`), may refund after the deadline but never an order with a used ticket, writes audit `ORDER_REFUNDED_BY_ADMIN` with `afterDeadline`.

**Cancelled event** - `cancelEventByAdmin` (or the organizer's own `cancelMyEvent`):

1. `EventService.cancelEvent` -> `changeStatusByAdmin(..., 'cancel', reason)`: conditional APPROVED to CANCELLED (reason required, stored as `cancelReason`; the organizer variant adds `organizerId` to the filter and answers `NOT_ALLOWED_REQUEST` for someone else's event). Audit `EVENT_CANCELLED` and notification.
2. `memberEvents` of the organizer is decremented (error logged, never thrown).
3. `refundOrdersForCancelledEvent` (`RefundService`): pages through PAID orders of the event by `_id` in batches of 50, calls `processRefund` with source `EVENT_CANCELLED` and an assessment with `cancelled: true` (so USED tickets are refunded too, and there is no deadline). One failing order is counted and logged, the loop continues. It returns `RefundSummary { refundedCount, failedCount, totalCount, failedOrderIds }`, writes audit `EVENT_REFUNDS_PROCESSED`, notifies the organizer. The hook never throws into the cancel.
4. `retryEventRefundsByAdmin(eventId)` runs the same function again for a CANCELLED event; only orders still `PAID` are touched.
5. Seats and stock of a cancelled event's refunded orders are released too (decision #110), through the same `releaseStock`.

---

## Flow 12 - Organizer payout

1. Nothing is stored until an admin marks a payout. The list is *computed*: `getMyPayouts` (`@Roles(ORGANIZER)` + `ActiveOrganizerGuard`, always filtered by the token's id) and `getPayoutsByAdmin` (`@Roles(ADMIN)`) call `PayoutService.list`, which runs one `eventModel.aggregate(buildPayoutPipeline(options))` (`libs/payout.ts`).
2. The pipeline: `$match` events with status APPROVED, ENDED or CANCELLED; `$lookup` the venue time zone; `payoutDate = $dateAdd(endAt, 3 days, timezone)` (needs MongoDB 5.0); `$lookup` orders (PAID only) grouped into `gross = sum(totalAmount)`, `commission = sum(commissionAmount)` (the amount stored on each order), `orderCount`; `$lookup` the `payouts` collection. A recorded payout is a frozen snapshot; a CANCELLED event always shows 0.
3. Commission is rounded once per event, half up (`$floor` of value + 0.5); `net = gross - commission`.
4. Status is computed in the same pipeline (`$switch`): `PAID_OUT` if a `Payout` document exists, else `NOTHING_TO_PAY` if net is 0, else `NOT_YET_DUE` if `payoutDate > now`, else `DUE`. `getPayoutStatus` in `libs/payout.ts` is the plain-code twin.
5. A `$facet` returns `list` (status filter, page), `metaCounter` and `totals` (net by status, ignoring the status filter). `shapePayoutTotals` -> `{ totalPaidOut, totalDue, totalUpcoming }`.
6. `markPayoutPaidByAdmin({ eventId, note? })` (`components/payout/payout.service.ts`) refuses in this order: unknown event `PAYOUT_EVENT_NOT_FOUND`; row already `PAID_OUT` -> `PAYOUT_ALREADY_PAID`; no row at all (a draft, pending or rejected event) -> `PAYOUT_NOTHING_TO_PAY`; `payoutDate` in the future -> `PAYOUT_NOT_DUE_YET`; any status other than `DUE` (net 0) -> `PAYOUT_NOTHING_TO_PAY`.
7. It reads the row again with the same pipeline, then `payoutModel.create({ eventId, organizerId, gross, commission, net, orderCount, paidAt, paidBy, note })`. The unique `eventId` index decides a race: the loser's duplicate-key error becomes `PAYOUT_ALREADY_PAID`.
8. Only after a successful insert: audit `PAYOUT_MARKED_PAID` and a `PAYOUT_PAID` notification to the organizer. No money moves anywhere.
