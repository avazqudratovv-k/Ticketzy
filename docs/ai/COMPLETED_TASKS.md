# Completed Tasks

Session: Claude Code (Sonnet 5.5), branch `modification`. The request text referred to "Codex" and "Petoria"; the actual tool and project are Claude Code and Ticketzy.

## 1. Analysis
- Explored the monorepo: apps, modules, schemas, enums, auth, upload, WebSocket and batch. Mapped the inherited concepts to ticketing equivalents (old catalog entity to Event, agent to Organizer; Venue, TicketType, Order, Ticket missing). Findings are summarized in `BACKEND_MIGRATION.md`.
- Confirmed `73c416b` ("start backend migration process") only added `AGENTS.md` and `SKILLS.md`, with no source changes.

## 2. Environment and identity checks
- Claude CLI 2.1.289 is installed natively (`~/.local/bin/claude`), not through npm or Homebrew.
- Git identity is `Kenneth <avazqudratovv@gmail.com>` (global config), different from the Claude account email. Not changed.

## 3. Safe rename layer (Nestar to Ticketzy), committed as `3386edb`

| Area | Change |
|---|---|
| Folders | `apps/nestar-api` to `apps/ticketzy-api`; `apps/nestar-batch` to `apps/ticketzy-batch` (`git mv`) |
| `nest-cli.json` | root, sourceRoot, tsConfigPath, project keys |
| `package.json` | name; scripts `start:dev:batch`, `start:prod`, `start:prod:batch`, `test:e2e` |
| `package-lock.json` | top-level name (hand edit) |
| `apps/*/tsconfig.app.json` | `outDir` |
| Source | `src/app.service.ts`, `src/batch.service.ts` (welcome strings and imports), `src/batch.module.ts`, `auth.guard.ts`, `roles.guard.ts` (import paths) |
| Test | `apps/ticketzy-batch/test/app.e2e-spec.ts` now imports the real `BatchModule`/`BatchController` |

Not changed: GraphQL schema/operations, DTOs, enums, schema names, collections, `.env`, `uploads/`.

## 4. Validation status

| Check | Result |
|---|---|
| `grep -ri nestar` (excluding node_modules, .git, dist, lockfile) | no matches |
| `tsc --noEmit` root, `ticketzy-api`, `ticketzy-batch` | pass (baseline had 1 error, the stale spec import, now fixed) |
| `eslint` without `--fix` | **2379 errors**, same as the baseline; mostly prettier tabs vs spaces, not caused by the rename |
| `nest build ticketzy-api` / `ticketzy-batch` | pass |
| GraphQL schema introspection before/after | **not run** |
| Server start / DB connection | **not run** |
| Unit / e2e tests | **not run** (only boilerplate e2e specs exist) |

## 5. Known leftovers
- `dist/nestar-api` and `dist/nestar-batch` may still exist (gitignored); `rm -rf dist` removes them.
- `package-lock.json` name was edited by hand; `npm install --package-lock-only` would regenerate it.

## 6. Documentation
- `docs/` created with six files: `BACKEND_MIGRATION.md`, `DECISIONS.md`, `FRONTEND_MIGRATION.md`, `COMPLETED_TASKS.md`, `NEXT_STEPS.md`, `PROMPTS.md`. No application source was changed.

## 7. Layers 2 to 5: the old catalog replaced by the Ticketzy domain

Session: Claude Code (Sonnet 5.5), branch `modification`, working from the owner's ER diagram. Committed as `a9a3d19`.

**Housekeeping:** removed stale `dist/`; `npm install --package-lock-only` produced no lockfile diff.

**Layer 2, decoupling**
- `OrdinaryInquiry`, `PricesRange`, `PeriodsRange` moved to `libs/dto/common/common.input.ts`.
- `LikeGroup`, `ViewGroup`, `CommentGroup`, `NotificationGroup`: the old catalog value became `EVENT` (`NotificationGroup` also gained `ORDER`; `NotificationType` gained `ORDER_PAID`, `EVENT_REMINDER`).
- Fixed `Like.model.ts` (used `ViewGroup`); like and view unique indexes and lookups are now group-scoped; `toggleLike`, `checkLikeExistence`, `recordView` search by group.
- `getFavoriteEvents` / `getVisitedEvents` look up `events` and no longer crash on an empty result; `CommentService` uses `EventService`; fixed the inverted `if (result!)` check in `createComment`.

**Layer 3, catalog**
- New enums `libs/enums/event.enum.ts`, `ticket.enum.ts` (values in DECISIONS #14).
- New schemas: `Event`, `Venue`, `TicketType`, `Order` (embedded `items[]`), `Ticket`, `Payment`; `Notification` now has `eventId` / `orderId`; the member's old catalog counter became `memberEvents` (+ DTO).
- New modules `event`, `venue`, `ticket-type` with DTOs under `libs/dto/{event,venue,ticket-type}`. Filters: category, venue, city, price (`eventMinPrice`), date (`startAt`), text (regex now escaped). `eventMinPrice` is recomputed when ticket types change. Event date ranges are validated. The organizer's `memberEvents` counter drops once when an event first becomes CANCELLED or DELETE.
- Removed the old catalog module, its DTOs, schema and enum.
- Fixed the old bug where the catalog update never persisted `deletedAt`.

**Layer 4, sales**
- Modules `order` (createOrder, payOrder, cancelOrder, getOrder, getMyOrders, getAllOrdersByAdmin; payment is a stub) and `ticket` (getMyTickets, checkInTicket).
- `TicketTypeService.reserve` / `release`: atomic conditional `findOneAndUpdate` (see DECISIONS #17). Orders snapshot unit prices, reject mixed currencies and duplicate ticket types, and release stock on any partial failure.

**Layer 5, batch**
- Ranking now uses `events` (`batchTopEvents`) and `memberEvents` (`batchTopOrganizers`); rollback and ranking run hourly instead of every minute; new `batchExpireOrders` (every minute) expires PENDING orders and releases their stock.

**Security touchpoint:** `imageUploader` / `imagesUploader` only accept `target` in `member`, `event`, `venue` (`article` was removed in section 10) and create the folder if missing.

**Not changed:** `MemberType` (stays `USER / AGENT / ADMIN`), board-article, follow, socket, `.env`, the collection and upload folder of the old catalog.

### Validation

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| grep for the old catalog's names in `apps/` | no matches |
| GraphQL schema generated from all resolvers (no DB needed) | pass, no old catalog names in the schema |
| `npx jest apps/ticketzy-api/src` (18 mock-based unit tests: reserve filter, order rollback, payment ticket issuing, cancel) | pass |
| Concurrency test against a real MongoDB | **not run** (no MongoDB available here) |
| Server start, DB connection, manual GraphQL smoke test | **not run** |
| Batch jobs against a database | **not run** |
| `eslint` | not run (`npm run lint` uses `--fix`) |

### Current operations by resolver
- event: createEvent, getEvent, updateEvent, getEvents, getFavorites, getVisited, getOrganizerEvents, likeTargetEvent, getAllEventsByAdmin, updateEventByAdmin, removeEventByAdmin
- venue: createVenue, getVenue, updateVenue, getVenues
- ticket-type: createTicketType, updateTicketType, getTicketTypes
- order: createOrder, payOrder, cancelOrder, getOrder, getMyOrders, getAllOrdersByAdmin
- ticket: getMyTickets, checkInTicket
- unchanged: member, comment, follow operations (the board was removed in section 10)

## 8. Notices and notifications wired (B10)

- New modules `notice` and `notification` (resolver, service, module, DTOs under `libs/dto/{notice,notification}`). Their schemas and enums already existed; registering them is what makes the `notices` and `notifications` collections appear in MongoDB (Mongoose creates a collection on first write).
- Notice operations: `getNotices` (public, ACTIVE only, filter by category); ADMIN: `createNotice`, `updateNotice`, `getAllNoticesByAdmin`, `removeNoticeByAdmin` (hard delete only after status DELETE).
- Notification operations: `getMyNotifications`, `markNotificationRead` (receiver only).
- Notifications are created by: a new event like (organizer), a comment on an event (organizer), and `payOrder` (buyer receipt and organizer sale). `createNotification` never throws, skips self-notification for LIKE and COMMENT, and in `payOrder` runs outside the rollback block so it cannot undo a payment.
- The `auths` collection is dropped from the ER (DECISIONS #21).

| Check | Result |
|---|---|
| `tsc --noEmit` both apps, `npm run build` | pass |
| `npx jest apps/ticketzy-api/src` (26 mock-based tests) | pass |
| GraphQL schema generated with the new resolvers | pass |
| Run against a database | **not run** |

## 9. Security and auth milestone (organizer role, email login, hardening)

Backend only, branch `modification`. Decisions: DECISIONS #13 (updated) and #23 to #26.

**Roles and members**
- `MemberType.AGENT` renamed to `ORGANIZER` (enum, `@Roles` in event, venue, ticket-type and ticket resolvers, member service, batch jobs). `MemberStatus` is now PENDING, ACTIVE, REJECTED, SUSPENDED, DELETE (no BLOCK). `MemberAuthType` lost TELEGRAM.
- `Member`: new `memberEmail` (required, unique index, lowercase, trimmed, format check); `memberNick` and `memberPhone` optional; `memberArticles` and `memberPoints` removed (schema, DTO, batch ranking formula, board-article counter calls). The `Member` GraphQL type exposes `memberEmail` only to the member and to admins (`MemberResolver.memberEmail`).
- Fixed on the way: `MISearch.memberStatus` used the `MemberType` enum; `updateMember` let any member set their own `memberType` and `memberStatus` and stored `memberPassword` unhashed (now ignored and hashed); `getMember` filtered on `MemberStatus` (capital M), so the filter did nothing.

**Operations changed**
- Removed `signup`. Added `signupUser` and `signupOrganizer` (`MemberInput`: memberEmail, memberPassword min 8, optional memberNick, memberPhone, memberFullName). `login` now takes `LoginInput { memberEmail, memberPassword }`.
- Unchanged: every other operation. Frontend impact: login and signup inputs, the JWT now holds only `_id` and `memberType` (the client must load the profile with `getMember`), and `MemberType` / `MemberStatus` values changed.

**Auth**
- `AuthService`: token payload `{ _id, memberType }`, expiry 1 day (`JwtModule.registerAsync`, secret read at startup instead of import time); `verifyToken` never leaks jwt errors (401); new `authenticate` (loads the member, rejects REJECTED, SUSPENDED and DELETE with `ACCOUNT_NOT_VERIFIED`); constant-time password check for unknown emails.
- Guards: `AuthGuard`, `RolesGuard` (null-checks the member first) and `WithoutGuard` all go through `authenticate`; new `ActiveOrganizerGuard` (`guards/organizer.guard.ts`) on the seven organizer mutations. New `Message` constants: `WRONG_EMAIL_OR_PASSWORD`, `ACCOUNT_NOT_VERIFIED`, `ORGANIZER_NOT_APPROVED`, `USED_MEMBER_EMAIL_NICK_OR_PHONE` (replaced `NO_MEMBER_NICK`, `WRONG_PASSWORD`, `BLOCKED_USER`, `USED_MEMBER_NICK_OR_PHONE`).
- Socket gateway authenticates through the database and broadcasts only id, role, nick, full name and image.
- `npm run seed` (`apps/ticketzy-api/src/seed.ts`): creates the first admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if no admin exists.

**Hardening**
- `libs/env.validation.ts`: API crashes without `SECRET_TOKEN` or the Mongo URI, batch without the Mongo URI. `.env.example` added (`CLIENT_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are new keys).
- `ValidationPipe({ whitelist: true, transform: true })`; CORS limited to `CLIENT_URL`; playground and introspection off in production (`GraphQLModule.forRootAsync`).
- `escapeRegExp` (`libs/config.ts`) used for every `new RegExp` (member, board article, event, venue).
- Nest `Logger` instead of `console.*` in guards, resolvers, services and database modules; the logging interceptor no longer prints request variables (passwords).
- Uploads: `saveVerifiedImage` checks png and jpeg magic bytes, picks the extension and name itself, and deletes partial files; the client mimetype and filename are ignored.

**Existing data (not migrated, no script was run):** members need a `memberEmail`; `memberType: 'AGENT'` and `memberStatus: 'BLOCK'` documents must be updated by hand; the new unique `memberEmail` index cannot build while members without an email exist.

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` and `nest build ticketzy-batch` | pass |
| `npx jest apps/ticketzy-api/src` (52 tests: auth service, guards, signup and login, input validation, magic bytes, regex escaping, env validation, plus the earlier order and ticket-type tests) | pass |
| GraphQL schema generated offline from all resolvers | pass: `signupUser`, `signupOrganizer`, new enums, `memberEmail` once on `Member` |
| `npm run seed` without admin env, API and batch started with a missing secret or Mongo URI | fail fast with a clear message, as intended |
| Seed against a database, real login and signup, guards over HTTP, upload of a real file | **not run** (no database was touched) |

## 10. Nestar leftovers removed (board, organizer naming, visibility)

Backend only. Decisions: DECISIONS #27 to #30.

**Deleted**
- `components/board-article/` (module, resolver, service), `libs/dto/board-article/` (3 files), `libs/enums/board-article.enum.ts`, `libs/schemas/BoardArticle.model.ts`, `availableBoardArticleSorts` in `libs/config.ts`. Removed from `components.module.ts` and from `CommentModule` / `CommentService`. All 8 board operations are gone.
- `ARTICLE` from `LikeGroup`, `ViewGroup`, `CommentGroup`, `NotificationGroup`; `articleId` from the Notification schema, DTO and `NotificationCreate`; the `article` upload target.

**Comments and follow**
- `CommentGroup` is only `EVENT`; `createComment` counts the comment on the event and notifies its organizer; `getComments` matches `commentGroup: EVENT`; `CommentService` no longer needs `MemberService`.
- `subscribe` requires an ACTIVE ORGANIZER target (new `Message.ONLY_ORGANIZERS_CAN_BE_FOLLOWED`); `unsubscribe` no longer looks the target up; `getMemberFollowings` / `getMemberFollowers` return ACTIVE members only, filtered before pagination.

**Renames (GraphQL names change)**
- `getAgents` to `getOrganizers`, `AgentsInquiry` to `OrganizersInquiry` (its search input `AISearch` to `OISearch`), `getAgentEvents` to `getOrganizerEvents`, `AgentEventsInquiry` to `OrganizerEventsInquiry`, `availableAgentSorts` to `availableOrganizerSorts`. Batch: `batchTopAgents` to `batchTopOrganizers`, `BATCH_TOP_AGENTS` to `BATCH_TOP_ORGANIZERS`, ranking is `memberEvents * 5 + memberLikes * 2 + memberViews`.

**Visibility**
- `getMember`: ACTIVE only (own page also while PENDING). `getOrganizers` was already ACTIVE only.
- `lookupActiveOrganizer` (`libs/config.ts`) drops events of non-ACTIVE organizers before sort and pagination in `getEvents`; `getFavorites` (`LikeService`) and `getVisited` (`ViewService`) filter the same way; `getEvent` and `likeTargetEvent` answer `NO_DATA_FOUND` for such events, and `getEvent` records no view for them.

**Docs:** `BACKEND_MIGRATION.md` and `FRONTEND_MIGRATION.md` rewritten (the old sections described the previous domain), old-domain wording removed from `AGENTS.md`, both skills, `PROMPTS.md`, `DECISIONS.md`, `NEXT_STEPS.md` and this file. "Nestar" is kept only as the name of the origin codebase and in the rename history.

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` and `nest build ticketzy-batch` | pass |
| `npx jest apps/ticketzy-api/src` (67 tests; new: follow, event visibility, comments, getMember and getOrganizers) | pass |
| GraphQL schema generated offline | pass: no article, board, agent or old catalog names; `CommentGroup` = EVENT |
| Reworked queries against the dev database (empty collections) | accepted by MongoDB: `getEvents`, `getOrganizers`, `getFavorites`, `getVisited`, `getMemberFollowers`, `getMemberFollowings`, `getMember`; REJECTED organizer hidden, follow of a USER refused, comment group MEMBER refused |
| Filtering with real events, follows and a suspended organizer | **not run** (no such data; covered by mock tests of the pipelines only) |

## 11. Organizer approval and audit log

Backend only. Decisions: DECISIONS #31 to #34.

**Operations added (all ADMIN, `RolesGuard`)**
- `getOrganizersByAdmin(input: OrganizersByAdminInquiry!): Members!` (page, limit, sort from the organizer sort whitelist, filter `memberStatus`, `text` searches full name, nick and email with escaped regex)
- `verifyOrganizerByAdmin(memberId)`, `rejectOrganizerByAdmin(input: { memberId, reason })`, `suspendOrganizerByAdmin(input: { memberId, reason })`, `reinstateOrganizerByAdmin(memberId)`: all return `Member`
- `setCommissionOverrideByAdmin(input: { memberId, rate, endsAt?, reason })`: returns `Member`
- `getAuditLogsByAdmin(input: AuditLogsInquiry!): AuditLogs!` (page, limit, sort `createdAt`, filter action, targetType, targetId, actorId; each entry includes `actorData`)

**Files added**
- `components/organizer/` (module, resolver, service) and `components/audit-log/` (module, resolver, service), both registered in `components.module.ts`
- `libs/schemas/AuditLog.model.ts` (collection `audit_logs`, index on `createdAt`), `libs/enums/audit-log.enum.ts` (`AuditAction`, `AuditTargetType`)
- `libs/dto/organizer/organizer.input.ts`, `libs/dto/audit-log/audit-log.ts`, `libs/dto/audit-log/audit-log.input.ts`
- specs: `organizer.service.spec.ts`, `audit-log.service.spec.ts`

**Files edited**
- `Member.model.ts` and `libs/dto/member/member.ts`: `rejectReason`, `commissionOverride { rate, endsAt, reason }` (embedded schema, rate 0 to 100); `MemberResolver` returns `memberEmail`, `rejectReason` and `commissionOverride` only to the member and to admins
- `member.enum.ts`: `organizerTransitions` rule table; `notification.enum.ts`: 5 new types; `common.enum.ts`: Message constants `NO_ORGANIZER_FOUND`, `INVALID_STATUS_TRANSITION`, `REJECT_REASON_REQUIRED`, `SUSPEND_REASON_REQUIRED`, `COMMISSION_REASON_REQUIRED`, `INVALID_COMMISSION_RATE`, `INVALID_COMMISSION_END_DATE`, `USE_ORGANIZER_OPERATIONS`; `libs/config.ts`: `availableAuditLogSorts`, `lookupActor`
- `member.service.ts`: `updateMemberByAdmin` refuses status and role changes on organizers
- N11: `ticket-type.service.ts` (`getTicketTypes`) and `order.service.ts` (`createOrder`) check the organizer is ACTIVE; both services and modules now use the `Member` model; `order.service.spec.ts` and `ticket-type.service.spec.ts` updated for the new constructor argument and extended

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` and `nest build ticketzy-batch` | pass |
| `npx jest apps/ticketzy-api/src` (117 tests; new: every action from every status, required reasons, rejectReason saved and cleared, audit and notification content, a broken notification or audit write does not block, commission rules, list filters, N11, the `updateMemberByAdmin` guard) | pass |
| GraphQL schema generated offline | pass: the 7 new operations are present |
| Live check against the dev database (30 checks over HTTP: all six operations and the invalid transitions, blank reasons, privacy of the new fields, admin-only access, audit entries and pagination, notifications received) | pass |
| `getTicketTypes` / `createOrder` against real data with a suspended organizer | **not run** (no events exist in the dev database; covered by mock tests) |

## 12. Events with admin approval

Backend only. Decisions: DECISIONS #35 to #40.

**Operations**
- Organizer (`RolesGuard` + `ActiveOrganizerGuard`, owner only): `createEvent` (always a DRAFT), `updateEvent` (DRAFT and REJECTED keep their status, APPROVED goes back to PENDING, PENDING, CANCELLED and ENDED refused), `submitEventForApproval(eventId)`. `getMyEvents(input: OrganizerEventsInquiry!)` replaces `getOrganizerEvents` (paged, optional `eventStatus`)
- Admin (`RolesGuard` ADMIN): `getEventsByAdmin(input: EventsByAdminInquiry!)` replaces `getAllEventsByAdmin` (status, categories, organizer, text); `approveEventByAdmin(eventId)`, `rejectEventByAdmin(input: { eventId, reason })`, `cancelEventByAdmin(input: { eventId, reason })`. `updateEventByAdmin` no longer changes status, `removeEventByAdmin` deletes DRAFTs only
- Public queries (`getEvents`, `getEvent`, `getFavorites`, `getVisited`, `likeTargetEvent`, `createOrder`) see APPROVED events only; the owner and admins open any event by id

**Schema and DTO**
- `Event`: `seatingType` (GENERAL default, RESERVED), `eventTranslations [{ locale en|ko|ru|uz, title, description }]`, `rejectReason`, `cancelReason`, `eventModeration { flags[{ type, reason, confidence }], reason, confidence, model, checkedAt }` (stored only). `rejectReason`, `cancelReason`, `eventModeration` are returned only to the owner and admins. `eventStatus` removed from `EventInput` and `EventUpdate`; `seatingType` and `eventTranslations` added to both
- `Member.completedEvents` (Int, default 0)
- `AuditAction` and `NotificationType` gained EVENT_APPROVED, EVENT_REJECTED, EVENT_CANCELLED; `AuditTargetType` gained EVENT; `AuditLogMeta` gained `fromEventStatus`, `toEventStatus`
- Message constants: `INVALID_EVENT_TRANSITION`, `EVENT_NOT_EDITABLE`, `EVENT_REJECT_REASON_REQUIRED`, `EVENT_CANCEL_REASON_REQUIRED`, `CANNOT_APPROVE_OWN_EVENT`, `EVENT_SUBMIT_TITLE_REQUIRED`, `EVENT_SUBMIT_IMAGE_REQUIRED`, `EVENT_SUBMIT_DATES_IN_PAST`, `EVENT_SUBMIT_VENUE_REQUIRED`, `EVENT_SUBMIT_TICKET_TYPE_REQUIRED`

**Batch**: `batchEndEvents`, hourly at minute 30 (`BATCH_END_EVENTS`): APPROVED events past `endAt` become ENDED and the organizer's `completedEvents` goes up by one. Ranking jobs now use `publicEventStatus`

**Files added**: `apps/ticketzy-batch/src/batch.service.spec.ts`
**Files edited**: `event.enum.ts` (new statuses, `SeatingType`, `EventLocale`, `eventTransitions`, `publicEventStatus`, `editableEventStatuses`, `closedEventStatuses`; old `listedEventStatuses` and `viewableEventStatuses` removed), `Event.model.ts`, `Member.model.ts`, `dto/event/*`, `dto/member/member.ts`, `dto/audit-log/audit-log.ts`, `event.service.ts`, `event.resolver.ts`, `event.module.ts`, `like.service.ts`, `view.service.ts`, `order.service.ts`, `ticket-type.service.ts` (event-level SOLD_OUT handling removed; ticket types still flip to SOLD_OUT), `batch.service.ts`, `batch.controller.ts`, `batch/lib/config.ts`, the specs of event, order and ticket-type, and `package.json` (jest `modulePaths: ["<rootDir>"]`, so the batch app's `apps/...` imports resolve in tests)

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` and `nest build ticketzy-batch` | pass |
| `npx jest apps` (177 tests; new: transition table, submit validation rules, edit rules per status, admin transitions, required reasons, audit and notification content, double approval, self approval, refund hook, visibility for guests, strangers, owner and admin, favorites and visited pipelines, resolver roles and guards, `batchEndEvents`) | pass |
| GraphQL schema generated offline | pass: new operations and fields present, `getOrganizerEvents` and `getAllEventsByAdmin` gone |
| Live check against a dev database | **not run** (mock tests only) |

## 13. Venue seat layout and seats

Backend only. Decisions: DECISIONS #41 to #44.

**Operations**
- `getMyEvents` now uses `RolesGuard` + `ActiveOrganizerGuard` (suspended organizers are locked out)
- `getEventSeatMap(eventId)` (public): layout, timezone and the HELD (hold in the future) and SOLD seats of an APPROVED RESERVED event, without `heldBy`
- `approveEventByAdmin` generates the `EventSeat` documents of a RESERVED event first (see below), then changes the status
- `submitEventForApproval` checks seated tiers for RESERVED events; GENERAL events need no layout
- `createVenue` / `updateVenue` take `venueLayout` and `venueTimezone`; `venueCapacity` is no longer an input
- `createTicketType` / `updateTicketType` take `tierKey`; `totalQuantity` is optional (required for GENERAL, refused for RESERVED where it is computed from the seats)

**Schema and DTO**: `Venue.venueTimezone`, `Venue.venueLayout`; `TicketType.tierKey` (partial unique index `(eventId, tierKey)`); new `EventSeat` schema; enums `SectionKind`, `SectionSpacing`, `SeatStatus`; DTOs `VenueSection(Input)`, `VenueLayout(Input)`, `EventSeatMap`, `TakenSeat`
**Message constants**: `INVALID_VENUE_LAYOUT`, `VENUE_LAYOUT_NO_SECTIONS`, `VENUE_LAYOUT_DUPLICATE_SECTION_KEY`, `VENUE_LAYOUT_BAD_SEAT_GRID`, `VENUE_LAYOUT_CAPACITY_REQUIRED`, `VENUE_LAYOUT_TIER_KEY_REQUIRED`, `INVALID_VENUE_TIMEZONE`, `EVENT_SUBMIT_LAYOUT_REQUIRED`, `SEAT_TIER_MISSING`, `SEAT_TIER_DUPLICATE`, `TICKET_TYPE_TIER_KEY_REQUIRED`, `TICKET_TYPE_QUANTITY_FROM_SEATS`, `TICKET_TYPE_QUANTITY_REQUIRED`, `TICKET_TYPE_TIER_LOCKED`, `SEAT_GENERATION_FAILED`

**Files added**: `libs/venue-layout.ts` (+ spec), `libs/schemas/EventSeat.model.ts`, `libs/dto/event/event-seat.ts`, `components/venue/venue.service.spec.ts`
**Files edited**: `event.enum.ts`, `common.enum.ts`, `Venue.model.ts`, `TicketType.model.ts`, `dto/venue/*`, `dto/ticket-type/*`, `venue.service.ts`, `ticket-type.service.ts` and module, `event.service.ts`, `event.resolver.ts`, `event.module.ts`, the specs of event and ticket-type

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| `npx jest apps` (257 tests; new: layout validation, capacity, timezone, venue create/update, seat generation incl. idempotency with an in-memory upsert store and the missing/duplicate tier failures, quantity computed from seats, seat map filter and privacy, submit checks, `getMyEvents` guards) | pass |
| Live check against a dev database (real unique index, bulkWrite upserts) | **not run** (mock tests only) |

## 14. Seat holds, mock payment, tickets

Backend only. Decisions: DECISIONS #45 to #51.

**Operations**
- `holdSeats(eventId, seatIds)` and `releaseSeats(eventId)` (`AuthGuard`, ACTIVE members of any role): see #45. `holdSeats` returns `SeatHold { eventId, seats, heldUntil, serverTime }`
- `createOrder` is now `createCheckout(input: CheckoutInput { eventId, seatIds?, items? })`; `cancelOrder` is now `cancelPendingOrder`; `payOrder(orderId, simulate: PaymentSimulation!)` takes SUCCESS or FAILURE (#46, #48)
- `getMyTickets(input: TicketsInquiry { page, limit, timeFilter? })` (UPCOMING / PAST) and the new `getTicket(ticketId)`, both owner-only and returning `qrToken`, `eventData`, `ticketTypeData` and `seatData { sectionKey, row, number }` (#49)
- `updateVenue` refuses `venueLayout` once a non-DRAFT event of the venue has generated seats (#51)
- Batch `batchExpireOrders` (every minute) now also releases seats and sweeps expired holds (#50)

**Environment**: `SEAT_HOLD_SECONDS` (optional, default 30, 1 to 3600) and `QR_SECRET` (required by the API) are checked at startup by `validateEnv`; both are in `.env.example`, and a `QR_SECRET` was added to the local `.env`

**Schema and DTO**: `OrderStatus` PENDING renamed PENDING_PAYMENT, FAILED added; `PaymentProvider.MOCK`; new enums `PaymentSimulation`, `TicketTimeFilter`. `Order` gained `seatIds`, `currency`, `subtotal`, `commissionRate`, `commissionAmount` (`totalAmount` stays the buyer total). `Ticket` gained `qrToken`, `seatId`. `EventSeat` gained indexes `(seatStatus, heldUntil)` and `(eventId, heldBy)`. DTOs `CheckoutInput`, `TicketsInquiry`, `TicketSeat`, `HeldSeat`, `SeatHold`
**Message constants**: `VENUE_LAYOUT_LOCKED`, `SEAT_HOLD_LIMIT`, `SEAT_JUST_TAKEN`, `SEATS_NOT_AVAILABLE_FOR_EVENT`, `HOLD_EXPIRED`, `CHECKOUT_RESERVED_NEEDS_SEATS`, `CHECKOUT_GENERAL_NEEDS_ITEMS`, `ORDER_NOT_PAYABLE`

**Files added**: `components/seat/` (service, resolver, module, `seat-flow.spec.ts`), `components/payment/` (`payment.provider.ts` with the `PaymentProvider` interface and token, `mock-payment.provider.ts`, `payment.service.ts`, `payment.module.ts`), `libs/commission.ts` (+ spec), `libs/qr-token.ts`, `libs/env.validation.spec.ts`, `libs/dto/ticket/ticket.input.ts`, `components/ticket/ticket.service.spec.ts`, `apps/ticketzy-api/test/fake-model.ts` (in-memory model for tests, outside the build)
**Files edited**: `env.validation.ts`, `app.module.ts`, `components.module.ts`, `order.service.ts` / `.resolver.ts` / `.module.ts` (the `Payment` model moved into `PaymentService`), `ticket.service.ts` / `.resolver.ts`, `ticket-type.service.ts` (`findSellable`), `venue.service.ts` / `.module.ts`, the Order, Ticket and EventSeat schemas, the order, ticket and event-seat DTOs, `ticket.enum.ts`, `common.enum.ts`, `config.ts` (`lookupSeat`), `batch.service.ts` / `.controller.ts` / `.module.ts`, the specs of order, venue and batch, `.env.example`

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` and `nest build ticketzy-batch` | pass |
| `npx jest apps` (307 tests, 18 suites; new: the hold race of two members for one seat, release on partial failure, hold expiry and re-hold, the 8 seat limit, non-ACTIVE members and closed events, commission tiers and override, server-side pricing, payment SUCCESS, FAILURE and idempotency, the HOLD_EXPIRED rollback with refund, ticket issuing failure undo, general-admission checkout, batch expiry and the seat sweep, ticket filters and owner-only access, the venue layout lock, env validation) | pass |
| GraphQL schema built offline from the three resolvers | pass: new operations, `CheckoutInput`, `PaymentSimulation` present |
| Live check against a dev database, app start with the real DI graph | **not run** (no MongoDB used; the race and payment tests run on an in-memory model, see N19) |

## 15. Check-in, refunds, event cancellation, sales

Backend only. Decisions: DECISIONS #52 to #57. Closes N20.

**Operations**
- `checkInTicket(qrToken, eventId?)` (replaces the `ticketCode` argument) and `checkInPreview(qrToken, eventId?)`: ORGANIZER (ACTIVE) or ADMIN, both return `CheckInResult { ticket, seat, buyerName, ticketTypeName, ticketStatus }` (#52, #53)
- `getRefundQuote(orderId)` returns `RefundQuote { deadline, refundable, refundableAmount, venueTimezone, currency, reason }`; `requestRefund(orderId, reason?)` returns the `Order`; both buyer only (#54, #55)
- `refundOrderByAdmin(input: AdminRefundInput { orderId, reason })` returns the `Order`, audited (#55)
- `retryEventRefundsByAdmin(eventId)` returns `RefundSummary { eventId, refundedCount, failedCount, totalCount, failedOrderIds }` (#56)
- `cancelEventByAdmin` now runs the refund hook (`refundOrdersForCancelledEvent`, in `RefundService`); its return type is unchanged
- Organizer only: `getEventSales(eventId)` (`EventSales { ticketTypes[ { ticketsSold, revenue, commission, netPayout } ] }`, every ticket type listed), `getEventAttendees(input: AttendeesInquiry { eventId, page, limit, ticketStatus? })` (`Attendees`), `getMyEarnings` (`MyEarnings { earnings[] }`, one entry per currency, with `refundedAmount`) (#57)

**Schema and DTO**: new `Refund` model (collection `refunds`, unique `orderId`); `Order.refundedAt`; enums `RefundStatus`, `RefundSource`, `AuditAction.ORDER_REFUNDED_BY_ADMIN` and `EVENT_REFUNDS_PROCESSED`, `AuditTargetType.ORDER`, `NotificationType.REFUND_COMPLETED` and `ORDER_REFUNDED`. New DTOs under `libs/dto/refund`, `libs/dto/sales` and `libs/dto/ticket/check-in.ts`
**Message constants**: `QR_INVALID`, `TICKET_WRONG_EVENT`, `TICKET_WRONG_ORGANIZER`, `TICKET_ALREADY_USED`, `TICKET_REFUNDED`, `TICKET_NOT_VALID`, `EVENT_NOT_OPEN_FOR_CHECKIN`, `ORDER_NOT_REFUNDABLE`, `REFUND_DEADLINE_PASSED`, `REFUND_TICKET_CHECKED_IN`, `REFUND_REASON_REQUIRED`, `REFUND_FAILED`, `REFUND_IN_PROGRESS`, `EVENT_NOT_CANCELLED`

**Files added**: `components/refund/` (service, resolver, module, `refund.service.spec.ts`), `components/sales/` (service, resolver, module, spec), `libs/refund-policy.ts` (+ spec), `libs/schemas/Refund.model.ts`, `libs/dto/refund/`, `libs/dto/sales/`, `libs/dto/ticket/check-in.ts`
**Files edited**: `libs/qr-token.ts` (`buildQrToken`, `parseQrToken`), `ticket.service.ts` / `.resolver.ts` / `.module.ts` / spec, `order.service.ts` (token format, `addSold` after payment and its undo), `payment.service.ts` (`refundOrder`), `seat.service.ts` (`releaseSoldSeats`), `ticket-type.service.ts` (`addSold`), `event.service.ts` / `.module.ts` / spec (refund hook), `components.module.ts`, `seat-flow.spec.ts`, the enums, `Order.model.ts`, `test/fake-model.ts` (now supports `sort`, `limit` and ObjectId comparison)

**Tests added**: signature (forged, garbled, missing, unsigned, wrong stored token, no database call), double scan (also in parallel), wrong event, wrong organizer, closed event, preview changes nothing; refund deadline in Seoul and Los Angeles at the same instant, to the millisecond, DST and the day boundary; idempotent refund and two parallel requests; refund after check-in (also a scan between check and flip); admin override with audit; cancel with a partial failure and a re-run, 120 orders over several batches, resume after a dead run, an order owned by another run; `soldQuantity` on sale, rollback, refund; sales owner check, commission and net payout, per-currency earnings

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| `npx jest` (360 tests, 21 suites) | pass |
| GraphQL schema built offline from the refund, sales, ticket and order resolvers | pass: all new operations present |
| Live check: built API (`SEAT_HOLD_SECONDS=5`) and built batch app against the dev database, driven over GraphQL: check-in, tampered and wrong-event tokens, refund, idempotent refund, refund after scan, deadlines in Seoul and Los Angeles, event cancel and retry, sales queries, batch sweep (26 checks) | pass; test data deleted by id, no leftovers. It found that `Order` did not expose `refundedAt` (fixed in `libs/dto/order/order.ts`). Real-database races (N19, N23) still not run |

## 16. Organizer and admin messaging, notifications

Backend only. Decision: DECISIONS #58. The old global socket chat (in-memory last 5 messages) is removed.

**Operations** (`ConversationGuard`: ORGANIZER and ADMIN only, REJECTED and SUSPENDED accounts included; what they may do is decided in the service)
- `startConversation(eventId?)` (organizer: own event, or the general support conversation; PENDING and REJECTED may open support only), `getMyConversations(input: OrdinaryInquiry)`, `getConversation(conversationId)` (with `eventData` card, `organizerData`, `adminData`), `getMessages(conversationId, input)` (newest first, page size capped at 100), `sendMessage(conversationId, body)`, `markConversationRead(conversationId)`
- Notifications (still `AuthGuard`): `getMyNotifications` now takes `unreadOnly`, new `getUnreadNotificationCount`, `markAllNotificationsRead` (both `Int`); `markNotificationRead` was already there
- Notification types: `NEW_MESSAGE` added; new message, event approved, rejected, cancelled, organizer verified, rejected, suspended and refund processed were already covered; group `CONVERSATION` added; notifications carry an optional `conversationId`

**Sockets** (`socket/socket.gateway.ts`, `ConversationRealtime`): auth by `Authorization` header or a first `{event:'auth', data:{token}}` message within 10 seconds (close 4401 / 4408), member reloaded on every action; client events `joinConversation`, `leaveConversation`, `typing`; server events `authenticated`, `joined`, `left`, `message`, `unread`, `read`, `typing`, `error`. `AuthService.authenticate(token, { allowRestricted })` and `loadMember` are new

**Schema**: `Conversation` (collection `conversations`), `Message` (`messages`, index `conversationId + createdAt`), `Notification.conversationId` and a `receiverId + notificationStatus + createdAt` index
**Message constants**: `CONVERSATION_NOT_ALLOWED`, `CONVERSATION_SUPPORT_ONLY`, `CONVERSATION_EVENT_NOT_YOURS`, `CONVERSATION_ORGANIZERS_ONLY`, `MESSAGE_BODY_REQUIRED`, `MESSAGE_BODY_TOO_LONG`, `TOO_MANY_MESSAGES`

**Files added**: `components/conversation/` (service, resolver, module, `conversation.realtime.ts`, spec), `components/auth/guards/conversation.guard.ts`, `socket/socket.gateway.spec.ts`, `libs/conversation-access.ts`, `libs/rate-limiter.ts`, `libs/schemas/Conversation.model.ts`, `libs/schemas/Message.model.ts`, `libs/dto/conversation/conversation.ts`
**Files edited**: `socket/socket.gateway.ts` (rewritten) and `socket.module.ts`, `auth.service.ts` (+ spec), `notification.service.ts` / `.resolver.ts`, `libs/dto/notification/*`, `Notification.model.ts`, the notification and common enums, `components.module.ts`, `test/fake-model.ts` (`skip`, `countDocuments`)

**Tests added**: only the conversation's organizer and admins read, write and mark read; USER, inactive admin and DELETE refused; PENDING, REJECTED and SUSPENDED limited to support (read, write, list, start); unread counters per side and mark read; first admin recorded and kept (also two admins at once); trimmed, empty and 2001 character bodies; private rooms and per-role unread counts; rate limit (429, per member, nothing saved when refused, sliding window); notification receivers (assigned admin, all active admins, organizer, never the sender, failures never throw); socket auth by header and by message, timeout, bad token, USER, join checks, typing, typing rate limit, disconnect

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| `npx jest` (408 tests, 23 suites) | pass |
| GraphQL schema built offline from the conversation and notification resolvers | pass: all operations present |
| Live check against a dev database and a real WebSocket client | **not run** (tests use the in-memory model; the unique partial indexes and the aggregation lookups are untested against MongoDB) |

## 17. Restricted accounts: notifications and socket cut-off

Backend only. Decision: DECISIONS #59.

- `NotificationGuard` (new, `components/auth/guards/notification.guard.ts`) on the four notification operations: REJECTED, SUSPENDED and PENDING members can read notifications, DELETE stays blocked, any member type is allowed
- `rejectOrganizerByAdmin` and `suspendOrganizerByAdmin` remove the organizer's sockets from all non-support rooms (`ConversationRealtime.setMemberRestricted`, called from `OrganizerService`; `OrganizerModule` imports `ConversationModule`); verify and reinstate lift it
- Gateway: `joinConversation` passes `isSupport` (`assertConversationAccess` now returns the conversation) and a restricted socket cannot join other rooms; every action re-syncs the restriction from the freshly loaded member; the room emitters never send non-support events to a restricted socket

**Tests added**: `NotificationGuard` (REJECTED, SUSPENDED, PENDING, ACTIVE, USER, DELETE refused by `authenticate`, the four operations use it); `OrganizerService` calls (reject, suspend restrict; verify, reinstate lift; invalid transition and a throwing realtime); gateway (rejected member loses the event room but keeps support and gets no event-room events, status re-check on the next action, only that member's sockets, lift)

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| `npx jest` (420 tests, 23 suites) | pass |
| Live check: built API on port 4777 against the dev database, real WebSocket and GraphQL clients, test admin and organizers inserted directly (48 checks): socket auth (header-less auth message, 10 s timeout 4408, bad token 4401, URL token ignored), start own and support conversation, admin sees both, other organizer refused, room-only delivery, unread counters and mark read, `adminId` on first admin reply, notifications for the other party only, rate limit (11th refused, not saved), PENDING and REJECTED support-only and notifications readable, 2001 character body refused, live reject and suspend cut sockets off event rooms | pass; test data deleted by id, no leftovers. Reject is only allowed from PENDING, so the rejected organizer was moved to PENDING in the database after its socket had joined. Real-database races (N19, N23) still not run |
