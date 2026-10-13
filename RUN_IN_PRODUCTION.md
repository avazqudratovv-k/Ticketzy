# Run Ticketzy in production

Target: a **Render** web service (free tier) for the API, **MongoDB Atlas** for data, a **Vercel** frontend on another origin, and an optional separate batch process. Names only: no value of any variable is written here or should be committed. Decisions behind each setting: `docs/ai/DECISIONS.md` #100 to #107.

## Required environment variables (production)

The API refuses to start, and prints every problem at once by variable **name**, when one of these is missing or invalid.

| Name | Purpose |
|---|---|
| `NODE_ENV` | must be `production` (picks `MONGO_PROD`, turns off the playground and introspection, quiet logs). `npm run start:prod` sets it; on Render the service also refuses to start without it |
| `MONGO_PROD` | Atlas connection string (pattern below) |
| `SECRET_TOKEN` | signs login tokens (JWT); at least 32 random characters, no placeholder words |
| `QR_SECRET` | signs ticket QR codes; at least 32 random characters, different from `SECRET_TOKEN` |
| `CORS_ORIGINS` | comma-separated exact browser origins that may call the API, for example the Vercel production URL; no wildcard, no path, `https` |
| `PAYMENT_MODE` | `simulated` (mock provider, the buyer picks the result) or `disabled` (every payment is refused); there is no real provider and no default in production |

## Optional environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | host sets it | port to listen on (falls back to `PORT_API`, then 3000); the API binds `0.0.0.0` |
| `PORT_API`, `PORT_BATCH` | 3000 | local fallbacks for the API and the batch app |
| `TRUST_PROXY_HOPS` | 1 in production | how many proxies are in front of the API, so rate limits see the real client IP |
| `CLIENT_URL` | none | older name of `CORS_ORIGINS`, read only when `CORS_ORIGINS` is empty |
| `RATE_LIMIT_GENERAL_PER_MINUTE` | 300 | GraphQL requests per IP per minute |
| `RATE_LIMIT_LOGIN_PER_15_MIN` | 10 | login attempts per IP per 15 minutes (per email: twice as many) |
| `RATE_LIMIT_SIGNUP_PER_HOUR` | 5 | sign-ups (user and organizer) per IP per hour |
| `RATE_LIMIT_PASSWORD_PER_15_MIN` | 5 | password changes and admin resets per member and per IP per 15 minutes |
| `AI_ENABLED` | `false` | AI features on or off |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `gemini` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | model default `gemini-2.5-flash` | Gemini key and models (a missing key only turns the AI off) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | model default `claude-haiku-4-5` | Anthropic key and model |
| `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE` | 15000, 10 | per-request timeout and per-minute limit per member or IP |
| `AI_DAILY_CAP` | 400 | AI model calls per UTC day for the whole app, kept in MongoDB; `0` turns the AI off |
| `AI_PER_KEY_DAILY_CAP` | 30 | AI operations per member or IP per UTC day |
| `SEAT_HOLD_SECONDS` | 30 | length of a seat hold and an unpaid general-admission order (1 to 3600); use 300 for a demo |
| `UPLOAD_MAX_FILE_MB`, `UPLOAD_MAX_FILES` | 15, 10 | image upload limits |
| `LOG_LEVEL` | `warn` in production | `error`, `warn`, `log`, `debug` or `verbose` |
| `MONGO_AUTO_INDEX` | `true` | `false` stops the API building indexes at startup (set it after the first deploy if cold starts matter) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN2_EMAIL`, `ADMIN2_PASSWORD`, `ADMIN2_NICK` | none | only for `npm run seed` (the admin accounts); remove `ADMIN_PASSWORD` from the host afterwards |
| `DEMO_PASSWORD`, `ALLOW_DEMO_SEED` | none | only for `npm run seed:demo`; the seed refuses production unless `ALLOW_DEMO_SEED=true` |

`.env.example` does not list the names added by this task yet (editing env files was out of scope): add them from the tables above.

## Render

| Setting | Value |
|---|---|
| Runtime | Node 22 or newer (the code needs `$dateAdd` with a time zone, so MongoDB 5.0+) |
| Build command | `npm ci && npm run build` |
| Start command | `npm run start:prod` |
| Health check path | `/health` (always 200, no database). Use `/ready` only for your own monitoring: it is 503 while MongoDB is not connected |
| Environment | the required names above, plus `NODE_ENV=production` if the host does not set it |

`npm ci` installs the dev dependencies the build needs. The build produces `dist/apps/ticketzy-api/main.js` and `dist/apps/ticketzy-batch/main.js`.

## MongoDB Atlas checklist

1. Create a cluster (M0 free is enough) in a region near the Render region.
2. **Database user**: Database Access, a user with a long random password and the least role that works: `readWrite` on the Ticketzy database only (not `atlasAdmin`). Prefer a password without characters that need URL encoding; if it has any, URL-encode it in the connection string.
3. **IP allowlist**: Network Access. A Render service has no dedicated outbound IP of its own, so the usual setup is `0.0.0.0/0` (anywhere). The password is then the only protection: keep it long, give the user the least role, and never reuse it. Render also publishes shared outbound address ranges per region that you can list instead if you accept keeping them up to date (check Render's current documentation; not verified here).
4. **URL format** (pattern, fill in your own values): `mongodb+srv://<user>:<password>@<cluster-host>/<database>?retryWrites=true&w=majority`. Set it as `MONGO_PROD`. The database name in the path decides where data lives.
5. Create the admin once, from your own machine against the production URL: `NODE_ENV=production npm run seed` with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set for that command only.
6. Indexes are built by the API at its first start (`MONGO_AUTO_INDEX` unset). If an old database has duplicate data a unique index cannot be built: the API logs the failed index and keeps running (see "Indexes" in `docs/ai/DECISIONS.md` #107).
7. Atlas M0 clusters can be paused after a long period without use: the first boot then waits for the cluster (the API retries 5 times, about a minute in total, then exits and the host restarts it).

## CORS and the WebSocket

- Set `CORS_ORIGINS` to the exact origin(s) of the Vercel site, for example the production URL and, if you use them, a fixed preview URL. Vercel preview URLs change on every deploy: either list a stable preview domain or test against production only. Wildcards are refused on purpose.
- The browser sends `Authorization: Bearer <token>`; no cookies are used, so CORS credentials are off.
- A refused origin gets no CORS header; the browser then reports a CORS error, the API answers normally to non-browser clients.
- The chat WebSocket is served by the same process on the same port (`wss://` through Render's proxy). Browsers do not apply CORS to WebSockets; the connection is authenticated by a token sent in the first `auth` message (or an `Authorization` header), never in the URL. The frontend needs `NEXT_PUBLIC_API_WS_URL` pointing at the API host.
- Uploaded images are served from `/uploads` with `Cross-Origin-Resource-Policy: cross-origin` so the Vercel site can show them.

## Cold start (free tier)

- An idle free instance sleeps after about 15 minutes (the host's number) and needs roughly 30 to 60 seconds to wake. The first request may time out; the frontend retries.
- On boot the API validates the environment, connects to Atlas (up to 5 tries), builds indexes (unless `MONGO_AUTO_INDEX=false`) and then listens. `/health` answers as soon as it listens.
- Everything held in memory is lost when it sleeps: rate-limit counters (a visitor gets a fresh budget), WebSocket connections and chat rooms (clients reconnect). Counters that must survive live in MongoDB: the AI daily cap.
- A keep-alive ping to `/health` every 10 minutes from an external service stops the sleep, but uses free-tier hours.

## The batch process

The batch app runs four jobs: ranks (events at minute 20, organizers at minute 40), order and seat-hold expiry (every minute), ending finished events (minute 30). Options:

1. **Second Render service** (a background worker or web service, start command `npm run start:prod:batch`, same `MONGO_PROD`). A free web service sleeps and then runs nothing; a paid worker runs always.
2. **External scheduler** calling the batch web service's `GET /` every few minutes to wake it (it runs its jobs while awake).
3. **No batch process.** Safe for correctness since #102:

| Job | If the batch never runs |
|---|---|
| Expire abandoned orders / release seat holds | Done by the API: when stock is short, when ticket types are read, when a buyer reads their orders; seat holds are claimed lazily. Nothing leaks. Without the batch, stock of an abandoned general-admission order is returned the next time anyone touches that ticket type or event |
| End finished events | **Lost.** Events stay `APPROVED` after `endAt`; `completedEvents` of the organizer does not grow, so the commission tiers (7 percent from 5 events, 5 percent from 20) do not advance. Payouts are still computed from `endAt`, but the events never show as `ENDED` |
| Refresh ranks | Lost. "Sort by rank" uses stale numbers; nothing breaks |

If you skip the batch process, run `npm run start:prod:batch` yourself (locally, against `MONGO_PROD`) now and then, or add a worker later.

## Uploads on Render's disk

User-uploaded images are written to `./uploads` on the instance's disk. On Render's free tier the disk is **ephemeral**: it is erased on every deploy, restart and spin-down, while the database keeps the image paths, so organizer images show as broken. Seeded demo events are not affected (they use external image URLs). Options are compared in the task report; the recommended one is Cloudinary's free tier uploaded through its REST API (the frontend already accepts absolute `https://` image URLs). Not implemented.

## Emails

The backend sends no email at all: there is no mail library, no mail setting, and no code path that sends a message. Accounts are not verified by email, there is no password reset flow (an admin can set a buyer's or organizer's password with `updateMemberByAdmin`), and notifications are in-app records only. The frontend's "Demo only. No emails are sent." notice is accurate.

## Rotating secrets

- `SECRET_TOKEN`: change it on the host and redeploy. Every login token stops working and everybody has to log in again. Do it at once if it leaked.
- `QR_SECRET`: change it on the host and redeploy. **Every ticket already issued stops validating at the gate** (their QR tokens were signed with the old secret). Rotate only with no live tickets, or after refunding them.
- `MONGO_PROD` password: create a second Atlas user, switch `MONGO_PROD`, redeploy, then delete the old user.
- AI keys: create the new key at the provider, change the variable, redeploy, revoke the old key.
- Admin password: change it from the admin account (`updateMember`), then remove `ADMIN_PASSWORD` from the host.
- Never paste a secret into a chat, a commit or a log; generate with a password manager or `openssl rand -base64 48`.

## Pre-deploy checklist

- [ ] `npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit` and the same for `apps/ticketzy-batch`; `npm run build`; `npm run test` all pass.
- [ ] Required variables set on the host (names above); `NODE_ENV=production`; `PAYMENT_MODE` chosen on purpose.
- [ ] `SECRET_TOKEN` and `QR_SECRET` are different random values of 32+ characters.
- [ ] `CORS_ORIGINS` is the exact Vercel origin; the frontend's `NEXT_PUBLIC_API_GRAPHQL_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_WS_URL` point at the API.
- [ ] Atlas user has `readWrite` on one database; the allowlist is decided; `MONGO_PROD` has the right database name.
- [ ] Admin created with `npm run seed`; `ADMIN_PASSWORD` removed from the host afterwards.
- [ ] Render health check path is `/health`.
- [ ] After deploy: `GET /health` is 200, `GET /ready` is 200, GraphQL `introspection` is refused, a login with a wrong password 11 times in a row answers `RATE_LIMITED`.
- [ ] Decided what to do about uploads (ephemeral disk) and the batch process.
- [ ] Demo only: `SEAT_HOLD_SECONDS=300`, and the frontend shows that payments are simulated.
