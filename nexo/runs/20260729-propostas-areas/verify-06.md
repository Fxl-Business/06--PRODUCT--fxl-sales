# Verify 06: proposal-wizard-web

Verdict: PASS

## Setup

Branch `feat/06-proposal-wizard-web` is already checked out at another worktree, so this agent checked out its SHA (`2e0b292`) detached in worktree `agent-a220d208ad53cc8d4`.
Single commit on top of `master` (8f94211): `feat(sales-ops): revamp sale wizard into the 4-step Nova proposta flow`.
`pnpm install --prefer-offline` ran clean.
Web-only slice, no DB setup needed.

## 1. Change surface

```
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/__tests__/areas-view.test.tsx
apps/web/src/sales-ops/__tests__/calculations.test.ts
apps/web/src/sales-ops/__tests__/routing.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
apps/web/src/sales-ops/api.ts
apps/web/src/sales-ops/calculations.ts
apps/web/src/sales-ops/hooks.ts
apps/web/src/sales-ops/types.ts
```

Exactly the plan's `files_modified` list plus the two documented out-of-plan reconciliations:
- `areas-view.test.tsx`: adds `receivables: []` and `saleProfessionals: []` to its bootstrap fixture (2 lines).
- `routing.test.tsx`: adds `receivables: []` / `saleProfessionals: []` to its mocked bootstrap and mocks the new `useUpdateSalesOpsSale` hook (3 lines).

Both are fixture-only reconciliations needed because `SalesOpsBootstrap` grew two required fields and `SalesOpsApp` now imports `useUpdateSalesOpsSale`; no behavioral change in either file. No API, DB, or files outside `apps/web` touched. Acceptable per the verify brief.

## 2. Diff read (points a-g)

a. `wizardSteps` is now `Proposta / Pagamento / Custos e margem / Revisão` (4 steps, `useState<1|2|3|4>`), `DialogTitle` is `{editSale ? 'Editar proposta' : 'Nova proposta'}`. Grepped the file and confirmed `Fechamento da venda`, `Nova venda`, `Salvar incompleto`, `Confirmar venda`, `Registro da venda`, `Pagamento e recebimento`, `Essa venda teve um finder`, `Total da venda`, `Dados da venda`, `Passo {wizardStep} de 3`, and the old dialog description all no longer exist anywhere in `apps/web/src/sales-ops/`. (One unrelated pre-existing string `Contas a pagar geradas pelas vendas persistidas` remains as a different view's subtitle - it predates this slice, per `git show master:...`, and is not the wizard's payables-card title, so it is not a violation of the removed-string list.)

b. Plan builder: `installmentRows: InstallmentRowForm[]` with `{dueDate, amountBrl, method}`; `planSumCents`/`planDeltaCents` gate `canAdvanceStepTwo` via `planValid` (`advanceWizard` sets `showPlanErrors` and blocks on step 2 when invalid). `applySplit()` calls `splitInstallmentsEqually(totalCents, count, baseDate, method)` which puts the remainder on the last row (`amountBrl: index === n - 1 ? totalCents - base * (n - 1) : base`). Verified by `calculations.test.ts` (`splitInstallmentsEqually(250000, 3, ...)` -> 83333/83333/83334) and by the payment-plan component test (`Dividir em 3` -> `833.33/833.33/833.34`) and the block/unblock test on sum mismatch.

c. Free-form rows (`kind: 'free'`) require `areaId`, `customLabel.trim()`, and `unitBrl > 0` via `itemsValid`/`draftValid`; rendered errors are `Selecione a área deste item.`, `Informe a descrição deste item avulso.`, `Informe um valor negociado maior que zero.`. Product rows derive area from `product?.areaId` (chip "Sem área" / area name; `Defina a área deste produto em Cadastros > Produtos.` when missing and `showItemErrors`). Verified by `sale-wizard-free-items.test.tsx` (adds a free item, submits without `productId`; blocks on missing description/value; blocks when a product has no area).

d. Recurring block (`recurringEnabled/recurringMonthlyBrl/recurringStartDate/recurringCycles/recurringIndefinite/recurringMethod`) builds `recurring: {monthlyBrl, startDate, cycles, method}` in `createPayload`, matching slice 03's `SaleRecurringSchema` (`monthlyBrl: money.positive`, `startDate: isoDate`, `cycles: number|null`, `method` defaulting to `pix`) field-for-field. Bounded cycles path (`cycles: recurringCyclesCount`) and indefinite path (`cycles: null`) both exercised in `sale-wizard-payment-plan.test.tsx` and `calculations.test.ts`.

e. `advanceWizard()` calls `submit('open')` only on the final step's `Avançar`/`Salvar proposta`; `Salvar rascunho` calls `submit('draft')`. Grepped the whole file for `'won'` string literals used as a submit argument - none found (only appears in the unrelated `statusMeta` label map). No path posts `won`.

f. `editSale: SalesOpsSale | null` prop threads into `SaleWizardDialogBody`; `deriveWizardPrefill` reconstructs client/seller/finder/items/professionals/installmentRows/recurring from `bootstrap.saleItems`, `bootstrap.receivables` (filtering `status !== 'void'`, splitting on `label.startsWith('M')` for recurring vs installment rows, per the `1/n` / `M1/c` convention), and `bootstrap.saleProfessionals`. Submit routes through `onSave` -> `SalesOpsApp`'s `updateSale.mutate({saleId, payload})` (PUT). Status guard caps edit to `draft|open` at both the dialog shell (`if (props.editSale && status !== 'draft' && status !== 'open') return null`) and `submit()`. Verified end-to-end by `sale-wizard-edit.test.tsx` (4 named tests: full-step prefill including the `N/M`/`MN/M` receivable reconstruction, submitted update payload shape, `Salvar rascunho` hidden for `open`/shown for `draft`, and plan staying frozen - not auto-resynced - when the total changes mid-edit).

g. Step 4 banner: "Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha."; payables card title "Previsão de contas a pagar" with sub-line "Estes lançamentos serão gerados quando a proposta for marcada como Ganha."; totals row "Total previsto". Matches the previsão framing required by the plan.

## 3. Payload cross-check vs slice 03's schema (master `apps/api/src/domains/sales-ops/service.ts`)

Built the payload mentally for: one product item (has area) + one free-form item (picked area) + entrada (1 installment, part of the plan) + 2 parcelas total + bounded recurring:

```json
{
  "clientId": "...", "clientName": "...",
  "sellerPersonId": "...", "sellerName": "...",
  "finderPersonId": "...", "finderName": "...",
  "status": "open",
  "baseDate": "2026-07-10",
  "notes": null,
  "sellerCommissionPct": 8, "finderCommissionPct": 0, "taxPct": 6,
  "otherCostsBrl": 0,
  "installments": [
    { "dueDate": "2026-07-10", "amountBrl": 150000, "method": "pix" },
    { "dueDate": "2026-08-10", "amountBrl": 150000, "method": "boleto" }
  ],
  "recurring": { "monthlyBrl": 100000, "startDate": "2026-08-10", "cycles": 2, "method": "boleto" },
  "items": [
    { "productId": "prod-1", "areaId": "area-1", "productName": "FXL Finance", "productType": "SaaS", "quantity": 1, "unitBrl": 250000 },
    { "areaId": "area-2", "productName": "Consultoria de processos", "productType": "Avulso", "quantity": 1, "unitBrl": 50000 }
  ],
  "professionals": []
}
```

Field-by-field against `CreateSaleSchema`/`UpdateSaleSchema` (`SaleWriteBaseSchema` in `apps/api/src/domains/sales-ops/service.ts` on master, lines ~178-196):
- No top-level `paymentMethod`/`condition`/`installments: number` - matches (`SaleWriteBaseSchema` has no such fields; server derives `paymentMethod`/`condition` internally per lines 388-394).
- `installments: SaleInstallmentSchema[] .min(1).max(120)` with `{dueDate: isoDate, amountBrl: money, method}` - matches the web array shape and types exactly.
- `recurring: SaleRecurringSchema.nullish()` with `{monthlyBrl: number.int.positive, startDate: isoDate, cycles: number.int.min(1).max(120).nullable, method: MethodSchema.default('pix')}` - matches; web sends `method` explicitly for edit round-trips and omits it (server defaults) on create.
- `items[].productId: uuid.optional()`, `areaId: uuid.optional()` with `superRefine` requiring `areaId` when `productId` absent - matches web's free-row `productId: undefined, areaId: <picked>`, and product-row `areaId: product.areaId`.
- `validatePaymentPlan` requires `sum(installments.amountBrl) === sum(items.quantity*unitBrl)` - matches the web's `planValid` gate (`planDeltaCents === 0`) blocking advance before submit; recurring is additive and not part of this sum, matching the web's `totalCents` comment ("the recurring mensalidade is additive on top and never enters the parcela sum check").
- `status: enum(['draft','open','won'])` for create, capped to `enum(['draft','open'])` for `UpdateSaleSchema` - matches: the wizard's `submit()` type is `(status: 'draft'|'open')` and the edit guard additionally checks `editSale.status` is `draft|open`.

No field-name or type mismatches found.

## 4. Verification commands (repo root, run-once)

- `pnpm run lint` - PASS, no warnings (`apps/api lint: Done`, `apps/web lint: Done`).
- `pnpm run type-check` - PASS (`apps/api type-check: Done`, `apps/web type-check: Done`).
- `CI=true pnpm test` - PASS, exit code 0. `apps/api`: 21 files / 199 tests passed. `apps/web`: 18 files / 107 tests passed (includes all 6 named oracle files: `sale-wizard-payment-plan.test.tsx` 4/4, `sale-wizard-free-items.test.tsx` 3/3, `sale-wizard-edit.test.tsx` 4/4, `sale-wizard-ui-contract.test.ts` 1/1, `sale-wizard-commission-defaults.test.tsx` 2/2, `sale-wizard-custom-item-labels.test.tsx` 5/5, plus updated `calculations.test.ts` 12/12). `packages/shared-utils`: 1 file / 17 tests. The `node scripts/no-legacy-auth.mjs` tracked-file guard ran as part of the `test` script chain with no failure.
- `pnpm run build` - PASS (`apps/api` tsc+tsc-alias, `apps/web` tsc --noEmit + vite build, all green).

`pnpm --filter @fxl-sales/api test:integration` intentionally skipped per the plan's Verification section (no API change in this slice; it belongs to slice 03's wave boundary).

## 5. Security / UX lens

- No raw account/workspace ids rendered: grepped `clientId|sellerPersonId|finderPersonId` against JSX rendering sites in `SalesOpsApp.tsx` - no hits; all UI reads through `displayName`/`clientName`/`areaNameById.get(...)` style helpers.
- Currency inputs parsed via existing helpers throughout the new code: `parseCurrencyToCents`, `parseCurrencyInputToCents` (via `installmentSumCents`), `centsToInput` - no ad hoc parsing introduced.
- No em dash (`—`) characters found in any changed file (`SalesOpsApp.tsx`, all touched/added test files, `calculations.ts`, `types.ts`, `api.ts`, `hooks.ts`).

## Conclusion

Every contract point (a-g), the payload cross-check, and all four verification commands are proven green with no gaps. Verdict: PASS.
