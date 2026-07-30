---
run: batch-01K9C0FXA7RQ8VZTN3KDM6WS4E
milestone: v2.3.0
mode: autopilot
---

# Audit: items needing a human decision

Autopilot parks a blocker here and continues rather than idling.
Nothing in this file blocks the rest of the batch.

## 1. Slice 04 `itens-section-align` - parked, cancelled by the user mid-build

**What it was.** User item 6, "We need to improve the align of this session", referring to the **Itens**
block of the proposta wizard step 1.

**Why it is parked.** The executor was stopped by the user partway through the Green phase. It had
modified `SalesOpsApp.tsx` (+255/-207) and written an untracked test file, with no commit and no result
file, leaving a half-applied change to a 5200-line file. The working tree was restored and the branch
deleted, so `master` was never touched.

**Preserved artefacts** in the session scratchpad:

- `slice-04-cancelled-partial.patch` - 522 lines
- `slice-04-cancelled-test.tsx` - 349 lines

**The plan is still valid** at `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/04-itens-section-align.md`,
with one caveat: its line anchors were captured before slices 01, 01.1, 05, 06 and 07 landed, and slice
06 in particular rewrote every picker in that section. An executor must re-locate anchors by searching.

**Note that slice 06 already absorbed part of this slice's scope.** The `NativeSelect` geometry bug that
caused the 40px-versus-44px mismatch was fixed there, and picker heights are now unified at two canonical
sizes. So the remaining work is the grid template consolidation (one `saleItemGridClass` replacing six
hand-written copies), the header `px-0.5` offset, numeric right-alignment to the same 12px inset, the
`Sem área` badge sub-row, and the smaller defects the plan enumerates.

**Decision needed:** redo with a fresh agent on the same plan, resume from the preserved patch, or drop
the slice.

## 2. Visual verification - deferred, needs a human or a safe local environment

No agent in this batch had a browser, so several claims are unverified in a real rendering engine. This
matters because the batch's whole purpose is UI quality.

**Blocked on environment, not effort.** A visual pass needs the dev server, and `apps/api/.env`'s
`DATABASE_URL` points at **staging** - so running it as configured would create real clientes and áreas
in staging. It also needs a Hub login. Doing this safely means starting the API with an explicit
override to the local Docker DB and authenticating interactively.

**What to look at:**

1. The `Criar novo ...` create rows working end to end against a real API.
2. The two CSS-only claims from slice 06: numeric fields showing no OS spin buttons, and the admin and
   finder popover panels now having a background where they previously had none.
3. **Rendered pixel geometry.** The tests assert class tokens only, so "a picker matches the `Input`
   beside it at 44px" is unproven in a browser.
4. The inline Combobox panel on the **last** parcela or profissional row - does it float above the
   dialog, or extend the dialog's scroll area?
5. Two stacked Radix modal dialogs when `Cadastrar produto` opens `ProductDialog` over the wizard. This
   state is unreachable on the pre-batch `master`, so it has never been seen.

## 3. Pre-existing defects found during the batch, each needing its own slice

None of these were introduced here, and all were deliberately left alone to keep slices atomic.

| Defect | Evidence |
|---|---|
| Concurrent `POST /products` with a duplicate `codeSuffix` returns 500 from an unhandled `23505`. 30 parallel calls gave `{"500":29,"201":1}`. Proven pre-existing by running the identical probe against a `master` worktree (`parallel: {"500":20}`). The codebase's own `'duplicate'` sentinel idiom from `createArea` is the fix. | verify-07 |
| `apps/api/test/rls/areas-rls.test.ts` carries the RLS-masking blind spot - its tenant assertions pass even with the service's explicit `orgId` filter deleted. The `adminDb` technique added in slice 05 is the fix. | verify-05, reproduced in verify-07 |
| The identical optimistic-id defect in the frozen legacy tree: `apps/web/src/admin/products/ProductsPage.tsx:80` and `:88`, fed by `useProducts.ts:83`, pass an `optimistic:<appId>:<slug>` id to `setEditProduct` and `navigate()`. `CLAUDE.md` fences `/admin/*` off as unchanged, so this needs an explicit decision. | verify-01, plan-01.1 |
| "Meus dados" shows a seller **every** seller in the org rather than only themselves. There is no pessoa-to-Hub-account link on `sales_ops_people` and no `userId` filter in sales-ops. | plan-05, verify-05 |
| `commissionOnRecurring` is a dead setting - read by the step-4 preview, ignored by the server. | plan-12 |
| `professional_cost` re-win dedup collapse: `alreadyExists('professional_cost', null)` keys on `(kind, receivableId)` and every professional row has a null `receivableId`, so one surviving `paid` row skips all of them. | plan-12 |
| Products with `sellerCommissionType: 'fix'` silently fall back to the org settings percentage, so a fixed-amount seller commission never reaches a proposta. | plan-12 |
| The failed-create rollback is silent: the optimistic row vanishes with no error surfaced to the operator. | verify-01, verify-01.1 |

## 4. Smaller follow-ups recorded during the batch

- `apps/web/eslint.config.js`'s rationale comment still says "exactly one single-select control", now
  mildly out of step with the documented `admin/products` exception.
- An `apps/web/src/index.css` comment calls spin buttons "the last browser-native picker", which the
  `<input type="date">` carve-out contradicts.
- The sales-ops sidebar workspace switcher (`SalesOpsApp.tsx:789-870`) is a hand-rolled routing menu that
  a future agent could misread the Combobox mandate as covering.
- `createPerson` via `funcaoIds` has no assertion on the derived boolean mirrors, so one drift mutation
  survives there. The shipped code is correct and the path is unreachable from the UI.
- Slice 07's 121-installment edge: `defaultRemainingInstallments` maxes at 120 and the entrada row sits on
  top, so entrada plus 120 parcelas exceeds `CreateSaleSchema`'s ceiling by one. Pinned by a test and
  deferred to slice 10's editor to cap the pair.
