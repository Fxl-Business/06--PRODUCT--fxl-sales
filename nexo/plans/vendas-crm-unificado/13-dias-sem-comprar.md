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
