# Ticketzy Backend Agent Instruction

Ticketzy is the backend of a ticket selling platform: organizers publish events at venues with ticket types or reserved seats, buyers hold seats, pay (mock provider), receive QR tickets and can refund, and admins approve organizers and events, handle refunds and mark payouts. It started from the Nestar codebase (see `docs/ai/BACKEND_MIGRATION.md`).

- Needs Node 22+ and MongoDB 5.0+ (payouts use `$dateAdd` with a time zone). CI is `.github/workflows/ci.yml` (both `tsc`, build, tests); there are no e2e tests (#99). Deploying (Render, Atlas, Vercel): `RUN_IN_PRODUCTION.md`.
- Stack: NestJS (monorepo), GraphQL code-first (Apollo), Mongoose and MongoDB, JWT, `graphql-upload`, a `ws` gateway for chat, a batch app (`@nestjs/schedule`) and Jest. Package manager: npm (`package-lock.json`).
- Roles (`MemberType`): `USER` buys, `ORGANIZER` needs admin approval (PENDING until verified), `ADMIN` is created only by `npm run seed`. Roles are set only by the server (#23).
- Only `USER` accounts can buy tickets: `assertBuyerAccount` (`libs/buyer.ts`) in `holdSeats`, `createCheckout` and `payOrder` (#80, #81).

## Commands

```bash
npm install
npm run start:dev          # API in watch mode (start:dev:batch for the batch app)
npm run build              # nest build
npm run start:prod         # node dist/apps/ticketzy-api/main (needs build first)
npm run test               # Jest, whole suite
npm run lint               # ESLint WITH --fix: it rewrites files (decision #6), run only when that is fine
npm run ai:check           # checks the AI settings and sends one tiny request (uses the key in .env, a real call)
npm run seed:demo          # demo data (needs DEMO_SEED_CONFIRM and four DEMO_*_PASSWORD, writes to the database: #108)
npm run reset:demo         # removes only what seed:demo tracked
npm run check:demo         # read-only consistency report of the demo data
npm run report:currency    # read-only report of ticket types that are not in KRW (#95), needs the database
npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit
npx tsc -p apps/ticketzy-batch/tsconfig.app.json --noEmit
```

## Read First

`docs/ai/DECISIONS.md` (numbered decisions, the source of truth), then `COMPLETED_TASKS.md`, `NEXT_STEPS.md` and `BACKEND_MIGRATION.md` in `docs/ai/`.

## Working Rules

- Analyze before editing; keep changes small and in the existing resolver/service/module pattern.
- Do not remove working logic unless it is replaced safely.
- Every decision gets the next number in `docs/ai/DECISIONS.md`; every finished task gets an entry in `docs/ai/COMPLETED_TASKS.md`.
- Do not commit unless asked.
- Never read `.env` or print secrets and API keys. Use `.env.example` for variable names.
- No new dependencies without asking.
- Every user-facing error goes through the `Message` enum (`libs/enums/common.enum.ts`). Raw errors (Mongo duplicate keys, cast errors, plain `Error`s) are mapped to safe `{ code, message }` in `formatGraphQLError` (`libs/error-mapping.ts`, #97); never put internal values in a message.
- Follow the existing role conventions: `@Roles(...)` with `RolesGuard`; organizer writes also use `ActiveOrganizerGuard`. Admin actions that change state write an audit entry (`AuditLogService.record`, `AuditAction`; field names only, never values, #94).
- Every list query takes `page` and `limit` through `PageField` / `LimitField` (`libs/dto/common/pagination.ts`): `limit` at most 100, `page` at most 10000 (#91). Do not add a bare `@Min(1)` limit.
- Add or update focused tests when behavior changes; the full suite (`npm run test`), both `tsc` checks and `npm run build` must pass before reporting.

## Project Shape

- Apps: `apps/ticketzy-api` and `apps/ticketzy-batch`. DTOs, enums and schemas live in `apps/ticketzy-api/src/libs`; modules in `src/components/<name>`.
- Terms: the catalog entity is Event (with Venue, TicketType, Order, Ticket, EventSeat). The community board is gone; do not bring back old catalog terms.
- Shared modules stay reusable: auth, member, like, view, comment (events only), follow (organizers only), socket.
- The batch app (`apps/ticketzy-batch`) runs four jobs: ranks (events at minute 20, organizers at minute 40, computed then written in place, #96), order and seat-hold expiry (every minute, shared code in `libs/order-expiry.ts`; the API runs the same code lazily because the batch process may be asleep, #102), ending finished events (minute 30).
- Ticket inventory changes are atomic (conditional `findOneAndUpdate`); there are no transactions (#17).

## Domain Rules (details in DECISIONS.md)

- Member privacy: only the fields listed in #90 are public; `memberPhone`, `memberEmail`, warnings, blocks, `deletedAt` are for the member and admins, full name and address only for organizers. A new `Member` `@Field` must be classified in `member.privacy.spec.ts`.
- Payments: `PAYMENT_MODE=simulated|disabled`, required in production (#92). No real provider exists; `payOrder` is the mock. Ticket types are KRW only, one currency per event (#95).
- Uploads: multipart requests need a valid bearer token before they are parsed (`libs/upload-guard.ts`, #98). Admins cannot reset another admin's password (#93).
- Payouts: one per event, due event end + 3 days in the venue timezone, status computed (never stored), a `Payout` document is created only when an admin marks it paid. `libs/payout.ts`, `components/payout` (#76 to #78).
- Venue conflicts: overlapping events at the same venue record are refused; admins see `possibleVenueConflicts`. `libs/venue-conflicts.ts` (#83, #84).
- Seat hold and order flow: `holdSeats` (conditional update per seat), `createCheckout`, `payOrder`, expiry in the batch job. `components/seat`, `components/order`, `components/payment` (#45 to #50).
- Event seat fields: `EventSeat` documents generated at approval; `eventTotalSeats` and `eventSoldSeats` on `Event`. `libs/seat-counts.ts` (#43, #79).
- Refunds: whole order, deadline the day before the event. `components/refund`, `libs/refund-policy.ts` (#54, #55).
- Admin seed: `ADMIN_EMAIL`/`ADMIN_PASSWORD` and optional `ADMIN2_*` (`npm run seed`, #23, #75); demo data: `npm run seed:demo` / `reset:demo` / `check:demo` (#62, #108). They refuse without `DEMO_SEED_CONFIRM` naming the database variable, refuse production without `ALLOW_DEMO_SEED=true`, refuse a database with non-demo data without `DEMO_SEED_ALLOW_NON_DEMO_DB=true`; reset removes only what the `demo_seed_records` manifest tracks; they print counts only. Seeding goes through the real services (`demo-seeder.ts`, plan in `libs/demo-plan.ts`).
- AI assistant: off unless `AI_ENABLED=true`; settings `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`. `components/ai`, `libs/env.validation.ts` (#60, #61, #63, #85 to #87).

## Production

- Config is checked at startup by `validateEnv` (`libs/env.validation.ts`, #103): in production a missing or weak value stops the API and the error lists variable **names** only. A new variable gets a parser there, an entry in `RUN_IN_PRODUCTION.md` and a test. `.env.example` is not edited by AI tasks unless the owner says so.
- Ports and proxy: `PORT` first (#100); the API trusts `TRUST_PROXY_HOPS` proxies. HTTP hardening is `helmet` + `CORS_ORIGINS` (exact origins, no cookies, #106); `GET /health` (liveness) and `GET /ready` (MongoDB state) are public and tiny.
- Rate limits are in memory (`libs/rate-limit.ts`, #104): `login`, `signupUser`, `signupOrganizer` and password changes count in the resolver; the general per-IP limit is a middleware on `/graphql`. Refusals throw `CodedException` (`RATE_LIMITED` with `retryAfterSeconds`). The AI daily caps live in MongoDB (`AiUsageService`, #105) and fail closed.
- Errors with their own code use `CodedException` (an `HttpException`, so Nest logs no stack for it); `formatGraphQLError` is the only place that shapes what a client sees.
- Never log variables, tokens, passwords, prompts or response bodies; production logs `warn` and `error` only.

## Skills

Skills live in `.agents/skills` and are linked into `.claude/skills`. The index and the Ticketzy overrides are in `docs/ai/SKILLS.md`. `docs/ai/DECISIONS.md` overrides any skill. Skill scripts that download or run programs need explicit approval each time. The repo workflow skill is `.claude/skills/ticketzy-backend-workflow`.
