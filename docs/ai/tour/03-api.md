# 03 - The GraphQL API

**What this file covers.** The cross-cutting machinery every request passes through (HTTP middleware, global pipe, guards, interceptor, error formatting, rate limits, other HTTP routes), then every GraphQL operation grouped by module: who may call it, the input fields with their validation rules, what it returns, what it changes in the database, and the errors it can return. The API has **97 operations: 41 queries and 56 mutations and no GraphQL subscriptions** (counted from the `@Query`/`@Mutation` decorators in `components/*/*.resolver.ts` and `app.resolver.ts`). Realtime chat uses a separate WebSocket gateway (`05-modules.md`).

**GraphQL for beginners.** GraphQL is one HTTP endpoint (`POST /graphql`). The client sends a *query* (read) or *mutation* (write) with named fields it wants back. "Code-first" means the schema (the list of types and operations) is generated from TypeScript decorators (`@ObjectType`, `@Field`, `@Query`, `@Mutation`) instead of a hand-written `.graphql` file (`autoSchemaFile: true`, `libs/graphql-options.ts`). An *input* is a class used as an argument; its fields carry `class-validator` decorators.

Paths start at `apps/ticketzy-api/src/`.

---

## Part A - What every request goes through

### A.1 Order of processing

`main.ts` (`bootstrap`) wires, in this order:

1. `NestFactory.create(AppModule, { logger: getLogLevels() })`.
2. `app.useGlobalPipes(createValidationPipe())` and `app.useGlobalInterceptors(new LoggingInterceptor())`.
3. `app.disable('x-powered-by')`, `app.set('trust proxy', getTrustProxyHops())`.
4. `helmet(getHelmetOptions())` - CSP only in production, `crossOriginResourcePolicy: cross-origin` so the Vercel site can show `/uploads` images (`libs/http-hardening.ts`).
5. `enableCors(buildCorsOptions())` - exact origins from `CORS_ORIGINS`/`CLIENT_URL`; methods `GET, POST, OPTIONS`; `credentials: false`; `maxAge: 600`; a request without an `Origin` header is allowed.
6. `app.use('/graphql', createGeneralRateLimitMiddleware())` - per-IP limit; CORS preflight (`OPTIONS`) is not counted.
7. `createUploadAuthMiddleware(authService)` - any `multipart/*` request needs a valid bearer token *before* it is parsed (decision #98); refusal is HTTP 401 with `{ errors: [{ message, extensions: { code: 'UNAUTHENTICATED' } }] }`.
8. `graphqlUploadExpress(getUploadLimits())` - the multipart parser.
9. `express.static('./uploads')` at `/uploads`, `express.static('./demo-images')` at `/demo-images`.
10. `WsAdapter`, `enableShutdownHooks()`, listen on `0.0.0.0` at `getListenPort()`; `keepAliveTimeout = 65000`, `headersTimeout = 66000` (longer than the proxy's idle time, to avoid sporadic 502s).

### A.2 Apollo settings (`libs/graphql-options.ts`)

- Playground and introspection are on outside production, off in production.
- `includeStacktraceInErrorResponses: false`; `hideSchemaDetailsFromClientErrors` in production (no "did you mean field X").
- `uploads: false` because `graphql-upload` is mounted by hand in `main.ts`.
- `formatError` = `formatGraphQLError`.

### A.3 The global ValidationPipe (`libs/validation.ts`, `createValidationPipe`)

```ts
new ValidationPipe({ whitelist: true, transform: true, exceptionFactory: ... ValidationFailedException(...) })
```

- `whitelist: true`: properties **without** a `class-validator` decorator are silently removed from inputs. Every input field therefore needs a decorator or it disappears (decision #26).
- `transform: true`: plain objects become class instances; `@Transform` helpers run (for example `normalizeEmail`, trimming `reason` strings).
- A validation failure becomes `ValidationFailedException` (code `VALIDATION_FAILED`, HTTP 400) with `fields: [{ field, rules }]`: property path and rule names only, never values (decision #113). For the two list arguments, the first text `limit must not be greater than N` / `page must not be greater than N` becomes the sentences `LIMIT_TOO_HIGH` / `PAGE_TOO_HIGH` (`mapValidationMessage`).
- Pagination: `PageField()` = integer 1 to 10000, default 1; `LimitField(max = 100)` = integer 1 to 100, default 20 (`libs/dto/common/pagination.ts`). `EventsByAdminInquiry.limit` allows up to 200 (`MAX_ADMIN_EVENTS_LIMIT`).
- Sorting: `sort` is whitelisted per list with `IsIn(available...Sorts)` from `libs/config.ts`. `direction` is the `Direction` enum (`ASC = 1`, `DESC = -1`).

### A.4 Guards, decorators

See `02-state-and-rules.md`, section 2.1 for the table. The decorators used on resolver methods: `@UseGuards(...)`, `@Roles(...)` (`SetMetadata('roles', ...)`), and the parameter decorator `@AuthMember('_id' | 'memberType' | undefined)`.

### A.5 Interceptor (`libs/interceptor/Logging.interceptor.ts`)

`LoggingInterceptor` logs only the operation name (`REQUEST`) and the duration (`RESPONSE`). It deliberately logs neither variables nor responses (passwords, profile data).

### A.6 Error formatting (`libs/error-mapping.ts`, `formatGraphQLError`)

The client always receives `{ code, message }` (plus `retryAfterSeconds` for rate limits, plus `fields` for validation failures) and never a stack, a Mongo value or an internal text. Order of the function:

1. `CodedException` (an `HttpException` subclass, `libs/coded-exception.ts`) -> its own `code`, message and optional `retryAfterSeconds`; `ValidationFailedException` also gets `fields`. Logged at warn level.
2. `mapRawError` for errors nobody threw on purpose:
   - Mongo duplicate key (11000/11001) -> `BAD_REQUEST`; message `USED_MEMBER_EMAIL_NICK_OR_PHONE` when the index is on `memberEmail`/`memberNick`/`memberPhone`, otherwise `DUPLICATE_VALUE`. Only field names are logged.
   - `CastError`, `ValidationError`, BSON errors, "24 character hex string" (a bad ObjectId) -> `BAD_REQUEST`.
   - connection failures (`MongoNetworkError`, server-selection, "buffering timed out", `ECONNREFUSED`, ...) -> `SERVICE_UNAVAILABLE` with `SERVICE_TEMPORARILY_UNAVAILABLE`, logged as error.
   - a plain `Error` whose text is a `Message` value (the uploader) passes through; any other plain `Error` -> `INTERNAL_SERVER_ERROR` with `SOMETHING_WENT_WRONG`.
   - `HttpException`s and `GraphQLError`s return `null` here (they are meant for the client).
3. Everything else: `code` from Apollo's mapping and the message from the exception.

How Apollo (`@nestjs/apollo` `apollo-base.driver.js`) derives `extensions.code` from a Nest `HttpException`: HTTP 400 -> `BAD_REQUEST`, 401 -> `UNAUTHENTICATED`, 403 -> `FORBIDDEN`, 422 -> `BAD_USER_INPUT`; **every other status (404, 429, 500, 503, ...) -> `INTERNAL_SERVER_ERROR`** (the status goes into `extensions.status`). So `InternalServerErrorException(NO_DATA_FOUND)` and `ServiceUnavailableException(AI_BUSY)` both reach the client with code `INTERNAL_SERVER_ERROR`; the *message* is what tells them apart. Only `CodedException` and a `GraphQLError` built with `extensions.code` keep their own code. Codes that clients can rely on:

| Code | Raised by |
|---|---|
| `BAD_REQUEST` | `BadRequestException` (most business refusals), raw cast/duplicate errors |
| `UNAUTHENTICATED` | missing/invalid token, wrong email or password |
| `FORBIDDEN` | wrong role, `ORGANIZER_NOT_APPROVED`, conversation denials |
| `ACCOUNT_NOT_VERIFIED` | login of a REJECTED/SUSPENDED/DELETE account (`GraphQLError`) |
| `VALIDATION_FAILED` | input validation (`ValidationFailedException`) |
| `RATE_LIMITED` | `createRateLimitedError` (login, signup, password, AI per-caller daily limit), with `retryAfterSeconds` |
| `AI_DAILY_CAP_REACHED` | global AI cap (`CodedException`, HTTP 429) |
| `AI_QUOTA_EXHAUSTED` | every model of the chain out of quota (`CodedException`, 503) |
| `SERVICE_UNAVAILABLE` | database unreachable, AI usage counter unreadable, `PAYMENTS_DISABLED` (a `GraphQLError`), `CodedException(NO_DATA_FOUND, 'NO_DATA_FOUND', 404)` is a separate code |
| `NO_DATA_FOUND` | only the seat map's "no map" answer (`CodedException`, 404, decision #114) |
| `INTERNAL_SERVER_ERROR` | unknown errors and every `InternalServerErrorException`/`ServiceUnavailableException`/429 `HttpException` |

`isExpectedDomainError` (`libs/expected-errors.ts`) downgrades `ACCOUNT_NOT_VERIFIED` and "wrong email or password" to one `warn` log line.

All user-facing texts live in the `Message` enum (`libs/enums/common.enum.ts`); the error names in the tables below are `Message` keys.

### A.7 Rate limits (`libs/rate-limit.ts`, `libs/rate-limiter.ts`)

In-memory sliding windows, one `RateLimiter` per kind, per process. With more than one API instance each instance counts alone (decision #104). Limits (defaults; env names in `00-overview.md`):

| Name | Key | Default | Applied |
|---|---|---|---|
| general | client IP | 300 / minute | Express middleware on `/graphql` only (not `/health`, `/ready`, `/uploads`) |
| login | IP | 10 / 15 min | `enforceLoginLimit` in the `login` resolver |
| loginEmail | email | 20 / 15 min (twice the login number) | same call |
| signup | IP | 5 / hour | `enforceSignupLimit` in `signupUser`, `signupOrganizer` |
| password | member id and IP | 5 / 15 min | `enforcePasswordLimit` when `updateMember` / `updateMemberByAdmin` carries `memberPassword` |
| checkInCode | member id | 60 / minute (fixed, not configurable) | `enforceCheckInCodeLimit` in `checkInTicketByCode` and `checkInPreviewByCode`; the QR token operations have no such limit (#116) |
| AI per minute | member id or IP | 10 / minute | `AiClientService.begin` |
| message | member id | 10 / 10 s | `ConversationService.sendLimiter` |
| typing | member id | 30 / 10 s | socket gateway |

Refusal: `CodedException('RATE_LIMITED', 429, retryAfterSeconds)`; for the middleware an HTTP 429 with `Retry-After` and `{ errors: [{ code, message, retryAfterSeconds }] }`. The map is bounded: when more than 5000 keys exist, idle keys are swept. Limits that must survive restarts (AI daily caps) live in MongoDB (`ai_usage`).

### A.8 Non-GraphQL HTTP routes

| Route | File | Behaviour |
|---|---|---|
| `GET /` | `app.controller.ts` | hello text |
| `GET /health` | `health.controller.ts` | always `{ status: 'ok' }`, no database access |
| `GET /ready` | same | `{ status: 'ready' }` when `connection.readyState === 1`, else HTTP 503 `{ status: 'unavailable' }` |
| `GET /uploads/...`, `/demo-images/...` | `main.ts` | static files |
| WebSocket (same port) | `socket/socket.gateway.ts` | chat, see `05-modules.md` |

Query `sayHello` (`app.resolver.ts`) returns a string; no guard.

---

## Part B - Operations by module

Notation: **Who** uses G (guest), U (USER), P (PENDING organizer), O (ACTIVE organizer), A (ADMIN) as in `02-state-and-rules.md`. "page/limit" means `PageField`/`LimitField`. "Returns" names the GraphQL type; list types are `{ list, metaCounter: [{ total }] }`. "Audit" means `AuditLogService.record` (never throws).

### B.1 Members (`components/member`)

| Operation | Who | Input and validation | Returns | Database effect | Errors |
|---|---|---|---|---|---|
| `signupUser` M | G | `MemberInput`: `memberEmail` IsEmail (lower-cased, trimmed), `memberPassword` min 8, `memberNick?` 3-50, `memberPhone?`, `memberFullName?` 3-100 | `Member` + `accessToken` | insert `members` (USER, ACTIVE, EMAIL) | `RATE_LIMITED`, `VALIDATION_FAILED`, `USED_MEMBER_EMAIL_NICK_OR_PHONE`, `SOMETHING_WENT_WRONG` |
| `signupOrganizer` M | G | same | `Member` + token | insert (ORGANIZER, PENDING) | same |
| `login` M | G | `LoginInput { memberEmail, memberPassword }` | `Member` + token | none | `RATE_LIMITED`, `WRONG_EMAIL_OR_PASSWORD` (UNAUTHENTICATED), `ACCOUNT_NOT_VERIFIED` |
| `checkAuth` Q | U P O A | none | string `Hi <id>` | none | `TOKEN_NOT_EXIST`, `NOT_AUTHENTICATED`, `ACCOUNT_NOT_VERIFIED` |
| `checkAuthRoles` Q | U P O | none | string | none | `ONLY_SPECIFIC_ROLES_ALLOWED` |
| `updateMember` M | U P O A | `MemberUpdate` (`_id` is overwritten by the token's id): `memberPhone?`, `memberNick?` 3-50, `memberPassword?` min 8, `memberFullName?` 3-100, `memberImage?`, `memberAddress?`, `memberDesc?`; `memberType`/`memberStatus` are deleted | `Member` with a new token | update own member while ACTIVE/PENDING; password re-hashed | `RATE_LIMITED` (password), `UPDATE_FAILED` |
| `getMember(memberId)` Q | all | id string | `Member` | `getMember` records a view (`members.memberViews +1`, new view only) when logged in | `NO_DATA_FOUND` (not ACTIVE, or not self while PENDING) |
| `getOrganizers(input)` Q | all | `OrganizersInquiry`: page/limit, `sort` in `availableOrganizerSorts`, `direction`, `search.text?` | `Members` (ACTIVE organizers; `memberEvents` replaced by the count of APPROVED events) | none | |
| `likeTargetMember(memberId)` M | U P O A | id | `Member` | toggle `likes` row; `memberLikes` +-1 | `NO_DATA_FOUND`, `SOMETHING_WENT_WRONG` |
| `imageUploader(file, target)` M | U P O A | upload; `target` in `member`/`event`/`venue` | path string `uploads/<target>/<uuid>.<ext>` | file on disk | `UPLOAD_FAILED`, `BAD_REQUEST`, `PROVIDE_ALLOWED_FORMAT` |
| `imagesUploader(files, target)` M | U P O A | list of uploads | list of paths in input order; all or nothing: if any file fails, the files this request already wrote are deleted and the request fails (#117) | files | `BAD_REQUEST`, `PROVIDE_ALLOWED_FORMAT`, `UPLOAD_FAILED` |
| `getAllMembersByAdmin(input)` M | A | `MembersInquiry`: sort in `availableMemberSorts`, `search.memberStatus?`, `memberType?`, `text?` (nick regex) | `Members` | none | |
| `updateMemberByAdmin(input)` M | A | `MemberUpdate` with `_id` | `Member` | update; audit `MEMBER_UPDATED_BY_ADMIN` (field names; for status also `toStatus`) | `CANNOT_ASSIGN_ADMIN_ROLE`, `CANNOT_CHANGE_OWN_ACCESS`, `CANNOT_RESET_ADMIN_PASSWORD` (audited `ADMIN_PASSWORD_RESET_BLOCKED`), `CANNOT_CHANGE_ADMIN_ACCESS`, `USE_ORGANIZER_OPERATIONS`, `RATE_LIMITED`, `UPDATE_FAILED` |

### B.2 Organizer administration (`components/organizer`, all A)

| Operation | Input and validation | Returns | Database effect | Errors |
|---|---|---|---|---|
| `getOrganizersByAdmin` Q | `OrganizersByAdminInquiry`: sort in `availableOrganizerSorts`, `search.memberStatus?`, `search.text?` (name/nick/email regex) | `Members` (password field projected out) | none | |
| `verifyOrganizerByAdmin(memberId)` M | id | `Member` | PENDING to ACTIVE; audit `ORGANIZER_VERIFIED`; notification; sockets unrestricted | `NO_ORGANIZER_FOUND`, `INVALID_STATUS_TRANSITION` |
| `rejectOrganizerByAdmin` M | `OrganizerReasonInput { memberId, reason (string, max 500, trimmed) }` | `Member` | PENDING to REJECTED, `rejectReason`; audit; notification; sockets restricted | `REJECT_REASON_REQUIRED`, plus above |
| `suspendOrganizerByAdmin` M | same | `Member` | ACTIVE to SUSPENDED; audit; notification; restricted | `SUSPEND_REASON_REQUIRED`, plus above |
| `reinstateOrganizerByAdmin(memberId)` M | id | `Member` | SUSPENDED/REJECTED to ACTIVE; audit; notification | as verify |
| `getMyAccountState` Q | P O A U (REJECTED and SUSPENDED too) | none | `MyAccountState { memberStatus, approvalCelebrationPending }` | read of the caller's own member by token id; the cheap query to poll about every 30 seconds to notice an approval (#120) | |
| `markApprovalCelebrationDone` M | O | none | `MyAccountState` | conditional update `approvalCelebrationPending` true to false on the caller's own organizer account; a repeat changes nothing and does not fail | |
| `setCommissionOverrideByAdmin` M | `CommissionOverrideInput { memberId, rate (number 0-100), endsAt? (date), reason (max 500) }` | `Member` | sets `commissionOverride`; audit `COMMISSION_OVERRIDE_SET`; notification `COMMISSION_UPDATED` | `COMMISSION_REASON_REQUIRED`, `INVALID_COMMISSION_RATE`, `INVALID_COMMISSION_END_DATE` (must be in the future), `NO_ORGANIZER_FOUND` |
| `clearCommissionOverrideByAdmin` M | `ClearCommissionOverrideInput { memberId, reason }` | `CommissionOverrideCleared { member, previousOverride, automaticRate, reason, clearedAt }` | one conditional `$unset`; audit `COMMISSION_OVERRIDE_CLEARED`; notification | `COMMISSION_CLEAR_REASON_REQUIRED`, `NO_COMMISSION_OVERRIDE`, `NO_ORGANIZER_FOUND` |

### B.3 Venues (`components/venue`)

| Operation | Who | Input and validation | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `createVenue` M | O A | `VenueInput` (Flow 3) | `Venue` | insert `venues`; `venueCapacity` computed | `INVALID_VENUE_TIMEZONE`, `INVALID_VENUE_LAYOUT` and the `VENUE_LAYOUT_*` messages, `CREATE_FAILED` (also for a duplicate `(city, name, address)`) |
| `updateVenue` M | O A | `VenueUpdate { _id, ...optional fields, venueStatus? }` | `Venue` | update (creator or admin); capacity recomputed when a layout is sent | `VENUE_LAYOUT_LOCKED`, timezone/layout errors, `UPDATE_FAILED` |
| `getVenue(venueId)` Q | all | id | `Venue` | none | `NO_DATA_FOUND` (missing or DELETE) |
| `getVenues(input)` Q | all | `VenuesInquiry`: sort in `availableVenueSorts`, `search.cityList?`, `typeList?`, `text?` (name regex) | `Venues` (ACTIVE only) | none | |

### B.4 Events (`components/event`)

| Operation | Who | Input and validation | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `createEvent` M | O | `EventInput`: `eventCategory`, `seatingType?` (default GENERAL), `eventTitle` 3-100, `eventDesc?` 5-2000, `eventTranslations?[{locale,title 3-100,description? 5-2000}]`, `eventImages[]` required, `venueId`, `startAt`, `endAt`, `saleStartAt?`, `saleEndAt?` | `Event` (DRAFT) | insert; organizer `memberEvents` +1 | `BAD_REQUEST` (end before start), `SALES_*`, `NO_DATA_FOUND` (venue not ACTIVE), `VENUE_ALREADY_BOOKED`, `CREATE_FAILED` |
| `updateEvent` M | O | `EventUpdate { _id, ...all optional }` | `Event` | see Flow 4; APPROVED goes to PENDING | `UPDATE_FAILED`, `EVENT_NOT_EDITABLE`, `EVENT_LAYOUT_LOCKED` (venue or seating type of an APPROVED event or one with seats), sales/venue errors |
| `submitEventForApproval(eventId)` M | O | id | `Event` (PENDING) | status; AI moderation in the background | `NO_DATA_FOUND`, `INVALID_EVENT_TRANSITION`, `EVENT_SUBMIT_*`, `SEAT_TIER_MISSING`, `VENUE_ALREADY_BOOKED` |
| `cancelMyEvent` M | O | `EventReasonInput { eventId, reason (max 500, trimmed) }` | `Event` (CANCELLED) | Flow 11 | `EVENT_CANCEL_REASON_REQUIRED`, `NOT_ALLOWED_REQUEST`, `EVENT_ALREADY_CLOSED`, `INVALID_EVENT_TRANSITION` |
| `getMyEvents` Q | O | `OrganizerEventsInquiry`: sort in `availableEventSorts`, `search.eventStatus?` | `Events` with organizer, venue, seat counts | none | |
| `getEvent(eventId)` Q | all | id | `Event` with `memberData`, `venueData`, seat counts, `meLiked`; admins also `possibleVenueConflicts` | records a view for logged-in callers on public events | `NO_DATA_FOUND` |
| `getEvents(input)` Q | all | `EventsInquiry`: sort in `availableEventSorts`; `search`: `organizerId?`, `venueId?`, `cityList?`, `categoryList?`, `pricesRange?{start,end}`, `periodsRange?{start,end}`, `text?` | `Events` | none | |
| `getEventSeatMap(eventId)` Q | all | id | `EventSeatMap { eventId, venueTimezone, venueLayout, seats[{sectionKey,row,number,seatStatus,mine?,holdExpiresAt?}] }` | none | `NO_DATA_FOUND` (code `NO_DATA_FOUND`, HTTP 404) |
| `getFavorites(input)` / `getVisited(input)` Q | U P O A | `OrdinaryInquiry { page, limit }` | `Events` (APPROVED events of ACTIVE organizers) | none | |
| `likeTargetEvent(eventId)` M | U P O A | id | `Event` | toggle like; `eventLikes` +-1; notification `LIKE` to the organizer on like (not on unlike, not to oneself) | `NO_DATA_FOUND` |
| `getEventsByAdmin` Q | A | `EventsByAdminInquiry`: `limit` up to 200; `search`: `eventStatus?`, `eventCategoryList?`, `organizerId?`, `text?` (title and translated titles) | `Events` (empty list is fine) | none | |
| `approveEventByAdmin(eventId)` M | A | id | `Event` (APPROVED) | seat generation, audit `EVENT_APPROVED`, notification | `CANNOT_APPROVE_OWN_EVENT`, `INVALID_EVENT_TRANSITION`, `NO_DATA_FOUND`, `SEAT_TIER_MISSING`, `SEAT_TIER_DUPLICATE`, `EVENT_SUBMIT_LAYOUT_REQUIRED`, `SEAT_GENERATION_FAILED`, `VENUE_ALREADY_BOOKED` |
| `rejectEventByAdmin` M | A | `EventReasonInput` | `Event` (REJECTED) | audit `EVENT_REJECTED`, notification | `EVENT_REJECT_REASON_REQUIRED`, `INVALID_EVENT_TRANSITION` |
| `cancelEventByAdmin` M | A | `EventReasonInput` | `Event` (CANCELLED) | Flow 11 | `EVENT_CANCEL_REASON_REQUIRED`, `INVALID_EVENT_TRANSITION` |
| `updateEventByAdmin` M | A | `EventUpdate` | `Event` | content only; audit `EVENT_UPDATED_BY_ADMIN` (field names) | `UPDATE_FAILED`, `EVENT_NOT_EDITABLE` (CANCELLED/ENDED) |
| `removeEventByAdmin(eventId)` M | A | id | the deleted `Event` | deletes a DRAFT and its ticket types; organizer `memberEvents` -1; audit `EVENT_REMOVED_BY_ADMIN` | `REMOVE_FAILED` |

### B.5 Ticket types (`components/ticket-type`)

| Operation | Who | Input and validation | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `createTicketType` M | O A | `TicketTypeInput { eventId, ticketTypeName 2-60, ticketPrice >= 0, ticketCurrency, tierKey? 1-30, totalQuantity? int >= 1, maxPerOrder int >= 1, saleStartAt?, saleEndAt? }` | `TicketType` | insert; `eventMinPrice` refreshed | `NOT_ALLOWED_REQUEST`, `ONLY_KRW_TICKETS`, `EVENT_HAS_OTHER_CURRENCY`, `TICKET_TYPE_QUANTITY_REQUIRED`, `TICKET_TYPE_QUANTITY_FROM_SEATS`, `TICKET_TYPE_TIER_KEY_REQUIRED`, `CREATE_FAILED` (also for the unique name/tier index) |
| `updateTicketType` M | O A | `TicketTypeUpdate { _id, ...optional, ticketTypeStatus? }` | `TicketType` | update; total cannot drop below `soldQuantity`; `eventMinPrice` refreshed | `NO_DATA_FOUND`, `NOT_ALLOWED_REQUEST`, `ONLY_KRW_TICKETS`, `TICKET_CURRENCY_LOCKED`, `TICKET_TYPE_TIER_LOCKED`, `TICKET_TYPE_QUANTITY_FROM_SEATS`, `UPDATE_FAILED` |
| `getTicketTypes(eventId)` Q | all | id | `[TicketType]` sorted by price | first expires stale unpaid orders of the event | `NO_DATA_FOUND` (unknown event or organizer not ACTIVE) |

`getTicketTypes` does not apply `publicEventStatus`, so the ticket types of a DRAFT event of an ACTIVE organizer are readable by anyone who knows the event id (decision #37 lists this as open, C3-30).

### B.6 Seats (`components/seat`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `holdSeats(eventId, seatIds?, seats?)` M | U (guard: any logged in) | exactly one of `seatIds: [String]` or `seats: [SeatRefInput { _id? \| sectionKey,row,number }]`, 1 to 8 seats | `SeatHold` | HELD seats (Flow 7) | `SEAT_INPUT_INVALID`, `SEAT_REF_INVALID`, `SEAT_NOT_FOUND`, `SEAT_HOLD_LIMIT`, `ONLY_BUYERS_CAN_BUY`, `NOT_ALLOWED_REQUEST`, `SEATS_NOT_AVAILABLE_FOR_EVENT`, `SALES_NOT_STARTED`/`SALES_CLOSED`/`EVENT_ENDED_NO_SALES`, `SEAT_JUST_TAKEN` |
| `releaseSeats(eventId)` M | any logged in | id | Int: seats freed | caller's HELD seats of the event to AVAILABLE | |
| `getSeatConfig` Q | G | none | `SeatConfig { seatHoldSeconds, maxSeatsPerOrder }` | none | |

### B.7 Orders and payment (`components/order`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `createCheckout` M | U (service check) | `CheckoutInput { eventId, seatIds? (1-8), items? [{ ticketTypeId, quantity int >= 1 }] (1-10) }` | `Order` | Flow 8 | `NOT_ALLOWED_REQUEST`, `ONLY_BUYERS_CAN_BUY`, `SALES_*`, `HOLD_EXPIRED`, `CHECKOUT_RESERVED_NEEDS_SEATS`, `CHECKOUT_GENERAL_NEEDS_ITEMS`, `BAD_REQUEST`, `CREATE_FAILED` |
| `payOrder(orderId, simulate)` M | U | `simulate`: `SUCCESS` or `FAILURE` | `Order` | Flow 8 | `PAYMENTS_DISABLED` (code `SERVICE_UNAVAILABLE`), `ONLY_BUYERS_CAN_BUY`, `NOT_ALLOWED_REQUEST`, `ORDER_NOT_PAYABLE`, `HOLD_EXPIRED`, `SOMETHING_WENT_WRONG` |
| `cancelPendingOrder(orderId)` M | any logged in | id | `Order` (CANCELLED) | releases seats or stock | `NOT_ALLOWED_REQUEST` |
| `getOrder(orderId)` Q | any logged in | id | `Order` with `eventData.venueData` | expires the caller's stale orders first | `NO_DATA_FOUND` |
| `getMyOrders(input)` Q | any logged in | `OrdersInquiry`: sort in `availableOrderSorts`, `orderStatus?` | `Orders` | same sweep | |
| `getMyEventOrders(input)` Q | O | `OrganizerOrdersInquiry` (+ `eventId?`) | `OrganizerOrders`: buyer nick only, seats as `{sectionKey,row,number}`, `ticketCount`, amounts | none | `NOT_ALLOWED_REQUEST` (event not theirs) |
| `getAllOrdersByAdmin(input)` Q | A | `AdminOrdersInquiry`: + `eventId?`, `text?` (max 100; buyer nick/name/email), `dateFrom?`, `dateTo?` | `AdminOrders` (+ `buyerNick`, `buyerEmail`, `eventTitle`) | none | `INVALID_ORDER_DATE_RANGE` |

### B.8 Tickets (`components/ticket`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `getMyTickets(input)` Q | any logged in | `TicketsInquiry { page, limit, timeFilter? UPCOMING \| PAST }` | `Tickets` with event+venue, ticket type, seat, `qrToken` | none | `NO_DATA_FOUND` (aggregation produced nothing) |
| `getTicket(ticketId)` Q | any logged in | id | `Ticket` | none | `NO_DATA_FOUND` (also for another member's ticket) |
| `checkInTicket(qrToken, eventId?)` M | O A | strings | `CheckInResult` | VALID to USED | `QR_INVALID`, `TICKET_WRONG_EVENT`, `TICKET_WRONG_ORGANIZER`, `EVENT_NOT_OPEN_FOR_CHECKIN`, `TICKET_ALREADY_USED`, `TICKET_REFUNDED`, `TICKET_NOT_VALID` |
| `checkInPreview(qrToken, eventId?)` Q | O A | same | `CheckInResult` | none | same |
| `checkInTicketByCode(input: CheckInByCodeInput!)` M | O A | `{ eventId: String!, ticketCode: String! }` (code normalized: spaces and dashes removed, upper case, 20 hex) | `CheckInResult` | VALID to USED, same update as `checkInTicket` | `TICKET_CODE_NOT_FOUND` (bad format, unknown code, other event, event not yours: all identical), `EVENT_NOT_OPEN_FOR_CHECKIN`, `TICKET_ALREADY_USED`, `TICKET_REFUNDED`, `TICKET_NOT_VALID`, `RATE_LIMITED` |
| `checkInPreviewByCode(input: CheckInByCodeInput!)` Q | O A | same | `CheckInResult` | none | same |

### B.9 Refunds (`components/refund`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `getRefundQuote(orderId)` Q | any logged in (own) | id | `RefundQuote { orderId, refundable, deadline, venueTimezone, refundableAmount, currency, reason? }` | none | `NO_DATA_FOUND` |
| `requestRefund(orderId, reason?)` M | any logged in (own) | | `Order` | Flow 11 | `NOT_ALLOWED_REQUEST`, `ORDER_NOT_REFUNDABLE`, `REFUND_TICKET_CHECKED_IN`, `REFUND_DEADLINE_PASSED`, `REFUND_IN_PROGRESS`, `REFUND_FAILED` |
| `refundOrderByAdmin` M | A | `AdminRefundInput { orderId, reason }` | `Order` | Flow 11 + audit `ORDER_REFUNDED_BY_ADMIN` | `REFUND_REASON_REQUIRED`, `NO_DATA_FOUND`, same refund errors except the deadline |
| `retryEventRefundsByAdmin(eventId)` M | A | id | `RefundSummary` | Flow 11 | `EVENT_NOT_CANCELLED` |

### B.10 Payouts and sales (`components/payout`, `components/sales`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `getMyPayouts` Q | O | `PayoutsInquiry { page, limit, payoutStatus?, direction? }` | `Payouts { list: PayoutRow[], metaCounter, totals { totalPaidOut, totalDue, totalUpcoming } }` | none | |
| `getPayoutsByAdmin` Q | A | + `organizerId?`, `text?` (max 100), `dateFrom?`, `dateTo?` (on payout date) | `Payouts` with `organizerNick`, `organizerEmail` | none | `PAYOUT_INVALID_DATE_RANGE` |
| `markPayoutPaidByAdmin` M | A | `MarkPayoutPaidInput { eventId, note? (max 300) }` | `PayoutRow` (PAID_OUT) | insert `payouts`; audit `PAYOUT_MARKED_PAID`; notification `PAYOUT_PAID` | `PAYOUT_EVENT_NOT_FOUND`, `PAYOUT_ALREADY_PAID`, `PAYOUT_NOT_DUE_YET`, `PAYOUT_NOTHING_TO_PAY`, `CREATE_FAILED` |
| `getEventSales(eventId)` Q | O (P passes the guard) | id | `EventSales { eventId, ticketTypes[{ticketTypeId,ticketTypeName,currency,ticketsSold,revenue,commission,netPayout}] }` | none | `NOT_ALLOWED_REQUEST` |
| `getEventAttendees(input)` Q | O | `AttendeesInquiry { eventId, page, limit, ticketStatus? }` (default VALID and USED) | `Attendees` rows (`ticketId`, `ticketCode`, status, `checkedInAt`, `buyerName`, ticket type, seat, `orderNumber`) | none | `NOT_ALLOWED_REQUEST` |
| `getMyEarnings` Q | O | none | `MyEarnings { earnings[{currency, ordersCount, ticketsSold, revenue, commission, netPayout, refundedAmount}] }` per currency | none | |

### B.11 Social: comments, likes, follows, views

| Operation | Who | Input and validation | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `createComment` M | any logged in | `CommentInput { commentGroup (EVENT), commentContent 1-500, commentRefId }` (`memberId` set by the server) | `Comment` | insert; `eventComments` +1; notification `COMMENT` to the organizer; refused before the insert when the event is missing, not APPROVED or its organizer is not ACTIVE (#117) | `NO_DATA_FOUND`, `CREATE_FAILED` |
| `updateComment` M | any logged in | `CommentUpdate { _id, commentStatus?, commentContent? 1-500 }` | `Comment` | only the author's ACTIVE comment; `commentStatus: DELETE` is a soft delete and lowers `eventComments` | `UPDATE_FAILED` |
| `getComments(input)` Q | all | `CommentsInquiry`: sort in `availableCommentSorts`, `search.commentRefId` | `Comments` (ACTIVE, with `memberData`) | none | `NO_DATA_FOUND` |
| `removeCommentByAdmin(commentId)` M | A | id | `Comment` | hard delete; `eventComments` -1 unless it was already soft-deleted; audit `COMMENT_REMOVED_BY_ADMIN` | `REMOVE_FAILED` |
| `subscribe(input)` M | any logged in | organizer id string | `Follower` | insert `follows`; `memberFollowings`/`memberFollowers` +1 | `SELF_SUBSCRIPTION_DENIED`, `NO_DATA_FOUND`, `ONLY_ORGANIZERS_CAN_BE_FOLLOWED`, `CREATE_FAILED` |
| `unsubscribe(input)` M | any logged in | organizer id | `Follower` | delete the follow row; counters -1 (never looks the target up) | `NO_DATA_FOUND` |
| `getMemberFollowings(input)` / `getMemberFollowers(input)` Q | all | `FollowInquiry { page, limit, search { followerId? / followingId? } }` | `Followings` / `Followers` (ACTIVE members only, filtered before paging) | none | `BAD_REQUEST` text (thrown as `InternalServerErrorException`, so the code is `INTERNAL_SERVER_ERROR`) when the needed search id is missing |

Likes and views have no resolvers of their own: `LikeService` and `ViewService` are called by the member and event services (`likeTargetMember`, `likeTargetEvent`, `getMember`, `getEvent`). `getFavorites` / `getVisited` read the `likes` and `views` collections.

### B.12 Notifications, notices, audit log

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `getMyNotifications` Q | NotificationGuard | `NotificationsInquiry { page, limit, notificationStatus?, unreadOnly? }` | `Notifications` with `authorData` | none | `NO_DATA_FOUND` |
| `markNotificationRead(notificationId)` M | same | id | `Notification` | WAIT to READ (own only) | `UPDATE_FAILED` |
| `getUnreadNotificationCount` Q | same | none | Int | none | |
| `markAllNotificationsRead` M | same | none | Int (changed) | `updateMany` | |
| `getNotices(input)` Q | all | `NoticesInquiry { page, limit, search.noticeCategory? }` | `Notices` (ACTIVE) | none | |
| `createNotice` M | A | `NoticeInput { noticeCategory, noticeStatus?, noticeTitle 3-100, noticeContent 3-2000 }` | `Notice` | insert; audit `NOTICE_CREATED` | `CREATE_FAILED` |
| `updateNotice` M | A | `NoticeUpdate { _id, ...optional }` | `Notice` | update (not DELETE ones); audit `NOTICE_UPDATED` | `UPDATE_FAILED` |
| `getAllNoticesByAdmin` Q | A | `AllNoticesInquiry` (+ `noticeStatus?`) | `Notices` | none | |
| `removeNoticeByAdmin(noticeId)` M | A | id | `Notice` | hard-deletes a notice only when its status is already `DELETE` (set earlier with `updateNotice`); audit `NOTICE_REMOVED` | `REMOVE_FAILED` |
| `getAuditLogsByAdmin` Q | A | `AuditLogsInquiry { page, limit, sort (createdAt), direction?, search { action?, targetType?, targetId?, actorId? } }` | `AuditLogs` with `actorData` | none | `NO_DATA_FOUND` |

### B.13 Conversations (`components/conversation`)

| Operation | Who | Input | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `startConversation(eventId?)` M | ConversationGuard (organizers; admins are refused by `getStartDenial`) | event id, or none for the support conversation | `Conversation` | create-or-return, race decided by unique indexes | `CONVERSATION_ORGANIZERS_ONLY`, `CONVERSATION_SUPPORT_ONLY`, `CONVERSATION_EVENT_NOT_YOURS` |
| `startConversationWithOrganizerByAdmin(organizerId)` M | A | id | `Conversation` | create the support conversation; audit `SUPPORT_CONVERSATION_STARTED`; notification to the organizer only when created now | `NO_DATA_FOUND`, `CONVERSATION_TARGET_NOT_ORGANIZER`, `CONVERSATION_NOT_ALLOWED` |
| `getMyConversations(input)` Q | ConversationGuard | `OrdinaryInquiry` (limit capped at 100) | `Conversations` | none | `CONVERSATION_NOT_ALLOWED` |
| `getConversation(conversationId)` Q | same | id | `Conversation` | none | `NO_DATA_FOUND`, `CONVERSATION_NOT_ALLOWED`, `CONVERSATION_SUPPORT_ONLY` |
| `getMessages(conversationId, input)` Q | same | `OrdinaryInquiry` | `ChatMessages` newest first | none | same |
| `sendMessage(conversationId, body)` M | same | `body` trimmed, 1 to 2000 chars | `ChatMessage` | insert `messages`; `lastMessageAt`; other side's unread +1; socket events `message`, `unread`; notification `NEW_MESSAGE` | `TOO_MANY_MESSAGES` (HTTP 429, code `INTERNAL_SERVER_ERROR`), `MESSAGE_BODY_REQUIRED`, `MESSAGE_BODY_TOO_LONG`, access errors |
| `markConversationRead(conversationId)` M | same | id | `Conversation` | marks the other side's messages read, zeroes own unread; socket `unread`, `read` | access errors |

The GraphQL type for a chat message is called `ChatMessage` because `Message` is already the error enum.

### B.14 AI (`components/ai`)

| Operation | Who | Input and validation | Returns | Effect | Errors |
|---|---|---|---|---|---|
| `askAssistant(input)` M | G U P O A | `AskAssistantInput { message (non-empty, max 1000 chars), history? (max 10 items, each with role USER or ASSISTANT and content max 1000), locale? EN/KO/RU/UZ }` | `AssistantAnswer { answer, events[] }` (max 5 event cards) | model calls (counted in `ai_usage`) | `AI_DISABLED`, `AI_NOT_CONFIGURED` (503), `AI_RATE_LIMITED` (429), `RATE_LIMITED` + `AI_USER_DAILY_LIMIT`, `AI_DAILY_CAP_REACHED`, `AI_QUOTA_EXHAUSTED`, `AI_BUSY`, `AI_REQUEST_FAILED`, `AI_INVALID_RESPONSE` |
| `translateEvent(input)` M | O | `TranslateEventInput { eventId, targetLocales (1 to 4) }` | `[EventTranslation]` (suggestions, nothing saved) | model call | `AI_TRANSLATE_LOCALES_REQUIRED`, `NO_DATA_FOUND`, AI errors |
| `runEventModerationByAdmin(eventId)` M | A | id | `Event` with new `eventModeration` | stores moderation; audit `EVENT_MODERATION_RUN` | `NO_DATA_FOUND`, `AI_DISABLED`, `AI_NOT_CONFIGURED` |

`askAssistant` and `translateEvent` are mutations on purpose: they cost money (decision #60).

---

## Part C - Things a reader should not miss

- **Every list answers `{ list, metaCounter }`** and is paged with `$facet` (one aggregation returns the page and the total). A page past the end returns an empty `list`. Many services still contain `if (!result.length) throw NO_DATA_FOUND` after the `$facet`, but a `$facet` stage always outputs exactly one document, so that line cannot fire in practice; `getEventsByAdmin` had a different check that did throw and was fixed to return `{ list: [], metaCounter: [] }` (decision #101).
- **Hidden things answer like missing things.** A non-public event and a nonexistent event both answer `NO_DATA_FOUND`; someone else's order or ticket answers `NO_DATA_FOUND`/`NOT_ALLOWED_REQUEST`, so ids cannot be probed.
- **The server never trusts prices, roles, statuses or capacities** from the client; the corresponding fields are absent from the inputs.
- **Counters are best-effort side writes** (see `02-state-and-rules.md`, 4.10).
