# Skills index

Skills live in `.agents/skills/<name>` and are linked into `.claude/skills/<name>` (symlinks). The repo's own workflow skill is a real folder in `.claude/skills`. **`docs/ai/DECISIONS.md` overrides any skill**, and so does `AGENTS.md`. A skill script that downloads or runs a program needs explicit approval each time.

| Skill | What it does | When to use it in Ticketzy | Ticketzy rules that override it |
|---|---|---|---|
| `nestjs-best-practices` | General NestJS architecture, DI, security and performance rules | Reviewing or writing NestJS code (modules, guards, DTO validation, DI) | GraphQL errors come from the `Message` enum, not `HttpException` bodies; existing module layout stays; no microservices (see notes) |
| `security-and-hardening` | OWASP-style checklist for input, auth, data and dependencies | Reviewing a new input handler, auth change or dependency | Roles are server-set (#23); guards and token rules (#25, #26); no refactoring of working code only to satisfy a checklist |
| `mongodb-query-optimizer` | Index and slow-query advice for MongoDB | Only when asked about a slow query or an index (aggregations in `libs/payout.ts`, `getEvents`, orders) | No new indexes or Redis without a decision; no transactions (#17) |
| `mongodb-connection` | Connection pool, timeout and client settings | Connection settings review, Atlas in production | Mongo URI keys are fixed by startup validation (#26); never read `.env` |
| `ticketzy-backend-workflow` | How to add an operation, tests and the project report format | Any new resolver, service method or DTO, and before reporting a task | This file's rules and `AGENTS.md` |

## Notes

- `nestjs-best-practices` is general advice and must not be applied blindly. Ticketzy uses GraphQL with errors from the `Message` enum (not `HttpException` bodies chosen freely), keeps its existing module layout and has no microservices. Rules about the repository pattern, API versioning, migrations, queues, events and microservices are followed only when a decision in `DECISIONS.md` or the user asks for it.
- `security-and-hardening` is a review checklist, not a reason to refactor working code. Report findings; change code only for a real problem or when asked.
- `mongodb-query-optimizer` is for index and query review; `mongodb-connection` is for connection settings, relevant to Atlas in production.

## skills-lock.json

`skills-lock.json` (repo root) records each installed skill: `source` (the GitHub repo, for example `mongodb/agent-skills`), `sourceType`, `skillPath` inside that repo and `computedHash` (a SHA-256 of the skill content). A changed hash means the skill files differ from what was installed, so review the diff before trusting an update. `ticketzy-backend-workflow` is written in this repo and is not in the lock file.

## Older repo skills

`skills/product-logic` is an older review checklist for the event API (not in `.claude/skills`, so it is not loaded automatically; its stale operation name `getOrganizerEvents` was corrected to `getMyEvents`). The root `SKILLS.md` (a duplicate index) and `skills/backend-migration` (a checklist for the finished Nestar to Ticketzy migration, every rule of it now in `AGENTS.md`) were removed on 2026-10-13 (audit C3-23); `git log` keeps them.
