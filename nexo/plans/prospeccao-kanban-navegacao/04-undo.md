---
id: 04-undo
milestone: v4.8.0
status: todo
depends_on: [03-restore-permission]
files_modified:
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/LeadDialog.tsx
  - apps/web/src/sales-ops/leads/UndoNotice.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-undo.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
acceptance: "After a successful reversible board move, existing lead edit, or soft delete, a notice offers Desfazer for about five seconds. Desfazer performs the inverse persisted mutation and refreshes cards and totals. A conversion move that creates a sale never offers Desfazer. Failed forward writes show no notice; failed inverse writes show an error without claiming restoration."
oracle: "apps/web/src/sales-ops/leads/__tests__/lead-undo.test.tsx"
---

# 04 - Desfazer for reversible lead writes

## Scope and prerequisite

Build after `03-restore-permission`, so a seller can use the existing `useRestoreLead()` hook to reverse their own delete.
This is the web interaction only, five changed files and below 600 changed lines. The fifth file is the existing contact-container oracle: the awaited save mutation changes its obsolete `mutate()` expectation while preserving that creation offers no edit undo.
If implementation grows beyond eight changed files or 600 changed lines, request a finite Nexo replan.
The feature level visual captures belong under `.nexo/tmp/`; visual access is not an automated delivery gate.

## Existing contracts

- `useMoveLead(filters)` owns the optimistic board and paired summary patch, rollback and leads root invalidation.
- `useSaveLead()` PATCHes an existing lead and invalidates the leads root.
- `useDeleteLead()` immediately performs the persisted soft delete using `POST /leads/:id/delete`.
- `useRestoreLead()` in `deleted-leads.ts` already calls `POST /leads/:id/restore` and invalidates the leads root.
- `LeadsBoard.emitMove` sends both drag and Mover button actions through `onMoveLead`.
  A conversion target calls `onRequestConversion`, creates a sale and passes `saleId` with the move.
  The server refuses subsequent moves of converted leads, so conversion is explicitly excluded from Desfazer.
- `LeadDialog` currently closes before its fire and forget mutation resolves; `ContactLeadDialog` already awaits its submit promise.

## Locked oracle first

Write `lead-undo.test.tsx` with the real container, QueryClient, board and dialogs and stubbed `fetch`, following `lead-delete.test.tsx`.
Prove both drag and Mover button callbacks offer undo after a successful ordinary move, then inverse POST restores the previous stage and valid position.
Prove original lost reason is sent when returning to a lost stage.
Prove a move payload carrying `saleId` or targeting a conversion stage offers no Desfazer even after the move succeeds; it must never attempt an inverse move of a converted lead or alter the created sale.
Prove failed forward moves show no notice.
Prove editing in both editions offers a notice only after PATCH succeeds, and inverse PATCH sends the prior edition-specific writable fields, including contact data or products.
Prove delete POSTs immediately, then Desfazer POSTs `/restore`, and the card and totals reconcile after invalidation.
Use fake timers to check an approximately five second window, replacement of an older notice, cleanup on unmount, and prevention of duplicate inverse requests.
Prove failed inverse shows an error and does not claim success.
Assert the persisted HTTP calls and refreshed board, not only local toast state.

## Implementation

1. In `LeadsBoardContainer`, capture a stable pre-write lead snapshot before each reversible move, edit or delete.
   Build edit inverse payloads from `leadToSeed` or `leadToContactSeed` according to the edition.
   Capture the original stage and visible column index for moves, plus the original lost reason if relevant.
   If the source row is not loaded, do not invent an inverse snapshot.
2. Use `mutateAsync` for forward writes and publish one undo action only after the server succeeds.
   Exclude a move when `payload.saleId` is present or its destination stage is `kind: 'conversion'`, including the move from a saved conversion wizard.
   Do not offer undo for creation.
3. Change full edition `LeadDialog` to await `onSubmit` and close only on success, with an inline save error on failure, as the contact dialog already does.
4. Add an accessible `UndoNotice` near the container outside modal dialogs, with a visible Desfazer button and about five seconds of action time.
   Keep one active notice.
   Clear its timer on replacement and unmount.
   Disable the action during an inverse request and reject duplicate clicks.
5. Undo a normal move with `useMoveLead(filters).mutateAsync` to the captured stage and index, including original lost reason when returning to lost.
   Suppress a second undo notice for this compensating move.
   Undo an edit through `useSaveLead().mutateAsync` with the captured prior payload.
   Undo a delete through existing `useRestoreLead().mutateAsync`.
   Let those hooks invalidate the leads root so cards and totals reconcile with server state.
   A delete restore uses the service's stage fallback and appended position rather than promising the precise former index.
6. A failed inverse leaves a clear error and refreshes the lead queries.
   If another actor changed the lead, never claim an exact reversal.
   Use Portuguese copy consistent with the board: `Lead movido`, `Lead editado`, `Lead excluído`, `Desfazer`, and `Não foi possível desfazer. Tente novamente.`

## Verification

Run once, never watch:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-undo.test.tsx
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
```

The separate Verify agent runs the locked oracle and affected suites.
The integrated wave runs the full suite, typecheck, lint and security checks.
No push or deploy.
