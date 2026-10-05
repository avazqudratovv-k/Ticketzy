# Next Steps (priority order)

First, resolve the open questions in `DECISIONS.md` (full rename vs. keep internals, preserve data, milestone scope). They change tasks B3 onward.

## Backend cleanup

| # | Task | Why |
|---|---|---|
| B1 | `rm -rf dist`, then rebuild both apps | remove stale `nestar-*` output |
| B2 | Run `npm install --package-lock-only` and check the lockfile diff | the lockfile name was edited by hand |
| B3 | Decouple `LikeService`/`ViewService`/`CommentService` from Property DTOs and `PropertyService` | prerequisite for replacing Property |
| B4 | Fix `Like.model.ts` (uses `ViewGroup` as its enum) and make `*Group` enums entity-agnostic | correctness plus decoupling |
| B5 | Replace Property with Event, Venue, TicketType (schemas, DTOs, resolver, service) | core domain |
| B6 | Add Order and Ticket with atomic inventory (conditional `findOneAndUpdate`); issue ticket codes | selling tickets |
| B7 | Replace `MemberType.AGENT` with ORGANIZER; update `RolesGuard` and JWT payload | role change |
| B8 | Rewrite batch ranking jobs for events and organizers; set a sane cron cadence (currently every minute) | batch app |
| B9 | Security: validate the upload `target` (path traversal), null-check `authMember` in `RolesGuard`, enable `ValidationPipe({ whitelist: true })`, disable the playground and restrict CORS in production | issues found during exploration |
| B10 | Wire `Notice` and `Notification` modules | schemas exist, nothing uses them |

## Frontend migration
(See `FRONTEND_MIGRATION.md`.)

| # | Task |
|---|---|
| F1 | Locate the Next.js repo and inventory pages and GraphQL documents |
| F2 | Rebrand strings, then add the terminology constants |
| F3 | Migrate property pages to Event operations once the backend ships aliases |
| F4 | Build ticket selection, checkout, my tickets |

## Testing

| # | Task |
|---|---|
| T1 | Start the API and compare schema introspection with the pre-rename schema (expect no diff) |
| T2 | Smoke-test login, `getProperties` and image upload against a dev DB |
| T3 | Add unit tests for the auth guards and the inventory decrement (concurrency) |
| T4 | Replace the boilerplate e2e specs with real ones; the batch spec needs Mongo |
| T5 | Run the prettier formatting pass as one isolated commit, then keep `npm run lint` clean |

## Documentation

| # | Task |
|---|---|
| D1 | Rewrite `README.md` (still Nest boilerplate) with Ticketzy setup, env keys and scripts |
| D2 | Expand `AGENTS.md`/`SKILLS.md` (3 lines each) with the conventions and layer plan |
| D3 | Update `docs/` after each layer; record decisions as they are made |
| D4 | Document env keys (`PORT_API`, `PORT_BATCH`, `MONGO_DEV`, `MONGO_PROD`, `SECRET_TOKEN`) without values; confirm `.env` is gitignored, and rotate the secrets if it was ever tracked |
