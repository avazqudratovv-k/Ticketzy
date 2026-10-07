# Frontend Migration Plan (Next.js)

> **Important:** the Next.js frontend is **not in this repository**. It lives in `~/ticketzy-next` (copied from `nestar-next`, pages router, Apollo Client, MUI, SCSS, next-i18next, Yarn only). It still calls the removed operations of the old catalog, so most pages cannot work until they are moved to the operations below. GraphQL operation names here are exact (taken from the resolvers).

## Backend API the frontend must use

| Area | Operations |
|---|---|
| Auth | `signupUser`, `signupOrganizer`, `login` (all by `memberEmail`; the token holds only `_id` and `memberType`, so load the profile with `getMember`), `checkAuth`, `checkAuthRoles` |
| Members | `getMember`, `getOrganizers`, `updateMember`, `likeTargetMember`, `imageUploader`, `imagesUploader`; admin: `getAllMembersByAdmin`, `updateMemberByAdmin` |
| Events | `getEvents`, `getEvent`, `getFavorites`, `getVisited`, `likeTargetEvent`; organizer: `createEvent`, `updateEvent`, `getOrganizerEvents`; admin: `getAllEventsByAdmin`, `updateEventByAdmin`, `removeEventByAdmin` |
| Venues and tickets | `getVenue`, `getVenues`, `createVenue`, `updateVenue`, `getTicketTypes`, `createTicketType`, `updateTicketType` |
| Orders and tickets | `createOrder`, `payOrder`, `cancelOrder`, `getOrder`, `getMyOrders`, `getAllOrdersByAdmin`, `getMyTickets`, `checkInTicket` |
| Social | `createComment`, `updateComment`, `getComments` (events only), `subscribe`, `unsubscribe` (organizers only), `getMemberFollowings`, `getMemberFollowers` |
| Admin: organizer approval | `getOrganizersByAdmin`, `verifyOrganizerByAdmin`, `rejectOrganizerByAdmin`, `suspendOrganizerByAdmin`, `reinstateOrganizerByAdmin`, `setCommissionOverrideByAdmin`, `getAuditLogsByAdmin` |
| Content | `getNotices`, `getMyNotifications`, `markNotificationRead` |

Enums changed: `MemberType` = USER, ORGANIZER, ADMIN; `MemberStatus` = PENDING, ACTIVE, REJECTED, SUSPENDED, DELETE; `CommentGroup` = EVENT; `LikeGroup` = MEMBER, EVENT. Public member and organizer data and public events are only returned for ACTIVE members (DECISIONS #30, #34). `memberEmail`, `rejectReason` and `commissionOverride` are returned only to the member themselves and to admins. Organizer status changes use the admin operations above, not `updateMemberByAdmin`.

## Step-by-step plan

| Step | Task | Depends on |
|---|---|---|
| 0 | Inventory pages, components, GraphQL documents and the Apollo setup in `~/ticketzy-next` | none |
| 1 | Rebrand: package name, titles, logo, copy | none |
| 2 | New auth: signup and login by email, organizer signup with a "waiting for approval" state, no JWT-decoded profile | backend (done) |
| 3 | Replace the old catalog pages with event list, filters (category, city or venue, date, price) and event detail with ticket types | backend (done) |
| 4 | Organizer pages: organizer list and detail, create and manage events, venues and ticket types | step 2 |
| 5 | New flows: ticket selection, checkout, order history, my tickets with QR | backend (done) |
| 6 | Remove the community board, its editor packages, and dead components and styles | steps 3 to 5 |

## UI terminology

| Use | Instead of |
|---|---|
| Event / Events | the old catalog entity |
| Organizer | the old seller role |
| Concert, Sport, Theater, Conference, Festival, Other | the old type list |
| Venue and city | the old location list |
| Ticket price, capacity, available tickets | the old size and room filters |
| Sold out | the old sold state |
| Event date | the old build year |
| Contact organizer | the old contact button |
| Saved events | the old favorites label |

## Risks
- The live frontend breaks on every removed operation and on the new login input; migrate page by page against a running backend.
- Cached Apollo `__typename`s change with the schema; update `typePolicies` and fragments.
