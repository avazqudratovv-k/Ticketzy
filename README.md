# Ticketzy backend

Ticketzy is the backend of a ticket selling platform. Organizers publish events at venues, with ticket types or reserved seats. Buyers hold seats, pay, receive QR tickets and can refund. Admins approve organizers and events, handle refunds and mark organizer payouts.

- **Roles:** `USER` buys tickets. `ORGANIZER` creates venues, events and ticket types, and needs admin approval first (`PENDING` until verified). `ADMIN` approves organizers and events, refunds orders, marks payouts and reads the audit log. Roles are set only by the server; the only way to get an admin is `npm run seed`.
- **Selling:** buyers hold seats (a short timer), check out and pay. Reserved-seating events use one conditional update per seat, general admission uses a conditional stock update, so nothing is oversold. Every ticket has a signed QR token; the organizer's gate scans it (`checkInTicket`).
- **Refunds:** a buyer can refund a whole order until the end of the day before the event. Admins can refund later, and cancelling an event refunds every order.
- **Payouts:** one payout per event, due three days after the event ends. An admin marks it paid; status is computed, never stored.
- **Extras:** organizer and admin chat (GraphQL plus a WebSocket gateway), notifications, comments, likes, follows (organizers only), and an optional AI assistant (event search, moderation, translation).

> **Payments are a mock.** There is no real payment provider. With `PAYMENT_MODE=simulated` the buyer chooses whether a payment succeeds, so anyone can get valid QR tickets. That is fine for a demo and wrong for real money. Set `PAYMENT_MODE=disabled` to refuse every payment. See `docs/ai/DECISIONS.md` (#48, #92).

## Stack

NestJS 10 (monorepo), GraphQL code-first (Apollo Server 4), Mongoose and MongoDB, JWT (bearer header, no cookies), `graphql-upload` for images, a `ws` gateway for chat, `@nestjs/schedule` for the batch app, Jest for tests, npm as the package manager (`package-lock.json`).

Needs **Node 22 or newer** (developed on Node 24, the CI workflow uses Node 22) and **MongoDB 5.0 or newer** (the payout report uses `$dateAdd` with a time zone). Transactions are not used, so a single MongoDB without a replica set is enough.

## Run it

```bash
npm install
cp .env.example .env        # then fill in the required values (see below)
npm run seed                # creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run start:dev           # API in watch mode (port PORT_API, default 3000)
npm run start:dev:batch     # batch app in watch mode (port PORT_BATCH)
```

`npm run seed:demo` fills a development database with demo accounts, venues, events, orders, a refund and chats (all demo accounts use the `@ticketzy.demo` email domain; the shared password is `DEMO_PASSWORD`, default `Demo1234!`). It refuses `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.

## Environment variables

Names only; copy `.env.example` and set the values. The API and the batch app refuse to start when a required one is missing.

| Name | Needed | What it is |
| --- | --- | --- |
| `MONGO_DEV` / `MONGO_PROD` | one of them (required) | MongoDB connection string. `MONGO_PROD` is used when `NODE_ENV=production`, otherwise `MONGO_DEV` |
| `SECRET_TOKEN` | required (API) | secret that signs login tokens (long and random) |
| `QR_SECRET` | required (API) | secret that signs ticket QR tokens (long, random, different from `SECRET_TOKEN`) |
| `PAYMENT_MODE` | required in production, optional otherwise | `simulated` (mock provider) or `disabled`; unset means `simulated` outside production |
| `CLIENT_URL` | optional | allowed browser origin(s), comma separated; development default is `http://localhost:3000` |
| `PORT_API`, `PORT_BATCH` | optional | ports of the API and the batch app |
| `SEAT_HOLD_SECONDS` | optional | how long a seat hold lasts (1 to 3600, default 30) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | for `npm run seed` | the first admin |
| `ADMIN2_EMAIL`, `ADMIN2_PASSWORD`, `ADMIN2_NICK` | optional, for `npm run seed` | a second admin |
| `AI_ENABLED`, `AI_PROVIDER`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE` | optional | AI assistant settings; it stays off unless `AI_ENABLED=true` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | optional | used when `AI_PROVIDER=anthropic` (default) |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | optional | used when `AI_PROVIDER=gemini` |
| `DEMO_PASSWORD`, `ALLOW_DEMO_SEED` | optional, for `npm run seed:demo` | demo password and the production guard |
| `NODE_ENV` | set by `npm run start:prod` | `production` turns off the GraphQL playground and introspection and picks `MONGO_PROD` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run start:dev` / `start:dev:batch` | API / batch app in watch mode |
| `npm run build` | `nest build` (both apps, into `dist/`) |
| `npm run start:prod` | runs `dist/apps/ticketzy-api/main` with `NODE_ENV=production` (build first) |
| `npm run start:prod:batch` | runs the batch app; it does not set `NODE_ENV`, so set `NODE_ENV=production` on the host |
| `npm run seed` / `seed:demo` | first admin / demo data |
| `npm run report:currency` | read-only report of ticket types that are not in KRW (see `docs/ai/DECISIONS.md` #95) |
| `npm run ai:check` | checks the AI settings and sends one tiny request (a real call with the key in `.env`) |
| `npm run test` | the whole Jest suite (no database, no secrets needed) |
| `npm run lint` | ESLint **with `--fix`**: it rewrites files, run it only when that is fine |

Type checks: `npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit` and the same for `apps/ticketzy-batch`. The GitHub Actions workflow (`.github/workflows/ci.yml`) runs both, the build and the tests.

## Run the tests

```bash
npm run test        # unit tests, every *.spec.ts under apps/
npm run test:cov    # with coverage
```

There are no end-to-end tests yet. Services are tested against an in-memory fake model (`apps/ticketzy-api/test/fake-model.ts`) or Jest mocks, so the race conditions of real MongoDB are not covered (see `docs/ai/CLEANUP_AUDIT.md`, C3-76).

## Folder map

```
apps/
  ticketzy-api/
    src/
      main.ts, app.module.ts      bootstrap (CORS, uploads, WebSocket adapter) and the root module
      components/<name>/          one folder per feature: resolver, service, module, specs
                                  (ai, audit-log, auth, comment, conversation, event, follow, like, member,
                                   notice, notification, order, organizer, payment, payout, refund, sales,
                                   seat, ticket, ticket-type, venue, view)
      libs/                       DTOs (dto/), enums, Mongoose schemas, pure rules (payout, refund policy,
                                  commission, venue layout...), env validation, error mapping
      socket/                     WebSocket gateway for chat
      database/                   MongoDB connection module
      seed.ts, seed-demo.ts       admin seed, demo seed
    test/fake-model.ts            in-memory Mongoose model for tests
  ticketzy-batch/                 hourly ranking, order and seat-hold expiry, ending finished events
docs/ai/                          decisions, completed tasks, next steps, audits (see below)
.agents/skills, .claude/skills    AI assistant skills (see docs/ai/SKILLS.md)
```

## Working with AI tools

This repo is built with AI coding assistants under written rules, so their work can be reviewed.

- `AGENTS.md` is the main guide for any AI tool: stack, commands, working rules and domain rules. `CLAUDE.md` imports it and adds a few Claude Code notes.
- `docs/ai/DECISIONS.md` is the numbered decisions log (what was decided, why, risks, alternatives); `docs/ai/COMPLETED_TASKS.md` records every finished task with the checks that were run. Start with `docs/ai/`.
- Skills (NestJS, security, MongoDB and a repo workflow skill) live in `.agents/skills` and `.claude/skills`; `docs/ai/SKILLS.md` lists them and `skills-lock.json` pins their sources.
- Decisions override skills: a skill is general advice, a decision is what this project chose.
- AI tools do not commit unless asked, never read `.env`, and must pass the full test suite before reporting.

## Check the AI

```bash
npm run ai:check
```

It reads `.env` (nothing secret is printed), shows whether `AI_PROVIDER`, `GEMINI_API_KEY` (set / not set) and `GEMINI_MODEL` are set, lists the Gemini models that support `generateContent` (your `GEMINI_MODEL` is marked), and sends one tiny "Say hello" request. Exit code 0 means it works, 1 means it does not.

| Result | Meaning |
| --- | --- |
| `OK in 640 ms` | Key, model and network work. |
| `GEMINI_MODEL "..." is not in the list` / `wrong model (404)` | The model name is wrong; use one of the IDs printed in the list (the closest ones are shown). |
| `bad key or permission (400/403)` | The key is wrong, expired, restricted or has no access to the model. |
| `quota (429)` | Too many requests or the free quota is used up; wait or check your Google plan. |
| `Google is busy (503/504)` | The model is overloaded; try again, or set `GEMINI_FALLBACK_MODEL`. |
| `timed out` | Google did not answer within `AI_TIMEOUT_MS` (default 15000). |

When `AI_PROVIDER=gemini`, the API logs a warning at startup if `GEMINI_API_KEY` or `GEMINI_MODEL` is missing (it never calls Google at startup).

## License

Private project (`UNLICENSED`). No license is granted.
