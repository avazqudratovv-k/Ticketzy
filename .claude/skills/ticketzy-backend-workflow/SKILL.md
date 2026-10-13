---
name: ticketzy-backend-workflow
description: Use when adding or changing a GraphQL operation, DTO, error message, audit entry or test in the Ticketzy backend, and before reporting a finished task.
---

# Ticketzy backend workflow

Read `AGENTS.md` and `docs/ai/DECISIONS.md` first. Decisions override any skill.

## Add an operation (example: `components/payout`)

1. **Input DTO** in `apps/ticketzy-api/src/libs/dto/<area>/<area>.input.ts`: `@InputType()` class, every field has a class-validator decorator (the global `ValidationPipe` uses `whitelist`, so undecorated fields are stripped, #26) and a `@Field`. Output types go in `<area>.ts` next to it.
2. **Enums and messages**: new values in `libs/enums/`. Every user-facing error is a new entry in `Message` (`libs/enums/common.enum.ts`), thrown as `BadRequestException(Message.X)` or the matching Nest exception. No inline strings.
3. **Resolver** in `components/<area>/<area>.resolver.ts`: `@Roles(MemberType.X)` plus `@UseGuards(RolesGuard)`; organizer writes add `ActiveOrganizerGuard`; purchases check `assertBuyerAccount` in the service. Take the caller with `@AuthMember('_id')`, never from the input. Log with `this.logger.log('Query: name')`.
4. **Service method**: stay thin in the resolver, logic in the service. Inventory and status changes are one conditional `findOneAndUpdate` (no transactions, #17). Pure rules go in `libs/*.ts` so they test easily.
5. **Audit and notification** for admin state changes: after the change succeeds, `auditLogService.record({ actorId, action, targetType, targetId, meta })` with a new `AuditAction` value, then `notificationService.createNotification(...)` when a person is affected. Both never throw.
6. **Admin operations**: names end in `ByAdmin` with `@Roles(ADMIN)` and `RolesGuard`; `components/auth/admin-access.spec.ts` checks this automatically.
7. **Tests**: a `*.spec.ts` beside the file (Jest, mocked models as in `payout.service.spec.ts`): happy path, each `Message` refusal, wrong role, and the race or repeat case for conditional updates.
8. **Docs**: next number in `docs/ai/DECISIONS.md`, entry in `docs/ai/COMPLETED_TASKS.md`.

## Verification checklist

- [ ] `npx tsc -p apps/ticketzy-api/tsconfig.app.json --noEmit` and the same for `apps/ticketzy-batch`
- [ ] `npm run build`
- [ ] `npm run test` (whole suite passes)
- [ ] `npm run lint` only if rewriting files is fine (it uses `--fix`); otherwise say it was skipped
- [ ] `npm run ai:check` only when AI code changed and the user agrees to a real call
- [ ] No `.env` read, no secrets printed, no new dependency, nothing committed

## Report format (as in COMPLETED_TASKS.md)

Short sections, bullets only:

- **What changed**: operations, files, new `Message` / enum values.
- **Tests**: spec files and cases added; checks run with counts (for example "tsc (api and batch), build and jest pass, N tests").
- **Decision**: number added to `DECISIONS.md`.
- **Not done / risks**: anything skipped, unverified or left unsure, stated plainly.
