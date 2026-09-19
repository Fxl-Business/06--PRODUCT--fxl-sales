# exec 08-web-conversion

Branch `feat/20260918-08-web-conversion`, commit `559a4e7`.
Status: PASS.

## Plan versus shipped code

The three cross-slice defects the plan told me to repair were ALREADY REPAIRED upstream.
I applied none of them and touched none of those files.

- DEFECT 1, `MoveLeadPayload.saleId`: already present in `apps/web/src/sales-ops/leads/api.ts`, and
  `leadsApi.moveLead` already serializes it with a conditional spread onto the `{stageId, position}`
  wire shape. No edit.
- DEFECT 2, `emitMove` discarding the sale id: `apps/web/src/sales-ops/leads/LeadsBoard.tsx` already
  spells `if (saleId === null) return;` then `onMoveLead({ ...payload, saleId });`. No edit.
- DEFECT 3, `LeadStageKind`: already the three-member `'normal' | 'conversion' | 'lost'` in
  `apps/web/src/sales-ops/leads/types.ts`, with no `stageIsReadOnly` anywhere and read-only keyed on
  `leadIsConverted(lead)`. No edit.
- `LeadsBoardContainer.tsx` already forwarded `onRequestConversion` verbatim, so it needed no edit
  either. `apps/web/src/sales-ops/leads/api.ts`, `LeadsBoard.tsx` and `LeadsBoardContainer.tsx` are
  therefore BYTE-UNCHANGED by this slice, although the plan listed all three in `files_modified`.
- No `board-model.ts`, no `LeadMoveCommand`, no `board-model.test.ts` was created.

Other points where the shipped code won over the plan:

- The plan says `leads/conversion.ts` is covered by slice 06's source scanner "for free" because it
  lives under `leads/`. It is NOT: `board-write-surface.test.ts` scans an EXPLICIT `OWNED_FILES`
  list, not the directory. I added `'conversion.ts'` to that list, which is the only reason the
  claim is now true. That is one file outside `files_modified`, listed below.
- The plan's `SaleWizardRequest` sketch resolves `created.id`; the real identity guard returns
  `{saleId, saleCode}`, so the call is `created.saleId`.
- The plan's `requestLeadConversion` sketch reads `request.lead`; that matched the shipped
  `LeadConversionRequest` exactly.

## Files outside `files_modified`

Two, both deliberate and both named in the plan's own prose or forced by the shipped code.

1. `apps/web/src/sales-ops/calculations.ts` - received `hasFuncao`, `FUNCAO_SLUG_VENDEDOR` and
   `FUNCAO_SLUG_FINDER`, hoisted out of `SalesOpsApp.tsx` byte-for-byte. The plan's section 4.1
   explicitly instructs this ("hoist it to `../calculations` in this slice"). It is forced:
   `react-refresh/only-export-components` allows only component exports from `SalesOpsApp.tsx`, so
   `leads/conversion.ts` could not import them from there, and re-deriving the slug comparison is
   banned by CLAUDE.md.
2. `apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts` - one entry added to
   `OWNED_FILES`, per the paragraph above. Its own positive control still passes.

`CLAUDE.md`'s claim that `hasFuncao` and `FUNCAO_SLUG_VENDEDOR` are "module-local" to
`SalesOpsApp.tsx` became FALSE with that hoist, so I rewrote that bullet and recorded the move as
prose rather than leaving a false statement standing.

## What was built

- `apps/web/src/sales-ops/leads/conversion.ts`, pure: `buildLeadConversionPrefill` and
  `findClientByName`. Imports only types plus `productBaseValueBrl`, `hasFuncao` and
  `FUNCAO_SLUG_VENDEDOR`. Money crosses as integer cents in both directions.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`, wiring only and no new screen body: the `'convert'`
  union arm with `ConversionSettle`, `createdSaleIdentity`, `convertedSales` state, a
  `saleWizardRef` mirrored in an effect plus an unmount cleanup that settles a hanging conversion,
  `requestLeadConversion`, `saveLeadConversion`, the `onRequestConversion` prop at the leads mount,
  `leadPrefill` at the wizard mount, the `onClose` that resolves `null`, `toSaleItemForm`, and five
  `useState` initializers each reading `leadPrefill` strictly AFTER `prefill?.x ??`.
- `CLAUDE.md` and `nexo/ROADMAP.md` per section 8 of the plan.

Every claim I added to `CLAUDE.md` is true of the shipped code, including the corrected line count
(9227, verified with `wc -l`) and the corrected `hasFuncao` home.

## Non-vacuity, proven by mutation

Each mutation was applied, the oracle run, and the file restored:

- delete DEFECT 2's `saleId` from the move payload -> 2 failed (C3 body assertion, C7 retry).
- seed `areaId` on a free row in `toSaleItemForm` -> 1 failed (the ghost-card oracle).
- delete the `convertedSales` early return -> 1 failed (a second `POST /sales` appears).
- restore -> 8 passed.

The ghost-card oracle carries its own in-test non-vacuity control: after asserting
`Salvar rascunho` is disabled it picks an área in the item's real `Combobox` and asserts the SAME
button becomes enabled, so it cannot pass against a wizard that renders nothing.

`wizardIsOpen()` deliberately keys on the wizard's own DialogDescription and NOT on
`Nova proposta`, because that string is also the shell's header action label - keying on it made
the cancellation assertion vacuous, which I hit and fixed before committing.

## Commands actually run, with their real results

- `pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts
   src/sales-ops/leads/__tests__/lead-conversion.test.tsx`
  -> Test Files 2 passed (2), Tests 17 passed (17).
- `pnpm --filter @fxl-sales/web test` -> Test Files 72 passed (72), Tests 911 passed (911).
- `pnpm --filter @fxl-sales/api test:integration` -> Test Files 30 passed (30), Tests 217 passed.
- `pnpm run lint` -> apps/api Done, apps/web Done. (One `react-hooks/refs` error on the first run,
  from writing `saleWizardRef.current` during render; moved into an effect and re-run green.)
- `pnpm run type-check` -> all four projects Done.
- `pnpm test` -> shared-utils 80, apps/api 526, apps/web 911, guard suite `# pass 21 # fail 0`.
- `pnpm run build` -> built in 1.77s.
- `git diff --stat master..HEAD -- apps/api` -> EMPTY. `SALE_TRANSITIONS` and `EXPECTED_MATRIX` are
  byte-unchanged by construction.

## Accepted costs, filed rather than hidden

Both are in `nexo/ROADMAP.md` and in `CLAUDE.md`: the single orphaned rascunho reachable only by
failed move plus page reload plus retry, and the missing unique index on
`sales_ops_clients (org_id, name)` that keeps `findClientByName` a best-effort dedupe.

No open question for `AUDIT.md`. No process left running.
