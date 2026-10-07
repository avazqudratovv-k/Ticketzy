# Next Steps (priority order)

First, resolve the open questions in `DECISIONS.md` (full rename vs. keep internals, preserve data, milestone scope). They change tasks B3 onward.

## Backend cleanup

| # | Task | Why |
|---|---|---|
| ~~B1~~ (done) | `rm -rf dist`, then rebuild both apps | remove stale `nestar-*` output |
| ~~B2~~ (done) | Run `npm install --package-lock-only` and check the lockfile diff | the lockfile name was edited by hand |
| ~~B3~~ (done) | Decouple `LikeService`/`ViewService`/`CommentService` from the old catalog's DTOs and service | prerequisite for replacing it |
| ~~B4~~ (done) | Fix `Like.model.ts` (uses `ViewGroup` as its enum) and make `*Group` enums entity-agnostic | correctness plus decoupling |
| ~~B5~~ (done) | Replace the old catalog with Event, Venue, TicketType (schemas, DTOs, resolver, service) | core domain |
| ~~B6~~ (done) | Add Order and Ticket with atomic inventory (conditional `findOneAndUpdate`); issue ticket codes | selling tickets |
| ~~B7~~ (done) | `MemberType.AGENT` renamed to `ORGANIZER`, statuses PENDING / ACTIVE / REJECTED / SUSPENDED / DELETE (DECISIONS #13, #23 to #25) | role change |
| ~~B8~~ (done) | Rewrite batch ranking jobs for events and organizers; set a sane cron cadence (currently every minute) | batch app |
| B9 | Security: ~~validate the upload `target` (path traversal)~~ (done, whitelist `member`, `event`, `venue`); ~~null-check `authMember` in `RolesGuard`~~, ~~`ValidationPipe({ whitelist: true })`~~, ~~playground off and CORS restricted in production~~ (all done, COMPLETED_TASKS section 9); still open: refresh tokens, rate limiting, the admin approve and reject flow for organizers (today `updateMemberByAdmin` sets `memberStatus`) | issues found during exploration |
| ~~B10~~ (done) | Wire `Notice` and `Notification` modules | done, see COMPLETED_TASKS section 8 |

## New backend follow-ups
| # | Task | Why |
|---|---|---|
| N1 | Replace `MockPaymentProvider` with a real provider (bind it in `PaymentModule`; capture through a webhook instead of the synchronous `charge`; drop or ignore `simulate`) | anyone can still pay their own order for free (DECISIONS #48) |
| N2 | Run the concurrency test for `TicketTypeService.reserve` against a real MongoDB (two parallel orders for the last ticket) | the unit tests use mocks and cannot prove atomicity |
| N3 | Smoke-test the new operations against a dev DB and drop the old `likes` / `views` unique indexes (`memberId_1_likeRefId_1`, `memberId_1_viewRefId_1`) | schema change is not applied to existing indexes |
| N4 | Decide whether to drop the orphaned collection and upload folders of the old catalog (everything under `uploads/` except `member`, `event`, `venue`) | left untouched on purpose |
| N5 | Refund / cancel for PAID orders (`REFUNDED` status exists, no flow); fill `EventService.refundOrdersForCancelledEvent`, which `cancelEventByAdmin` already calls | not built |
| N6 | Admin-side listing of venues and ticket types, delete flows for both | only create, update and public reads exist |

| N7 | Data update before the next deploy: give existing members a `memberEmail`, change `memberType: 'AGENT'` to `ORGANIZER` and `memberStatus: 'BLOCK'` to `SUSPENDED`, then let the unique `memberEmail` index build; run `npm run seed` | the enums and the schema changed |
| ~~N8~~ (done) | Agent-named operations renamed to organizer names (DECISIONS #27) | frontend-visible |
| N9 | Frontend: new signup and login inputs, JWT no longer holds the profile, new enum values | breaking API change |
| N10 | Clean leftovers of the removed board in the database: the board collection, `likes` / `views` with group ARTICLE, `comments` with group MEMBER or ARTICLE, `notifications` with group ARTICLE, `uploads/article/` | the code no longer reads them |
| ~~N11~~ (done) | The organizer-must-be-ACTIVE rule now covers `getTicketTypes` and `createOrder` (DECISIONS #34) | closed the DECISIONS #30 gap |
| ~~N12~~ (done, DECISIONS #47) | Use `commissionOverride` and a default rate when orders are priced; still open: an operation to clear an override, audit USER status changes | |
| N13 | `shapeIntoMongoObjectId` throws the raw BSON error for a malformed id (visible in every operation that takes an id); answer a clean `BAD_REQUEST` instead | leaks library text |
| N14 | Existing orders of events whose organizer was suspended before this change are not cancelled or refunded | not built |
| N15 | Data update before the next deploy: set `eventStatus` of existing events to `APPROVED` (was PUBLISHED, ON_SALE or SOLD_OUT), `ENDED` (was FINISHED) or `CANCELLED`; remove events with status DELETE; existing members get `completedEvents` 0 by default | the status enum changed (DECISIONS #35) |
| N16 | Fill `eventModeration` (AI moderation) and decide whether it should block submit or only flag; tell admins when an organizer submits an event (no notification exists for that yet) | stored only |
| N17 | Editing ticket types of an APPROVED event does not send it back to review | known gap in #36 |
| N18 | Data update before the next deploy: existing orders with `orderStatus: 'PENDING'` become `PENDING_PAYMENT` (or EXPIRED), and they need `subtotal`, `commissionRate`, `commissionAmount` (required now; `subtotal` = `totalAmount`, rate 10, amount computed). Existing tickets have no `qrToken` (required): backfill with `signQrToken(_id)` | the Order and Ticket schemas changed (DECISIONS #46, #49) |
| N19 | Run the seat-hold race against a real MongoDB (two parallel `holdSeats` for one seat, two parallel `payOrder`); the unit tests use an in-memory model with the same atomic semantics | mocks cannot prove the real query operators |
| N20 | ~~Gate scanning and `soldQuantity`~~ done, see COMPLETED_TASKS section 15 and DECISIONS #52, #53, #57 | done |
| N21 | The `Venue` layout lock is two steps (check, then update) and is skipped when `venueLayout` is absent; decide whether to compare layouts instead of refusing on presence | DECISIONS #51 |
| N22 | Real refunds need a real provider: `MockPaymentProvider.refund` does nothing. When one is chosen, `PaymentService.refundOrder` already claims the payment and calls the provider once; check partial refunds and provider webhooks | DECISIONS #54 |
| N23 | Run the refund races against a real MongoDB (two parallel `requestRefund`, a refund against a scan, the unique `orderId` index on `refunds`, cancel with a re-run); the tests use the in-memory model | like N19 |
| N24 | Schedule a retry for FAILED refunds of a cancelled event (the batch app could call the same loop), and show admins which orders failed; today `retryEventRefundsByAdmin` is manual | DECISIONS #56 |
| N25 | Existing tickets have the old bare-HMAC `qrToken` and cannot be scanned; re-issue them if any real data exists. The scanner client must send `qrToken` (and optionally `eventId`) instead of `ticketCode` | DECISIONS #52 |
| N26 | Smoke-test messaging against a dev DB and a real WebSocket client: the two partial unique indexes on `conversations`, the lookups of `getConversation`, header auth and first-message auth, the `Authorization` header is not sent by browsers so the frontend must use the `auth` message. Decide whether REJECTED and SUSPENDED organizers should read notifications (they cannot today, DECISIONS #58) and whether a conversation list needs a per-member socket room for live badges | DECISIONS #58, not run live |

## Frontend migration
(See `FRONTEND_MIGRATION.md`.)

| # | Task |
|---|---|
| F1 | Locate the Next.js repo and inventory pages and GraphQL documents |
| F2 | Rebrand strings, then add the terminology constants |
| F3 | Migrate the old catalog pages to the Event operations (no aliases exist) |
| F4 | Build ticket selection, checkout, my tickets |

## Testing

| # | Task |
|---|---|
| T1 | Start the API and compare schema introspection with the pre-rename schema (expect no diff) |
| T2 | Smoke-test login, `getEvents` and image upload against a dev DB |
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
