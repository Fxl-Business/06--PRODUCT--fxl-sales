# Part 13b-dias-sem-comprar-web of slice 13-dias-sem-comprar

Original frontmatter (for reference, not a slice):

```yaml
id: 13b-dias-sem-comprar-web
milestone: v4.8.0
status: todo
depends_on: ["13a-dias-sem-comprar-api"]
files_modified: ["apps/web/src/sales-ops/clients/client-recency.ts", "apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts", "apps/web/src/sales-ops/clients/ClientsView.tsx", "apps/web/src/sales-ops/clients/__tests__/clients-view-recency.test.tsx", "apps/web/src/sales-ops/SalesOpsApp.tsx"]
affected_tests: [
  {path: apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, impact: "none, navigation untouched", update: "none", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation-edition.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx, impact: "renders cliente rows through SalesOpsApp; the moved ClientsView must keep the pending-row guard", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/optimistic-row-guard.test.tsx", owner: builder}
]
acceptance: "given clientes with days 0, 45, 200 and null, when the operator picks Mais de 90 dias, then only the 200-day cliente is listed; Nunca comprou lists only the null one, shown as '-' never 0; sorting by the column puts the largest first and the null ones last"
goal: "Show 'Dias sem comprar' on the Clientes screen with a threshold filter and a sort."
must_not_break: ["UI Controls rule: the picker is the Combobox, no native select", "the optimistic pending row stays non-editable", "Clientes screen keeps Nome, Contato, Nº vendas, Receita total, Ações", "ClientsView keeps its empty state for zero clientes"]
rules: ["Pickers use Combobox from @/components/ui/combobox with comboboxTriggerClass (40px, filter bar)", "Component state for filter and sort, not URL state", "null is shown as '-', never 0; the cell never renders the number 0 for a never-bought cliente", "web imports shared-utils subpaths, never the root", "No raw ids in the UI"]
verifier_focus: "null vs 0 in the cell; filter thresholds are strictly greater than N; null always sorts last in both directions; the moved component is byte-equivalent for the columns that existed; no unused imports left in SalesOpsApp.tsx"
oracle: "apps/web/src/sales-ops/clients/__tests__/client-recency.test.ts"
```

# 13b - Dias sem comprar: tela Clientes

## Context

- `ClientsView` is a private function in `apps/web/src/sales-ops/SalesOpsApp.tsx:3820-3891` mounted at `:2310` (`view === 'clientes'`). It renders `Nome`, `Contato`, `Nº vendas`, `Receita total`, `Ações`, with the empty state `Nenhum cliente cadastrado` and the optimistic guard `isOptimisticId(client.id)` (`optimistic.ts:44`).
- Slice 13a adds `lastPurchaseOn` and `daysSinceLastPurchase` (both optional/null) to `SalesOpsClient` (`types.ts:145`) and to `bootstrap.clients`.
- Convention for extracted views: local copies of the style constants (see `people/VendedoresView.tsx:35-42`), because `SalesOpsApp.tsx` imports the extracted module. Style constants to copy (values at `SalesOpsApp.tsx:228-248`): `panelClass`, `mutedPanelClass`, `tableHeadClass`, `tableCellClass`, `iconButtonBaseClass`, `iconButtonClass`, `iconButtonPendingClass`, `comboboxTriggerClass`.
- `EmptyPanel` is a 6-line local component at `SalesOpsApp.tsx:1086`; copy it into the new file.
- `Combobox` (`components/ui/combobox.tsx`): `options: {value,label}[]`, `value`, `onChange`, `aria-label`; trigger has `role="combobox"`, options `role="option"`. No `onCreate` here (no create row on a filter).
- Phase 3 slice 12 may have touched `SalesOpsApp.tsx` navigation; re-read lines around `ClientsView` before editing and keep the call site's props.

## Design

New pure module `apps/web/src/sales-ops/clients/client-recency.ts`:

```ts
import { civilDaysBetween } from '@fxl-sales/shared-utils/purchase-recency';
import type { SalesOpsClient } from '../types';

export const RECENCY_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: '30', label: 'Mais de 30 dias' },
  { value: '60', label: 'Mais de 60 dias' },
  { value: '90', label: 'Mais de 90 dias' },
  { value: '180', label: 'Mais de 180 dias' },
  { value: 'never', label: 'Nunca comprou' },
] as const;
export type RecencyFilter = (typeof RECENCY_FILTER_OPTIONS)[number]['value'];
export type RecencySort = 'default' | 'desc' | 'asc';
export const RECENCY_EMPTY_LABEL = '-';

type RecencyClient = Pick<SalesOpsClient, 'lastPurchaseOn' | 'daysSinceLastPurchase'>;

/** Days from the last won proposta to `today` (São Paulo). Prefers lastPurchaseOn so a tab open past midnight stays right; null when it never bought. */
export function clientDaysWithoutBuying(client: RecencyClient, today: string): number | null {
  if (client.lastPurchaseOn) return civilDaysBetween(client.lastPurchaseOn, today);
  return client.daysSinceLastPurchase ?? null;
}

export function formatDaysWithoutBuying(days: number | null): string {
  if (days === null) return RECENCY_EMPTY_LABEL;
  return days === 1 ? '1 dia' : `${days} dias`;
}

export function applyRecency<T extends RecencyClient>(
  clients: readonly T[],
  filter: RecencyFilter,
  sort: RecencySort,
  today: string,
): T[] {
  const withDays = clients.map((client) => ({ client, days: clientDaysWithoutBuying(client, today) }));
  const kept = withDays.filter(({ days }) => {
    if (filter === 'all') return true;
    if (filter === 'never') return days === null;
    return days !== null && days > Number(filter);
  });
  if (sort === 'default') return kept.map((k) => k.client);
  const dir = sort === 'desc' ? -1 : 1;
  // Array.prototype.sort is stable: ties keep the incoming (name) order.
  return [...kept]
    .sort((a, b) => {
      if (a.days === null && b.days === null) return 0;
      if (a.days === null) return 1; // null last in BOTH directions
      if (b.days === null) return -1;
      return (a.days - b.days) * dir;
    })
    .map((k) => k.client);
}

export function nextRecencySort(sort: RecencySort): RecencySort {
  return sort === 'default' ? 'desc' : sort === 'desc' ? 'asc' : 'default';
}
```

`ClientsView` moves to `apps/web/src/sales-ops/clients/ClientsView.tsx` (named export, same props `{ bootstrap, onEdit }`), keeps its body, and adds:
- State (above the early return, rules-of-hooks): `const [filter, setFilter] = useState<RecencyFilter>('all'); const [sort, setSort] = useState<RecencySort>('default');`; `const today = todayInSaoPaulo();` (import from `@fxl-sales/shared-utils/sao-paulo-day`).
- A filter bar above the table (only when `bootstrap.clients.length > 0`): a label `Dias sem comprar` (`<label htmlFor="clients-recency-filter" className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">`) and `<Combobox id="clients-recency-filter" aria-label="Dias sem comprar" className={comboboxTriggerClass} options={[...RECENCY_FILTER_OPTIONS]} value={filter} onChange={(v) => setFilter(v as RecencyFilter)} searchPlaceholder="Buscar..." />` in a `flex items-center gap-3 px-1 pb-3` wrapper, `data-clients-recency-filter`.
- A new column `Dias sem comprar` between `Receita total` and `Ações`: header cell is a button `type="button"` (`data-recency-sort`) with `aria-label="Ordenar por dias sem comprar"`, text `Dias sem comprar` and an arrow glyph `lucide-react` `ArrowDown`/`ArrowUp`/`ArrowUpDown` for desc/asc/default; on the `TableHead` set `aria-sort={sort === 'default' ? 'none' : sort === 'desc' ? 'descending' : 'ascending'}`. Clicking calls `setSort(nextRecencySort(sort))`. The body cell: `className="sales-ops-num px-4 py-3 text-center text-[13.5px]"`, `data-days-without-buying={days ?? 'none'}`, text `formatDaysWithoutBuying(days)`; when `days === null` use the muted colour `text-[#9b9ba3]`.
- Rows come from `applyRecency(bootstrap.clients, filter, sort, today)`. When it returns `[]` while `bootstrap.clients.length > 0`, render `<EmptyPanel title="Nenhum cliente neste filtro" text="Nenhum cliente corresponde ao filtro de dias sem comprar." />` plus a `Limpar filtro` button (`type="button"`, `secondaryButtonClass` local copy, `onClick={() => { setFilter('all'); setSort('default'); }}`). The header stays out of that branch.
- The `Nº vendas` and `Receita total` figures keep their current computation (all sales of the cliente, any status) untouched.

`SalesOpsApp.tsx`: delete the `function ClientsView` block (3820-3891), add `import { ClientsView } from './clients/ClientsView';` with the other local imports, keep the call at `:2310` unchanged. Then run lint: remove any import that became unused ONLY if lint reports it (for example `Edit3` is still used elsewhere; do not guess).

## Steps (TDD)

1. Write `clients/__tests__/client-recency.test.ts` (Tests). Run: fails (module missing).
2. Create `clients/client-recency.ts` with the code above. Run: green.
3. Write `clients/__tests__/clients-view-recency.test.tsx`. Run: fails (view missing).
4. Create `clients/ClientsView.tsx` by moving the existing component (copy lines 3820-3891, plus the imports it needs: `Edit3` from `lucide-react`; `Table*` from `@/components/ui/table`; `formatMoneyBrl` from the same module `SalesOpsApp.tsx` imports it from (`grep -n "formatMoneyBrl" SalesOpsApp.tsx | head -3` shows the import near line 173); `isOptimisticId` from `../optimistic`; `SalesOpsBootstrap`, `SalesOpsClient` from `../types`) and add the Design additions.
5. Edit `SalesOpsApp.tsx` as described.
6. Run the commands; fix lint (no `eslint-disable`).

## Tests

`clients/__tests__/client-recency.test.ts` (plain vitest, no DOM), `today = '2026-10-20'`; fixtures `{ lastPurchaseOn: '2026-10-20', daysSinceLastPurchase: 0 }` (0 days), `'2026-09-05'` (45), `'2026-04-03'` (200), `{ lastPurchaseOn: null, daysSinceLastPurchase: null }`:
- `it('days come from lastPurchaseOn against the given today, not from the stale server figure')`: `{lastPurchaseOn:'2026-10-10', daysSinceLastPurchase: 3}` -> `10`.
- `it('falls back to the server figure and then to null')`: `{lastPurchaseOn: null, daysSinceLastPurchase: 7}` -> 7; both missing (undefined fields) -> `null`.
- `it('formats null as a dash and never as 0')`: `formatDaysWithoutBuying(null)` is `'-'`; `formatDaysWithoutBuying(0)` is `'0 dias'`; `(1)` is `'1 dia'`; `(45)` is `'45 dias'`.
- `it('"Mais de 90 dias" is strictly greater than 90 and drops null')`: boundary fixtures 90 and 91 days -> only 91 stays.
- `it('"Nunca comprou" keeps only null')`.
- `it('"Todos" keeps everything and default sort keeps the incoming order')`.
- `it('desc puts the largest first and null last; asc puts the smallest first and null still last')`.
- `it('sort is stable for ties')`: two clientes with 45 days keep their input order.
- `it('nextRecencySort cycles default -> desc -> asc -> default')`.

`clients/__tests__/clients-view-recency.test.tsx` (`// @vitest-environment happy-dom`, `createRoot` + `act`, as `people/__tests__/vendedores-view.test.tsx`; build `bootstrap` with `sales: []`, four clientes `Alfa` (0 days), `Beta` (45), `Gama` (200), `Delta` (null), fake the clock with `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T15:00:00Z'))`):
- `it('shows a dash for a never-bought cliente and the number for the others')`: `[data-days-without-buying="none"]` text is `-` and its row is `Delta`; text of the `Alfa` cell is `0 dias`; no cell of `Delta` contains `0`.
- `it('the picker is a Combobox, not a native select')`: `container.querySelector('select')` is null; `getByRole('combobox')` named `Dias sem comprar` exists.
- `it('filtering Mais de 90 dias lists only Gama')`: click the combobox trigger, click the option `Mais de 90 dias`, rows (`tbody tr`) are 1 with `Gama`.
- `it('Nunca comprou lists only Delta')`.
- `it('a filter with no match shows the filter empty state and Limpar filtro restores all four rows')` (use a 4th filter that matches none by setting all clientes to 0 days in a second render with `Mais de 180 dias`).
- `it('clicking the column header sorts desc then asc and sets aria-sort')`: after one click first row is `Gama`, `th[aria-sort]` is `descending`; after the second first row is `Alfa`, `ascending`; `Delta` is last both times.
- `it('keeps the edit button disabled for an optimistic cliente')`: a cliente with `id` from `optimisticId()` (`optimistic.ts`) renders the `Salvando <name>` button `disabled`.
- `it('keeps the zero-clientes empty state without the filter bar')`.

## Commands

```bash
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/clients/__tests__/client-recency.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/clients
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/optimistic-row-guard.test.tsx src/sales-ops/__tests__/sales-settlement-visibility.test.tsx
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web exec vitest run
```

## Risks

- Moving a component out of a 9,700-line file: if lint reports a now-unused import in `SalesOpsApp.tsx`, remove only that import. If `ClientsView` used a helper that is private to `SalesOpsApp.tsx` and not listed above, copy it locally (do not export from the shell: cycle).
- Open product question for the owner (recorded, not blocking): the cell shows `-` for "never bought" (the brief says "empty"; a blank cell reads as broken). A different empty rendering is a one-constant change (`RECENCY_EMPTY_LABEL`).
- Unit-visible only in a real browser: the 40px Combobox alignment beside the label. The Verify agent should look at the screen once with `make dev-fake` (cadastros/clientes) and confirm the bar and column align.
