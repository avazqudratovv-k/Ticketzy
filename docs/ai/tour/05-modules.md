# 05 - Modules, services and the machinery around them

**What this file covers.** What each NestJS module and service is responsible for, its main methods and what it depends on; then the pieces that deserve their own explanation: the batch (cron) app and each of its jobs, the WebSocket gateway and its events, image upload handling and storage paths, QR token generation and the check-in rule that blocks double scans, the AI module (providers, tools, caps, fallback chain, moderation), the payment seam (`PAYMENT_MODE`), and notifications (which are in-app only: the backend sends no email). Paths start at `apps/ticketzy-api/src/` unless written otherwise.

**NestJS in five lines.** A *module* groups related classes (`@Module({ imports, providers, exports })`). A *provider* (usually a *service*, `@Injectable()`) is a class that Nest builds once and *injects* into constructors that ask for it by type. A *resolver* exposes GraphQL operations. A *guard* decides whether a request may continue. `@InjectModel('Event')` injects the Mongoose model of a collection registered with `MongooseModule.forFeature`. Modules only see providers that another module `exports` and that they `imports`.

---

## 1. The module map

`AppModule` (`app.module.ts`) imports `ConfigModule.forRoot({ validate })` (environment check), `GraphQLModule.forRootAsync` (Apollo), `ComponentsModule` (the 22 feature modules), `DatabaseModule` (Mongo connection) and `SocketModule` (WebSocket). Controllers: `AppController`, `HealthController`.

`DatabaseModule` (`database/database.module.ts`) connects with `MongooseModule.forRootAsync`: URI from `process.env[getMongoUriKey()]`, options from `libs/mongo-options.ts`: `serverSelectionTimeoutMS 8000`, `connectTimeoutMS 10000`, `socketTimeoutMS 45000`, `maxPoolSize 10`, `retryAttempts 5`, `retryDelay 3000`, `autoIndex` from `MONGO_AUTO_INDEX`, and `bufferTimeoutMS 8000` set through `connectionFactory`. It logs `MongoDB disconnected` / `reconnected` at warn level (the only trace of an outage in a quiet production log).

Feature modules, what they import (from `components/*/*.module.ts`), and what they export:

| Module | Imports (besides Mongoose models) | Exports | Responsibility |
|---|---|---|---|
| `AuthModule` | `HttpModule`, `JwtModule` (secret `SECRET_TOKEN`, 1 day) | `AuthService` | tokens and member loading; the guards are plain classes that take `AuthService` |
| `MemberModule` | Auth, View, Like, AuditLog | `MemberService` | accounts, profiles, uploads, admin member edits |
| `OrganizerModule` | Auth, AuditLog, Notification, Conversation | none | organizer approval and commission override |
| `VenueModule` | Auth | `VenueService` | venues and layouts |
| `EventModule` | Auth, View, Member, Like, Notification, AuditLog, Refund, Ai | `EventService` | event lifecycle |
| `TicketTypeModule` | Auth | `TicketTypeService` | price tiers and atomic stock |
| `SeatModule` | Auth | `SeatService` | seat holds |
| `PaymentModule` | none | `PaymentService` | provider seam, `Payment` records |
| `OrderModule` | Auth, TicketType, Seat, Payment, Notification | `OrderService` | checkout and payment |
| `TicketModule` | Auth | `TicketService` | ticket reads and check-in |
| `RefundModule` | Auth, Payment, Seat, TicketType, Notification, AuditLog | `RefundService` | refunds |
| `SalesModule` | Auth | `SalesService` | organizer sales numbers |
| `PayoutModule` | Auth, Notification, AuditLog | `PayoutService` | payouts |
| `NoticeModule`, `NotificationModule`, `AuditLogModule` | Auth (+AuditLog for notice) | their services | notices, in-app notifications, audit trail |
| `CommentModule` | Auth, Event, Notification, AuditLog | none | comments on events |
| `LikeModule`, `ViewModule` | none | their services | like toggling, view recording (no resolvers) |
| `FollowModule` | Auth, Member | `FollowService` | follow organizers |
| `ConversationModule` | Auth, Notification, AuditLog | `ConversationService`, `ConversationRealtime` | chat logic and live rooms |
| `AiModule` | Auth, AuditLog | `AiClientService`, `AiModerationService` | AI features |
| `SocketModule` | Auth, Conversation | none | WebSocket gateway |

Notice the dependency direction: `EventModule` depends on `RefundModule` (to refund when it cancels) and `AiModule` (to moderate on submit), and `CommentModule` depends on `EventModule` (for the comment counter). The AI and refund modules do not depend back on events (they use the `Event` Mongoose model directly).

---

## 2. Services: responsibility and main methods

### Auth (`components/auth`)

- `AuthService`: `hashPassword`, `comparePasswords` (compares against a dummy hash for unknown emails), `createToken`, `verifyToken` (never leaks JWT library errors), `authenticate(token, { allowRestricted })`, `loadMember` (also used by sockets), `getBearerToken`.
- Guards: `AuthGuard`, `RolesGuard`, `WithoutGuard`, `ActiveOrganizerGuard`, `NotificationGuard`, `ConversationGuard`; decorators `@Roles`, `@AuthMember`. They put the loaded member on `request.body.authMember`.

### Member and organizer

- `MemberService`: `signupUser`, `signupOrganizer`, `login`, `updateMember`, `getMember`, `getOrganizers`, `likeTargetMember`, `getAllMembersByAdmin`, `updateMemberByAdmin`, `memberStatsEditor` (the generic counter `$inc`), `checkSubscription`. Also hides stored counts: `useVisibleEventCount` replaces `memberEvents` on organizer profiles with the number of APPROVED events.
- `OrganizerService`: `getOrganizersByAdmin`, `verify/reject/suspend/reinstateOrganizerByAdmin` (via one private `changeStatus`), `setCommissionOverrideByAdmin`, `clearCommissionOverrideByAdmin`. Depends on `ConversationRealtime` to cut sockets off.

### Catalog

- `VenueService`: `createVenue`, `getVenue`, `updateVenue`, `getVenues`; pure helpers in `libs/venue-layout.ts`.
- `EventService` (753 lines, the largest): `createEvent`, `getEvent`, `getEvents`, `getMyEvents`, `updateEvent`, `submitEventForApproval`, `getEventSeatMap`, `likeTargetEvent`, `getFavorites`, `getVisited`, and the admin side `getEventsByAdmin`, `approveEventByAdmin`, `rejectEventByAdmin`, `cancelEventByAdmin`, `cancelMyEvent`, `updateEventByAdmin`, `removeEventByAdmin`. Private: `applyUpdate`, `changeStatusByAdmin`, `generateEventSeats`, `assertVenueFree`, `refundOrdersForCancelledEvent`. Exported pure function `getEventSubmitError`.
- `TicketTypeService`: `createTicketType`, `updateTicketType`, `getTicketTypes`, `reserve`, `release`, `addSold`, `findSellable`, `sweepStaleOrders`.
- `libs/venue-conflicts.ts` (pure helpers + `attachPossibleVenueConflicts`, two queries for a whole page).

### Selling

- `SeatService`: `holdSeats`, `releaseSeats`, `resolveSeatInput`, `getSeatConfig`, `findHeldSeats`, `markSold`, `revertSold`, `releaseOrderSeats`, `releaseSoldSeats`.
- `OrderService`: `createCheckout`, `payOrder`, `cancelPendingOrder`, `getOrder`, `getMyOrders`, `getMyEventOrders`, `getAllOrdersByAdmin`.
- `PaymentService`: `charge`, `record`, `refund`, `refundOrder`, `deleteRecords`.
- `TicketService`: `getMyTickets`, `getTicket`, `checkInTicket`, `checkInPreview`, `checkInTicketByCode`, `checkInPreviewByCode` (the two code methods and the two QR methods share `assertScannable` and `markUsed`).
- `RefundService`: `getRefundQuote`, `requestRefund`, `refundOrderByAdmin`, `refundOrdersForCancelledEvent`, `retryEventRefundsByAdmin`.
- `SalesService`: `getEventSales`, `getEventAttendees`, `getMyEarnings`.
- `PayoutService`: `getMyPayouts`, `getPayoutsByAdmin`, `markPayoutPaidByAdmin` (the aggregation pipeline is built by `buildPayoutPipeline` in `libs/payout.ts`).

### Community and support

- `CommentService`, `LikeService.toggleLike/checkLikeExistence/getFavoriteEvents`, `ViewService.recordView/getVisitedEvents`, `FollowService`.
- `NoticeService`, `NotificationService`, `AuditLogService` (details below).
- `ConversationService` and `ConversationRealtime` (chat; details below).

---

## 3. The batch app (`apps/ticketzy-batch`)

A second NestJS application in the same monorepo (`nest-cli.json` project `ticketzy-batch`). It has no GraphQL. `main.ts` creates `BatchModule`, enables shutdown hooks and listens (so a host that wants a web port is satisfied) on `PORT`, then `PORT_BATCH`, then 3000. `BatchModule` imports `ConfigModule.forRoot({ validate: validateEnv() })`, its own `DatabaseModule` (**`autoIndex: false`**: the API owns the indexes), `ScheduleModule.forRoot()` and registers five Mongoose models (Event, Member, Order, TicketType, EventSeat). `BatchController` holds the schedules (`@Cron`), `BatchService` the work. `GET /` answers a hello text; `@Timeout(1000)` logs "BATCH SERVER READY!".

| Job (constant) | Cron expression in code | Method | What it does |
|---|---|---|---|
| `BATCH_TOP_EVENTS` | `'20 00 * * * *'` | `batchTopEvents` | rank of every APPROVED event = `eventLikes * 2 + eventViews` (`apps/ticketzy-batch/src/lib/rank.ts`, `getEventRank`); only changed ranks are written, in `bulkWrite` chunks of 500 |
| `BATCH_TOP_ORGANIZERS` | `'40 00 * * * *'` | `batchTopOrganizers` | rank of every ACTIVE organizer = `memberEvents * 5 + memberLikes * 2 + memberViews` (`getOrganizerRank`) |
| `BATCH_EXPIRE_ORDERS` | `'10 * * * * *'` | `batchExpireOrders` | `expireStaleOrders(models)` then `releaseExpiredSeatHolds(models)` from `libs/order-expiry.ts` |
| `BATCH_END_EVENTS` | `'00 30 * * * *'` | `batchEndEvents(onlyEventIds?)` | APPROVED events with `endAt <= now` (up to 500 per run) become ENDED with a conditional update; the organizer's `completedEvents` goes up by one (an increment failure is logged, not retried) |
| `BATCH_DUE_PAYOUTS` | `'00 50 * * * *'` | `batchNotifyDuePayouts` | DUE payouts whose event has no `payoutDueNotifiedAt`: claim with a conditional update, then one `PAYOUT_DUE` notification to the organizer and one to each active admin; payouts due more than 7 days ago are only claimed (#119). Needs the `Notification` model in the batch module |

Each controller method wraps its call in try/catch and logs the error, so one failing job never stops the schedule. The decision text says ranks are computed first and written after, so a rank is never zero in between (#96; the old rollback job that zeroed ranks is gone). `batchEndEvents(onlyEventIds)` takes an id list so the demo seeder can end only its own events.

**The crontab detail (see oddities).** `@nestjs/schedule` cron strings with six fields are `second minute hour day month weekday`. So `'20 00 * * * *'` means second 20 of minute 0 of every hour (hh:00:20), and `'40 00 * * * *'` is hh:00:40, **not** "minute 20" and "minute 40" (the wording the comments, `AGENTS.md` and `RUN_IN_PRODUCTION.md` used to have; corrected in decision #118). `'10 * * * * *'` (second 10 of every minute) and `'00 30 * * * *'` (hh:30:00) match their descriptions.

**If the batch app never runs** (it may sleep on a free host), `RUN_IN_PRODUCTION.md` says: expiry is done by the API itself (decision #102); events stay APPROVED after `endAt`, `completedEvents` stops growing so commission tiers do not advance; ranks go stale.

Shared code: the batch app imports the API's schemas, DTO classes, enums, `env.validation`, `mongo-options` and `libs/order-expiry.ts` through absolute paths that start with `apps/ticketzy-api/src/...` (decision #4), so the two apps are built from one repository and cannot be deployed from separate folders without that source.

---

## 4. WebSocket gateway (chat)

Files: `socket/socket.gateway.ts` (`SocketGateway`), `components/conversation/conversation.realtime.ts` (`ConversationRealtime`), registered with `WsAdapter` in `main.ts` (library `ws`, not socket.io, although `@nestjs/platform-socket.io` is in `package.json`). `@WebSocketGateway({ transports: ['websocket'], secure: false })`: the same port as the HTTP server; TLS comes from the host's proxy.

**Authentication** (the token is never in the URL):

1. If the upgrade request has `Authorization: Bearer <token>`, it is verified at once.
2. Otherwise the client has `AUTH_TIMEOUT_MS = 10000` to send `{ "event": "auth", "data": { "token": "..." } }` (browsers cannot set headers on a WebSocket). Silence closes the socket with code 4408; a bad token closes it with 4401.
3. `authenticateClient` calls `AuthService.authenticate(token, { allowRestricted: true })` and requires `ORGANIZER` or `ADMIN` (`ONLY_SPECIFIC_ROLES_ALLOWED`), then registers the socket in `ConversationRealtime` and sends `authenticated`.

**Client to server events**: `auth`, `joinConversation { conversationId }`, `leaveConversation { conversationId }`, `typing { conversationId, isTyping }`.
**Server to client events**: `authenticated`, `joined`, `left` (also sent with `reason` when a restriction removes a socket from a room), `message`, `unread`, `read`, `typing`, `error { message }`.

Rules:

- Every action reloads the member (`run` -> `loadMember`) and refreshes the socket's `restricted` flag (an organizer who is not ACTIVE is restricted), so a rejection takes effect on the next action.
- A socket can only join a room after `ConversationService.assertConversationAccess` approves; `ConversationRealtime.join` refuses non-support rooms for restricted sockets.
- Messages are **sent with the GraphQL mutation `sendMessage`**, not over the socket. The service then calls `realtime.emitToRoom(id, 'message', ...)` and `emitUnread`. Typing events are limited to 30 per 10 s per member.
- Rooms: one private room per conversation (`rooms: Map<conversationId, Set<WebSocket>>`). `emitUnread` sends each socket the counter of its own side. `ConversationRealtime.send` skips restricted sockets for non-support rooms as a last defence.
- The room state lives in process memory. After a server restart clients reconnect and re-join.
- A client that is not in any room hears nothing, so lists must be refreshed by polling `getMyConversations` or the notification count (decision #58).

---

## 5. Uploads and storage paths

- Operations: `imageUploader(file, target)` and `imagesUploader(files, target)` in `components/member/member.resolver.ts` (they live in the member module although they are generic). `target` must be in `validUploadTargets` = `['member', 'event', 'venue']` (`libs/config.ts`). `imagesUploader` calls `saveVerifiedImages`, which is all or nothing: files are verified and stored, and when any one fails the files already written in that request are deleted and the first error is thrown (decision #117). The frontend only uses the single-file `imageUploader`.
- Chain: Express `createUploadAuthMiddleware` (token required for any `multipart/*` before parsing) -> `graphqlUploadExpress({ maxFileSize: UPLOAD_MAX_FILE_MB * 1,000,000, maxFiles })` -> `AuthGuard` -> `saveVerifiedImage(stream, target)`.
- `saveVerifiedImage` reads the first 8 bytes and accepts only the PNG signature (`89 50 4E 47 0D 0A 1A 0A`) or the JPEG signature (`FF D8 FF`); the client's filename and MIME type are ignored. It creates `uploads/<target>/` if needed and writes `uploads/<target>/<uuid v4><.png|.jpg>` with a stream pipeline; on a write error the partial file is deleted and `UPLOAD_FAILED` is thrown. The returned string is the relative path; the stored value in documents is that path.
- Files are served by `express.static('./uploads')` at `/uploads` (relative to the working directory), and `express.static('./demo-images')` at `/demo-images`. Both with `Cross-Origin-Resource-Policy: cross-origin` from helmet settings.
- The local `uploads/` folder contains sub-folders `article`, `event`, `member`, `property` and `venue`; `article` and `property` are left over from the Nestar days (decision #27, #18).
- Production caveat (`RUN_IN_PRODUCTION.md`): Render's free disk is ephemeral, so uploaded images vanish on redeploy while the database keeps the paths. Not solved; Cloudinary is suggested. Demo images are committed in `demo-images/` so they survive.
- Image paths are stored in `eventImages` / `venueImages` / `memberImage`; nothing validates that a path in those fields points to an upload the caller made (any string is accepted, the frontend accepts absolute https URLs too).

---

## 6. QR tickets

**Library.** None. Node's built-in `crypto` (`createHmac`, `timingSafeEqual`) in `libs/qr-token.ts`. The backend never renders a QR image.

**What is encoded.** The QR carries the text `qrToken = "<ticketId>.<signature>"`, where `ticketId` is the 24-hex ObjectId of the ticket and `signature` is `HMAC-SHA256(ticketId, QR_SECRET)` in lower-case hex (64 characters). Functions: `signQrToken(ticketId)`, `buildQrToken(ticketId)`, `verifyQrToken(ticketId, signature)` (constant-time compare), `parseQrToken(token)` (regex `^([a-f0-9]{24})\.([a-f0-9]{64})$` and signature check; returns the ticket id or `null`). The ticket id is inside the token so that the signature can be verified *before* any database access (decision #52).

**Stored or generated on demand?** Generated **once**, at payment time, and **stored** on the ticket: `OrderService.buildTickets` creates the ticket `_id`, calls `buildQrToken(_id)` and inserts the document with `qrToken` (required in `Ticket.model.ts`). Reads (`getMyTickets`, `getTicket`) return the stored text to the owner. Nothing regenerates it.

**How check-in validates it** (`TicketService.validateScan`, then `checkInTicket`): signature check without database, then `findOne({ _id, qrToken })` so the stored text must equal the scanned text, then event, organizer and status checks (details in Flow 10 of `01-flows.md`).

**How double scans are blocked.** The last step is the conditional `findOneAndUpdate({ _id, ticketStatus: VALID }, { ticketStatus: USED, checkedInAt })`. A second scan finds no `VALID` ticket and answers `TICKET_ALREADY_USED`. `checkInPreview` runs the same checks and writes nothing (a preview of a used ticket is an error, not a "used at 12:03" answer; decision #53).

**Security properties and limits.** The token is useless without `QR_SECRET`; a forged id is detected by the signature; a copied screenshot of a valid code works until the ticket is used (any bearer of the text can be scanned once). Rotating `QR_SECRET` invalidates all issued tickets (`RUN_IN_PRODUCTION.md`). `ticketCode` (20 hex characters) is a separate random value shown to people. The signed token is the normal gate path; since decision #116 the code is accepted too, but only through `checkInTicketByCode` / `checkInPreviewByCode` with an event id (a code alone is never enough), rate limited to 60 per minute per organizer.

---

## 7. AI module (`components/ai`)

Switched on by `AI_ENABLED=true` plus a key for the selected provider. Everything is read at call time, so a missing key only turns the AI operations off with a clear message; the rest of the app keeps working (`AiClientService.assertAvailable`).

**Classes.**

| Class | File | Role |
|---|---|---|
| `AiClientService` | `ai-client.service.ts` | the only gateway to a model vendor: availability, per-minute limit, daily caps, retry, model chain, error mapping, per-attempt log line |
| `AiUsageService` | `ai-usage.service.ts` | daily counters in MongoDB (`ai_usage`) |
| `AiAssistantService` | `ai-assistant.service.ts` | the chat assistant with tool calling |
| `AiToolsService` | `ai-tools.service.ts` | the four backend tools the model may call |
| `AiModerationService` | `ai-moderation.service.ts` | flags a submitted event |
| `AiTranslationService` | `ai-translation.service.ts` | suggests translations |
| `AiProvider` interface | `providers/ai-provider.ts` | `generateText`, `generateJson`, `chat` |
| `AnthropicProvider`, `GeminiProvider` | `providers/*.provider.ts` | vendor adapters, chosen by `createAiProvider` from `AI_PROVIDER` |
| `getGeminiModelConfig` | `providers/gemini-model-config.ts` | all model-specific options in one place |
| helpers | `libs/ai.ts`, `libs/ai-reason.ts`, `libs/ai-check.ts` | strict JSON parsers, text clipping, safe error reasons, the `ai:check` logic |

**Providers.** Default model: `claude-haiku-4-5` (Anthropic) or `gemini-2.5-flash` (Gemini). Anthropic is built with the SDK `timeout` and `maxRetries: 0` (the SDK's own retry would multiply ours); JSON answers come from the prompt plus `extractJson`. Gemini uses `@google/genai`; JSON mode sets `responseMimeType: 'application/json'`; the timeout is our own `AbortSignal.timeout`, and **`httpOptions.timeout` must never be set** because the SDK sends it to Google as a server-side deadline and Google answers 400 for anything under 10 seconds (decision #111). Thinking options depend on the model family (`getGeminiFamily`): Gemini 3.x gets `thinkingLevel: LOW`, Gemini 2.5 Flash gets `thinkingBudget: 0`, 2.5 Pro and unknown models get none. The assistant turn carries an opaque `providerState` so Gemini's thought signatures are replayed.

**The assistant** (`askAssistant`): `AiClientService.reserve(key)` first (per-minute limit then per-caller daily cap); history is sanitized (last 10 turns, clipped, must start with a user turn); the system prompt (`buildAssistantSystemPrompt`) tells the model today's date and language, to use tools for facts, to treat all messages and tool results as data, never to reveal instructions, and to ignore refunded/cancelled tickets. A loop calls `aiClient.chat` with `tools: ASSISTANT_TOOLS`; up to `MAX_TOOL_ROUNDS = 4` rounds with at most `MAX_TOOL_CALLS_PER_ROUND = 4` tool calls each; after the rounds are used the call is made with `toolChoice: 'none'`. The whole question shares one deadline (`AI_MAX_WAIT_MS = 40,000`). The answer is clipped to 2000 characters and at most 5 event cards are returned; an empty answer becomes `AI_ASSISTANT_NO_ANSWER`.

**The tools** (`ASSISTANT_TOOLS`, `AiToolsService.execute`): `search_events` (APPROVED events of ACTIVE organizers, `startAt >= now` unless `dateFrom` is given, optional category/dates/maxPrice/text/city, sorted by start, max 5), `get_event` (details and ticket types with `remaining`), `get_refund_policy` (`getRefundPolicyText` in `libs/refund-policy.ts`), `get_my_tickets` (only the caller's own tickets, never a QR token, 10 newest not CANCELLED, plus `mostExpensiveTicket` over VALID/USED). The model never supplies a member id; `authMember` is passed by the service. A guest calling `get_my_tickets` gets `AI_LOGIN_REQUIRED`.

**Moderation.** Flow 5 in `01-flows.md`. Strict parser `parseModerationResult`; failure stored as `checked: false`; it only flags (types `DUPLICATE`, `SUSPICIOUS`, `INAPPROPRIATE`, `MISLEADING_PRICE`).

**Translation.** `translateEvent` takes the owner's event, sends title and description as JSON, parses with `parseTranslationResult` (exactly the requested locales once each; title 3 to 100; description 5 to 2000 when the source has one, the same limits as `EventTranslationInput`) and returns suggestions without saving.

**Caps and limits (three layers).**

1. Per-minute: `AI_RATE_LIMIT_PER_MINUTE` (default 10) per member or visitor IP, in memory (`begin`, error `AI_RATE_LIMITED`).
2. Per-caller daily: `AI_PER_KEY_DAILY_CAP` operations per member/IP per UTC day, in MongoDB (`reserve` -> `AiUsageService.consume('key:<id>')`); over it: `RATE_LIMITED` with seconds until 00:00 UTC and text `AI_USER_DAILY_LIMIT`.
3. Global daily: `AI_DAILY_CAP` **model calls** of the whole app per UTC day (`chargeModelCall` -> `consume('global')`); every attempt counts, including a retry and a fallback model; `AI_DAILY_CAP_REACHED` (HTTP 429) over it. `0` turns the AI off.
Both daily counters **fail closed**: when MongoDB cannot be read the request is refused with `SERVICE_UNAVAILABLE`. A client built without the usage service (unit tests) has no daily caps. Log lines carry counts only (at 80 percent and at the cap, one refusal line per minute).

**The fallback chain** (`AiClientService.run`, decisions #85, #111, #114, #115). The chain is `[AI_MODEL, ...GEMINI_FALLBACK_MODELS]` (fallbacks exist for Gemini only, at most 3, ordered).

- The main model gets one retry (`runWithRetry`) after 1 second (`AI_RETRY_DELAY_MS`) when the failure is a timeout, 503 or 504 and enough time is left.
- A **429** on a model marks it out of quota for 30 minutes in memory (`AI_QUOTA_COOLDOWN_MS`, `quotaUntil` map) and the chain moves on at once without a retry; marked models are skipped without a network call.
- 400, 404, 500, 503, 504 and timeout move to the next model (each fallback gets one try). 401 and 403 stop the chain (the same key would fail everywhere).
- All attempts together stay inside the deadline (`AI_MAX_WAIT_MS = 40,000`); an attempt with less than `AI_MIN_ATTEMPT_MS = 3000` left is not started; the attempt timeout is `min(AI_TIMEOUT_MS, time left)`.
- Outcome mapping: every model out of quota with no other failure -> `AI_QUOTA_EXHAUSTED` (`CodedException`, 503); invalid JSON -> `AI_INVALID_RESPONSE`; timeout/503/504/429 -> `AI_BUSY` (`ServiceUnavailableException`); anything else -> `AI_REQUEST_FAILED`.
- Every attempt logs one line: provider, model, milliseconds, outcome. Never the key, the prompt or the answer. Provider errors are reduced to kind, status and class name; `sanitizeProviderReason` (`libs/ai-reason.ts`) strips key-shaped text and long quotes from vendor messages.

**Prompt-injection stance.** Event text goes to the model as one JSON user message and the system prompt calls it untrusted data; model answers are parsed strictly and only known fields are copied; moderation only flags; the assistant has no write tools.

**`npm run ai:check`** (`ai-check.ts` + `libs/ai-check.ts`) loads `.env`, prints AI settings (key as set/not set), and sends 1 tiny request to the primary and each fallback model (`-- --full` sends 3 real-shaped requests per model). These are real calls with the key from `.env`.

---

## 8. Payment seam (`PAYMENT_MODE`)

- Interface `PaymentProvider` (`components/payment/payment.provider.ts`): `name`, `charge(request) -> { success, providerRef, failureReason? }`, `refund(providerRef)`. Injection token `PAYMENT_PROVIDER`.
- `PaymentModule` binds `{ provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider }`. The comment in that file says to swap `useClass` for a real provider. `PaymentService` only talks to the interface.
- `MockPaymentProvider.charge` returns success unless `simulate === FAILURE`; `refund` does nothing. Enum values `STRIPE`, `PAYME`, `CLICK` exist for the future.
- `PAYMENT_MODE` (`libs/env.validation.ts`, `parsePaymentMode`): `simulated` or `disabled`; unset means `simulated` outside production and a startup error in production; any other value is a startup error. The check is in `OrderService.payOrder` (`getPaymentMode() === 'disabled'`): a `GraphQLError(PAYMENTS_DISABLED, code SERVICE_UNAVAILABLE)`.
- The honest summary: with `simulated`, any buyer can mark their own order as paid. A real provider would charge first and the amount, `simulate` flag and webhook handling would have to be redesigned around it.

---

## 9. Notifications, audit log, notices (no email)

- **Notifications** (`NotificationService`): `createNotification(input)` inserts a `Notification` and **never throws** (a failed notification is logged, decision #22). Likes, comments and new-message notifications are not sent to oneself (`selfNotifiedTypes`); system types such as `ORDER_PAID` may go to the author. Callers: organizer/event/refund/payout/payment/conversation services. Reads: `getMyNotifications` (author joined), `getUnreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead` under `NotificationGuard`.
- **Payout and approval notices (#119, #120):** `PAYOUT_PAID` is sent by `markPayoutPaidByAdmin`; `PAYOUT_DUE` (group EVENT, `eventId` set, author = the organizer) by the batch job to the organizer and each active admin; approval sends `ORGANIZER_VERIFIED` (group MEMBER). A pending organizer learns of an approval by polling `getMyAccountState` (no socket event: sockets are in process memory, exist only on chat pages and miss approvals made in another process, #59).
- **Email:** none. There is no mail library, no mail setting and no code path that sends mail (`RUN_IN_PRODUCTION.md`, "Emails"); there is no password-reset flow. Notifications are in-app records only. The `EVENT_REMINDER` type exists but only the demo seeder creates one.
- **Audit log** (`AuditLogService.record`): inserts an `AuditLog` and never throws (a lost entry is logged as `AUDIT LOG NOT WRITTEN`). Written by admin and state-changing flows (list in `libs/enums/audit-log.enum.ts`); `meta` carries field names or reasons only. `getAuditLogsByAdmin` joins the actor.
- **Notices** (`NoticeService`): admin-written FAQ/TERMS/INQUIRY content with statuses HOLD/ACTIVE/DELETE; public `getNotices` lists ACTIVE; deleting is two-step (set status DELETE, then `removeNoticeByAdmin`).
- **Logging** (global rule in `AGENTS.md`): never log variables, tokens, passwords, prompts or response bodies; `LoggingInterceptor` logs the operation name and duration only.

---

## 10. Scripts and tooling that are part of the app code

| Script | File | Purpose |
|---|---|---|
| `npm run seed` | `seed.ts`, `libs/admin-seed.ts` | creates the first ADMIN when none exists; `ensureExtraAdmin` inserts a second from `ADMIN2_*`; never updates; prints no password |
| `npm run seed:demo` / `reset:demo` / `check:demo` | `seed-demo.ts`, `reset-demo.ts`, `check-demo.ts` | see `06-quality.md` |
| `npm run report:currency` | `report-currency.ts`, `libs/currency.ts` | read-only list of ticket types that are not in KRW |
| `npm run ai:check` | `ai-check.ts` | AI setup check, real calls |
