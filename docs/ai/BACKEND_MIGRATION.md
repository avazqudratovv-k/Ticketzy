# Backend Migration: Nestar to Ticketzy

> Naming note: the target project is **Ticketzy**. The request mentioned "Petoria"; this repo, its remote (`avazqudratovv-mit/Ticketzy`) and package name are all Ticketzy, so these docs use Ticketzy.

## 1. Original project (Nestar)
NestJS 10 GraphQL monorepo for a real-estate platform.

| Item | Detail |
|---|---|
| Apps | `nestar-api` (GraphQL, upload, WebSocket), `nestar-batch` (cron ranking jobs) |
| Stack | NestJS 10, Apollo 4 (`@nestjs/graphql` 12, code-first), Mongoose 8, JWT + bcryptjs, graphql-upload 13, `ws`, `@nestjs/schedule` |
| Domain | Member (USER/AGENT/ADMIN), Property, BoardArticle, Comment, Follow, Like, View, Notice, Notification |
| Shared code | Inside the API app: `src/libs/{dto,enums,schemas,interceptor,types,config.ts}` (no top-level `libs/`) |
| Storage | Images on local disk under `uploads/{member,property,article}` |

## 2. New project (Ticketzy)
A ticket-selling platform built on the same codebase. Target domain (planned, not implemented): Event, Venue, TicketType, Order, Ticket (with QR/code), Organizer role.

## 3. Migration goal
Reuse auth, member, like/view/comment/follow, chat, upload and batch scaffolding. Replace the Property (real estate) domain with ticketing. Done in layers so the API stays working at every step.

| Layer | Status |
|---|---|
| 1. Safe rename (identifiers only) | **Done**, committed as `3386edb` |
| 2. Decouple generic services from Property | **Done** (like/view/comment no longer know Property; group enums say `EVENT`) |
| 3. Property to Event/Venue/TicketType | **Done**; `components/property` and all Property DTOs, schemas and enums are removed |
| 4. Order/Ticket + atomic inventory | **Done** (payment is a manual stub, see DECISIONS #16) |
| 5. Organizer role, batch ranking rewrite | Batch rewrite **done**; Organizer role **deliberately not done**: `MemberType` stays `USER / AGENT / ADMIN` (DECISIONS #13) |

> Sections 5 to 8 below describe the original Nestar state at the time of layer 1. The current domain is: members, events, venues, ticketTypes, orders, tickets, payments, boardArticles, comments, likes, views, follows (plus the notice and notification schemas, still unwired). Current GraphQL operations are listed in `COMPLETED_TASKS.md` section 7.

## 4. Naming changes (layer 1)

| Kind | Old | New |
|---|---|---|
| App folder | `apps/nestar-api` | `apps/ticketzy-api` |
| App folder | `apps/nestar-batch` | `apps/ticketzy-batch` |
| `nest-cli.json` project keys / root / sourceRoot / tsConfigPath | `nestar-*` | `ticketzy-*` |
| `package.json` name | `nestar` | `ticketzy` |
| `package.json` scripts (`start:dev:batch`, `start:prod`, `start:prod:batch`, `test:e2e`) | `nestar-*` paths | `ticketzy-*` paths |
| `package-lock.json` top-level name | `nestar` | `ticketzy` |
| `tsconfig.app.json` `outDir` (both apps) | `dist/apps/nestar-*` | `dist/apps/ticketzy-*` |
| Absolute imports (`batch.module.ts`, `batch.service.ts`, `auth.guard.ts`, `roles.guard.ts`) | `apps/nestar-api/src/libs/...` | `apps/ticketzy-api/src/libs/...` |
| Welcome strings (`app.service.ts`, `batch.service.ts`) | "Nestar Rest API / BATCH Server" | "Ticketzy Rest API / BATCH Server" |
| Batch e2e spec (`apps/ticketzy-batch/test/app.e2e-spec.ts`) | imported nonexistent `NestarBatchModule` | imports real `BatchModule` |

No `nestar` string existed in `.env`, so no environment label or DB name changed.

## 5. Module changes
No module was added, removed or modified in behavior. Current modules under `apps/ticketzy-api/src/components/`:

| Module | Status | Ticketzy direction |
|---|---|---|
| member | unchanged | keep; AGENT becomes Organizer later |
| auth (JWT, `AuthGuard`, `WithoutGuard`, `RolesGuard`) | unchanged | keep |
| property | unchanged | replace with Event / Venue / TicketType |
| board-article | unchanged | keep as community/news, or drop |
| comment, follow | unchanged | keep; extend group enums |
| like, view | unchanged (no resolver; services only) | keep; decouple from Property DTOs |
| notice (schema + enum only) | unchanged | wire up module (FAQ/terms/inquiry) |
| notification (schema + enum only) | unchanged | wire up |
| socket (`ws` gateway, in-memory) | unchanged | keep; persistence optional |
| batch app | unchanged | rewrite ranking for events/organizers |

## 6. GraphQL changes
**None.** Operation names, types and fields are identical to Nestar. Current operations, by resolver:

| Resolver | Operations |
|---|---|
| member | signup, login, checkAuth, checkAuthRoles, updateMember, getMember, getAgents, likeTargetMember, getAllMembersByAdmin, updateMemberByAdmin, imageUploader, imagesUploader |
| property | createProperty, getProperty, updateProperty, getProperties, getFavorites, getVisited, getAgentProperties, likeTargetProperty, getAllPropertiesByAdmin, updatePropertyByAdmin, removePropertyByAdmin |
| board-article | createBoardArticle, getBoardArticle, getBoardArticles, updateBoardArticle, likeTargetBoardArticle, getAllBoardArticlesByAdmin, updateBoardArticleByAdmin, removeBoardArticleByAdmin |
| comment | createComment, updateComment, getComments, removeCommentByAdmin |
| follow | subscribe, unsubscribe, getMemberFollowings, getMemberFollowers |

Not verified: a schema-introspection diff before/after. The rename touched no decorators or types, so none is expected.

## 7. MongoDB collections / schemas
**Unchanged.** Schemas live in `apps/ticketzy-api/src/libs/schemas/`.

| Collection | Schema | Note |
|---|---|---|
| `members` | Member | fields `memberX` |
| `properties` | Property | fields `propertyX`; unique index on type + location + title + price (`Property.model.ts`) |
| board articles, `comments`, `follows`, `likes`, `views` | respective models | Like and View have unique indexes |
| notices, notifications | Notice, Notification | schema only |

Planned new collections (not created): events, venues, ticket types, orders, tickets.

## 8. Compatibility notes
- Existing data and clients keep working: API surface and collections are untouched.
- **Absolute imports** (`apps/ticketzy-api/src/...`) rely on `baseUrl: ./`. Any new code or external tool referencing `nestar-*` paths will break.
- **Stale build output:** `dist/nestar-api` and `dist/nestar-batch` may remain on disk (gitignored). Remove with `rm -rf dist`.
- **Lint:** `npm run lint` uses `--fix`. The baseline has 2379 prettier errors (tabs vs spaces) unrelated to this work.
- **Coupling to fix before the Property to Event swap:** `LikeService`/`ViewService` import Property DTOs, `CommentService` injects `PropertyService`, and `Like.model.ts` uses `ViewGroup` as its enum.
- Hard-coded enums to generalize: `PropertyLocation`, `MemberType.AGENT`, `*Group.PROPERTY`.
