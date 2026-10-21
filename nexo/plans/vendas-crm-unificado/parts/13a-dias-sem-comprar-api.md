# Part 13a-dias-sem-comprar-api of slice 13-dias-sem-comprar

Original frontmatter (for reference, not a slice):

```yaml
id: 13a-dias-sem-comprar-api
milestone: v4.8.0
status: todo
depends_on: ["12-web-modulos-navegacao"]
files_modified: ["packages/shared-utils/src/purchase-recency.ts", "packages/shared-utils/src/__tests__/purchase-recency.test.ts", "packages/shared-utils/package.json", "apps/api/src/domains/sales-ops/service.ts", "apps/api/test/rls/clients-purchase-recency.test.ts", "apps/web/src/sales-ops/types.ts"]
affected_tests: [
  {path: apps/api/test/rls/client-legal-fields.test.ts, impact: "listClients rows gain two additive keys; the test reads named fields only", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/client-legal-fields.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-no-financial-impact.test.ts, impact: "deep-equals getSalesOpsSnapshot before and after; both sides now carry the new keys", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-no-financial-impact.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/routes.test.ts, impact: "mocks listClients; unchanged contract", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/routes.test.ts", owner: builder}
]
acceptance: "given clientes with no won sale, one won sale, several won sales and a lost sale, when GET /clients and /bootstrap are read, then each cliente carries lastPurchaseOn and daysSinceLastPurchase from the LATEST won sale in the São Paulo calendar, and null (never 0) when it never had a won sale"
goal: "Compute days since the last won sale per cliente with a pure function and expose it additively on the clientes list API and the bootstrap."
must_not_break: ["no write to any sales or ledger table: this slice only SELECTs sales_ops_sales", "GET /clients and /bootstrap keep every existing key", "leads-no-financial-impact deep-equal", "sao-paulo-day tests (TZ Asia/Tokyo)"]
rules: ["Civil days: every 'today' is todayInSaoPaulo, the won day is saoPauloDayOf(won_at); never new Date().toISOString().slice(0,10)", "The pure function takes today as an argument and never reads the clock", "shared-utils subpath export, web and api import the subpath never the root", "Additive API: existing keys and paths unchanged"]
verifier_focus: "null versus 0 for a cliente without a won sale; lost/cancelled/open/draft ignored; São Paulo midnight boundary; no UPDATE/INSERT touching sales or ledger tables; bootstrap and GET /clients agree"
oracle: "packages/shared-utils/src/__tests__/purchase-recency.test.ts"
```

# 13a - Dias sem comprar: função pura e API

## Context

- `sales_ops_sales` (`apps/api/src/db/schema.ts:796`) holds `status` (`draft|open|won|lost|cancelled`, line 807), `won_at timestamptz` (line 810, set to `now` when the sale becomes `won`: `service.ts:2613`, `:2971`, cleared on leaving won `:2994`), `client_id` (nullable, line 803) and `client_name_snapshot` (NOT NULL).
- "The latest won sale" therefore means: `status = 'won'` and `won_at IS NOT NULL`, maximum `won_at`. Lost, cancelled, open and draft rows are ignored whatever their `won_at`.
- A won day is a São Paulo civil day: `saoPauloDayOf(wonAt)` from `@fxl-sales/shared-utils/sao-paulo-day` (`packages/shared-utils/src/sao-paulo-day.ts:15`). An instant at 2026-03-01T02:30Z is 2026-02-28 in São Paulo.
- `listClients` is `apps/api/src/domains/sales-ops/service.ts:2286` (route `GET /clients`, `routes.ts:214`). The bootstrap builds its own `clients` select at `service.ts:3160` inside `getSalesOpsSnapshot` (`:3147`) and the web Clientes screen reads `bootstrap.clients`, so BOTH producers must carry the new fields.
- The web `ClientsView` (`apps/web/src/sales-ops/SalesOpsApp.tsx:3820`) already attributes a sale to a cliente by `sale.clientId === client.id || sale.clientNameSnapshot === client.name`. The pure function mirrors this for rows with a NULL `client_id` only (a sale with another client id never counts by name).
- `GET /clients` is behind `requireCapability('clients')` today; phase 3 (slice 12 and its predecessors) may rename the gate. This slice does not touch the router, so it inherits whatever is there.

## Design

Pure function in a new shared-utils module `packages/shared-utils/src/purchase-recency.ts` (subpath `@fxl-sales/shared-utils/purchase-recency`; NOT added to `index.ts`):

```ts
import { saoPauloDayOf } from './sao-paulo-day.js';

export type PurchaseRecencyClient = { id: string; name: string };
export type PurchaseRecencySale = {
  clientId: string | null;
  clientNameSnapshot: string;
  status: string;
  wonAt: Date | string | null;
};
export type PurchaseRecency = { lastPurchaseOn: string | null; daysSinceLastPurchase: number | null };

const EMPTY: PurchaseRecency = { lastPurchaseOn: null, daysSinceLastPurchase: null };

/** Whole civil days from `fromDay` to `toDay` (both ISO days). Never negative. */
export function civilDaysBetween(fromDay: string, toDay: string): number {
  const ms = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.round((ms(toDay) - ms(fromDay)) / 86_400_000));
}

/** One entry per cliente id. `today` is the São Paulo civil day the caller computed. */
export function computePurchaseRecency(
  clients: readonly PurchaseRecencyClient[],
  sales: readonly PurchaseRecencySale[],
  today: string,
): Map<string, PurchaseRecency> {
  const latest = new Map<string, number>(); // client id -> max won_at epoch ms
  const byName = new Map<string, string>(); // name -> client id, only when the name is unique
  const nameCount = new Map<string, number>();
  for (const c of clients) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  for (const c of clients) if (nameCount.get(c.name) === 1) byName.set(c.name, c.id);
  const known = new Set(clients.map((c) => c.id));
  for (const sale of sales) {
    if (sale.status !== 'won' || sale.wonAt === null) continue;
    const at = sale.wonAt instanceof Date ? sale.wonAt : new Date(sale.wonAt);
    const t = at.getTime();
    if (Number.isNaN(t)) continue;
    const id = sale.clientId !== null ? sale.clientId : byName.get(sale.clientNameSnapshot);
    if (id === undefined || !known.has(id)) continue;
    const prev = latest.get(id);
    if (prev === undefined || t > prev) latest.set(id, t);
  }
  const result = new Map<string, PurchaseRecency>();
  for (const c of clients) {
    const t = latest.get(c.id);
    if (t === undefined) {
      result.set(c.id, EMPTY);
      continue;
    }
    const day = saoPauloDayOf(new Date(t));
    result.set(c.id, { lastPurchaseOn: day, daysSinceLastPurchase: civilDaysBetween(day, today) });
  }
  return result;
}
```

Decisions already made:
- Wire fields on every cliente row: `lastPurchaseOn: string | null` (ISO civil day) and `daysSinceLastPurchase: number | null`. Both null together. A purchase today is `0` (a real zero); "never bought" is `null`.
- The days figure is computed on the server with `todayInSaoPaulo(now)`; `getSalesOpsSnapshot` and `listClients` get an optional trailing `now: Date = new Date()` parameter (tests inject it). The web also keeps `lastPurchaseOn` so slice 13b can recompute against its own today after midnight without a refetch.
- Helper `attachPurchaseRecency` (private in `service.ts`) does ONE read of `sales_ops_sales` `(id not needed) client_id, client_name_snapshot, status, won_at WHERE org_id = $1 AND status = 'won' AND won_at IS NOT NULL` inside the caller's tenant transaction, runs `computePurchaseRecency`, and spreads the two fields on each row. The snapshot already holds `sales` in memory: reuse them there (no second query) by passing the already selected rows (they have all four columns).
- No migration, no index (org-scoped scan of won rows is bounded by the sale count).

## Steps (TDD)

1. Write `packages/shared-utils/src/__tests__/purchase-recency.test.ts` first (see Tests). Run it: it fails (module missing).
2. Create `packages/shared-utils/src/purchase-recency.ts` with the code above. Add the subpath to `packages/shared-utils/package.json` `exports`, after `"./default-pipeline"`:
   ```json
   "./purchase-recency": {
     "types": "./dist/purchase-recency.d.ts",
     "import": "./dist/purchase-recency.js"
   }
   ```
   (add the comma after the `./default-pipeline` block). Run `pnpm --filter @fxl-sales/shared-utils build` (the API resolves through `dist`).
3. Write the integration test `apps/api/test/rls/clients-purchase-recency.test.ts` (see Tests). It fails (fields missing).
4. In `apps/api/src/domains/sales-ops/service.ts`:
   a. Add `import { computePurchaseRecency } from '@fxl-sales/shared-utils/purchase-recency';` next to the sao-paulo-day import at line 8.
   b. Add above `listClients`:
   ```ts
   type ClientRowLike = { id: string; name: string };
   type SaleRecencyRow = { clientId: string | null; clientNameSnapshot: string; status: string; wonAt: Date | null };

   /** Additive: lastPurchaseOn and daysSinceLastPurchase from the LATEST won sale (null, never 0, without one). */
   function withPurchaseRecency<T extends ClientRowLike>(
     clients: readonly T[],
     sales: readonly SaleRecencyRow[],
     now: Date,
   ): Array<T & { lastPurchaseOn: string | null; daysSinceLastPurchase: number | null }> {
     const recency = computePurchaseRecency(clients, sales, todayInSaoPaulo(now));
     return clients.map((client) => ({
       ...client,
       ...(recency.get(client.id) ?? { lastPurchaseOn: null, daysSinceLastPurchase: null }),
     }));
   }
   ```
   c. Change `listClients(db, orgId)` to `listClients(db, orgId, now: Date = new Date())`: inside the `withTenant` callback select the clients as today (`const clients = await tx.select()...orderBy(salesOpsClients.name)`), then
   ```ts
   const wonSales = await tx
     .select({
       clientId: salesOpsSales.clientId,
       clientNameSnapshot: salesOpsSales.clientNameSnapshot,
       status: salesOpsSales.status,
       wonAt: salesOpsSales.wonAt,
     })
     .from(salesOpsSales)
     .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.status, 'won'), isNotNull(salesOpsSales.wonAt)));
   return withPurchaseRecency(clients, wonSales, now);
   ```
   Add `isNotNull` to the existing `drizzle-orm` import if missing (check with `grep -n "from 'drizzle-orm'" service.ts`).
   d. `getSalesOpsSnapshot(db, orgId, now: Date = new Date())`: after `const clients = await tx.select()...` (line ~3160) the `sales` array (selected at `:3149`) is already in scope; return `clients: withPurchaseRecency(clients, sales, now)` in the returned object (line ~3213) instead of `clients`. `sales` rows carry `clientId`, `clientNameSnapshot`, `status`, `wonAt` so they satisfy `SaleRecencyRow`.
   e. `routes.ts` is NOT changed: both handlers call the functions with the default `now`.
5. `apps/web/src/sales-ops/types.ts`: in `SalesOpsClient` (line 145) add after `legalRepDocument`:
   ```ts
   /** ISO civil day (São Paulo) of the latest WON proposta; null when the cliente never bought. Optional so an older API reads as null. */
   lastPurchaseOn?: string | null;
   /** Whole days from lastPurchaseOn to today (São Paulo) at read time; null, never 0, when it never bought. */
   daysSinceLastPurchase?: number | null;
   ```
6. Run the commands below; fix until green.

## Tests

`packages/shared-utils/src/__tests__/purchase-recency.test.ts` (first line `process.env.TZ = 'Asia/Tokyo';` like `sao-paulo-day.test.ts`, then `import { describe, expect, it } from 'vitest'`). Helper `c(id, name='C'+id)` and `won(clientId, iso, extra)` builders. All with `today = '2026-10-20'`:
- `it('a cliente with no sale at all is null, never 0')`: `computePurchaseRecency([c('a')], [], today).get('a')` toEqual `{ lastPurchaseOn: null, daysSinceLastPurchase: null }`; also `.daysSinceLastPurchase` is not `0` (`toBeNull()`).
- `it('several won sales use the LATEST won_at')`: sales won at 2026-01-10T15:00Z, 2026-09-30T15:00Z, 2026-05-01T15:00Z for `a` -> `{ lastPurchaseOn: '2026-09-30', daysSinceLastPurchase: 20 }`.
- `it('lost, cancelled, open and draft sales are ignored even with a later won_at')`: a won on 2026-06-01T15:00Z plus lost/cancelled/open/draft on 2026-10-01T15:00Z -> `{ '2026-06-01', 141 }` (Jun 1 to Oct 20 = 30+31+31+30+19 = 141 days).
- `it('only lost sales leaves the cliente null')`.
- `it('a won sale today is 0 days (a real zero)')`: won 2026-10-20T15:00Z -> `0`.
- `it('São Paulo midnight boundary: 02:59Z is still the previous São Paulo day, 03:00Z is the new one')`: won `2026-10-19T02:59:59Z` -> `lastPurchaseOn '2026-10-18'`, days `2`; won `2026-10-19T03:00:00Z` -> `'2026-10-19'`, days `1`. (The process TZ is Tokyo on purpose.)
- `it('a sale with a NULL client_id counts by an unambiguous name snapshot')`: sale `{clientId: null, clientNameSnapshot: 'Ca'}` attributes to client `a` (name 'Ca'); with two clientes named 'Ca' it attributes to neither.
- `it('a sale of another client id never counts through the name')`: `{clientId: 'zzz', clientNameSnapshot: 'Ca'}` -> `a` stays null.
- `it('accepts wonAt as an ISO string')`.
- `it('civilDaysBetween never goes negative')`: `civilDaysBetween('2026-10-21','2026-10-20')` is `0`.

`apps/api/test/rls/clients-purchase-recency.test.ts` (copy the harness of `client-legal-fields.test.ts` lines 1-30: `drizzle(postgres(APP_DB_URL))`, `testDatabaseUrls()`, admin client for cleanup; cleanup order `sales_ops_payables, sales_ops_receivables, sales_ops_sale_items, sales_ops_sale_professionals, sales_ops_sales, sales_ops_products, sales_ops_areas, sales_ops_people, sales_ops_clients` as in `leads-no-financial-impact.test.ts:58-69`; sales have settlement-free ledgers so no settlement delete is needed). Build sales with the exact recipe of `leads-no-financial-impact.test.ts:84-120` (`createArea`, `createProduct`, `createPerson` seller, `createSale` with `clientId` of a created cliente, `transitionSale(db, orgId, id, 'won', <Date>)`). Use a fixed `now = new Date('2026-10-20T15:00:00Z')` passed to `listClients(db, orgId, now)` and `getSalesOpsSnapshot(db, orgId, now)`.
- `it('GET list: never-bought cliente is null, bought clientes use the latest won sale, a lost sale is ignored')`: clientes `Sem Compra` (no sale), `Uma Compra` (won at `2026-10-10T15:00:00Z`), `Varias` (won `2026-03-01T15:00:00Z` and `2026-10-15T15:00:00Z`), `So Perdida` (sale transitioned to `lost`). Expect `Sem Compra` -> `{lastPurchaseOn: null, daysSinceLastPurchase: null}`; `Uma Compra` -> `'2026-10-10'`, `10`; `Varias` -> `'2026-10-15'`, `5`; `So Perdida` -> both null.
- `it('bootstrap clients carry the same two fields as the list')`: for each cliente `expect(snapshot.clients.find(...))` has the same `lastPurchaseOn`/`daysSinceLastPurchase` as `listClients`.
- `it('another org never leaks into the figures')`: a second org with a won sale for a cliente of the same NAME; the first org's cliente stays null.
- `it('computing recency writes nothing: sales row count and updated_at unchanged')`: count rows and `max(updated_at)` of `sales_ops_sales` for the org before and after both reads via `adminClient`.

## Commands

```bash
pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/purchase-recency.test.ts
pnpm --filter @fxl-sales/shared-utils build
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/clients-purchase-recency.test.ts
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/client-legal-fields.test.ts test/rls/leads-no-financial-impact.test.ts
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/routes.test.ts
pnpm --filter @fxl-sales/shared-utils test
pnpm --filter @fxl-sales/api lint && pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/web type-check
```

## Risks

- A `getSalesOpsSnapshot` consumer with an exact `clients` shape assertion: the three tests in "Affected tests" were searched (`grep -rln "listClients\|getSalesOpsSnapshot" apps/api/src apps/api/test`); `lead-contract.test.ts` and the route tests mock or read named fields only. If one fails on `toEqual`, add the two keys to its expected object, never loosen the assertion.
- Phase 2 may have changed `getSalesOpsSnapshot` (for example new keys); re-read lines `3147-3216` before editing and keep only the `clients:` line change.
- The figure ages while the tab stays open past midnight: accepted, 13b recomputes from `lastPurchaseOn`.
