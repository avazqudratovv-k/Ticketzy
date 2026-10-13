# Ticketzy vs Nestar backend (comparison)

Report only. Nothing was changed in either repo except the three docs files of this task. Nestar reference: `/Users/kenneth/nestar` (read-only; git log shows 67 commits, last on 2026-10-02). Its `.env` was not read. Ticketzy `.env` was not read either.

Labels: **SAME** (copied convention, nothing added), **EXTENDED** (Ticketzy added to the Nestar convention without changing it), **DIVERGED** (Ticketzy changed or replaced a Nestar convention). A point gets the strongest label that applies; the sub-items that are SAME or DIVERGED inside an EXTENDED point are listed in the details.

## 1. Summary

| # | Point | Status | One line |
|---|---|---|---|
| 1 | Repo layout | EXTENDED | Same two apps, `libs` inside the app, `components/<name>/{module,resolver,service}`; 22 modules instead of 8, flat helper files in `libs/`, specs next to the code |
| 2 | NestJS setup | DIVERGED | Same bootstrap skeleton, but validation, CORS, env checks, GraphQL options and error logging were rewritten (#23 to #26, #64, #65) |
| 3 | GraphQL | EXTENDED | Same code-first resolver/service/DTO pattern, `{code, message}` errors, `$facet` pagination and sort whitelists; many more operations, a much larger `Message` enum, field resolvers |
| 4 | Mongoose | EXTENDED | Same `X.model.ts` default-export schemas and `@InjectModel('X')`; 26 indexes instead of 4, conditional updates, `bulkWrite`; the like/view unique index changed (#20) |
| 5 | Auth | DIVERGED | Same guards, `@Roles`, `@AuthMember` and `request.body.authMember`; token payload, lifetime and per-request member reload changed (#25) |
| 6 | Uploads | DIVERGED | Same `graphql-upload`, `imageUploader`, `uploads/<target>/`, `/uploads` static; client mimetype check replaced by magic bytes (#26) |
| 7 | Realtime | DIVERGED | Same `ws` gateway and `WsAdapter`; global chat room with `?token=` replaced by per-conversation rooms and header/first-message auth (#58, #59) |
| 8 | Batch jobs | EXTENDED | Same batch app shape (`@Cron` with names, `try/catch`, `lib/config.ts`); four jobs instead of three, some schedules changed (the rollback job was removed, #96) |
| 9 | Logging, interceptors, filters | DIVERGED | Same `LoggingInterceptor` file, now without request variables; `console.log` replaced by `Logger`; neither repo has exception filters |
| 10 | Tests | EXTENDED | Same Jest config and `*.spec.ts` rule; Nestar has no unit tests, Ticketzy has 38 spec files |
| 11 | Scripts, tooling, TypeScript | EXTENDED | `tsconfig`, `nest-cli.json`, ESLint and Prettier files are identical; Ticketzy adds seed and AI scripts and three dependencies |
| 12 | Docs | EXTENDED | Nestar has only the Nest boilerplate README; Ticketzy adds AGENTS.md, CLAUDE.md and `docs/ai/` |

**Counts:** SAME 0, EXTENDED 7, DIVERGED 5 (12 points). No point is SAME because every area gained something; the SAME items are the sub-items below (most of the structure).

## 2. Details

### 1. Repo layout: EXTENDED
- SAME: `nest-cli.json` monorepo with `apps/<name>-api` and `apps/<name>-batch`; DTOs, enums, schemas and interceptor inside the app at `apps/<app>/src/libs/{dto,enums,schemas,interceptor,types}`; modules at `src/components/<name>/<name>.{module,resolver,service}.ts`; schemas `Name.model.ts` (PascalCase) with default export; DTOs `libs/dto/<name>/<name>.ts`, `.input.ts`, `.update.ts`; `components/components.module.ts` aggregates modules; absolute `apps/...` imports between apps (#4).
- EXTENDED: 22 component folders vs 8 (`ai`, `audit-log`, `conversation`, `event`, `order`, `organizer`, `payment`, `payout`, `refund`, `sales`, `seat`, `ticket`, `ticket-type`, `venue`, ...); kebab-case folder names for multi-word modules (`ticket-type`, `audit-log`); `libs/dto/common/common.input.ts` (Nestar kept `OrdinaryInquiry` in the property DTO file); flat pure-logic files in `libs/` (`commission.ts`, `refund-policy.ts`, `payout.ts`, `venue-layout.ts`, ...); `seed.ts`, `seed-demo.ts`, `ai-check.ts` next to `main.ts`; `components/ai/providers/`; guards `conversation.guard.ts`, `notification.guard.ts`, `organizer.guard.ts`.
- Reasons: domain change (#10, #11); `libs/` extraction was deferred on purpose (#4).
- Nestar leftovers Ticketzy also carries: an empty `schemas/` folder next to `src` exists in Nestar only (`apps/nestar-api/src/schemas`); Ticketzy does not have it.

### 2. NestJS setup: DIVERGED
- SAME: `main.ts` order (pipes, interceptor, CORS, `graphqlUploadExpress({maxFileSize: 15000000, maxFiles: 10})`, `/uploads` static, `WsAdapter`, `PORT_API ?? 3000`); `AppModule` imports `ConfigModule`, `GraphQLModule` (Apollo, code-first `autoSchemaFile: true`, `uploads: false`), `ComponentsModule`, `DatabaseModule`, `SocketModule`; same `AppController`/`AppService`/`AppResolver`; Mongo URI by `NODE_ENV` (`MONGO_PROD` / `MONGO_DEV`); `tsconfig.json` and `nest-cli.json` (webpack on) identical.
- DIVERGED: `ValidationPipe()` became `{ whitelist: true, transform: true }`; `origin: true` became `CLIENT_URL` (comma separated list); `ConfigModule.forRoot()` became `forRoot({ validate: validateEnv([...]) })` that crashes without `SECRET_TOKEN` / `QR_SECRET` / Mongo URI; `GraphQLModule.forRoot` became `forRootAsync` so playground and introspection are off in production; `formatError` keeps the `{code, message}` shape but logs through `Logger` and downgrades expected errors to `warn` (`libs/expected-errors.ts`); `DatabaseModule` uses `Logger`.
- Evidence: `apps/ticketzy-api/src/main.ts`, `app.module.ts`, `libs/env.validation.ts`. Reasons: DECISIONS #26 (hardening), #64 and #65d (error codes and log noise).

### 3. GraphQL: EXTENDED
- SAME: code-first; `@Resolver()` class calling one service; `@Args('input') input: XInput`; `@Mutation`/`@Query` with `(returns) => Type`; `@UseGuards` + `@Roles` on the handler; list results as `{ list, metaCounter: [{ total }] }` built by `$facet` (`$skip`/`$limit` inside the facet; Nestar 14 `metaCounter` uses, Ticketzy 27); `page`/`limit` inputs (`OrdinaryInquiry`); sorts are `@IsIn(availableXSorts)` whitelists in `libs/config.ts` plus `direction: Direction` (ASC = 1, DESC = -1), default `createdAt` DESC; `shapeIntoMongoObjectId` in the resolver; `lookupMember`-style `$lookup` helpers in `libs/config.ts`; `Message` enum in `libs/enums/common.enum.ts`; error body is `{ code, message }` in both.
- EXTENDED: about 96 operations vs about 40 (counted by `@Query`/`@Mutation` in resolvers); `Message` enum grew from 17 to about 115 values (every user-facing error goes through it, rule in AGENTS.md); `@ResolveField` on `Event` for owner/admin-only fields; sort whitelists got an `_id` tie-break in places (#72c); new lookup helpers (`lookupEventWithVenue`, `lookupActiveOrganizer`); resolvers log with `Logger` (`this.logger.log('Mutation: ...')`) instead of `console.log('Mutation: ...')`.
- Drift not in DECISIONS: exception classes. Nestar throws mostly `InternalServerErrorException` (39 of 55 throws). Ticketzy throws `BadRequestException` 127 times and `InternalServerErrorException` 58 times (counted on 2026-10-13; 126 and 55 when this was first written); clients see GraphQL status 200 either way. One `GraphQLError` is used for the login code (#64).

### 4. Mongoose: EXTENDED (one DIVERGED sub-item)
- SAME: `new Schema({...}, { timestamps: true, collection })` in `libs/schemas/X.model.ts`, `export default XSchema`; modules register `MongooseModule.forFeature([{ name: 'X', schema }])`; services use `@InjectModel('X') private readonly xModel: Model<X>`; reads end in `.lean().exec()`; lists are aggregations with `$match`, `$sort`, `$facet`, `$lookup`/`$unwind`; counters change through a `xStatsEditor` with `$inc`; `DatabaseModule` identical apart from logging.
- EXTENDED: 19 schemas vs 9; 26 `.index()` calls vs 4 (compound, partial unique, e.g. `eventSeats` unique `(eventId, sectionKey, row, number)`); atomic inventory with conditional `findOneAndUpdate` (#17); chunked `bulkWrite` upserts (#43); nested sub-schemas (`venueLayout`, `commissionOverride`); aggregations for payouts and seat counts (#77, #79); no transactions by decision.
- DIVERGED sub-item: like and view unique indexes include the group (`{memberId, likeRefId, likeGroup}`); Nestar's `{memberId, likeRefId}` ignored the group (#20). Existing databases keep the old index until dropped by hand.
- Nestar-only oddity: `Property` unique index over type, location, title and price; it was removed together with the entity.

### 5. Auth: DIVERGED
- SAME: `AuthModule` exports `AuthService`; `AuthGuard`, `RolesGuard`, `WithoutGuard` read the bearer token from `request.headers.authorization` of the GraphQL context and store the member in `request.body.authMember`; `@Roles(...roles)` is `SetMetadata('roles', roles)`; `@AuthMember('field')` param decorator is byte for byte the same; bcryptjs hashing; `contextType === 'graphql'` branch with a comment for non-GraphQL contexts.
- DIVERGED: Nestar signs the whole member document (minus password) into a 30 day token and the guards trust it; Ticketzy signs only `{ _id, memberType }` for 1 day and `AuthService.authenticate` reloads the member from the database on every request so suspensions apply at once (#25). Guards use `getBearerToken` and the `Message` enum, log through `Logger`, and `JwtModule` is registered async. Login is by email, not nick (#24); unknown email and wrong password give one message; a dummy hash equalizes timing.
- EXTENDED: `ActiveOrganizerGuard`, `NotificationGuard`, `ConversationGuard` (`allowRestricted`), roles `ORGANIZER` and `ADMIN`; `admin-access.spec.ts` scans every resolver for correct admin guards (#72d).
- Reasons: #13, #23 to #25.

### 6. Uploads: DIVERGED
- SAME: `graphql-upload` v13 with `uploads: false` in Apollo and `graphqlUploadExpress` in `main.ts`; `imageUploader` / `imagesUploader` mutations in `member.resolver.ts` taking `GraphQLUpload`; files stored under `uploads/<target>/` with a UUID name; `express.static('./uploads')`.
- DIVERGED: Nestar checks `validMimeTypes` (the client-sent mimetype) and keeps the client's extension via `getSerialForImage`; Ticketzy sniffs the file head (`detectImageExtension`, png/jpeg magic bytes), picks the extension itself and streams through `pipeline` into `createWriteStream` (`libs/config.ts`). The `article` upload target is gone with the board (#27).
- Not compared line by line: the full bodies of the two uploader mutations in Ticketzy's `member.resolver.ts`; the evidence is the shared helper in `libs/config.ts`.
- Reason: #26.

### 7. Realtime: DIVERGED
- SAME: `ws` through `WsAdapter`; `@WebSocketGateway({ transports: ['websocket'], secure: false })`; logger name `SocketEventsGateway`; state kept in process memory.
- DIVERGED: Nestar (115 lines) has one global chat room, `?token=` in the URL (guests allowed), a message history array and join/leave broadcasts; Ticketzy (164 lines plus a 235 line spec) has no global room, tokens only from the `Authorization` header or a first `auth` message (4401/4408 close codes, 10 s auth timeout), one private room per conversation, typing rate limit, restriction sync for rejected or suspended organizers.
- Reasons: #58, #59, and the security rule that tokens never go in URLs. Open question in DECISIONS: keep or drop chat.

### 8. Batch or scheduled jobs: EXTENDED
- SAME: separate app `apps/<name>-batch` (`BatchModule`, `BatchController` with `@Cron(..., { name })`, `BatchService`, `lib/config.ts` job names, own `DatabaseModule`); `@Timeout(1000)` "BATCH SERVER READY"; each job wrapped in `try/catch` with `this.logger['context'] = NAME`; the `@Interval(1000)` test block is commented out in both; schemas are imported from the API app by absolute path (#4).
- EXTENDED: four jobs instead of three (`batchTopEvents`, `batchTopOrganizers`, `batchExpireOrders`, `batchEndEvents`; `batchRollback` was removed by decision #96); module registers five schemas and uses `validateEnv()`; batch has a spec (`batch.service.spec.ts`).
- Schedule drift: Nestar runs rollback, top properties and top agents every minute (`00/20/40 * * * * *`); Ticketzy runs the two top jobs hourly (`20 00`, `40 00`; the rollback at `00 00` was removed by #96), expiry every minute at second 10, event ending hourly at minute 30. Only the end-events job (#39) and expiry (#50) are in DECISIONS; the change of the ranking schedules is now recorded in #96.
- The `batch.controller.ts` still has the Nestar `getHello` route.

### 9. Logging, interceptors, filters: DIVERGED
- SAME: global `LoggingInterceptor` (same file name `Logging.interceptor.ts`, same REQUEST/RESPONSE log with timing); no `ExceptionFilter`, `APP_FILTER` or `APP_INTERCEPTOR` anywhere in either repo (checked by search); errors are shaped only in `formatError`.
- DIVERGED: Ticketzy logs the operation name instead of the request body (variables carry passwords); `console.log` in guards, resolvers and database was replaced by `Logger` (52 files use `new Logger` vs 2 in Nestar, counted on 2026-10-13; no `console.*` left outside seeds and `ai-check`); expected domain errors log as `warn` (#65d).
- Reason: #65d is recorded; the interceptor change and the `Logger` migration have only a code comment, no decision number.

### 10. Tests: EXTENDED
- SAME: Jest config in `package.json` (`testRegex .*\.spec\.ts$`, `ts-jest`, `roots: apps/`), `test/app.e2e-spec.ts` + `jest-e2e.json` in both apps (the Nest boilerplate "Hello World" e2e; both need a database; not run here).
- EXTENDED: Nestar has 0 unit specs. Ticketzy has 47 spec files and 999 Jest tests (counted on 2026-10-13 from the Jest run after the C3 fixes; the first version said about 639 by a pattern count that missed `it.each`), colocated with the code (`*.service.spec.ts`, `libs/*.spec.ts`, `guards.spec.ts`, `socket.gateway.spec.ts`, `batch.service.spec.ts`); style: pure functions tested directly, services with mocked Mongoose models, frozen clock for date logic (#70), a resolver scan test (`admin-access.spec.ts`).
- Not run: the suites were not executed for this report (report-only task).

### 11. Scripts, tooling, lint, TypeScript: EXTENDED
- SAME: `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json` (apart from names), `.eslintrc.js`, `.prettierrc` are identical (diffed). `npm run lint` uses `--fix` in both. Prettier says `useTabs: false` while most source uses tabs, in both repos; this lint debt came with Nestar (#6).
- EXTENDED: scripts `seed`, `seed:demo`, `ai:check`; dependencies `@anthropic-ai/sdk`, `@google/genai`, `dotenv`; `.env.example` (Nestar has none); `.vscode`, `.gitattributes`.
- Relaxed TypeScript (`strictNullChecks: false`, `noImplicitAny: false`) is unchanged.

### 12. Docs: EXTENDED
- Nestar: boilerplate Nest README only; no AGENTS.md, CLAUDE.md or docs folder.
- Ticketzy: `AGENTS.md`, `CLAUDE.md`, `docs/ai/` (DECISIONS, COMPLETED_TASKS, NEXT_STEPS, BACKEND_MIGRATION, FRONTEND_MIGRATION, PROMPTS, SKILLS, and this file), `.agents/skills` + `.claude/skills`. Legacy root `SKILLS.md` and `skills/` still exist next to the new index (#88).

## 3. DIVERGED items: keep or realign

| Item | Where | View | Effort |
|---|---|---|---|
| Hardened bootstrap (whitelist validation, CORS list, env validation, prod playground off) | #26 | **Keep.** Security fixes, no reason to go back | none |
| Token payload `{_id, memberType}`, 1 day, member reloaded per request | #25 | **Keep.** Costs one read per request; Nestar's full-member 30 day token goes stale | none |
| Login by email, one error for unknown email/wrong password | #24 | **Keep** | none |
| Magic-byte upload check | #26 | **Keep.** Client mimetype is spoofable | none |
| Conversation rooms and token not in URL | #58, #59 | **Keep.** Required by the new product; the global room was removed | none |
| Like/view unique index includes the group | #20 | **Keep.** Needed (MEMBER and EVENT likes coexist) | small: drop the old index in existing databases by hand |
| `LoggingInterceptor` no longer logs variables | no decision number | **Keep**, but record it. Passwords would otherwise reach the log | trivial: add a decision line |
| `console.log` to `Logger` | no decision number | **Keep**, record it | trivial |
| Ranking batch jobs hourly instead of every minute | no decision number | **Keep** the hourly schedule (every minute is demo-grade), record it | trivial |
| Exception class mix (`BadRequest` 127 vs `InternalServerError` 58) | no decision number | **Realign** (inconsistent for no good reason): `NO_DATA_FOUND` and similar are thrown as `InternalServerErrorException` (Nestar habit) next to `BadRequestException`. Clients only see GraphQL 200 plus `code`, so this affects the `code` value only | medium: audit about 55 throw sites, check frontend code matching |
| `batch.controller.ts` keeps the `getHello` route and the commented `@Interval` block | Nestar leftover | **Realign** (remove) when touched next | trivial |

## 4. Overall judgement

Ticketzy follows the Nestar structure closely: same monorepo with two apps, same folder and file naming, same resolver/service/DTO/schema pattern, same guards and decorators, same `$facet` pagination, same batch app shape and identical build and lint configs. It is Nestar's skeleton with a much larger domain on top. Where it diverges (bootstrap, auth token, uploads, realtime, logging) the change is a deliberate hardening, mostly recorded in DECISIONS.

Three most important differences:
1. **Auth model (#25):** minimal 1 day token plus a database reload on every request, instead of a 30 day token carrying the whole member.
2. **Hardened bootstrap and input handling (#26, #64, #65):** env validation, whitelist validation, CORS list, production introspection off, magic-byte uploads, structured error logging.
3. **Realtime redesign (#58, #59):** per-conversation rooms with header or first-message auth replace the global URL-token chat room.

Not compared: runtime behavior (nothing was started or tested in either repo); Nestar `dist/`, `uploads/` and `.env`; the full bodies of the Ticketzy upload mutations; the frontends (`nestar-next`, `ticketzy-next`).
