# Prompts

## Prompts that worked this session

**1. Analysis**
> Analyze the current Nestar monorepo structure to transform the existing NestJS monorepo into a ticket selling platform.

Produced the module, schema and enum inventory and the Property to Event mapping.

**2. Safe rename layer** (the scoped version worked best)
> Safe rename layer (no business logic change). Rename all visible project/app identifiers from Nestar to Ticketzy. Do not change domain logic. Keep APIs and database collections unchanged. Update package names, environment labels, constants. Run lint and typecheck after refactoring. Please make a plan first!

Why it worked: it states what must not change, asks for validation, and asks for a plan before edits.

**3. Documentation**
> Create a `docs` folder with BACKEND_MIGRATION, DECISIONS, FRONTEND_MIGRATION, COMPLETED_TASKS, NEXT_STEPS and PROMPTS. Do not change application source code.

Lesson: name the project and tool correctly (Ticketzy / Claude Code, not Petoria / Codex), and say where the frontend lives, because it is not in this repo.

## Reusable prompts for the next session

**Verify the rename**
> Start `ticketzy-api` against the dev DB and diff the GraphQL schema against the pre-rename one (git stash or checkout `73c416b` for the baseline). Report any difference. Do not edit code.

**Decouple generic services**
> Plan first. Make LikeService, ViewService and CommentService independent of Property DTOs and PropertyService. Fix the `ViewGroup` enum used in `Like.model.ts`. No API or collection changes. Run tsc and the build after.

**Property to Event**
> Plan first. Replace the Property module with Event, Venue and TicketType. Keep deprecated Property operations as aliases for one release. List every file touched, the schema changes and the data migration. Ask me about open decisions in `docs/DECISIONS.md` before writing code.

**Orders and inventory**
> Design Order and Ticket schemas and a createOrder mutation with atomic stock decrement (conditional `findOneAndUpdate`) and no overselling under concurrency. Include a concurrency test. No payment gateway.

**Organizer role**
> Replace `MemberType.AGENT` with ORGANIZER across enums, `RolesGuard`, resolver decorators, JWT payload and the batch job. Show the impact on existing member documents.

**Frontend mapping**
> Here is the frontend repo path: <path>. Inventory pages, components and GraphQL documents, and produce a file-by-file migration table against `docs/FRONTEND_MIGRATION.md`. Read-only.

**Hardening**
> Fix the issues listed in NEXT_STEPS B9 one at a time, each with a test and a separate commit.

## Tips
- Put "plan first" and "do not change X" in the prompt.
- Ask for validation commands (`tsc --noEmit`, `eslint` without `--fix`, `nest build`).
- Give exact names (project, tool, repo) to avoid doc drift.
