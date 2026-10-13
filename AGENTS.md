# Ticketzy Backend Agent Instruction

Ticketzy is the backend of a ticket selling platform: organizers publish events at venues with ticket types or reserved seats, buyers hold seats, pay (mock provider), receive QR tickets and can refund, and admins approve organizers and events, handle refunds and mark payouts. It started from the Nestar codebase (see `docs/ai/BACKEND_MIGRATION.md`).

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
- Every user-facing error goes through the `Message` enum (`libs/enums/common.enum.ts`).
- Follow the existing role conventions: `@Roles(...)` with `RolesGuard`; organizer writes also use `ActiveOrganizerGuard`. Admin actions that change state write an audit entry (`AuditLogService.record`, `AuditAction`).
- Add or update focused tests when behavior changes; the full suite (`npm run test`), both `tsc` checks and `npm run build` must pass before reporting.

## Project Shape

- Apps: `apps/ticketzy-api` and `apps/ticketzy-batch`. DTOs, enums and schemas live in `apps/ticketzy-api/src/libs`; modules in `src/components/<name>`.
- Terms: the catalog entity is Event (with Venue, TicketType, Order, Ticket, EventSeat). The community board is gone; do not bring back old catalog terms.
- Shared modules stay reusable: auth, member, like, view, comment (events only), follow (organizers only), socket.
- Ticket inventory changes are atomic (conditional `findOneAndUpdate`); there are no transactions (#17).

## Domain Rules (details in DECISIONS.md)

- Payouts: one per event, due event end + 3 days in the venue timezone, status computed (never stored), a `Payout` document is created only when an admin marks it paid. `libs/payout.ts`, `components/payout` (#76 to #78).
- Venue conflicts: overlapping events at the same venue record are refused; admins see `possibleVenueConflicts`. `libs/venue-conflicts.ts` (#83, #84).
- Seat hold and order flow: `holdSeats` (conditional update per seat), `createCheckout`, `payOrder`, expiry in the batch job. `components/seat`, `components/order`, `components/payment` (#45 to #50).
- Event seat fields: `EventSeat` documents generated at approval; `eventTotalSeats` and `eventSoldSeats` on `Event`. `libs/seat-counts.ts` (#43, #79).
- Refunds: whole order, deadline the day before the event. `components/refund`, `libs/refund-policy.ts` (#54, #55).
- AI assistant: off unless `AI_ENABLED=true`; settings `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`. `components/ai`, `libs/env.validation.ts` (#60, #61, #63, #85 to #87).

## Skills

Skills live in `.agents/skills` and are linked into `.claude/skills`. The index and the Ticketzy overrides are in `docs/ai/SKILLS.md`. `docs/ai/DECISIONS.md` overrides any skill. Skill scripts that download or run programs need explicit approval each time. The repo workflow skill is `.claude/skills/ticketzy-backend-workflow`.
