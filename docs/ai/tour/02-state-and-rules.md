# 02 - State machines, permissions, money and concurrency

**What this file covers.** (1) Every state machine in the data: the list of states, the exact transitions, and the function that performs each one. (2) The role and permission matrix: which guard protects each of the 97 GraphQL operations and who can pass it. (3) The money rules: commission tiers, order totals, refund deadline, payout date, KRW only. (4) The concurrency rules: how double sales are prevented without database transactions, with the exact code. Paths start at `apps/ticketzy-api/src/` unless written otherwise. The statement "unused" means a search of the non-test source found no code that sets the value.

---

## Part 1 - State machines

A **state machine** here means: a field that may only hold a few values, plus a short list of allowed moves between them. The code usually writes a move as one conditional `findOneAndUpdate` whose filter contains the allowed starting states, so an illegal or racing move simply matches nothing.

### 1.1 Member (`Member.memberStatus`, `libs/enums/member.enum.ts`)

States: `PENDING`, `ACTIVE`, `REJECTED`, `SUSPENDED`, `DELETE`. Default in the schema is `ACTIVE` (`Member.model.ts`).

| Move | Who / where | Code |
|---|---|---|
| (new) -> ACTIVE | buyer signs up | `MemberService.signupUser` passes `MemberStatus.ACTIVE` |
| (new) -> PENDING | organizer signs up | `MemberService.signupOrganizer` passes `PENDING` |
| ADMIN accounts -> ACTIVE | `npm run seed` | `seed.ts`, `libs/admin-seed.ts` |
| USER -> any status | an admin, with `updateMemberByAdmin` | allowed for USER targets; refused for the admin's own id (`CANNOT_CHANGE_OWN_ACCESS`), for another ADMIN (`CANNOT_CHANGE_ADMIN_ACCESS`) and for ORGANIZER targets (`USE_ORGANIZER_OPERATIONS`) |
| ACTIVE or PENDING -> DELETE | the owner (USER or ORGANIZER), `deleteMyAccount` (#123) | `AccountService.deleteAccount`: one conditional update sets `DELETE`, `deletedAt`, `emailReusableAt`; an organizer with events in PENDING review, APPROVED events not ended or payouts NOT_YET_DUE / DUE is refused (`ACCOUNT_DELETE_BLOCKED`); a buyer's holds are released and unpaid orders cancelled. `DELETE` is final: no operation brings it back |
| organizer moves | see 1.2 | `OrganizerService.changeStatus` |

What each status can do at login and on tokens (`AuthService.loadMember`, `unverifiedMemberStatuses`): `REJECTED`, `SUSPENDED` and `DELETE` cannot log in (`login` answers `ACCOUNT_NOT_VERIFIED`) and every normal guard answers `UnauthorizedException(ACCOUNT_NOT_VERIFIED)`. `PENDING` and `ACTIVE` pass `AuthGuard`. Two guards use `allowRestricted: true` (`NotificationGuard`, `ConversationGuard`): they let `REJECTED` and `SUSPENDED` in (only `DELETE` stays blocked).

Facts to know:

- `DELETE` is set only by `deleteMyAccount` (#123). An admin can neither set it nor change the status or role of a deleted account through `updateMemberByAdmin` (`CANNOT_SET_DELETED_STATUS`, `ACCOUNT_IS_DELETED`). The deleted record keeps every value (email, nick, phone, counters); it gets the tags `deletedAt`, `emailReusableAt` (+30 days), later `reusedByMemberId`; a new account on the same email gets `previousAccountId` (#124). All four are admin-only fields.
- `login` looks up the email among members that are not `DELETE`, so the email of a deleted account looks like an unknown one (`WRONG_EMAIL_OR_PASSWORD`); a token of a deleted member is refused by every guard (`ACCOUNT_NOT_VERIFIED`).
- `updateMember` (self) deletes `memberType` and `memberStatus` from the input, and its filter only matches members that are `ACTIVE` or `PENDING`.
- Roles are never client-controlled (decision #23): `memberType` is not in any sign-up input; `updateMemberByAdmin` refuses `memberType: ADMIN` before any query (`CANNOT_ASSIGN_ADMIN_ROLE`).

### 1.2 Organizer approval (`organizerTransitions`, `libs/enums/member.enum.ts`)

```ts
export const organizerTransitions = {
	verify: { from: [MemberStatus.PENDING], to: MemberStatus.ACTIVE },
	reject: { from: [MemberStatus.PENDING], to: MemberStatus.REJECTED },
	suspend: { from: [MemberStatus.ACTIVE], to: MemberStatus.SUSPENDED },
	reinstate: { from: [MemberStatus.SUSPENDED, MemberStatus.REJECTED], to: MemberStatus.ACTIVE },
};
```

```
 signupOrganizer
      |
   PENDING --verify--> ACTIVE --suspend(reason)--> SUSPENDED
      |                  ^                            |
   reject(reason)        +------- reinstate ----------+
      v                  |
   REJECTED -------------+  (reinstate)
```

Performed by `OrganizerService.changeStatus` (`components/organizer/organizer.service.ts`) as `findOneAndUpdate({ _id, memberType: ORGANIZER, memberStatus: { $in: from } }, update)`. `reject` stores `rejectReason`; `verify` and `reinstate` `$unset` it; `suspend` keeps no `rejectReason` change. Reasons are required for reject and suspend (`REJECT_REASON_REQUIRED`, `SUSPEND_REASON_REQUIRED`). A move from the wrong state: `INVALID_STATUS_TRANSITION`; unknown organizer: `NO_ORGANIZER_FOUND`. `verify` and `reinstate` from REJECTED set `approvalCelebrationPending: true` in the same update (`reinstate` tries a REJECTED-only update first; from SUSPENDED it does not set it), `suspend` sets it to false (#120). Each move writes an audit entry and a notification, and reject/suspend call `ConversationRealtime.setMemberRestricted(id, true)`.

Related: the commission override (`commissionOverride { rate 0..100, endsAt?, reason }`) is a field, not a state: set by `setCommissionOverrideByAdmin`, removed by `clearCommissionOverrideByAdmin` with one conditional `$unset` (filter requires an override to exist, `NO_COMMISSION_OVERRIDE` otherwise).

### 1.3 Event (`Event.eventStatus`, `eventTransitions` in `libs/enums/event.enum.ts`)

States: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `ENDED`.

```ts
export const eventTransitions = {
	submit: { from: [EventStatus.DRAFT, EventStatus.REJECTED], to: EventStatus.PENDING },
	approve: { from: [EventStatus.PENDING], to: EventStatus.APPROVED },
	reject: { from: [EventStatus.PENDING], to: EventStatus.REJECTED },
	cancel: { from: [EventStatus.APPROVED], to: EventStatus.CANCELLED },
	end: { from: [EventStatus.APPROVED], to: EventStatus.ENDED },
};
```

| Move | Performed by | Notes |
|---|---|---|
| (create) -> DRAFT | `EventService.createEvent` | `eventStatus: DRAFT`; clients cannot send a status (no such input field) |
| DRAFT/REJECTED -> PENDING | `submitEventForApproval` | validated by `getEventSubmitError`; conditional on the status read; clears `rejectReason`; starts AI moderation in the background |
| APPROVED -> PENDING | `updateEvent` (organizer edit) in `applyUpdate` | an edit of an approved event needs a new review; `updateEventByAdmin` does not do this |
| PENDING -> APPROVED | `approveEventByAdmin` -> `changeStatusByAdmin('approve')` | seats generated first for RESERVED events; the organizer cannot approve their own event (`CANNOT_APPROVE_OWN_EVENT`) |
| PENDING -> REJECTED | `rejectEventByAdmin` | reason required (`EVENT_REJECT_REASON_REQUIRED`), stored in `rejectReason` |
| APPROVED -> CANCELLED | `cancelEventByAdmin`, `cancelMyEvent` | reason required (`EVENT_CANCEL_REASON_REQUIRED`), stored in `cancelReason`; then refunds (Flow 11) |
| APPROVED -> ENDED | batch job `batchEndEvents` (`apps/ticketzy-batch/src/batch.service.ts`) | when `endAt <= now`; adds 1 to the organizer's `completedEvents` |
| DRAFT -> (deleted) | `removeEventByAdmin` | only DRAFT; deletes its ticket types too |

**Ended events (#121).** Public means APPROVED **and** `endAt` ahead, compared with the clock (`libs/event-visibility.ts`), so an event disappears from the public at its end time even before `batchEndEvents` sets ENDED (or when the batch app sleeps). `getEvent` answers the public with `EVENT_ENDED`; lists, favorites, visited, likes, comments, seat map, ticket types and the AI tools exclude it. Owner and admins keep full access; buyers keep their own orders, tickets and refund quote (event and venue joined by id, no status filter). `payOrder` refuses an ended event.

Editable statuses for an organizer: `editableEventStatuses` = DRAFT, REJECTED, APPROVED (APPROVED goes to PENDING). `closedEventStatuses` = CANCELLED, ENDED: no edits, no new ticket types (`assertCanManageEvent` excludes them). PENDING is locked so the reviewer sees what was submitted. Public visibility: only `publicEventStatus` = APPROVED, and only if the organizer is ACTIVE.

When the move fails: `changeStatusByAdmin` re-reads the event and answers `NOT_ALLOWED_REQUEST` (organizer path, not the owner), `NO_DATA_FOUND`, `EVENT_ALREADY_CLOSED` (organizer cancelling a closed event), `CANNOT_APPROVE_OWN_EVENT`, or `INVALID_EVENT_TRANSITION`.

### 1.4 Ticket type (`TicketType.ticketTypeStatus`)

States: `ACTIVE` (default), `PAUSED`, `SOLD_OUT`.

| Move | Code |
|---|---|
| ACTIVE -> SOLD_OUT | automatic when `soldQuantity >= totalQuantity`: second conditional update in `TicketTypeService.tryReserve` (general stock) and in `addSold` (reserved seats) |
| SOLD_OUT -> ACTIVE | automatic when `soldQuantity < totalQuantity` after `TicketTypeService.release`, and in `releaseStockOfOrder` (`libs/order-expiry.ts`) |
| any -> any | `updateTicketType` accepts `ticketTypeStatus` from the organizer or admin (`TicketTypeUpdate`), so `PAUSED` is set by hand only |

Only `ACTIVE` types can be reserved or sold (`tryReserve` and `findSellable` filter on it). A paused type is also left out of `eventMinPrice` (`refreshEventMinPrice`). The SOLD_OUT-to-ACTIVE update in `release` has the filter `ticketTypeStatus: SOLD_OUT` and `$expr: soldQuantity < totalQuantity`, so it also lifts a `SOLD_OUT` that an organizer set by hand, as soon as any release makes the numbers allow it.

### 1.5 Event seat (`EventSeat.seatStatus`)

States: `AVAILABLE`, `HELD`, `SOLD`. Created `AVAILABLE` by `generateEventSeats` at approval.

| Move | Code | Condition in the filter |
|---|---|---|
| AVAILABLE -> HELD | `SeatService.holdSeats` | status AVAILABLE, or HELD with `heldUntil <= now`, or HELD by the same member |
| HELD -> AVAILABLE | `releaseSeats`; the pre-release inside `holdSeats`; `releaseOrderSeats` (order failed/cancelled/expired); batch `releaseExpiredSeatHolds` | HELD by that member, or HELD with `heldUntil <= now` |
| HELD -> SOLD | `SeatService.markSold` (inside `payOrder`) | HELD by the buyer and `heldUntil > now`; sets `orderId` |
| SOLD -> HELD | `revertSold` (rollback when payment steps fail) | SOLD with that `orderId` |
| SOLD -> AVAILABLE | `releaseSoldSeats` (refund) | SOLD with that `orderId` |

Seat fields: `heldBy`, `heldUntil` (only while HELD), `orderId` (only while SOLD).

### 1.6 Order (`Order.orderStatus`)

States: `PENDING_PAYMENT` (default), `PAID`, `FAILED`, `CANCELLED`, `EXPIRED`, `REFUNDED`.

```
 createCheckout
      |
 PENDING_PAYMENT --payOrder SUCCESS--> PAID --processRefund--> REFUNDED
   |  |   |                              |
   |  |   +--payOrder FAILURE--> FAILED  +-- (rollback inside payOrder) --> PENDING_PAYMENT
   |  +--cancelPendingOrder--> CANCELLED
   +--expiresAt passed--> EXPIRED
```

| Move | Code |
|---|---|
| (create) -> PENDING_PAYMENT | `OrderService.createOrderDocument` |
| -> PAID | `payOrder`: conditional on PENDING_PAYMENT, sets `paidAt` |
| -> FAILED | `failOrder`: conditional on PENDING_PAYMENT |
| -> CANCELLED | `cancelPendingOrder`: conditional on PENDING_PAYMENT and `buyerId` |
| -> EXPIRED | `OrderService.expireOrder` (during `payOrder`, `getOrder`, `getMyOrders` through `expireStaleOrdersOf`) and `expireStaleOrders` (`libs/order-expiry.ts`, used by the batch job and by `TicketTypeService`); all conditional on PENDING_PAYMENT and `expiresAt <= now` |
| PAID -> PENDING_PAYMENT | only as a rollback inside `payOrder` when saving payment/tickets failed |
| PAID -> REFUNDED | `RefundService.processRefund`, conditional on PAID; sets `refundedAt` |

### 1.7 Payment (`Payment.paymentStatus`)

States: `INITIATED`, `CAPTURED`, `FAILED`, `REFUNDED`. `INITIATED` is only the schema default; no code creates a payment in it (`PaymentService.record` always writes `CAPTURED` or `FAILED`).

| Move | Code |
|---|---|
| (create) -> CAPTURED / FAILED | `PaymentService.record` after `charge` |
| CAPTURED -> REFUNDED | `PaymentService.refundOrder`: conditional claim *before* calling the provider |
| REFUNDED -> CAPTURED | same function, only if the provider throws (undo) |
| (delete) | `deleteRecords` in the `payOrder` rollback |

`providerRef` is unique (`Payment.model.ts`). `Payment.paymentProvider` is `MOCK` for the mock; `MANUAL`, `STRIPE`, `PAYME`, `CLICK` exist in the enum but no code uses them.

### 1.8 Ticket (`Ticket.ticketStatus`)

States: `VALID` (default), `USED`, `REFUNDED`, `CANCELLED`. `CANCELLED` is never set by any code (only read by the AI tool `get_my_tickets`, which excludes it).

| Move | Code |
|---|---|
| (create) -> VALID | `payOrder` -> `buildTickets` -> `insertMany` |
| VALID -> USED | `TicketService.checkInTicket`, conditional update, sets `checkedInAt` |
| VALID -> REFUNDED | `RefundService.markTicketsRefunded` |
| USED -> REFUNDED | same function, only when the whole event was cancelled (`cancelled: true`) |
| REFUNDED -> VALID, USED -> ... | `restoreTickets`: undo when a refund fails before the money moved or a scan slipped in |

### 1.9 Refund (`Refund.refundStatus`)

States: `PENDING` (default), `COMPLETED`, `FAILED`. One document per order (unique `orderId`).

| Move | Code |
|---|---|
| (create) -> PENDING | `RefundService.claimRefund` (`create`; duplicate-key means someone else owns it) |
| FAILED -> PENDING | `claimRefund` takes over with a conditional update |
| PENDING -> PENDING (taken over) | same, when `lockedAt <= now - REFUND_LOCK_MS` (5 minutes): the earlier run is presumed dead |
| PENDING -> COMPLETED | end of `processRefund`; unsets `lockedAt`, `failureReason` |
| PENDING -> FAILED | `catch` of `processRefund`; sets `failureReason`, unsets `lockedAt` |

`refundSource`: `BUYER`, `ADMIN`, `EVENT_CANCELLED`. `stockReleased` is a boolean flag claimed once (see Part 4).

### 1.10 Payout (computed, `PayoutStatus`, `libs/enums/payout.enum.ts`)

States: `NOT_YET_DUE`, `DUE`, `PAID_OUT`, `NOTHING_TO_PAY`. **Never stored.** The only stored fact is the existence of a `Payout` document. Evaluation order (`getPayoutStatus`, mirrored by the `$switch` in `buildPayoutPipeline`, `libs/payout.ts`):

1. a `Payout` document exists -> `PAID_OUT`
2. `net === 0` -> `NOTHING_TO_PAY` (also every cancelled event and an upcoming event with no sales yet)
3. `payoutDate > now` -> `NOT_YET_DUE`
4. otherwise `DUE`

The only write to payout state: `markPayoutPaidByAdmin` creates the `Payout` document (Flow 12). Separately, the batch job `batchNotifyDuePayouts` (hourly, minute 50) claims each DUE event once by setting `Event.payoutDueNotifiedAt` with a conditional update and sends the `PAYOUT_DUE` notices; a payout due more than 7 days ago is claimed but not announced (#119). The marker is not part of the status. Only events in `payoutEventStatuses` = APPROVED, ENDED, CANCELLED have a row.

### 1.11 Conversation (no status field)

`Conversation` has no status enum (`Conversation.model.ts`). Its "state" is made of:

- **kind**: event conversation (`eventId` set, unique per event) or support conversation (`isSupport: true`, unique per organizer); both through partial unique indexes.
- **assignment**: `adminId: null` until the first admin sends a message; `claimConversation` does a conditional `findOneAndUpdate({ _id, adminId: null }, { $set: { adminId } })` so the first admin wins.
- **unread counters**: `unreadForOrganizer`, `unreadForAdmin` (the latter is shared by all admins), incremented by `sendMessage` for the other side and zeroed by `markConversationRead`.
- **who may use it** depends on the organizer's `memberStatus` (`getConversationDenial`, `libs/conversation-access.ts`):

| Viewer | Access |
|---|---|
| ADMIN, ACTIVE | all conversations |
| ORGANIZER, ACTIVE | own conversations (event and support) |
| ORGANIZER, PENDING / REJECTED / SUSPENDED | only the own support conversation (`CONVERSATION_SUPPORT_ONLY` for others) |
| USER, DELETE organizers | `CONVERSATION_NOT_ALLOWED` / blocked at the guard |

`Message.readAt` is the per-message read marker, set by `markConversationRead` for the other side's messages.

---

## Part 2 - Roles and permissions

### 2.1 The guards (`components/auth/guards/`)

| Guard / decorator | What it does | Who passes |
|---|---|---|
| none | no check | everybody including guests |
| `WithoutGuard` | tries to authenticate; on any failure sets `authMember = null` and lets the request through | everybody; logged-in callers get personalised data |
| `AuthGuard` | bearer token required, member loaded, status must not be REJECTED/SUSPENDED/DELETE | USER, ORGANIZER (also PENDING), ADMIN |
| `@Roles(...)` + `RolesGuard` | same as `AuthGuard`, then `memberType` must be in the list; without `@Roles` metadata the guard lets everything through | listed roles; a PENDING organizer passes unless `ActiveOrganizerGuard` follows |
| `ActiveOrganizerGuard` | must come after `RolesGuard`; an ORGANIZER whose status is not ACTIVE gets `ORGANIZER_NOT_APPROVED`; ADMIN and other types pass | ACTIVE organizers, admins |
| `NotificationGuard` | token required, `allowRestricted: true`, any member type | everybody logged in except DELETE accounts |
| `ConversationGuard` | token required, `allowRestricted: true`, type must be ORGANIZER or ADMIN | organizers and admins in any status except DELETE |

Important: a guard only checks the *type and status*. Many operations add ownership checks in the service (`organizerId: memberId` in the filter, `buyerId`, `ownerId`).

Abbreviations in the matrix: **G** guest, **U** USER, **P** PENDING organizer, **O** ACTIVE organizer, **A** ADMIN. Columns show who is let in by the guards; the last column shows service-level rules that narrow it further.

### 2.2 Matrix per operation (99 operations: 42 queries, 57 mutations; 101 before #122)

`app.resolver.ts` has `sayHello`; the rest are listed by module. Q = Query, M = Mutation. "(M)" next to a `get...` name means it is declared as a Mutation in code (see oddities).

**Account (`member.resolver.ts`)**

| Operation | Guard | Passes | Service-level rule |
|---|---|---|---|
| signupUser (M), signupOrganizer (M), login (M) | none | G U P O A | IP rate limits; login also per email |
| checkAuth (Q) | AuthGuard | U P O A | returns a greeting string |
| checkAuthRoles (Q) | Roles(USER, ORGANIZER) | U P O | |
| updateMember (M) | AuthGuard | U P O A | status must be ACTIVE or PENDING; password change rate-limited; role/status ignored |
| getMember (Q) | WithoutGuard | G U P O A | target must be ACTIVE (a member can open their own page while PENDING) |
| getOrganizers (Q) | WithoutGuard | all | ACTIVE organizers only |
| likeTargetMember (M) | AuthGuard | U P O A | target ACTIVE |
| imageUploader (M), imagesUploader (M) | AuthGuard (and a token before the multipart parse) | U P O A | target in `member`, `event`, `venue`; PNG/JPEG by magic bytes; `imagesUploader` is all or nothing (one bad file removes the others it wrote, #117) |
| getAllMembersByAdmin (M) | Roles(ADMIN) | A | |
| updateMemberByAdmin (M) | Roles(ADMIN) | A | admin-safety rules of 1.1 |

**Organizer administration (`organizer.resolver.ts`)** - all `Roles(ADMIN)`: getOrganizersByAdmin (Q), verifyOrganizerByAdmin, rejectOrganizerByAdmin, suspendOrganizerByAdmin, reinstateOrganizerByAdmin, setCommissionOverrideByAdmin, clearCommissionOverrideByAdmin (all M). Passes: A.

**Venues (`venue.resolver.ts`)**

| Operation | Guard | Passes | Service rule |
|---|---|---|---|
| createVenue (M) | Roles(ORGANIZER, ADMIN) + ActiveOrganizerGuard | O A | |
| updateVenue (M) | same | O A | creator or ADMIN (`memberId` in the filter) |
| getVenue (Q), getVenues (Q) | WithoutGuard | all | `getVenues` lists ACTIVE only; `getVenue` hides DELETE |

**Events (`event.resolver.ts`)**

| Operation | Guard | Passes | Service rule |
|---|---|---|---|
| createEvent, updateEvent, submitEventForApproval, cancelMyEvent (M) | Roles(ORGANIZER) + ActiveOrganizerGuard | O | own events only |
| getMyEvents (Q) | same | O | own events |
| getEvent (Q) | WithoutGuard | all | public = APPROVED + `endAt` ahead + ACTIVE organizer (#121); an ended event answers `EVENT_ENDED` to the public; owner/admin see any status |
| getEvents (Q), getEventSeatMap (Q) | WithoutGuard | all | public rules (APPROVED and not ended) |
| getFavorites (Q), getVisited (Q), likeTargetEvent (M) | AuthGuard | U P O A | public events only |
| getEventsByAdmin (Q), approveEventByAdmin, rejectEventByAdmin, cancelEventByAdmin, updateEventByAdmin, removeEventByAdmin (M) | Roles(ADMIN) | A | approve: not the admin's own event |

**Ticket types (`ticket-type.resolver.ts`)**: createTicketType (M), updateTicketType (M): Roles(ORGANIZER, ADMIN) + ActiveOrganizerGuard -> O A; the service requires the organizer to own the event (admin: any), event not CANCELLED/ENDED. getTicketTypes (Q): WithoutGuard -> all; organizer must be ACTIVE.

**Seats (`seat.resolver.ts`)**: holdSeats (M), releaseSeats (M): AuthGuard -> U P O A at the guard, but `holdSeats` calls `assertBuyerAccount`, so only USER succeeds (`ONLY_BUYERS_CAN_BUY` otherwise); `releaseSeats` has no buyer check (it only touches the caller's own holds). getSeatConfig (Q): no guard -> all.

**Orders (`order.resolver.ts`)**

| Operation | Guard | Passes | Service rule |
|---|---|---|---|
| createCheckout, payOrder (M) | AuthGuard | U P O A at the guard | `assertBuyerAccount`: USER only |
| cancelPendingOrder (M), getOrder (Q), getMyOrders (Q) | AuthGuard | U P O A | own orders (`buyerId`) |
| getMyEventOrders (Q) | Roles(ORGANIZER) + ActiveOrganizerGuard | O | orders of own events; buyer shown as nick only |
| getAllOrdersByAdmin (Q) | Roles(ADMIN) | A | |

**Tickets (`ticket.resolver.ts`)**: getMyTickets (Q), getTicket (Q): AuthGuard -> own tickets. checkInTicket (M), checkInPreview (Q): Roles(ORGANIZER, ADMIN) + ActiveOrganizerGuard -> O A; a non-admin must be the event's organizer. checkInTicketByCode (M), checkInPreviewByCode (Q): the same guards and rules, input `{ eventId, ticketCode }`, 60 per minute per member (#116).

**Refunds (`refund.resolver.ts`)**: getRefundQuote (Q), requestRefund (M): AuthGuard, own orders. refundOrderByAdmin (M), retryEventRefundsByAdmin (M): Roles(ADMIN).

**Payouts (`payout.resolver.ts`)**: getMyPayouts (Q): Roles(ORGANIZER) + ActiveOrganizerGuard -> O. getPayoutsByAdmin (Q), markPayoutPaidByAdmin (M): Roles(ADMIN).

**Sales (`sales.resolver.ts`)**: getEventSales, getEventAttendees, getMyEarnings (Q): `Roles(ORGANIZER)` + `RolesGuard` only (no `ActiveOrganizerGuard`), so a PENDING organizer passes the guard; `getEventSales` and `getEventAttendees` then require owning the event (`assertOwner`), `getMyEarnings` reads the caller's own events. Passes: O (and P, who has no data).

**Social**: createComment (M), updateComment (M): AuthGuard (create only on a public event: APPROVED, organizer ACTIVE, else `NO_DATA_FOUND`, #117; update only your own ACTIVE comment). getComments (Q): WithoutGuard. removeCommentByAdmin (M): ADMIN.

**Account state (`member.resolver.ts`)**: getMyAccountState (Q): `NotificationGuard` (PENDING, REJECTED and SUSPENDED pass), always the caller's own. markApprovalCelebrationDone (M): Roles(ORGANIZER), always the caller's own, idempotent (#120).

**Account deletion (`account.resolver.ts`, #123)**: getMyAccountDeletionCheck (Q) and deleteMyAccount (M): `Roles(USER, ORGANIZER)` + `RolesGuard`, always the caller's own account; an ADMIN gets `ONLY_SPECIFIC_ROLES_ALLOWED`; REJECTED and SUSPENDED organizers cannot sign in so they cannot call it. deleteMyAccount is rate limited (`accountDelete`, like a password change).

**Notifications / notices / audit**: getMyNotifications (Q), markNotificationRead (M), getUnreadNotificationCount (Q), markAllNotificationsRead (M): `NotificationGuard`. getNotices (Q): WithoutGuard. createNotice, updateNotice, removeNoticeByAdmin (M), getAllNoticesByAdmin (Q), getAuditLogsByAdmin (Q): ADMIN.

**Conversations (`conversation.resolver.ts`)**: startConversation (M), getMyConversations (Q), getConversation (Q), getMessages (Q), sendMessage (M), markConversationRead (M): `ConversationGuard`, then `getConversationDenial`. startConversationWithOrganizerByAdmin (M): Roles(ADMIN).

**AI (`ai.resolver.ts`)**: askAssistant (M): WithoutGuard (visitors are limited by IP). translateEvent (M): Roles(ORGANIZER) + ActiveOrganizerGuard, only for the organizer's own event. runEventModerationByAdmin (M): ADMIN.

**Guard test**: `components/auth/admin-access.spec.ts` scans every resolver and fails if an operation named `*ByAdmin` (plus `createNotice` and `updateNotice`) lacks `Roles(ADMIN)` and `RolesGuard`, or if any handler that names ADMIN lacks `RolesGuard`.

### 2.3 What the page may show: field-level privacy

Field resolvers hide data from the wrong viewer (they return `null`, not an error):

- `Member` (`member.resolver.ts`): `memberEmail`, `memberPhone`, `memberWarnings`, `memberBlocks`, `rejectReason`, `commissionOverride` only to the member and admins; `deletedAt`, `emailReusableAt`, `previousAccountId`, `reusedByMemberId` to admins only, not even to the member (#123); `memberFullName` and `memberAddress` also to anyone when the member is an ORGANIZER. A new `@Field` on `Member` must be classified in `member.privacy.spec.ts` (`AGENTS.md`).
- `Event` (`event.resolver.ts`): `rejectReason`, `cancelReason`, `eventModeration` only to the owner and admins; `possibleVenueConflicts` only to admins.
- `Ticket.qrToken`: only the pipelines of the owner's `getMyTickets` / `getTicket` include it.

---

## Part 3 - Money rules

All amounts are whole numbers in the schema as `Number`; the currency is always KRW for new data.

| Rule | Value and code |
|---|---|
| Currency | `EVENT_CURRENCY = KRW` (`libs/currency.ts`). `createTicketType`/`updateTicketType` refuse other currencies (`ONLY_KRW_TICKETS`); an event with a non-KRW type refuses new types (`EVENT_HAS_OTHER_CURRENCY`); a non-KRW type that sold tickets cannot be edited into KRW silently (`TICKET_CURRENCY_LOCKED`). The enum still lists USD, EUR, KRW, UZS. `npm run report:currency` lists old non-KRW types |
| Price | `TicketTypeInput.ticketPrice`: `Min(0)`, so a free ticket (price 0) is allowed by validation |
| Client sends prices? | Never. Unit prices are read from the ticket types in `createCheckout` |
| Commission rate | `getCommissionRate` (`libs/commission.ts`): the admin override wins while `endsAt` is empty or in the future; else 5 percent when `completedEvents >= 20`, 7 percent when `>= 5`, otherwise 10 (`BASE_COMMISSION_RATE`) |
| Commission amount | `calculateOrderAmounts`: `commissionAmount = round2(subtotal * rate / 100)`; `totalAmount = subtotal`. The commission is deducted from the organizer's share; the buyer pays the subtotal |
| Frozen on the order | `commissionRate`, `commissionAmount`, `subtotal`, `totalAmount` are stored on the `Order`; later rate changes never touch old orders (`Order.model.ts`) |
| Hold length | `SEAT_HOLD_SECONDS` (default 120, max 3600) for seat holds and for unpaid general-admission orders |
| Seats per order | 8 (`MAX_SEATS_PER_HOLD`, `seat.service.ts`); `CheckoutInput` allows up to 8 `seatIds` and up to 10 `items`; each item is bounded by the ticket type's `maxPerOrder` |
| Refund deadline | 23:59:59.999 on the day before `event.startAt`, wall clock of `venue.venueTimezone` (default `Asia/Seoul`); `getRefundDeadline` (`libs/refund-policy.ts`) returns the instant `start of the event's local day - 1 ms`, stored/compared in UTC |
| Who may refund | buyer: PAID order, no USED ticket, `now <= deadline`; admin: same without the deadline; cancelled event: all PAID orders, USED tickets included |
| Refund amount | the whole `totalAmount` (the unit is the whole order, never one ticket) |
| Payout date | `endAt` + 3 calendar days on the venue wall clock (`PAYOUT_DELAY_DAYS = 3`, `getPayoutDate`; the pipeline uses `$dateAdd` with the time zone) |
| Payout amounts | `gross` = sum of `totalAmount` of PAID orders, `commission` = sum of stored `commissionAmount` rounded once per event half up, `net = gross - commission`; REFUNDED orders drop out; a CANCELLED event is always 0 |
| Seat counts on lists | `eventTotalSeats` = sum of `totalQuantity` of all ticket types; `eventSoldSeats` = tickets in PAID orders (`libs/seat-counts.ts`) |

Edge to know: for an event starting shortly after local midnight, "the day before" ends only a few minutes before the start in clock terms; decision #70 explains that the 23:00 to 23:59 window is a product edge, not a bug.

---

## Part 4 - Concurrency rules (no transactions)

There is no replica set, so no multi-document transactions (decision #17). The code relies on four tools: **conditional updates**, **unique indexes**, **idempotent steps** (a repeat changes nothing) and **compensation** (an explicit undo when a later step fails).

### 4.1 Two buyers want the same seat

The decision is made by MongoDB inside one document update (`SeatService.holdSeats`, `components/seat/seat.service.ts`):

```ts
const seat = await this.eventSeatModel.findOneAndUpdate(
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
);
```

MongoDB applies one update to one document atomically, so only one request can see the seat as free. The loser gets `null`, the code releases the seats it already claimed in this call (`releaseClaimed`) and throws `SEAT_JUST_TAKEN`. Because a hold is time-based, "free" includes "held but past `heldUntil`" - no cleanup job needs to run first.

### 4.2 Overselling general-admission stock

One update decides (`TicketTypeService.tryReserve`):

```ts
{
  _id: ticketTypeId,
  ticketTypeStatus: TicketTypeStatus.ACTIVE,
  maxPerOrder: { $gte: quantity },
  $expr: { $lte: [{ $add: ['$soldQuantity', quantity] }, '$totalQuantity'] },
  // ...plus the sale window
}
// update: { $inc: { soldQuantity: quantity } }
```

The check "is there stock?" and the increment are the same atomic operation, so two buyers cannot both take the last ticket. `soldQuantity` therefore *includes unpaid reservations* (decision #17); expiry gives them back (4.5).

### 4.3 Selling a held seat

`SeatService.markSold` converts HELD to SOLD with a filter that demands "held by this buyer and `heldUntil > now`". If the hold expired or another buyer re-held the seat, the update matches nothing, the seats already sold in this call return to HELD (`revertSold`) and `HOLD_EXPIRED` is thrown. The charge is refunded in `payOrder` (`refundQuietly`).

### 4.4 Paying the same order twice

- A PAID order is returned unchanged at the top of `payOrder`.
- The PAID flip is conditional on `PENDING_PAYMENT`. If a parallel call already won, the loser reverts its sold seats, refunds its charge, reads the order again and, if it is PAID, returns it.
- The Payment `providerRef` is unique.

### 4.5 Expiry, lazy expiry, and the batch job

`libs/order-expiry.ts` is shared by the batch app and the API:

- `expireStaleOrders(models, scope, limit)` finds `PENDING_PAYMENT` orders with `expiresAt <= now`, flips each to `EXPIRED` with a conditional update, and **only the call whose update matched** releases anything (seats of that buyer whose hold has passed, or stock via `$inc: -quantity` guarded by `soldQuantity >= quantity`). Running it twice or in two processes releases once.
- `releaseExpiredSeatHolds` sets every `HELD` seat with `heldUntil <= now` back to `AVAILABLE`.
- Who calls them: the batch job `batchExpireOrders` every minute (all orders); the API lazily - `TicketTypeService.sweepStaleOrders` (called by `getTicketTypes` for the event and by `reserve` when stock is short, 50 at a time), and `OrderService.expireStaleOrdersOf` (called by `getOrder` and `getMyOrders`, 20 at a time); `payOrder` expires the order it is paying (decision #102). The Render free tier can put the batch app to sleep, which is why the API does this itself.
- Seat holds are *also* honoured lazily: the claim filter accepts a past `heldUntil`, `getEventSeatMap` hides expired holds, `findHeldSeats` and `markSold` require `heldUntil > now`. Correctness never depends on cron timing; the sweep only keeps data tidy.

### 4.6 Two scans of one QR code

`TicketService.checkInTicket` ends with `findOneAndUpdate({ _id, ticketStatus: VALID }, { ticketStatus: USED, ... })`. Only one scan matches. The other reads the current status and throws `TICKET_ALREADY_USED`.

### 4.7 Refund races

- The unique `orderId` on `Refund` means only one `claimRefund` can create it; others fail with a duplicate key and are told `REFUND_IN_PROGRESS` (or get the finished order back).
- A crashed run is recoverable: a `PENDING` refund with `lockedAt` older than `REFUND_LOCK_MS` (5 minutes) or a `FAILED` one can be taken over by a conditional update.
- `markTicketsRefunded` flips VALID tickets, re-reads them, and if a scan won in between, undoes and throws.
- `PaymentService.refundOrder` flips the CAPTURED payment to REFUNDED *before* calling the provider, so two parallel refunds cannot both reach it, and restores CAPTURED if the provider throws.
- `releaseStock` claims `stockReleased` with `findOneAndUpdate({ _id, stockReleased: { $ne: true } }, { stockReleased: true })` and gives the flag back on failure, so seats and counters go back once per refund.
- Known gap (decision #54): if the stock step dies after the flag was set, a few seats may stay unsold (undersell, never oversell).

### 4.8 Unique indexes that decide races

| Index (file) | Race it decides |
|---|---|
| `Member`: unique `(memberEmail, deletedAt)`, sparse unique `(memberPhone, deletedAt)`, sparse unique `memberNick` (#124) | two sign-ups with the same email/phone among live members (a deleted member has a `deletedAt`, so it never collides); a nick is reserved for ever |
| `EventSeat`: unique `(eventId, sectionKey, row, number)` | seat generation run twice |
| `TicketType`: unique `(eventId, ticketTypeName)`, partial unique `(eventId, tierKey)` | duplicate tiers |
| `Order.orderNumber` unique, `Payment.providerRef` unique, `Ticket.ticketCode` unique | duplicate identifiers |
| `Refund.orderId` unique | double refund |
| `Payout.eventId` unique | double payout |
| `Conversation`: partial unique `eventId`; partial unique `organizerId` where `isSupport` | duplicate conversations |
| `View`, `Like`: unique `(memberId, refId, group)` | double view/like |
| `AiUsage.usageKey` unique | first-of-the-day counter created twice |

### 4.9 Admin state changes

Every admin transition (organizer and event) is one conditional update on the allowed starting states, followed by audit and notification (which never throw). Two admins clicking at once: one wins, the other gets `INVALID_STATUS_TRANSITION` or `INVALID_EVENT_TRANSITION`.

### 4.10 Counters and honest limits

Counters (`memberEvents`, `eventLikes`, `eventViews`, `eventComments`, ...) are plain `$inc` updates done *after* the main write; a failure is logged and not retried (decisions #39, #65). `assertVenueFree` is check-then-write (decision #83), and `updateVenue`'s layout lock is check-then-update (decision #51): both can lose a very tight race.

### 4.11 The AI daily counter

`AiUsageService.consume` (`components/ai/ai-usage.service.ts`) is one `findOneAndUpdate({ usageKey, count: { $lt: cap } }, { $inc }, { upsert: true })`. When the counter is full the upsert would insert a second document with the same unique key, so MongoDB throws a duplicate-key error, which the code reads as "at the cap". One retry covers two first-of-the-day inserts racing. If the counter cannot be read, the request is refused (fails closed).
