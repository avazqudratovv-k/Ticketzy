# 06 - Quality: tests, CI, configuration checks, operations, demo data, and open questions

**What this file covers.** How the code is tested (what is covered and, just as important, what is not), the CI pipeline, the startup environment validation, health checks, logging, the demo-data tooling with its consistency checks, notes for running in production, a cross-check against the frontend repository, and at the end the list "Questions and oddities": things that look inconsistent, dead, risky or unclear, each with a file path. Paths start at `apps/ticketzy-api/src/` unless written otherwise.

---

## 1. Tests

**How to run.** `npm run test` (Jest 29 with `ts-jest`; config in `package.json` under `"jest"`: `roots: ["<rootDir>/apps/"]`, `testRegex: ".*\\.spec\\.ts$"`, `testEnvironment: "node"`). Also `npm run test:watch`, `test:cov`, `test:debug`. Observed run for this tour: **63 suites, 1244 tests, all passing, about 8 s**. There is no `test` folder with end-to-end tests: the boilerplate e2e specs were deleted (decision #99).

**Important: no test uses a real MongoDB.** `package.json` has no `mongodb-memory-server`; CI starts a `mongo:7` container but the workflow comment says it is "for later integration tests" and nothing in the specs connects to it. The test styles are:

1. **Pure functions** tested directly: refund deadline (`libs/refund-policy.spec.ts`, 19 tests incl. DST across seven time zones), payout date/status (`libs/payout.spec.ts`), commission tiers, sales window, venue layout and conflicts, env parsers, error mapping, rate limiter.
2. **Services with an in-memory `FakeModel`** (`test/fake-model.ts`, 178 lines): a tiny stand-in for a Mongoose model that supports equality, regex, `$or`, `$and`, `$in`, `$nin`, `$ne`, `$gt/$gte/$lt/$lte`, and the `$set`, `$unset`, `$inc` update operators. Each operation runs synchronously, so a `findOneAndUpdate` is atomic like the real one. Used where state must carry across calls (`components/seat/seat-flow.spec.ts`, 35 tests: seat races, hold expiry, payment idempotency, refunds).
3. **Services with `jest.fn()` mocks** returning canned data (most `*.service.spec.ts`).
4. **A real Nest HTTP app without MongoDB** (`app-http.spec.ts`, `libs/production-behaviour.spec.ts`): rate limits answer `RATE_LIMITED`, introspection is off in production, helmet headers, CORS for the listed origin only, a 429 carries CORS headers, `formatError` shapes, `limit > 100` message, the logging interceptor does not log variables, indexes added in the hardening task are non-unique, TTL index on `ai_usage`, `start:prod` sets `NODE_ENV`, shutdown hooks.
5. **Schema self-check** (`libs/schema.spec.ts`): builds the GraphQL schema from every `*.resolver.ts` without a database and asserts **exactly 97 operations (41 queries, 56 mutations)**, so a renamed or dropped operation fails the test.
6. **Structural guard tests**: `components/auth/admin-access.spec.ts` (every `*ByAdmin` operation must be `Roles(ADMIN)` + `RolesGuard`), `components/member/member.privacy.spec.ts` (every `Member` field classified public or private).

What is covered, by area (test counts from the specs; `it(` count per file):

| Area | Specs (tests) |
|---|---|
| Events | `event.service.spec.ts` (116) |
| Orders / payments / buyer-only | `order.service.spec.ts` (27), `buyer-only.spec.ts` (8), `payment-mode.spec.ts` (4), `seat-flow.spec.ts` (35) |
| Refunds, payouts, sales | `refund.service.spec.ts` (29), `payout.service.spec.ts` (17), `libs/payout.spec.ts` (14), `sales.service.spec.ts` (7) |
| Tickets and check-in | `ticket.service.spec.ts` (15) |
| Ticket types / venues | `ticket-type.service.spec.ts` (20), `venue.service.spec.ts` (11), `libs/venue-layout.spec.ts` (9), `libs/venue-conflicts.spec.ts` (10) |
| Members / organizers / auth | `member.service.spec.ts` (24), `member.privacy.spec.ts` (7), `organizer.service.spec.ts` (23), `auth.service.spec.ts` (6), `guards.spec.ts` (5) |
| Chat | `conversation.service.spec.ts` (48), `socket.gateway.spec.ts` (13) |
| AI | `ai.service.spec.ts` (61), `ai-usage.service.spec.ts` (12), provider specs (5 + 9), `libs/ai-check.spec.ts` (11), `libs/ai-reason.spec.ts` (3) |
| Batch | `batch.service.spec.ts` (10), `batch.rank.spec.ts` (7) |
| Production behaviour | `libs/env.validation.spec.ts` (16), `libs/production-env.spec.ts` (22), `libs/production-behaviour.spec.ts` (11), `libs/rate-limit.spec.ts` (11), `libs/error-mapping.spec.ts` (11), `libs/http-hardening.spec.ts` (8), `libs/upload-guard.spec.ts` (8), `libs/validation.spec.ts` (5), `health.controller.spec.ts` (3), `app-http.spec.ts` (6) |
| Demo data | `libs/demo-plan.spec.ts` (32), `demo-consistency.spec.ts` (15), `demo-guards.spec.ts` (11), `demo-manifest.spec.ts` (7), `demo-errors.spec.ts` (5), `demo-refunds.spec.ts` (5), `demo-seeder.refunds.spec.ts` (4) |
| Misc | comments (11), notices (5), views (6), audit log (3), `libs/order-expiry.spec.ts` (10), `libs/seat-counts.spec.ts` (3), `libs/sales-window.spec.ts` (8), `libs/commission.spec.ts` (5), `libs/currency.spec.ts` (4), `libs/config.spec.ts` (7), `libs/admin-seed.spec.ts` (4) |

**What the tests cannot prove.** Atomicity of `findOneAndUpdate` is a MongoDB guarantee; the `FakeModel` imitates it single-threaded. MongoDB aggregation pipelines (`$facet`, `$lookup` with `let`/`pipeline`, `$dateAdd` with a time zone, `$expr`) are mocked or never executed in tests: for example `payout.service.spec.ts` replaces `eventModel.aggregate` and only inspects the first stage. Those are exercised only by running the app or the demo seed against a real MongoDB 5+ (the first real demo seed on Atlas found a refund-deadline bug, decision #109). A reader should treat "all 1244 tests pass" as "the logic is consistent with itself", not "it works against MongoDB".

Fixed clocks: refund tests freeze time with `freezeClock` (decision #70) so they do not depend on the hour they run.

---

## 2. CI (`.github/workflows/ci.yml`)

- Triggers: every `push` and `pull_request`. Permissions: `contents: read`.
- One job `test` on `ubuntu-latest` with a `mongo:7` service container (unused by the tests today).
- Environment is fake values written in the file, labelled "not secrets": `MONGO_DEV=mongodb://localhost:27017/ticketzy_ci`, `SECRET_TOKEN`, `QR_SECRET`, `PAYMENT_MODE=simulated`.
- Steps: checkout, Node 22 with npm cache, `npm ci`, `npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit`, the same for the batch app, `npm run build`, `npm test`, then `npm audit --omit=dev --audit-level=critical` with `continue-on-error: true` (never fails the build).
- Not in CI: lint (it would rewrite files, decision #6), coverage thresholds, e2e, any deploy.

`AGENTS.md` states the rule for finishing work: the full suite, both `tsc` checks and `npm run build` must pass.

---

## 3. Environment validation (`libs/env.validation.ts`)

- `validateEnv(required, { checkPayment, web })` is the `validate` hook of `ConfigModule.forRoot` (API: `validateEnv(['SECRET_TOKEN', 'QR_SECRET'], { checkPayment: true, web: true })`; batch: `validateEnv()`, which only requires the Mongo URI). It collects **all** problems and throws one `Error` that names variables, never values.
- Checks everywhere: the Mongo URI variable for the current `NODE_ENV` exists; `NODE_ENV` is one of production/development/test; if `RENDER` is set then `NODE_ENV` must be production; `SEAT_HOLD_SECONDS`, the AI settings (`getAiConfig`), port, `LOG_LEVEL`, `MONGO_AUTO_INDEX` parse; with `checkPayment`, `PAYMENT_MODE`.
- Extra in production for the API (`web: true`): `CORS_ORIGINS` (or `CLIENT_URL`) present; the Mongo URI starts with `mongodb://` or `mongodb+srv://`; `SECRET_TOKEN` and `QR_SECRET` at least 32 characters, not containing placeholder words (`getWeakSecretReason`: changeme, replace, example, placeholder, default, password, secret, token, qwerty, 123456, abcdef, xxxx, todo, test, ...) and at least 10 different characters; `QR_SECRET` different from `SECRET_TOKEN`; `parseCorsOrigins` (exact origins, no wildcard, no path, https unless localhost); `getAiCaps`; `getUploadLimits`; `getRateLimitConfig`; `getTrustProxyHops`.
- Outside production the checks are light (presence and ranges). In development an empty CORS list means `http://localhost:3000`.
- AI keys are deliberately *not* required: a missing key only turns AI off (`getAiStartupWarnings` prints hints for Gemini).
- Rule (`AGENTS.md`): a new variable needs a parser in this file, an entry in `RUN_IN_PRODUCTION.md` and a test. `.env.example` is not edited by AI tasks.
- Secrets handling rule: never read or print `.env`; use `.env.example` for names.

---

## 4. Health checks

`GET /health` -> always `200 { status: 'ok' }`, no database access (use this as the host's health check). `GET /ready` -> `200 { status: 'ready' }` when `connection.readyState === 1`, otherwise `503 { status: 'unavailable' }` (for your own monitoring). Both are public, tiny, outside `/graphql`, so the GraphQL rate limit does not count them (`health.controller.ts`, tested in `health.controller.spec.ts`). The batch app has `GET /` only.

---

## 5. Logging

- Library: the Nest `Logger`. Levels from `getLogLevels()`: default `warn` in production, `verbose` otherwise; `LOG_LEVEL` overrides. Production logs only warn and error by default.
- Per request: `AuthGuard` logs `authenticated member <id>` and `RolesGuard` logs `member <id> allowed as <type>` at log level (hidden in production); resolvers log `Mutation: name` / `Query: name`; `LoggingInterceptor` logs the operation name and duration.
- Never logged: variables, tokens, passwords, prompts, response bodies, connection strings (`redactSecrets` in `libs/error-mapping.ts` strips `mongodb://...` and `password|secret|token|key=...`), API keys.
- Expected domain errors (wrong password, unverified account) log one `warn` line (`isExpectedDomainError`) instead of an error.
- Money-related failures are logged loudly with ids only: `REFUND NEEDED for <providerRef>`, `AUDIT LOG NOT WRITTEN`, `memberEvents NOT DECREMENTED`, `completedEvents NOT INCREMENTED`, `Moderation result ... NOT STORED`.
- The DB module logs `MongoDB disconnected` / `reconnected` as warnings so an outage is visible in a quiet log.

---

## 6. Demo seed and its consistency checks

Commands (decisions #62, #108, #109, #112): `npm run seed:demo`, `reset:demo`, `check:demo`; entry files `seed-demo.ts`, `reset-demo.ts`, `check-demo.ts`; logic in `demo-seeder.ts` (794 lines, class `DemoSeeder`), `libs/demo-plan.ts` (pure plan), `libs/demo-data.ts` (names, venues, text, images), `libs/demo-guards.ts`, `libs/demo-manifest.ts`, `libs/demo-consistency.ts`, `demo-snapshot.ts`, `demo-app.ts`.

**What it does.** It starts the whole Nest application context *without an HTTP server* (`openDemoApp`: `DemoSeedModule` imports `ComponentsModule`, `DatabaseModule` and the manifest model) and drives the **real services**: approval generates seats, `payOrder` signs QR tokens, refunds, check-in and event cancellation run through `RefundService`, `TicketService`, etc. The data is set in South Korea: ten real-looking venues, fictional football fixtures between real K League 1 club names, 31 committed JPEG photos in `demo-images/` (credits in `demo-images/CREDITS.md`), Korean names. The plan is dated relative to "now" (every date is now plus or minus days), so re-running refreshes the dates; a fixed random seed (`createRng`) gives the same shape each day. Event count 40 to 60, buyers 40 to 60 (coverage rules).

**Safety rules** (`libs/demo-guards.ts`, checked before anything connects):

1. `DEMO_SEED_CONFIRM` must equal the NAME of the database variable in use (`MONGO_DEV` or `MONGO_PROD`).
2. In production, `ALLOW_DEMO_SEED=true` is also required.
3. The database must not contain data the seed did not create (members other than admins, venues, events, orders) unless `DEMO_SEED_ALLOW_NON_DEMO_DB=true`.
4. Four passwords from the environment (`DEMO_BUYER_PASSWORD`, `DEMO_ORGANIZER_PASSWORD`, `DEMO_PENDING_ORGANIZER_PASSWORD`, `DEMO_REJECTED_ORGANIZER_PASSWORD`), each at least 12 and at most 72 characters, three of four character kinds, no guessable fragments, enough distinct characters.
5. An existing admin is required (created by `npm run seed`); the seed never creates or changes an admin.
6. For its own process only it sets `AI_ENABLED=false` (no moderation call), `SEAT_HOLD_SECONDS=300`, `PAYMENT_MODE=simulated`.
7. It prints counts only, never values.

**Manifest and reset.** `demo_seed_records` (collection of root documents: Member, Venue, Event) is written *before* each root is created. `reset:demo` removes exactly what the manifest tracks, plus what hangs off those roots; a member is removed only if tracked **and** on the `@ticketzy.demo` email domain and not an ADMIN; records written by real users about demo data are left and reported (`leftBehind`); an event someone else bought tickets for stays (`kept`). `seed:demo` removes an earlier run first. Details in `04-data-model.md` section 16.

**Consistency check** (`libs/demo-consistency.ts`, `evaluateDemoConsistency`; pure, fed by `demo-snapshot.ts`; `getInvariantFailures` decides the exit code). *Invariants* (a failure = exit code 1 and the offending events listed with the numbers compared, no personal data): sold counters equal paid orders; no ticket type oversold; `SOLD_OUT` matches the stock; reserved events' sold seats equal live tickets equal paid orders; no seat still held; no open checkout left; tickets match paid/refunded orders; a cancelled event has no paid order left; only events that already happened have checked-in tickets; drafts/pending/rejected have no sales; event dates agree with status; order amounts and commissions are right; every paid order has a captured payment; commission follows the tiers 10/7/5 and never rises; no order was sold at a lower rate than the organizer earned at that time; payout records add up and belong to finished events. *Coverage rules* (warnings only, because real use changes them): 40 to 60 buyers and events, 10 venues, events in every status, reasons on rejected/cancelled events, at least 5 hero candidates starting within 7 days, at least 2 sold out, 2 about 90 percent sold, 2 whose sales have not opened, the "rich organizer" having more than 150 paid orders and every payout status.

`check:demo` is read-only, needs no confirmation, also lists probable QA/test data that is not part of the demo (reported only). `seed:demo` runs the same check at the end and fails (leaving the data) if an invariant fails.

---

## 7. Production notes (from `RUN_IN_PRODUCTION.md`, `AGENTS.md`, and the code)

- **Target:** Render web service (free tier) for the API, MongoDB Atlas (M0 is enough; user with `readWrite` on one database), Vercel frontend on another origin, optional batch process. Start `npm run start:prod`, build `npm ci && npm run build`, health path `/health`.
- **Proxy:** `TRUST_PROXY_HOPS` (default 1 in production) so `req.ip` is the client; `keepAliveTimeout` 65 s.
- **CORS:** exact origins, no cookies; WebSocket is not subject to CORS and authenticates with its first message.
- **Rate limits** are per process; a second instance doubles them. AI daily caps live in MongoDB.
- **Cold start:** idle free instances sleep (~15 min) and need 30 to 60 s to wake; in-memory state is lost (rate-limit counters, sockets, rooms, AI quota marks). The API retries Mongo 5 times at boot; a paused M0 cluster may need a restart.
- **Uploads:** ephemeral disk; images vanish on redeploy. Not solved.
- **Batch process:** three options in the doc; the API stays correct without it for expiry (decision #102) but events never become `ENDED` and `completedEvents`/commission tiers/ranks stagnate.
- **Secrets:** rotate `SECRET_TOKEN` (everyone logs in again) or `QR_SECRET` (every issued ticket stops validating) with care; never paste secrets into chats, commits or logs.
- **Payments:** the biggest production caveat. `simulated` lets any buyer mint tickets; `disabled` turns buying off. A real provider does not exist (decisions #48, #92).
- **Email:** none, and no password reset flow (admin can set a password with `updateMemberByAdmin`).
- **Indexes:** built at the first API start; if old data has duplicates a unique index fails to build and the API logs it and keeps running (decision #107).
- **Pre-deploy checklist** is in `RUN_IN_PRODUCTION.md` (tsc x2, build, test, variables, CORS, Atlas, admin seed, health path, post-deploy: `/health` 200, `/ready` 200, introspection refused, eleven wrong logins answer `RATE_LIMITED`).

---

## 8. Cross-check with the frontend repository (`/Users/kenneth/ticketzy-next`)

A scan of the GraphQL documents under the frontend's `apollo/`, `libs/` and `pages/` found 84 distinct root fields used (aliased fields such as `pendingEvents` hide the real operation name from a simple scan, so the following is by name and is a lower bound). These 16 backend operations have **no mention at all** in the frontend's `apollo`, `libs` or `pages` folders: `checkAuth`, `checkAuthRoles`, `checkInPreview`, `createNotice`, `getAllNoticesByAdmin`, `getAuditLogsByAdmin`, `getNotices`, `getVisited`, `imagesUploader`, `likeTargetMember`, `refundOrderByAdmin`, `removeCommentByAdmin`, `removeEventByAdmin`, `removeNoticeByAdmin`, `updateEventByAdmin`, `updateNotice`. In other words the current admin UI has no screen that calls the notice operations, the audit log, the admin refund, comment removal, event edit/remove, and the scanner never calls `checkInPreview`. Those operations are tested and guarded but are not reachable from the UI. (This does not prove the frontend is wrong: they may be reserved for later.)

---

## 9. Questions and oddities

Each item: what looks wrong or unclear, where, and how sure I am. I did not change any code. "Verified" means I read the code path; "not run" means I did not execute it.

1. **(Fixed in the docs, #118.) Rank cron times did not match their description.** `apps/ticketzy-batch/src/batch.controller.ts` uses `@Cron('20 00 * * * *')` and `@Cron('40 00 * * * *')`. In `@nestjs/schedule` (six fields: second, minute, hour, ...) these fire at hh:00:20 and hh:00:40 every hour, not at "minute 20" and "minute 40" as the comments, `AGENTS.md` and `RUN_IN_PRODUCTION.md` say. The other two jobs (`'10 * * * * *'`, `'00 30 * * * *'`) match their descriptions. Verified by reading the expressions; not run. Effect is harmless (ranks refresh hourly either way) but the documentation is wrong, or the expression is.
2. **(Fixed, #118.) Documented vs real AI daily caps.** `docs/ai/DECISIONS.md` #105 says `AI_DAILY_CAP` default 400 and `AI_PER_KEY_DAILY_CAP` default 30; `libs/env.validation.ts` (`DEFAULT_AI_DAILY_CAP = 200`, `DEFAULT_AI_PER_KEY_DAILY_CAP = 10`) and `RUN_IN_PRODUCTION.md` say 200 and 10. The last commit ("stricter AI caps") probably changed the code and the production doc but not the decision. Decision #105 is stale.
3. **TTL mismatch on `ai_usage`.** `libs/schemas/AiUsage.model.ts` comment says the counter expires "two days after its day ended"; `components/ai/ai-usage.service.ts` sets `expireAt` to 3 days after the day starts. Decision #105 says 3 days after the day. Only the schema comment is off.
4. **`getAllMembersByAdmin` is a Mutation** (`components/member/member.resolver.ts`) although it only reads, unlike every other `get*` list (queries). The frontend must call it as a mutation. Verified.
5. **Not-found and similar business failures reach the client as `INTERNAL_SERVER_ERROR` (HTTP 500 semantics).** Many services throw `InternalServerErrorException(Message.NO_DATA_FOUND | UPDATE_FAILED | REMOVE_FAILED)`: for example `EventService.getEvent`, `MemberService.getMember`, `OrderService.getOrder`, `TicketService.getTicket`, `VenueService.getVenue`, `FollowService.unsubscribe`. Apollo maps any non-400/401/403 status to code `INTERNAL_SERVER_ERROR`, and the log line is an *error*. Only the seat map was fixed to a coded 404 (decision #114). A client cannot tell "not found" from a real server fault except by message text. Verified.
6. **Other statuses collapse to `INTERNAL_SERVER_ERROR` too.** `AiClientService.begin` and `ConversationService.sendMessage` throw a plain `HttpException(…, 429)`; `ServiceUnavailableException` is used for `AI_DISABLED`, `AI_NOT_CONFIGURED`, `AI_BUSY`, `AI_REQUEST_FAILED`. They reach the client as code `INTERNAL_SERVER_ERROR` (status in `extensions.status`), not `RATE_LIMITED` / a dedicated code, unlike `CodedException` ones. `apps/ticketzy-api/src/components/ai/ai-client.service.ts`, `components/conversation/conversation.service.ts`. Verified from `@nestjs/apollo/dist/drivers/apollo-base.driver.js`.
7. **Duplicate-key errors on create are hidden as `CREATE_FAILED`.** `VenueService.createVenue`, `EventService.createEvent`, `TicketTypeService.createTicketType` catch every error and throw `BadRequestException(CREATE_FAILED)`, so the unique-index collision (same venue address, same event, same ticket type name) is not reported as `DUPLICATE_VALUE` as `libs/error-mapping.ts` would do. Verified; the user sees a generic message.
8. **Dead or reserved values never set by application code.** `TicketStatus.CANCELLED` (only read by the AI tool), `PaymentStatus.INITIATED` (only the schema default), `PaymentProvider.MANUAL/STRIPE/PAYME/CLICK`, `Member.memberWarnings`, `memberBlocks`, `memberComments`, `deletedAt` on Member and Event (and `MemberUpdate.deletedAt`, which has no validator and is stripped), `NotificationType.EVENT_REMINDER` (only the demo seeder creates one), `TicketCurrency` USD/EUR/UZS (no longer accepted for new data). Confirmed by searching non-test source.
9. **(Fixed, #117: `createComment` now calls `EventService.assertPublicEvent` first.) Comment on any id.** `CommentService.createComment` (`components/comment/comment.service.ts`) inserts the comment first, then increments `eventComments` and notifies only if an event with that id exists; it never checks that the event exists, is APPROVED or belongs to an ACTIVE organizer. A comment can be created for a non-existent id, or for a DRAFT event. Also `eventComments` is only changed when the event exists. Verified by reading; not run.
10. **`getTicketTypes` ignores event visibility.** `components/ticket-type/ticket-type.service.ts` `getTicketTypes` checks only that the organizer is ACTIVE, so anyone who knows the id of a DRAFT/PENDING event can read its ticket types (decision #37 / C3-30 says this is known and open).
11. **(Fixed, #117: `EVENT_LAYOUT_LOCKED`.) Editing an APPROVED event can change `venueId` or `seatingType` after seats exist.** `EventService.applyUpdate` allows `venueId`, `seatingType`, `startAt` ... on an APPROVED event (it goes back to PENDING). On re-approval `generateEventSeats` only *upserts* seats for the (new) layout; the old seats stay in `eventSeats` with their old `sectionKey`s and can still be held by id. `updateVenue` locks the layout of a venue with generated seats, but nothing locks the event's own `venueId`/`seatingType`. I did not run this; it looks risky.
12. **(Fixed, #117: all or nothing.) `imagesUploader` can return holes.** `components/member/member.resolver.ts`: a failed file is logged and its slot stays `undefined`, but the mutation's return type is `[String]` (non-null items), so one bad file would turn the whole mutation into a GraphQL error instead of a partial result. Not run.
13. **Image paths are trusted strings.** `eventImages`, `venueImages`, `memberImage` accept any string (`EventInput.eventImages` only has `IsNotEmpty`). Nothing checks that a path points to a real upload by that caller.
14. **A moderation run uses the organizer's daily AI allowance.** `AiModerationService.moderateEvent` reserves with key `member:<organizerId>`, so each submit/resubmit spends one of the organizer's `AI_PER_KEY_DAILY_CAP` operations (10 per UTC day by default), which can later block that organizer's `translateEvent`. Verified.
15. **`qrToken` comment is inaccurate.** `libs/schemas/Ticket.model.ts` says "HMAC of the ticket id"; the stored value is `<id>.<hmac>` (`libs/qr-token.ts`).
16. **Misplaced comment in the payout pipeline.** `libs/payout.ts`: the comment "the commission of the whole event is rounded once, half up" sits above `zeroIfCancelled`; the rounding is the `$floor(x + 0.5)` expression further down.
17. **Sales operations do not use `ActiveOrganizerGuard`.** `components/sales/sales.resolver.ts` uses `RolesGuard` only, so a PENDING organizer passes the guard (they just have no data). Harmless but inconsistent with the other organizer operations.
18. **The payment mock is the whole payment system.** `OrderService.payOrder` with `PAYMENT_MODE=simulated` lets any buyer pick `SUCCESS` for their own order. Documented everywhere (README, decisions #48, #92); repeated here because it is the biggest functional gap.
19. **Previous holds are released before the new claim.** `SeatService.holdSeats` releases the member's earlier holds on the event first; if the new claim fails, the earlier holds are lost (decision #45 lists this).
20. **Check-then-write races that are accepted.** `assertVenueFree` (decision #83), `VENUE_LAYOUT_LOCKED` (decision #51), the counters (`memberEvents`, `eventLikes`, ...). A tight race can pass them.
21. **Cancelled-event refund summary is not returned.** `cancelEventByAdmin` returns the `Event`; the `RefundSummary` is only logged and available through `retryEventRefundsByAdmin` (decision #56). If many orders fail the admin only learns from logs or by running the retry mutation.
22. **`ADMIN` is allowed on organizer-only guards by design** (`ActiveOrganizerGuard` passes admins) and admins may call `createVenue`, `createTicketType`, `checkInTicket`. Not a bug, but surprising when you read `@Roles(ORGANIZER, ADMIN)`.
23. **Legacy folders and names.** `uploads/article` and `uploads/property` (old Nestar data, decision #18/#27); the repo and some docs still mention Nestar; `package.json` keeps `@nestjs/platform-socket.io` although the app uses `ws` through `WsAdapter`; `@nestjs/axios` and `HttpModule` are imported in `AuthModule` but nothing calls HTTP from there.
24. **Lint debt.** `npm run lint` uses `--fix` and the code is tab-indented while `.prettierrc` says spaces; decision #6 counts 17,185 problems. Some files use mixed indentation (spaces inside tab-indented files, for example `comment.service.ts`, `follow.service.ts`, `member.service.ts`).
25. **Two decision numbers are claimed by the same topic in a way that can confuse.** `DECISIONS.md` #16 is superseded by #48; #25 says no refresh tokens exist; #40/#44 changed guards after being written. Always read the *latest* row on a topic. No code impact.
26. **Frontend gaps (see section 8).** 16 backend operations have no mention in the frontend repository, including `getAuditLogsByAdmin`, `refundOrderByAdmin`, `checkInPreview` and the notice operations.
27. **Test confidence.** 1244 passing tests run without a real MongoDB; aggregation pipelines and the `$dateAdd` time-zone payout query are not executed by CI (section 1). The decision log records one case where a first real run on Atlas found a bug that tests had missed (#109).
