---
name: product-logic
description: Review Ticketzy event API consistency across GraphQL operations, DTOs, schemas, enums, filters, and remaining legacy terminology.
---

# Ticketzy Event API Review

Use this skill for review-only passes or pre-edit analysis of the event API.

## Review Checklist

- Confirm GraphQL operation names use event terminology (see `docs/ai/FRONTEND_MIGRATION.md`):
  - `createEvent`
  - `getEvent`
  - and where it is related
- Confirm shared operations such as `getFavorites`, `getVisited` and `getOrganizerEvents` return event data.
- Confirm DTOs, schemas, and enums agree on event fields and nullability.
- Confirm filters use event category, city or venue, date, price and etc.
- Confirm no terminology from the previous catalog remains (listing, location enums, room or area filters, agent).
- Report real findings with paths and behavior impact.
