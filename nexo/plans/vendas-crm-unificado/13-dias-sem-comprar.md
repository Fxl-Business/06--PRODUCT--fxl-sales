---
id: 13-dias-sem-comprar
milestone: v4.8.0
status: todo
depends_on: ["12-web-modulos-navegacao"]
files_modified: ["packages/shared-utils/src/purchase-recency.ts", "packages/shared-utils/src/__tests__/purchase-recency.test.ts", "packages/shared-utils/package.json", "apps/api/src/domains/sales-ops/service.ts", "apps/api/test/rls/clients-purchase-recency.test.ts", "apps/web/src/sales-ops/types.ts", "apps/web/src/sales-ops/clients/client-recency.ts", "apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts", "apps/web/src/sales-ops/clients/ClientsView.tsx", "apps/web/src/sales-ops/clients/__tests__/clients-view-recency.test.tsx", "apps/web/src/sales-ops/SalesOpsApp.tsx"]
affected_tests: [{path: apps/api/test/rls/client-legal-fields.test.ts, impact: "listClients rows gain two additive keys; the test reads named fields only", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/client-legal-fields.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-no-financial-impact.test.ts, impact: "deep-equals getSalesOpsSnapshot before and after; both sides now carry the new keys", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-no-financial-impact.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/routes.test.ts, impact: "mocks listClients; unchanged contract", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/routes.test.ts", owner: builder}, {path: apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, impact: "none, navigation untouched", update: "none", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation-edition.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx, impact: "renders cliente rows through SalesOpsApp; the moved ClientsView must keep the pending-row guard", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/optimistic-row-guard.test.tsx", owner: builder}]
acceptance: "given clientes with no won sale, one won sale, several won sales and a lost sale, when GET /clients and /bootstrap are read, then each cliente carries lastPurchaseOn and daysSinceLastPurchase from the LATEST won sale in the São Paulo calendar, and null (never 0) when it never had a won sale AND given clientes with days 0, 45, 200 and null, when the operator picks Mais de 90 dias, then only the 200-day cliente is listed; Nunca comprou lists only the null one, shown as '-' never 0; sorting by the column puts the largest first and the null ones last"
goal: "Dias sem comprar per cliente (API field + Clientes screen filter and sort)"
rules: ["execute the parts in order, TDD inside each part", "each part's Steps, Tests, Commands and Affected tests sections are binding", "depends_on names inside a part that point at another part of this slice mean that part"]
verifier_focus: "run every part's oracle and focused commands, then the affected package suites, lint and type-check"
oracle: "apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts"
---

# 13-dias-sem-comprar

Consolidated by the orchestrator from the planner's part plans (run budget: at most 24 slices).

## Parts, execute in order

- `parts/13a-dias-sem-comprar-api.md` - oracle `packages/shared-utils/src/__tests__/purchase-recency.test.ts`
- `parts/13b-dias-sem-comprar-web.md` - oracle `apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts`

All oracles: `packages/shared-utils/src/__tests__/purchase-recency.test.ts`, `apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts`


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase34.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

Orchestrator decision on D7: take the recommended option (latest day over won sales AND live client-bound leads in a `saida/ganho` stage, day from `stage_changed_at`), reconciling the CLAUDE.md rule and `leads-no-financial-impact.test.ts` as the report says, without weakening that test.

#### D7 [MAJOR] 13a/13b: "dias sem comprar" ignores won leads; misses half of the request AC
Files: `parts/13a-dias-sem-comprar-api.md` Context ("latest won sale" = `sales_ops_sales.status='won'` only), Design, tests; `13-dias-sem-comprar.md` acceptance.
Request section 4 phase 4: "hoje - data da ultima venda ganha (etapa de saida ganho / `sales_ops_sales.status='won'`)". An org with `orcamentos` off (Construbom) has NO propostas; its only purchases are leads that reached an exit stage `ganho`. With the sales-only query every Construbom cliente reads "Nunca comprou" forever.
Recommendation: count both sources and take the maximum day. Paste into 13a Context:
> A purchase is either (a) a proposta with `status = 'won'` and `won_at IS NOT NULL` (day = `saoPauloDayOf(won_at)`), or (b) a live lead (`deleted_at IS NULL`) with `client_id IS NOT NULL` whose stage is `type = 'saida' AND exit_kind = 'ganho'` (day = `saoPauloDayOf(stage_changed_at)`, the instant it entered the exit stage). The last purchase of a cliente is the greatest day over both. A lost, paused, cancelled, open, draft or deleted record never counts. A lead already converted to a proposta (`sale_id` set) counts once through the max.
Add to 13a Steps a second SELECT on `sales_ops_crm_leads` joined to `sales_ops_pipeline_stages` (org-filtered both sides, in the same tenant tx) feeding `computePurchaseRecency` a third argument `leadWins: ReadonlyArray<{ clientId: string; wonAt: Date | string }>`, and test cases in `purchase-recency.test.ts` and `clients-purchase-recency.test.ts`: (1) a cliente with only a lead in a `ganho` exit stage gets that day; (2) a lead in `perdido`/`pausado` is ignored; (3) a deleted ganho lead is ignored; (4) sale and lead on different days gives the later one.
Rule conflict to resolve in the same change: CLAUDE.md "Kanban de leads" says leads never enter `/bootstrap` and `leads-no-financial-impact.test.ts` deep-equals `getSalesOpsSnapshot` across lead activity. Therefore: (i) add to that oracle's deep-equal a projection that strips `lastPurchaseOn`/`daysSinceLastPurchase` from `clients` before comparing, plus one new assertion that moving a client-bound lead to the ganho exit changes ONLY those two keys; (ii) in CLAUDE.md add after the "Leads never enter /bootstrap" sentence: `The one derived exception is the per-cliente lastPurchaseOn/daysSinceLastPurchase (slice 13), which may read a ganho exit lead.` Add `apps/api/test/rls/leads-no-financial-impact.test.ts` and `CLAUDE.md` to 13's `files_modified` and change its affected row from "none expected, run to prove" to this update. If the product owner decides propostas-only is enough, the minimum is to state it in the slice acceptance and the final report as a known limitation; this check does not recommend that.

