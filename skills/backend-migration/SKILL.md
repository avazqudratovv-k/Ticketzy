---
name: backend-migration
description: Continue the Ticketzy backend migration from the Nestar codebase to Ticketzy ticketing concepts while preserving the existing NestJS architecture.
---

# Ticketzy Backend Migration

Use this skill when changing backend code for the Ticketzy ticketing migration.

## Workflow

1. Search for affected references to leftovers of the old catalog and to the entities you change before editing.
2. Preserve the resolver/service/module structure already used by `ticketzy-api`.
3. Keep DTOs, enums, and schemas in their existing folders.
4. Keep `MemberType.USER | ORGANIZER | ADMIN`; never accept a role or status from client input.
5. Use event terminology (Event, Venue, TicketType, Order, Ticket) for catalog behavior and database lookups.
6. Update social modules consistently when event counters, likes, views, comments, or notifications are involved.
7. Update batch logic when event or organizer ranking affects rank calculations.
8. Make ticket inventory changes atomic so tickets cannot be oversold.
9. Update `docs/ai/COMPLETED_TASKS.md` after major completed work.
