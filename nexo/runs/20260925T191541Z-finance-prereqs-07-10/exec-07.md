# Exec notes - 07-admin-gate-and-brl

Branch `feat/20260925-07-admin-gate-and-brl`, base `2f1f406`, head `d30cc86`.

## Commits

- `96524f1` feat(sales-ops): gate financial proposta and settings routes to admins (PC23)
- `cb52a13` feat(sales-ops): in-page admin-required banner and BRL-only settings
- `d30cc86` docs(sales-ops): record the PC23 financial admin gate and the BRL lock

## Files touched (all inside the plan's files_modified)

- API: `apps/api/src/middleware/require-admin.ts` (`ADMIN_ROLE_REQUIRED_BODY`, `hasAdminRole`), `apps/api/src/domains/sales-ops/routes.ts` (`requireAdmin` on transition, cancel-contract, PUT /sales/:id, PUT /settings; raw-body `isWonRequest` check on POST /sales), `apps/api/src/domains/sales-ops/service.ts` (`currency: z.literal('BRL').default('BRL')`).
- API tests: new `financial-admin-gate.test.ts`; `routes.test.ts` (5 PUT tests set `currentRole = 'admin'`); `transition-routes.test.ts` (middleware sets admin role).
- Web: new `mutation-error-copy.ts`, new `MutationErrorBanner.tsx`; `SalesOpsApp.tsx` (banner state scoped to view, `reportMutation` on cancel/transition/settings, `canManage` requires admin, `export function SettingsView`, read-only `Real (BRL)`, `activeSettings` always `BRL`); `api.ts` (`SaveSettingsPayload.currency?: 'BRL'`); `sale-save-error.ts` 403 line is `MUTATION_ERROR_COPY.adminRequired`.
- Web tests: new `mutation-error-banner.test.tsx`, `settings-currency-brl.test.tsx`, `financial-mutation-forbidden.test.tsx`; `sale-save-error.test.ts` 403 expectation.
- Docs: `CLAUDE.md` (Auth Model bullet + "Financial role gate (PC23)" block before `Testing:`), `nexo/knowledge/reference/propostas.md` (new section), `nexo/knowledge/reference/auth-model.md` (appended bullet).

## Oracles and results

- Red first: API oracle 17 failed / 9 passed before implementation (all gate rejections, won rejections, USD case); web settings (3) and shell (1) failed on missing behaviour, banner file failed on missing module.
- Green: API `financial-admin-gate`, `transition-routes`, `routes` = 87/87. Web six oracle files = 28/28.
- Mutation spot-checks (web): dropping `reportMutation` from `saveSettings.mutate` fails the shell oracle; echoing `settings?.currency` fails `saves BRL even when the stored currency is a legacy USD`. Restored after.
- `CI=true pnpm test`: exit 0 (api 678, web 996, shared-utils 155, auth-fake 35, node script tests ok).
- `pnpm run lint`: exit 0. `pnpm run type-check`: exit 0.
- Integration suite not run: this slice changes no SQL; `settlements.integration.test.ts` already runs its route calls as admin by default.

## Decisions and deviations

- Worktree needed `pnpm run build:packages` before the first targeted vitest run (shared-utils `dist` missing); no tracked change.
- `propostas.md` does not quote the old `createPayload(status: 'draft' | 'open')` signature (per Revalidation): it states the wizard POSTs only draft/open and sends `won` only on a PUT edit, which is now admin-only.
- The new docs live under a new `## Financial role gate and BRL lock (PC23, 2026-09-25)` heading in propostas.md rather than dangling after the PC2 section.
- Read-only currency box uses `border-[#dcdce2]` and `rounded-[10px]` to match `formSelectClass`.
- `sale-save-error.test.ts` asserts through the `MUTATION_ERROR_COPY` constant.
- Decisions D07-1..D07-6 applied as planned. No contract deviations.

## Attempt 2 (Gate 2 fix: acceptance 8 half-asserted)

Verify found that removing `reportMutation` from the transition and cancel-contract calls left every oracle green.

- Commit `451c1b0` test(sales-ops): shell oracles for the 403 banner on transition and cancel-contract.
- File: `apps/web/src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx` only (no production change).
- Two new cases render `/operacional/vendas` (admin profile) with an open sale `P-002` and a won recurring sale `P-003` in the bootstrap, stub `POST .../sales/sale-open/transition` and `POST .../sales/sale-won-recurring/cancel-contract` to `403 {error:'forbidden',reason:'admin_role_required'}`, and click the real SalesView buttons (`Marcar como ganha`; `Cancelar contrato` plus its confirm step).
  Each asserts exactly one POST, `MUTATION_ERROR_COPY.adminRequired` rendered, both table rows still mounted, and `[data-forbidden]` null.
- The dropdown and alert-dialog mocks are copied from `sales-transition-actions.test.tsx`; the dropdown mock spreads `importOriginal` so the shell's other menu exports (`DropdownMenuGroup`) still resolve.
- Mutation proofs: removing `reportMutation` from `transitionSale.mutate` alone fails only the transition case; removing it from `cancelContract.mutate` alone fails only the cancel-contract case. Both restored (tree clean).
- Rerun: web oracles 30/30, API oracles 87/87, `CI=true pnpm test` exit 0 (api 678, web 998), `pnpm run lint` exit 0, `pnpm run type-check` exit 0.
