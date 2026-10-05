# Frontend Migration Plan (Next.js)

> **Important:** the Next.js frontend is **not in this repository** (only `apps/ticketzy-api` and `apps/ticketzy-batch` exist). Page and component names below are **assumed from typical Nestar structure and the backend GraphQL surface**. Verify each against the actual frontend repo before acting. GraphQL operation names are exact (taken from the resolvers).

## Step-by-step plan

| Step | Task | Depends on |
|---|---|---|
| 0 | Locate the frontend repo; inventory pages, components, `.graphql`/`gql` documents and Apollo client config | none |
| 1 | Rename branding only: package name, title, logo, copy ("Nestar" to "Ticketzy"). Point the Apollo endpoint at the renamed API (URL and port unchanged) | none |
| 2 | Add UI terminology constants (see table below) so strings are centralized | 1 |
| 3 | Backend layer 2/3 ships Event operations **alongside** old Property ones (deprecated aliases) | backend |
| 4 | Switch property pages to the Event operations one page at a time | 3 |
| 5 | Replace Agent pages with Organizer pages | backend Organizer role |
| 6 | Add new flows: ticket selection, checkout, order history, ticket QR | backend Order/Ticket |
| 7 | Remove old Property documents and dead components once nothing imports them | 4-6 |

## Page / component mapping (assumed)

| Old Nestar (assumed) | Ticketzy | Notes |
|---|---|---|
| Home: top properties, top agents, newest | Home: featured events, top organizers, upcoming | batch rankings feed this |
| Property list + filters (type, location, price, beds) | Event list + filters (category, city/venue, date, price) | beds/rooms/square filters removed |
| Property detail | Event detail + ticket types | add ticket selector |
| Property create/edit (agent) | Event create/edit (organizer) | add ticket tiers and venue |
| Agent list / agent detail | Organizer list / organizer detail | |
| Favorites (`getFavorites`) / Recently visited (`getVisited`) | Saved events / Recently viewed | |
| Community board | Community / News | keep or drop |
| Member page, login/signup, my-page | same | reuse |
| Chat widget (`ws`, `?token=`) | same | reuse |
| CS / notice (FAQ, terms, inquiry) | same | backend module still to wire |
| none | Cart/checkout, My tickets, Order history | new |

## GraphQL rename plan
Operation names change only when the backend adds the new ones. Keep the old ones as deprecated aliases until the frontend is migrated.

| Current (exact) | Planned |
|---|---|
| createProperty | createEvent |
| getProperty | getEvent |
| updateProperty | updateEvent |
| getProperties | getEvents |
| getFavorites | getSavedEvents |
| getVisited | getVisitedEvents |
| getAgentProperties | getOrganizerEvents |
| likeTargetProperty | likeTargetEvent |
| getAllPropertiesByAdmin | getAllEventsByAdmin |
| updatePropertyByAdmin | updateEventByAdmin |
| removePropertyByAdmin | removeEventByAdmin |
| getAgents | getOrganizers |
| createComment / getComments (`CommentGroup.PROPERTY`) | same operations, group `EVENT` |
| New | createOrder, getMyOrders, getMyTickets, getTicketTypes, checkInTicket |
| Unchanged | signup, login, checkAuth, checkAuthRoles, updateMember, getMember, likeTargetMember, subscribe, unsubscribe, getMemberFollowings, getMemberFollowers, imageUploader, imagesUploader, board-article operations |

Input fields follow the same rule: `propertyX` to `eventX` (e.g. `propertyType` to `eventCategory`, `propertyLocation` to venue/city), and the frontend types are regenerated from the schema.

> **Implemented backend names (differs from the plan above):** `getFavorites` and `getVisited` kept their names and return events; the organizer listing is `getAgentEvents` (the role is still `AGENT`); `getAgents` is unchanged. New: `createVenue`, `updateVenue`, `getVenue`, `getVenues`, `createTicketType`, `updateTicketType`, `getTicketTypes`, `createOrder`, `payOrder`, `cancelOrder`, `getOrder`, `getMyOrders`, `getAllOrdersByAdmin`, `getMyTickets`, `checkInTicket`. No deprecated `*Property*` aliases were added: those operations no longer exist.

## UI terminology

| Nestar | Ticketzy |
|---|---|
| Property / Properties | Event / Events |
| Agent | Organizer |
| Apartment / Villa / House | Concert / Sports / Theatre (final list to be decided) |
| Location (city enum) | Venue / City |
| Price | Ticket price |
| Beds / Rooms / Square | removed; replaced by Capacity / Available tickets |
| Sold | Sold out |
| Rent / Barter | removed (or Featured / Online) |
| Built/constructed year | Event date |
| Contact agent | Contact organizer |
| Favorites | Saved events |

## Risks
- Changing operation names before the backend keeps aliases will break the live frontend. Keep aliases until step 7.
- Cached Apollo `__typename`s (`Property`, `Member`) change with the schema; update `typePolicies` and fragments.
