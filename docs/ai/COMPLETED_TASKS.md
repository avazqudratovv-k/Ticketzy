# Completed Tasks

Session: Claude Code (Sonnet 5.5), branch `modification`. The request text referred to "Codex" and "Petoria"; the actual tool and project are Claude Code and Ticketzy.

## 1. Analysis
- Explored the monorepo: apps, modules, schemas, enums, auth, upload, WebSocket and batch. Mapped real-estate concepts to ticketing equivalents (Property to Event, Agent to Organizer; Venue, TicketType, Order, Ticket missing). Findings are summarized in `BACKEND_MIGRATION.md`.
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

## 7. Layers 2 to 5: Property replaced by the Ticketzy domain

Session: Claude Code (Sonnet 5.5), branch `modification`, working from the owner's ER diagram. Committed as `a9a3d19`.

**Housekeeping:** removed stale `dist/`; `npm install --package-lock-only` produced no lockfile diff.

**Layer 2, decoupling**
- `OrdinaryInquiry`, `PricesRange`, `PeriodsRange` moved to `libs/dto/common/common.input.ts`.
- `LikeGroup`, `ViewGroup`, `CommentGroup`, `NotificationGroup`: `PROPERTY` became `EVENT` (`NotificationGroup` also gained `ORDER`; `NotificationType` gained `ORDER_PAID`, `EVENT_REMINDER`).
- Fixed `Like.model.ts` (used `ViewGroup`); like and view unique indexes and lookups are now group-scoped; `toggleLike`, `checkLikeExistence`, `recordView` search by group.
- `getFavoriteEvents` / `getVisitedEvents` look up `events` and no longer crash on an empty result; `CommentService` uses `EventService`; fixed the inverted `if (result!)` check in `createComment`.

**Layer 3, catalog**
- New enums `libs/enums/event.enum.ts`, `ticket.enum.ts` (values in DECISIONS #14).
- New schemas: `Event`, `Venue`, `TicketType`, `Order` (embedded `items[]`), `Ticket`, `Payment`; `Notification` now has `eventId` / `orderId`; `Member.memberProperties` became `memberEvents` (+ DTO).
- New modules `event`, `venue`, `ticket-type` with DTOs under `libs/dto/{event,venue,ticket-type}`. Filters: category, venue, city, price (`eventMinPrice`), date (`startAt`), text (regex now escaped). `eventMinPrice` is recomputed when ticket types change. Event date ranges are validated. The organizer's `memberEvents` counter drops once when an event first becomes CANCELLED or DELETE.
- Removed `components/property`, `libs/dto/property`, `Property.model.ts`, `property.enum.ts`.
- Fixed the old bug where `updateProperty` never persisted `deletedAt`.

**Layer 4, sales**
- Modules `order` (createOrder, payOrder, cancelOrder, getOrder, getMyOrders, getAllOrdersByAdmin; payment is a stub) and `ticket` (getMyTickets, checkInTicket).
- `TicketTypeService.reserve` / `release`: atomic conditional `findOneAndUpdate` (see DECISIONS #17). Orders snapshot unit prices, reject mixed currencies and duplicate ticket types, and release stock on any partial failure.

**Layer 5, batch**
- Ranking now uses `events` (`batchTopEvents`) and `memberEvents` (`batchTopAgents`); rollback and ranking run hourly instead of every minute; new `batchExpireOrders` (every minute) expires PENDING orders and releases their stock.

**Security touchpoint:** `imageUploader` / `imagesUploader` only accept `target` in `member`, `event`, `venue`, `article` and create the folder if missing.

**Not changed:** `MemberType` (stays `USER / AGENT / ADMIN`), board-article, follow, socket, `.env`, the `properties` collection, `uploads/property/`.

### Validation

| Check | Result |
|---|---|
| `tsc --noEmit` `ticketzy-api` and `ticketzy-batch` | pass |
| `npm run build` | pass |
| `grep -rni propert apps/` | no matches |
| GraphQL schema generated from all resolvers (no DB needed) | pass, no `propert*` in the schema |
| `npx jest apps/ticketzy-api/src` (18 mock-based unit tests: reserve filter, order rollback, payment ticket issuing, cancel) | pass |
| Concurrency test against a real MongoDB | **not run** (no MongoDB available here) |
| Server start, DB connection, manual GraphQL smoke test | **not run** |
| Batch jobs against a database | **not run** |
| `eslint` | not run (`npm run lint` uses `--fix`) |

### Current operations by resolver
- event: createEvent, getEvent, updateEvent, getEvents, getFavorites, getVisited, getAgentEvents, likeTargetEvent, getAllEventsByAdmin, updateEventByAdmin, removeEventByAdmin
- venue: createVenue, getVenue, updateVenue, getVenues
- ticket-type: createTicketType, updateTicketType, getTicketTypes
- order: createOrder, payOrder, cancelOrder, getOrder, getMyOrders, getAllOrdersByAdmin
- ticket: getMyTickets, checkInTicket
- unchanged: member, board-article, comment, follow operations

## 8. Notices and notifications wired (B10)

- New modules `notice` and `notification` (resolver, service, module, DTOs under `libs/dto/{notice,notification}`). Their schemas and enums already existed; registering them is what makes the `notices` and `notifications` collections appear in MongoDB (Mongoose creates a collection on first write).
- Notice operations: `getNotices` (public, ACTIVE only, filter by category); ADMIN: `createNotice`, `updateNotice`, `getAllNoticesByAdmin`, `removeNoticeByAdmin` (hard delete only after status DELETE).
- Notification operations: `getMyNotifications`, `markNotificationRead` (receiver only).
- Notifications are created by: a new event like (organizer), a comment on an event, article or member (owner), and `payOrder` (buyer receipt and organizer sale). `createNotification` never throws, skips self-notification for LIKE and COMMENT, and in `payOrder` runs outside the rollback block so it cannot undo a payment.
- The `auths` collection is dropped from the ER (DECISIONS #21).

| Check | Result |
|---|---|
| `tsc --noEmit` both apps, `npm run build` | pass |
| `npx jest apps/ticketzy-api/src` (26 mock-based tests) | pass |
| GraphQL schema generated with the new resolvers | pass |
| Run against a database | **not run** |
