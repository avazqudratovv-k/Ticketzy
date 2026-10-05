# Architectural Decisions

| # | Decision | Why | Risks | Alternatives |
|---|---|---|---|---|
| 1 | Do the migration in layers; **rename layer first** with no logic change | Keeps the API deployable at every step and makes each diff reviewable | Names (`Property`, `Agent`) stay misleading until layer 3 | One big-bang rewrite: faster on paper, hard to debug |
| 2 | Keep GraphQL operations and **MongoDB collections unchanged** in layer 1 | Existing clients and data keep working; no migration script | Frontend still sees real-estate names | Rename now plus a data migration: cleaner, riskier |
| 3 | Use `git mv` for the app folders | Preserves file history across the rename | None meaningful | Copy and delete: loses blame |
| 4 | Keep the `apps/<name>/src/libs` structure and absolute `apps/...` imports | Changing structure is out of scope for a rename | Absolute imports tie code to the folder name (they had to be edited) | Extract a top-level `libs/` with path aliases; do it later with layer 2 |
| 5 | Fix the batch e2e spec to import `BatchModule` | The spec referenced `NestarBatchModule`, which never existed, so tsc already failed on it | The spec may still not pass at runtime (needs Mongo); only compilation was checked | Delete the spec |
| 6 | Run lint **without `--fix`** | `npm run lint` rewrites files; the baseline has 2379 prettier errors that would pollute a rename diff | Lint debt remains | Run prettier over the repo as its own commit (recommended later) |
| 7 | Leave `.env` keys/values alone | No Nestar strings in it; changing DB names would point at different data | None | Rename DB names with a migration |
| 8 | Git identity stays `Kenneth <avazqudratovv@gmail.com>` (global git config), separate from the Claude account email | Commits should match the GitHub account; the signup email is not a git identity | Commits may not link to the GitHub profile if that email is not added to the account | Set a repo-local `user.email` |
| 9 | Treat the target as **Ticketzy** (the request text said "Petoria") | Repo, remote and package name are Ticketzy | If Petoria is a real second rename, the docs need updating | Ask before proceeding |
| 10 | Property becomes **Event + Venue + TicketType** (planned) | Price tiers and capacity do not fit a single `propertyPrice`; locations should be entities, not a Korean-city enum | Large change touching DTOs, sort whitelists, `$lookup`s, batch jobs | Reuse Property with renamed fields: smaller, but keeps the wrong data model |
| 11 | Agent becomes **Organizer** (planned) | Same "owner of listings" role | `MemberType` enum change affects `RolesGuard`, JWT contents and the frontend | Keep AGENT internally and alias in the UI |
| 12 | Order/Ticket need **atomic inventory** (planned) | No inventory logic exists; overselling is the main ticketing risk | Needs conditional `findOneAndUpdate` or transactions (replica set) | Optimistic checks only: race conditions |

## Open questions (user cancelled these; still undecided)
- Full rename of `propertyX` fields and collections vs. keeping internals.
- Whether existing DB data must be preserved.
- Milestone scope (payments or not).
- Keep or drop board-article and chat.
