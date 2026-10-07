# Backend: from the Nestar codebase to Ticketzy

> Naming note: the target project is **Ticketzy**. Early requests said "Petoria"; the repo, its remote (`avazqudratovv-mit/Ticketzy`) and the package name are Ticketzy, so these docs use Ticketzy.

## 1. Origin
Ticketzy started as a copy of the Nestar backend: a NestJS 10 GraphQL monorepo (Apollo 4 code-first, Mongoose 8, JWT, graphql-upload, `ws`, `@nestjs/schedule`) with two apps, an API and a cron batch app. The original catalog domain was replaced by ticketing; only the generic building blocks were kept.

## 2. Migration layers

| Layer | Status |
|---|---|
| 1. Safe rename (identifiers only), commit `3386edb` | **Done** |
| 2. Decouple like / view / comment from the old catalog | **Done** |
| 3. Old catalog replaced by Event, Venue, TicketType | **Done** |
| 4. Order, Ticket, atomic inventory | **Done** (payment is a manual stub, DECISIONS #16) |
| 5. Organizer role, batch ranking rewrite | **Done** (DECISIONS #13) |
| 6. Security and auth hardening | **Done** (DECISIONS #23 to #26) |
| 7. Leftover cleanup: board removed, organizer naming, visibility rules | **Done** (DECISIONS #27 to #30) |
| 8. Organizer approval, audit log, commission override | **Done** (DECISIONS #31 to #34) |

## 3. Current shape
Code lives in `apps/ticketzy-api/src` (`components/`, `libs/{dto,enums,schemas,interceptor}`, `socket/`, `database/`) and `apps/ticketzy-batch/src`.

| Module | Role |
|---|---|
| auth | JWT (`{ _id, memberType }`, 1 day), `AuthGuard`, `RolesGuard`, `WithoutGuard`, `ActiveOrganizerGuard` |
| member | signupUser, signupOrganizer, login by email, profile, organizer listing, admin member management, image upload |
| organizer | ADMIN operations: list, verify, reject, suspend, reinstate, commission override |
| audit-log | `audit_logs` writer used by the organizer module, and `getAuditLogsByAdmin` |
| event, venue, ticket-type | the catalog |
| order, ticket | sales, atomic stock, tickets with codes, check-in |
| like, view | favorites and counters (groups MEMBER and EVENT) |
| comment | comments on events only |
| follow | followers of organizers only |
| notice, notification | FAQ-style notices; in-app notifications |
| socket | `ws` chat gateway, in memory |
| batch app | hourly event and organizer ranking, per-minute order expiry |

Collections: `members`, `events`, `venues`, `ticketTypes`, `orders`, `tickets`, `payments`, `likes`, `views`, `comments`, `follows`, `notices`, `notifications`, `audit_logs`. The current GraphQL operations are listed in `COMPLETED_TASKS.md` (sections 7 and 10).

## 4. Compatibility notes
- Absolute imports (`apps/ticketzy-api/src/...`) rely on `baseUrl: ./`; the batch app imports schemas and enums from the API app this way.
- `dist/` is gitignored; `rm -rf dist` removes stale output.
- `npm run lint` uses `--fix` and the baseline has thousands of prettier errors (tabs vs spaces), so run it only when file rewriting is acceptable.
- Existing database documents from the Nestar days are not migrated: see `NEXT_STEPS.md` N4, N7 and N10.
