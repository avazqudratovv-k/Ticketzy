# Ticketzy API

Backend for **[ticketzy.uz](https://ticketzy.uz)**, a ticketing platform for concerts, football and comedy events. Organizers publish events with reserved seats or general admission. Buyers hold seats, pay and receive signed QR tickets. Admins approve organizers, refund orders and mark payouts.

Frontend: [Ticketzy-next](https://github.com/avazqudratovv-k/Ticketzy-next) (Next.js).

<!-- Add 2-3 screenshots here: ![Event page](docs/screenshots/event.png) -->

## What it does

- **Ticketing flow:** reserved-seat and general-admission events, time-limited seat holds, orders, refunds, organizer payouts.
- **Signed QR tickets:** each ticket carries an HMAC-signed token, so a door scan can be verified without trusting the client.
- **Roles:** buyers, organizers (with an admin approval step) and admins.
- **Auth and accounts:** JWT sessions, bcrypt password hashing, email verification and password reset by email (Resend).
- **Realtime:** WebSocket updates (`ws`) alongside the GraphQL API.
- **Optional AI features:** moderation, translation and an assistant, switchable between Anthropic (default) and Gemini, with a daily cap, per-member rate limit, timeout, retry and a Gemini fallback model. AI is off unless `AI_ENABLED` is set.
- **Safety defaults:** `helmet`, CORS allow-list, rate limits for general traffic, login, signup and password reset, and a required-variables check that stops the apps from starting with a missing secret.

## Architecture

A NestJS monorepo with two apps:

| App | Role |
|---|---|
| `apps/ticketzy-api` | GraphQL API (Apollo), WebSocket gateway, file uploads, health check |
| `apps/ticketzy-batch` | Scheduled jobs (`@nestjs/schedule`), run as a separate process so they never compete with request traffic |

- **Stack:** NestJS 10, TypeScript, GraphQL (Apollo Server 4), MongoDB with Mongoose, JWT, `ws`, Resend, Anthropic and Google Gen AI SDKs.
- **Seat holds:** a hold lasts `SEAT_HOLD_SECONDS` (default 30, range 1 to 3600). Unpaid general-admission orders expire on the same timer.
- **Payments:** `PAYMENT_MODE=simulated` is the only mode implemented. No real payment provider is connected yet, and production requires the variable to be set explicitly.
- **Deployment:** Docker Compose runs the API and batch apps behind a reverse proxy, bound to localhost only. See [RUN_IN_PRODUCTION.md](RUN_IN_PRODUCTION.md).

## Getting started

Requires Node 24 and a MongoDB instance.

```bash
git clone https://github.com/avazqudratovv-k/Ticketzy.git
cd Ticketzy
npm ci
cp .env.example .env     # fill in the required values, see below
npm run start:dev        # API
npm run start:dev:batch  # batch jobs (separate terminal)
```

Required variables: `MONGO_DEV` (and `MONGO_PROD` in production), `SECRET_TOKEN`, `QR_SECRET`. In production also `PAYMENT_MODE`, `CORS_ORIGINS`, `RESEND_API_KEY`, `MAIL_FROM` and `SITE_URL`. Every variable is documented in [.env.example](.env.example). Use long random strings for the secrets, and never commit a real `.env`.

### Demo data

```bash
npm run seed        # creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run seed:demo   # demo events, organizers and orders
npm run reset:demo  # reset demo data
npm run check:demo  # read-only check
```

The demo seed refuses to run against a database that holds data it did not create, and it refuses weak demo passwords. Demo images and their credits are in [demo-images/](demo-images/CREDITS.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` / `start:dev:batch` | Run the API / batch app in watch mode |
| `npm run build` | Build both apps |
| `npm run start:prod` / `start:prod:batch` | Run the built apps |
| `npm test` | Unit and HTTP tests (Jest) |
| `npm run test:cov` | Tests with coverage |
| `npm run lint` | ESLint |
| `npm run migrate:*` | One-off data migrations (see RUN_IN_PRODUCTION.md) |

## Tests

Jest covers the services, the GraphQL and HTTP layer, the demo seeder (including refunds) and the batch jobs (ranking and payout notices). Run `npm test`.

1,675 backend test cases in 88 spec files, run in CI. The API exposes 105 GraphQL operations (43 queries, 62 mutations).

## License

Private project, shown here as a portfolio piece.
