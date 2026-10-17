# 00 - Overview of the Ticketzy backend

**What this file covers.** What the backend is for, the stack with the versions that are installed, an annotated map of the repository, how to run and test it, every environment variable by NAME (never a value), a glossary of the project's own words, and a table that maps every decision number in `docs/ai/DECISIONS.md` to a one-line summary. Read this first; files 01 to 06 go deeper. Everything here was read from the code on branch `modification` (clean working tree at the start). Where something looks wrong it is listed in "Questions and oddities" at the end of `06-quality.md`, not guessed here.

How to read the paths: `apps/ticketzy-api/src/...` is shortened to `api/...` in some tables, and `apps/ticketzy-batch/src/...` to `batch/...`. A claim is always followed by a path and, where useful, a function or class name.

---

## 1. Purpose

Ticketzy is the backend of a ticket-selling platform (`README.md`, `AGENTS.md`).

- **Organizers** publish **events** at **venues**. An event sells either general-admission tickets (a quantity) or reserved seats (a seat map).
- **Buyers** (`USER`) hold seats for a short time, check out, "pay" (a mock provider, no money moves), receive tickets with a signed QR token, and can refund a whole order.
- **Admins** approve organizers and events, refund orders, cancel events, and mark organizer payouts as paid.
- Extras: in-app notifications, organizer-admin chat (GraphQL + WebSocket), comments/likes, an optional AI assistant (event search, moderation hints, translation).

The code started as a different project called Nestar (a property-listing site) and was migrated (`docs/ai/BACKEND_MIGRATION.md`, `NESTAR_COMPARISON.md`). Some shared names (for example `getFavorites`, `memberLikes`) survive from that.

> Payments are a mock. `PaymentMode` `simulated` means the buyer chooses whether the payment succeeds (`payOrder(orderId, simulate: SUCCESS | FAILURE)`), so anyone can get valid tickets for free. `disabled` refuses every payment. See `api/components/payment/mock-payment.provider.ts` and `api/libs/env.validation.ts` (`parsePaymentMode`).

## 2. Stack with versions

Versions are the installed ones in `node_modules` (the ranges are in `package.json`).

| Piece | Installed | Role |
|---|---|---|
| Node.js | 22+ required by `AGENTS.md`; this machine runs v24.15.0; CI uses 22 (`.github/workflows/ci.yml`) | runtime |
| NestJS (`@nestjs/core`) | 10.4.22 | framework: modules, dependency injection, guards, pipes |
| `@nestjs/graphql` + `@nestjs/apollo` | 12.2.2 | GraphQL "code-first": the schema is generated from TypeScript classes |
| `@apollo/server` | 4.13.0 | the GraphQL HTTP server underneath |
| `graphql` | 16.14.2 | GraphQL reference library |
| `mongoose` (+ `@nestjs/mongoose` ^10.0.2) | 8.24.3 | MongoDB ODM (object-document mapper: classes/schemas for collections) |
| MongoDB | 5.0+ required (payouts use `$dateAdd` with a time zone); CI runs `mongo:7` | database |
| `@nestjs/jwt` | 10.2.0 | signs/verifies login tokens |
| `bcryptjs` | 2.4.3 | password hashing |
| `class-validator` / `class-transformer` | 0.14.4 / ^0.5.1 | input validation |
| `graphql-upload` | 13.0.0 | multipart image uploads |
| `ws` + `@nestjs/platform-ws` | ws 8.21.3 | chat WebSocket server |
| `@nestjs/schedule` | 4.1.2 | cron jobs in the batch app |
| `helmet` | 8.3.0 (pinned, no caret) | HTTP security headers |
| `moment` | 2.30.1 | date maths (sales window, submit checks) |
| `@anthropic-ai/sdk` / `@google/genai` | 0.131.0 / 2.27.0 | the two AI vendors |
| TypeScript | 5.9.3 | language (range ^5.1.3) |
| Jest + ts-jest | 29.7.0 | tests |
| Package manager | npm (`package-lock.json`) | |

There is **no QR-image library** in the backend: the server only creates and checks the QR *text* (see `05-modules.md`, section "QR tickets"). Drawing the QR picture happens in the frontend. There is no mail library either (`RUN_IN_PRODUCTION.md`, "Emails").

## 3. Repository layout

```
ticketzy/
├── AGENTS.md              rules for AI tools: commands, working rules, domain rules (source of project conventions)
├── CLAUDE.md              "@AGENTS.md" plus two Claude Code notes
├── README.md              human intro, API and demo notes
├── RUN_IN_PRODUCTION.md   Render + Atlas + Vercel deployment guide, env var tables, batch options
├── package.json / package-lock.json   scripts and dependencies (npm)
├── nest-cli.json          NestJS monorepo config: two projects, ticketzy-api and ticketzy-batch, webpack build
├── tsconfig.json, tsconfig.build.json, .eslintrc.js, .prettierrc, .gitattributes
├── .env.example           variable NAMES with empty values (the real .env exists locally and is git-ignored; never read)
├── .github/workflows/ci.yml   CI: both tsc checks, build, test, npm audit
├── .vscode/launch.json    debugger config
├── .agents/skills/        4 downloaded "skills" (mongodb-connection, mongodb-query-optimizer, nestjs-best-practices, security-and-hardening)
├── .claude/               Claude Code config; .claude/skills links to .agents/skills and holds ticketzy-backend-workflow
├── skills/product-logic/  one more skill file about product rules
├── skills-lock.json       lock file of the downloaded skills
├── apps/
│   ├── ticketzy-api/      THE API (GraphQL + WebSocket + uploads + health)
│   │   ├── src/main.ts, app.module.ts          bootstrap and root module
│   │   ├── src/components/<name>/              one folder per feature: module, resolver, service (+ guards for auth)
│   │   ├── src/libs/                           shared code: dto/, enums/, schemas/, pure helpers, env validation, demo-seed logic
│   │   ├── src/database/database.module.ts     Mongo connection
│   │   ├── src/socket/                         WebSocket gateway for chat
│   │   ├── src/seed.ts                         creates the admin(s)
│   │   ├── src/seed-demo.ts, reset-demo.ts, check-demo.ts, demo-seeder.ts, demo-snapshot.ts, demo-app.ts   demo data tooling
│   │   ├── src/ai-check.ts, report-currency.ts one-off scripts
│   │   └── test/fake-model.ts                  a fake AI model used by tests
│   └── ticketzy-batch/    THE BATCH APP (cron jobs only)
│       └── src/ main.ts, batch.module.ts, batch.controller.ts (schedules), batch.service.ts (jobs), lib/rank.ts, lib/config.ts
├── demo-images/           31 committed JPEG photos for the demo data, served at /demo-images
├── uploads/               runtime folder for user uploads (git-ignored); sub-folders article, event, member, property, venue exist locally
├── docs/ai/               project memory: DECISIONS.md (numbered), COMPLETED_TASKS.md, NEXT_STEPS.md, BACKEND_MIGRATION.md, FRONTEND_MIGRATION.md, NESTAR_COMPARISON.md, CLEANUP_AUDIT.md, PROMPTS.md, SKILLS.md
├── docs/ai/tour/          this tour (new)
├── dist/                  build output (git-ignored)
└── node_modules/
```

Inside `apps/ticketzy-api/src/components/` (22 feature modules, listed in `components.module.ts`):

| Folder | What it owns |
|---|---|
| `auth` | JWT creation/verification, the 5 guards, `@Roles`, `@AuthMember` |
| `member` | sign-up, login, profile, admin member list, image upload mutations |
| `organizer` | admin approval of organizers, commission override |
| `event` | event lifecycle, public lists, seat map, admin event actions |
| `venue` | venues and their seat layout |
| `ticket-type` | price tiers and atomic stock |
| `seat` | seat holds for reserved events |
| `order` | checkout, payment, order reads |
| `payment` | provider seam (`PaymentProvider`), mock provider, `Payment` records |
| `ticket` | ticket reads, QR check-in |
| `refund` | buyer, admin, and cancelled-event refunds |
| `payout` | organizer payout list and "mark paid" |
| `sales` | organizer sales numbers |
| `conversation` | organizer/admin chat service + realtime rooms |
| `notification`, `notice`, `audit-log` | in-app notifications, public notices, admin audit trail |
| `comment`, `like`, `view` | social features (the follow module was removed, #122) |
| `ai` | assistant, moderation, translation, vendor providers |

## 4. How to run and test

From `AGENTS.md` and `package.json` scripts:

```bash
npm install
npm run start:dev          # API with file watching  (nest start --watch)
npm run start:dev:batch    # batch app with file watching
npm run build              # nest build -> dist/apps/ticketzy-api/main.js and dist/apps/ticketzy-batch/main.js
npm run start:prod         # NODE_ENV=production node dist/apps/ticketzy-api/main   (build first)
npm run start:prod:batch   # same for the batch app
npm run test               # Jest, whole suite
npm run seed               # create the ADMIN from ADMIN_EMAIL/ADMIN_PASSWORD (+ optional ADMIN2_*)
npm run seed:demo          # fill a database with demo data (guarded)
npm run reset:demo         # remove only what seed:demo tracked
npm run check:demo         # read-only consistency report
npm run report:currency    # read-only report of ticket types not in KRW
npm run ai:check           # real requests to the AI vendor (uses the key in .env)
npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit
npx tsc -p apps/ticketzy-batch/tsconfig.app.json --noEmit
```

`npm run lint` runs ESLint **with `--fix`**, so it rewrites files (decision #6). The code is indented with tabs while `.prettierrc` says spaces, so lint would rewrite almost everything (decision #6 counts 17,185 problems on 2026-10-13).

Test run observed while writing this tour: **63 test suites, 1244 tests, all passed, 8.4 s** (`npx jest`). No test needs a database. There are no end-to-end tests (decision #99).

## 5. Environment variables (names only)

The API validates configuration at startup in `libs/env.validation.ts` (`validateEnv`, called from `ConfigModule.forRoot` in `app.module.ts`). All names below appear in code or `.env.example`. Defaults are from `env.validation.ts` and `RUN_IN_PRODUCTION.md`.

**Required in production** (`NODE_ENV=production`):

| Name | Meaning |
|---|---|
| `NODE_ENV` | `production`, `development` or `test`. Production picks `MONGO_PROD`, turns off the GraphQL playground/introspection, and logs only warn/error |
| `MONGO_PROD` / `MONGO_DEV` | Mongo connection string for production / development (`getMongoUriKey`) |
| `SECRET_TOKEN` | signs login JWTs; 32+ chars in production |
| `QR_SECRET` | signs ticket QR tokens; 32+ chars, must differ from `SECRET_TOKEN` in production |
| `CORS_ORIGINS` | comma-separated exact browser origins (https in production); `CLIENT_URL` is the older name, read only when `CORS_ORIGINS` is empty |
| `PAYMENT_MODE` | `simulated` or `disabled`; no default in production |

**Optional:**

| Name | Meaning (default) |
|---|---|
| `PORT`, `PORT_API`, `PORT_BATCH` | listen port: `PORT`, then `PORT_API` (batch: `PORT_BATCH`), then 3000 |
| `TRUST_PROXY_HOPS` | proxies in front of the API (1 in production, else 0; max 5) |
| `RATE_LIMIT_GENERAL_PER_MINUTE` (300), `RATE_LIMIT_LOGIN_PER_15_MIN` (10), `RATE_LIMIT_SIGNUP_PER_HOUR` (5), `RATE_LIMIT_PASSWORD_PER_15_MIN` (5) | in-memory rate limits |
| `SEAT_HOLD_SECONDS` | length of a seat hold / unpaid general order (30; 1 to 3600) |
| `UPLOAD_MAX_FILE_MB` (15; 1 to 50), `UPLOAD_MAX_FILES` (10; 1 to 20) | upload limits |
| `LOG_LEVEL` | `error`, `warn`, `log`, `debug`, `verbose` (warn in production, verbose otherwise) |
| `MONGO_AUTO_INDEX` | `false` stops index building at startup (default true) |
| `AI_ENABLED` | AI on/off (off) |
| `AI_PROVIDER` | `anthropic` (default) or `gemini` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic key and model (default model `claude-haiku-4-5`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key and model (default `gemini-2.5-flash`) |
| `GEMINI_FALLBACK_MODELS` | up to 3 comma-separated fallback models; `GEMINI_FALLBACK_MODEL` (one name) is deprecated |
| `AI_TIMEOUT_MS` (15000; 1000 to 120000), `AI_RATE_LIMIT_PER_MINUTE` (10) | per-attempt timeout, per-minute limit per member/IP |
| `AI_DAILY_CAP` (200 in code), `AI_PER_KEY_DAILY_CAP` (10 in code) | daily AI caps kept in MongoDB. Decision #105 originally said 400 and 30; #118 corrects it to the 200 and 10 of the code and `RUN_IN_PRODUCTION.md` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN2_EMAIL`, `ADMIN2_PASSWORD`, `ADMIN2_NICK` | only for `npm run seed` |
| `DEMO_BUYER_PASSWORD`, `DEMO_ORGANIZER_PASSWORD`, `DEMO_PENDING_ORGANIZER_PASSWORD`, `DEMO_REJECTED_ORGANIZER_PASSWORD` | only for `seed:demo` |
| `DEMO_SEED_CONFIRM`, `DEMO_SEED_ALLOW_NON_DEMO_DB`, `ALLOW_DEMO_SEED` | safety switches of the demo commands |
| `RENDER` | set by the Render host; `validateEnv` refuses a non-production `NODE_ENV` when it is present |

The frontend needs `NEXT_PUBLIC_API_GRAPHQL_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_WS_URL` (`RUN_IN_PRODUCTION.md`, checklist).

## 6. Glossary of project terms

| Term | Meaning |
|---|---|
| **Resolver** | NestJS class whose methods are GraphQL queries/mutations. Thin: it applies guards, reads the logged-in member, calls a service |
| **Service** | class with the real logic and database access |
| **Guard** | NestJS class that runs before a resolver method and may refuse the request (see `02-state-and-rules.md`) |
| **Query / Mutation** | GraphQL read / write operation. This API has no GraphQL subscriptions (realtime uses a separate `ws` gateway) |
| **DTO** | "data transfer object": a TypeScript class describing GraphQL input/output (`libs/dto`) |
| **Schema (Mongoose)** | definition of a MongoDB collection (`libs/schemas/*.model.ts`) |
| **Member** | any account. `memberType` is `USER`, `ORGANIZER` or `ADMIN` |
| **Organizer** | account that sells events; starts `PENDING`, needs admin verification |
| **Event** | the thing people buy tickets for (was the property listing in Nestar) |
| **Venue** | a place with an optional seat layout and a time zone |
| **Layout / section** | `venueLayout.sections[]`: blocks of seats (`SEATED`, rows x seatsPerRow) or standing areas (`STANDING`, a capacity) |
| **tierKey** | string that links a ticket type to the seated sections with the same key (price tier) |
| **TicketType** | a price tier of one event (name, price, stock, sale window) |
| **EventSeat** | one physical seat of one event, created when the event is approved |
| **GENERAL / RESERVED** | `SeatingType`: quantity-based tickets vs. seat-by-seat tickets |
| **Hold** | temporary claim on seats (`HELD` with `heldUntil`) |
| **Order** | a purchase; starts `PENDING_PAYMENT`, expires if unpaid |
| **Ticket** | one admission, with `ticketCode` and `qrToken` |
| **Check-in** | scanning a ticket at the gate; moves it `VALID` to `USED` |
| **Refund** | whole-order money-back record (`Refund`), one per order |
| **Payout** | mock record that an admin paid an organizer for an ended event; status is computed, not stored |
| **Commission** | platform share: 10 percent, 7 from 5 completed events, 5 from 20, or an admin override; stored on each order |
| **Audit log** | admin-only trail of state changes (field names only, never values) |
| **Conditional update** | `findOneAndUpdate` whose filter contains the state it expects; used instead of transactions |
| **Lazy expiry** | the API frees expired holds/orders itself when it touches them, so correctness does not depend on the cron job |
| **Batch app** | second Nest app that runs cron jobs |
| **Demo seed** | scripts that fill a database with fake but realistic data through the real services |
| **Decision (#n)** | numbered row in `docs/ai/DECISIONS.md`; `C3-n` / `N-n` are item ids from audit notes (`CLEANUP_AUDIT.md`, `NEXT_STEPS.md`) |

## 7. Decision files and what each decision number says

`docs/ai/DECISIONS.md` is the source of truth (115 numbered rows, table form: decision, why, risks, alternatives). Some rows are superseded by later rows; the later row wins, and `DECISIONS.md` overrides every skill (`AGENTS.md`).

| Other file in `docs/ai/` | What it holds |
|---|---|
| `COMPLETED_TASKS.md` (689 lines) | one entry per finished task |
| `NEXT_STEPS.md` (80 lines) | open work, with ids like N5, N14, N15 |
| `BACKEND_MIGRATION.md` | how Nestar became Ticketzy, layer by layer |
| `FRONTEND_MIGRATION.md` | the same for the frontend |
| `NESTAR_COMPARISON.md` | 12-point comparison with the Nestar repo (0 same, 7 extended, 5 diverged) |
| `CLEANUP_AUDIT.md` (469 lines) | audit findings numbered C3-n |
| `PROMPTS.md`, `SKILLS.md` | prompt notes; skills index and Ticketzy overrides |

Decision numbers:

| # | One-line summary |
|---|---|
| 1 to 9 | migration method: rename layer first, keep collections, `git mv`, keep `libs` structure, fix the batch spec, lint without `--fix`, leave `.env`, git identity, target name Ticketzy |
| 10, 11, 13 | catalog entity becomes Event + Venue + TicketType; seller role becomes `ORGANIZER`; `MemberType` = USER/ORGANIZER/ADMIN and `MemberStatus` = PENDING/ACTIVE/REJECTED/SUSPENDED/DELETE |
| 12, 17 | atomic inventory with conditional `findOneAndUpdate`; stock held by incrementing `soldQuantity` |
| 14, 15 | enums for events, venues, tickets, orders; locations are `venues` documents |
| 16 (superseded by 48) | first payment stub |
| 18, 19, 20, 21 | old collections untouched; `getFavorites`/`getVisited` keep names; like/view unique index includes the group; SMS-login `auths` dropped |
| 22 | notifications are best effort and never throw |
| 23, 24, 25, 26 | roles set only by the server; login by email; JWT holds only id+type and lasts 1 day, guards reload the member each request; startup hardening, magic-byte image check |
| 27, 28, 29, 30 | community board deleted and organizer renames; comments on events only; follow organizers only (removed by #122); public visibility rules |
| 31, 32, 33 | organizer approval transitions, commission override field, audit log + notifications for admin actions |
| 34 to 40 | ticket types/orders refuse inactive organizers; new `EventStatus` machine; owner edit rules; `publicEventStatus`; admin event actions; `completedEvents` counter and `batchEndEvents`; renames `getMyEvents`/`getEventsByAdmin` |
| 41 to 44, 51, 67 | venue layout model and validation; `tierKey`; `EventSeat` generation at approval; seat map visibility; layout lock; seat picker backend (`seats` by coordinates, `getSeatConfig`, `mine`) |
| 45, 46, 47, 48, 49, 50 | seat holds; order flow and server-side pricing; commission tiers; `PaymentProvider` seam and `payOrder`; tickets and HMAC QR; expiry batch |
| 52, 53 | QR token format `<ticketId>.<hmac>`; check-in order and `checkInPreview` |
| 116 to 118 | check-in by ticket code; comment, upload and event-layout fixes; cron and AI cap doc corrections |
| 54, 55, 56, 70, 110 | refunds per whole order; refund deadline rule; cancelled-event refunds; clock-independent refund tests; cancelled-event refunds now release seats |
| 57 | `soldQuantity` for reserved events via `addSold`; sales/attendees/earnings queries |
| 58, 59, 74 | organizer/admin chat, restricted accounts, sockets, admin starts a support conversation |
| 60, 61, 63, 85, 86, 87, 111, 114, 115 | AI features, vendor switch (Anthropic/Gemini), timeout and retry, fallback model, `ai:check`, startup warning, Gemini 400 fix, 40-second budget, model chain with quota cooldown |
| 62, 108, 109, 112 | demo seed (replaced by the guarded version), refund timing and batched writes, South-Korea data with real photos |
| 64, 65, 66, 113 | distinct login error codes; small fixes (search, comment counters, public counts); comment length; nick length and `VALIDATION_FAILED` with field names |
| 68, 69, 71, 72, 73, 75 | order/ticket queries return event+venue; organizer cancel and `getMyEventOrders`; sales window validation; admin safety rules; no admin promotion; second admin seed |
| 76, 77, 78 | payout rules, computed payout status, `markPayoutPaidByAdmin` |
| 79 | `eventTotalSeats` / `eventSoldSeats` on event lists |
| 80, 81, 82 | only `USER` can buy; protected operations; existing non-USER orders left alone |
| 83, 84 | venue double-booking refused; admin-only `possibleVenueConflicts` |
| 88, 89 | project guide files and skills index; Nestar comparison |
| 90, 91, 93, 94 | public member fields; list limits (`page` max 10000, `limit` max 100); admin cannot reset an admin password; more audit entries |
| 92 | `PAYMENT_MODE` |
| 95 | one currency per event: KRW |
| 96, 102 | ranking jobs no longer zero ranks; abandoned orders released without the batch app |
| 97, 98, 99, 100, 101 | safe error mapping; multipart needs a token first; e2e specs deleted and CI added; port/proxy/shutdown; empty lists are empty lists |
| 103, 104, 105, 106, 107 | production config validation; in-memory rate limits; AI daily caps in MongoDB; helmet/CORS/health; extra indexes |
| 100 to 107 | the production-readiness block referred to in `RUN_IN_PRODUCTION.md` |

The "F-number" ids (F21 etc.) belong to the frontend's own decision file (for example #113 mentions "frontend F21"); they are not in this repo.
