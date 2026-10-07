# Ticketzy Backend Agent Instruction

Ticketzy is a NestJS GraphQL monorepo for a ticket selling platform (it started from the Nestar codebase, see `docs/ai/BACKEND_MIGRATION.md`)

## Read First

Before changing code, read the current AI handoff docs:

- `docs/ai/BACKEND_MIGRATION.md`
- `docs/ai/DECISIONS.md`
- `docs/ai/COMPLETED_TASKS.md`
- `docs/ai/NEXT_STEPS.md`

Use those files as the source of truth for AI Agent related migration history, accepted decisions, remaining work and validation status.

## Project Shape

- Backend apps are `ticketzy-api` and `ticketzy-batch`.
- Keep the existing NestJS resolver/service/module pattern based on MVC and DI.
- Keep DTOs, enums, schemas under `apps/ticketzy-api/src/libs`.
- Keep shared modules reusable: auth, member, like, view, comment (events only), follow (organizers only), socket.

## Domain Rules

- Use ticketing terminology: the main catalog entity is Event, with Venue, TicketType, Order and Ticket as supporting entities (planned, see `docs/ai/BACKEND_MIGRATION.md`).
- Do not reintroduce fields or terms from the previous catalog; the catalog entity is Event. The community board is removed.
- `MemberType` is `USER`, `ORGANIZER` and `ADMIN` (AGENT was renamed, `docs/ai/DECISIONS.md` #13). Roles are set only by the server; admins come from `npm run seed`.
- Event ownership uses `MemberType.ORGANIZER`; organizer-only mutations also use `ActiveOrganizerGuard` so PENDING organizers cannot write.
- Ticket inventory changes must be atomic (conditional `findOneAndUpdate`) so tickets cannot be oversold.
- Event category, city and other enum values are still to be decided; record them in `docs/ai/DECISIONS.md`.

## Workflow

1. Analyze before editing.
2. Keep changes small and consistent with existing project patterns.
3. Do not remove working logic unless it is replaced safely.
4. Update `docs/ai/COMPLETED_TASKS.md` after major completed work.
5. Add or update focused tests when behavior changes.

## Validation

Use these checks for backend work:

```bash
npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit
npx tsc -p apps/ticketzy-batch/tsconfig.app.json --noEmit
npx run build
```

`npm run lint` runs ESLint with `--fix`, so use it only when file rewriting is acceptable!
