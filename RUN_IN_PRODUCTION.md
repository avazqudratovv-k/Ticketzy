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
| `RESEND_API_KEY` | Resend API key (sends the verification and password reset emails). Without it the API does not start in production |
| `MAIL_FROM` | sender, an address on a domain you verified at Resend: `noreply@example.com` or `Ticketzy <noreply@example.com>` |
| `SITE_URL` | front end address the emailed links start with, `https`, no path, for example `https://example.com`. The links are `SITE_URL/verify-email?token=...` and `SITE_URL/reset-password?token=...` |
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
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | model default `gemini-2.5-flash`, no fallbacks | Gemini key, main model and an ordered, comma separated list of up to 3 fallback models, for example `GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite`; more than 3 or a bad name stops the API at startup (names only, no call to Google). A 429 skips to the next model at once and the model rests for 30 minutes; 503/504/timeout/500/400/404 move on after one retry of the main model; 401/403 stop the chain. `GEMINI_FALLBACK_MODEL` (one name) is **deprecated**, still read as a one item list when the new variable is empty. A missing key only turns the AI off |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | model default `claude-haiku-4-5` | Anthropic key and model |
| `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE` | 15000, 10 | per-request timeout (our own abort, not a Google deadline) and per-minute limit per member or IP |
| `AI_DAILY_CAP` | 200 | AI model calls per UTC day for the whole app, kept in MongoDB; `0` turns the AI off. Every attempt counts (a retry, a fallback model, a 429), a model skipped during its cooldown does not. One assistant question makes 1 to 5 calls. Keep it at or below what the daily limits of the models in the chain add up to |
| `AI_PER_KEY_DAILY_CAP` | 10 | AI operations per member or IP per UTC day (about 10 to 50 model calls at most), so a few visitors cannot use up the shared cap |
| `SEAT_HOLD_SECONDS` | 120 | length of a seat hold and an unpaid general-admission order (1 to 3600); use 300 for a demo |
| `UPLOAD_MAX_FILE_MB`, `UPLOAD_MAX_FILES` | 15, 10 | image upload limits |
| `LOG_LEVEL` | `warn` in production | `error`, `warn`, `log`, `debug` or `verbose` |
| `MONGO_AUTO_INDEX` | `true` | `false` stops the API building indexes at startup (set it after the first deploy if cold starts matter) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN2_EMAIL`, `ADMIN2_PASSWORD`, `ADMIN2_NICK` | none | only for `npm run seed` (the admin accounts); remove `ADMIN_PASSWORD` from the host afterwards |
| `DEMO_BUYER_PASSWORD`, `DEMO_ORGANIZER_PASSWORD`, `DEMO_PENDING_ORGANIZER_PASSWORD`, `DEMO_REJECTED_ORGANIZER_PASSWORD` | none | only for `npm run seed:demo`: strong passwords (12+ characters, three kinds, no common words) of the demo accounts; remove them from the host afterwards |
| `DEMO_SEED_CONFIRM` | none | only for `seed:demo` and `reset:demo`: must be `MONGO_DEV` or `MONGO_PROD`, the database variable the command should use |
| `EMAIL_VERIFIED_MIGRATION_CONFIRM` | none | only for `npm run migrate:email-verified -- --apply`: must be `MONGO_DEV` or `MONGO_PROD` (see "Upgrading to email verification") |
| `STADIUM_SURROUND_MIGRATION_CONFIRM` | none | only for `npm run migrate:stadium-surround -- --apply`: must be `MONGO_DEV` or `MONGO_PROD` (see "Room around the pitch") |
| `MEMBER_INDEX_MIGRATION_CONFIRM` | none | only for `npm run migrate:member-indexes -- --apply`: must be `MONGO_DEV` or `MONGO_PROD`, the database variable the command should use (see "Upgrading member indexes") |
| `DEMO_SEED_ALLOW_NON_DEMO_DB` | `false` | `true` lets the demo commands run against a database that already holds data the seed did not create |
| `ALLOW_DEMO_SEED` | `false` | the demo commands refuse `NODE_ENV=production` unless this is `true` |

**Gemini free tier (demo):** the free quota is counted per model per day and Google changes the limits, so check them at https://ai.dev/rate-limit and keep `AI_DAILY_CAP` within them. A free-tier demo may be slow or busy; list up to 3 models in `GEMINI_FALLBACK_MODELS` so one used-up model does not switch the assistant off, and run `npm run ai:check` (1 request per model; `-- --full` sends 3 per model) before a deploy.

`.env.example` lists every name above as a placeholder (names only).

## Demo data on Atlas

`seed:demo`, `reset:demo` and `check:demo` run from your own machine against Atlas; they are not part of the deployed service. The seed writes several thousand documents (the seat maps alone are thousands) through the real services and needs a few minutes over the internet.

1. Use an **empty** database (a new Atlas database name in `MONGO_PROD`), or accept the risk with `DEMO_SEED_ALLOW_NON_DEMO_DB=true`: only records tracked in the `demo_seed_records` collection are ever removed, but a name clash with existing data stops the seed.
2. Run `npm run seed` once for the admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).
3. Export the settings in your shell only (not in a file): `NODE_ENV=production`, `ALLOW_DEMO_SEED=true`, `DEMO_SEED_CONFIRM=MONGO_PROD`, the four `DEMO_*_PASSWORD` values, `MONGO_PROD`, `SECRET_TOKEN`, `QR_SECRET`. The Atlas user needs `readWrite` on that database.
4. `npm run check:demo` first (read only) to see what is there, then `npm run seed:demo`; later `npm run reset:demo`. A failing rule of the check lists the offending events (id, title, the numbers compared), never personal data.
5. A failed seed names the scenario that failed and leaves its data; just run `npm run seed:demo` again (it removes the earlier run first). Moderation is skipped during the seed (#109).
6. Seeded events are in the future: run the seed again to refresh the dates. The seed sets `SEAT_HOLD_SECONDS=300` and `PAYMENT_MODE=simulated` for its own process only. Unset the variables afterwards.

## Upgrading to email verification (decision #135)

New sign-ups must verify their email before they can buy. Members that exist when this ships (demo members and admins included) must count as verified, or nobody could buy. Run the migration **once, right after the deploy** that adds the feature, before new people sign up:

```bash
npm run migrate:email-verified                                                          # 1. dry run: counts the members without a verified email
EMAIL_VERIFIED_MIGRATION_CONFIRM=MONGO_PROD NODE_ENV=production npm run migrate:email-verified -- --apply   # 2. run it
```

It sets `emailVerifiedAt` only on members that have none, so running it again changes nothing. Set `RESEND_API_KEY`, `MAIL_FROM` and `SITE_URL` first (the API refuses to start in production without them), and verify the sending domain at Resend (SPF and DKIM) or the mail will not arrive.

## Room around the pitch (decision #138)

Football stadium venues get a free band of 16 units between the pitch and every stand, for the run-off, advertising boards and dugouts. New venues from the template have it; venues stored earlier are moved by a one-off script. Run it **after** the deploy, with the owner. It touches only `x` and `y` of sections of PITCH venues (no seat, order or ticket depends on them) and prints each venue, section and old to new place.

```bash
NODE_ENV=production npm run migrate:stadium-surround                                                              # 1. dry run: read the list
STADIUM_SURROUND_MIGRATION_CONFIRM=MONGO_PROD NODE_ENV=production npm run migrate:stadium-surround -- --apply    # 2. run it
```

A venue marked "NEEDS A PERSON" is left untouched (exit code 1); fix its layout by hand. Running it again changes nothing.

## Upgrading member indexes (account deletion, decision #124)

A deleted account keeps its email, so the old rule "one member per email" (a unique index on `memberEmail` alone, and the same on `memberPhone`) is replaced by "one live member per email" (unique on `memberEmail` + `deletedAt`, and sparse unique on `memberPhone` + `deletedAt`). A **new** database needs nothing: the API builds the new indexes at its first start. An **existing** database (the demo database, production) still has the old indexes, and while they exist a deleted account's email cannot be used by a new account (the sign-up answers the duplicate message). The script `npm run migrate:member-indexes` swaps them:

- it creates the two new indexes first and drops the two old ones only after both exist, so there is never a moment without a uniqueness guarantee;
- it changes **indexes only**, never a document; running it again changes nothing; if a creation fails, nothing is dropped;
- the new indexes are looser than the old ones, so existing data can never violate them;
- without `--apply` it is a dry run that prints the plan. With `--apply` it refuses unless `MEMBER_INDEX_MIGRATION_CONFIRM` names the database variable in use. It prints index names and the variable name only, never a connection string. Dropping and creating indexes on a small `members` collection takes seconds; take an Atlas snapshot first if you want a restore point anyway.

The variable follows `NODE_ENV`: without `NODE_ENV=production` it uses `MONGO_DEV`, with it `MONGO_PROD` (the same rule as `npm run seed`). Put the connection string in `.env` (or the shell) as for the other scripts. Run it from your own machine; it is not part of the deployed service.

Demo database (when it is the one in `MONGO_DEV`):

```bash
npm run migrate:member-indexes                                                   # 1. dry run: read the plan
MEMBER_INDEX_MIGRATION_CONFIRM=MONGO_DEV npm run migrate:member-indexes -- --apply   # 2. run it
npm run migrate:member-indexes                                                   # 3. optional: every step should now say "keep"
```

Later, on production (Atlas, `MONGO_PROD`), before or right after the deploy of this version (the old code also works with the new indexes):

```bash
NODE_ENV=production npm run migrate:member-indexes
NODE_ENV=production MEMBER_INDEX_MIGRATION_CONFIRM=MONGO_PROD npm run migrate:member-indexes -- --apply
NODE_ENV=production npm run migrate:member-indexes
```

If the demo data lives in `MONGO_PROD` (as in "Demo data on Atlas"), use the production commands for it. Afterwards the `members` collection shows `memberEmail_1_deletedAt_1` and `memberPhone_1_deletedAt_1` and no longer `memberEmail_1` or `memberPhone_1`.

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
- The demo photos of `seed:demo` are served the same way from `/demo-images` (the folder `demo-images/` is committed in the repository, so Render has it after every deploy; the API reads it relative to the working directory, the repository root). Seeded events and venues store `demo-images/<name>.jpg`, which the frontend turns into `<API address>/demo-images/<name>.jpg`.

## Cold start (free tier)

- An idle free instance sleeps after about 15 minutes (the host's number) and needs roughly 30 to 60 seconds to wake. The first request may time out; the frontend retries.
- On boot the API validates the environment, connects to Atlas (up to 5 tries), builds indexes (unless `MONGO_AUTO_INDEX=false`) and then listens. `/health` answers as soon as it listens.
- Everything held in memory is lost when it sleeps: rate-limit counters (a visitor gets a fresh budget), WebSocket connections and chat rooms (clients reconnect). Counters that must survive live in MongoDB: the AI daily cap.
- A keep-alive ping to `/health` every 10 minutes from an external service stops the sleep, but uses free-tier hours.

## The batch process

The batch app runs four jobs: ranks (hourly: events at 20 seconds and organizers at 40 seconds past the full hour, `'20 00 * * * *'` and `'40 00 * * * *'`), order and seat-hold expiry (every minute), ending finished events (minute 30). Options:

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

User-uploaded images are written to `./uploads` on the instance's disk. On Render's free tier the disk is **ephemeral**: it is erased on every deploy, restart and spin-down, while the database keeps the image paths, so organizer images show as broken. Seeded demo events are not affected (their photos are committed in `demo-images/`, which is part of every deploy). Options are compared in the task report; the recommended one is Cloudinary's free tier uploaded through its REST API (the frontend already accepts absolute `https://` image URLs). Not implemented.

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
- [ ] Existing database: `npm run migrate:member-indexes -- --apply` run once (see "Upgrading member indexes").
- [ ] Email: `RESEND_API_KEY`, `MAIL_FROM`, `SITE_URL` set, sending domain verified at Resend, `npm run migrate:email-verified -- --apply` run once (see "Upgrading to email verification").
- [ ] Admin created with `npm run seed`; `ADMIN_PASSWORD` removed from the host afterwards.
- [ ] Render health check path is `/health`.
- [ ] After deploy: `GET /health` is 200, `GET /ready` is 200, GraphQL `introspection` is refused, a login with a wrong password 11 times in a row answers `RATE_LIMITED`.
- [ ] Decided what to do about uploads (ephemeral disk) and the batch process.
- [ ] Demo only: `SEAT_HOLD_SECONDS=300`, and the frontend shows that payments are simulated.
