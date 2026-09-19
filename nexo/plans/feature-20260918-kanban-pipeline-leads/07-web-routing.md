---
id: 07-web-routing
milestone: v4.1.0
status: done
depends_on: [05-web-stage-cadastro, 06-web-kanban-board]
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/LeadStagesContainer.tsx
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - CLAUDE.md
  - nexo/ROADMAP.md
acceptance: "given an operator holding admin, seller, or both, when they open /operacional/leads, /meus-dados/leads or /cadastros/etapas, then the URL resolves with redirect: false and the shell mounts LeadsBoardContainer (seller filter offered only under operacional) or LeadStagesContainer respectively; a seller opening /operacional/leads is redirected to /meus-dados/vendedores and an admin-only operator opening /meus-dados/leads is redirected to /tatico/dashboard; and every pre-existing canonical route still resolves to the exact same workspace, view, path and redirect flag it did before this slice."
goal: Make the three lead screens reachable through the existing URL-is-truth router and mount them in the shell as a mount-plus-props edit, adding no screen to SalesOpsApp.tsx.
must_not_break:
  - "Every pre-existing canonical route keeps its exact segment, workspace and redirect flag. `resolveSalesOpsRoute` answers identically for every input the current suite exercises."
  - "`getDefaultSalesOpsRoute` answers identically for EVERY role set and EVERY preferred workspace. A seller still lands on `meus-dados/vendedores`, an admin still lands on `tatico/dashboard`, `getDefaultSalesOpsRoute(team, 'operacional')` is still `vendas` and `(team, 'cadastros')` is still `produtos`."
  - "`aliasLegacyView` still fires only under `cadastros`, and `legacyCadastroViews` gains no member."
  - "`getSalesOpsNavigation('meus-dados', finder)` stays byte-identical: `['finders', 'vendas']`. A finder gains nothing from this feature."
  - "No new screen inside SalesOpsApp.tsx (acceptance 18). The edit is imports, two `titleForView` entries, two mount blocks, one `headerAction` guard and one `useMemo` - no view component is declared there."
  - "No lead query runs on a view that is not a lead view: both containers are mounted conditionally, so `useLeadStages`/`useLeadsBoard` are never called from the dashboard."
  - "Nothing about leads reaches `/bootstrap`, `getSalesOpsSummary`, the dashboard or `computeSaleFinancials`."
  - "`apps/web/src/sales-ops/hooks.ts`, `api.ts`, `types.ts`, `optimistic.ts` stay byte-unchanged."
  - "The three existing shell tests that `vi.mock('../hooks', ...)` (routing, session-loss-keeps-route, shell-organization-switcher) stay byte-unchanged and green."
  - "`SALE_TRANSITIONS` / `EXPECTED_MATRIX` byte-inaltered; no `POST /sales/:id/transition` reachable from a lead screen."
rules:
  - "New segments are unaccented lowercase ASCII, matching every existing segment (`areas` for Áreas, `funcoes` for Funções)."
  - "A new nav item is APPENDED, never prepended: `getDefaultSalesOpsRoute` reads `[0]` of the list, so prepending silently relocates where a workspace switch lands and where a seller's session starts."
  - "`hasFuncao` and `FUNCAO_SLUG_VENDEDOR` are NOT exported from SalesOpsApp.tsx - `react-refresh/only-export-components` allows only component exports there. The `sellers` option list is built inside SalesOpsApp.tsx and passed down."
  - "Icons are chosen from the set already imported by this app at this exact lucide version. Dependencies are not installed in the worktree, so an unverifiable icon name is a build risk taken for nothing."
  - "No native `<select>`/`<option>`/`<datalist>`; no raw entity id in user-facing copy."
verifier_focus: "Two things. (1) That the canonical-route fence is a REAL oracle: `keeps every pre-existing canonical route at its exact segment` must iterate a frozen literal table written out by hand, not a table derived from `getSalesOpsNavigation`, because a derived table moves with the bug. (2) That the mount oracle proves a MOUNT and not a string: deleting the `{view === 'leads' ? <LeadsBoardContainer .../> : null}` block must turn it red, and it must also assert `showSellerFilter` is `true` under `operacional` and `false` under `meus-dados`, because that boolean is the only thing separating the admin board from the seller board on the client."
---

# 07 — Rotas e montagem das três telas de leads

## 0. What this slice is

Three screens exist (05, 06) and nothing can reach them. This slice adds the view ids, the
navigation entries, the `titleForView` copy and the mount blocks, plus the two thin containers that
keep the lead queries from firing on views that are not lead views. It also pays acceptance 24's
`CLAUDE.md` debt.

It is not: the conversion flow (08), or any component internals (05/06).

---

## 1. The segment names, and why

Three routes, two segments.

| route | segment | why this word |
|---|---|---|
| `operacional/leads` | `leads` | The entity is `sales_ops_leads`. Every data-driven segment in this app is the **entity's plural**: `produtos`, `areas`, `clientes`, `pessoas`, `funcoes`, `vendas`. `leads` is that same rule applied, it is already unaccented ASCII, and it matches the table, the API path (`GET /api/v1/sales-ops/leads`) and the query key group (`queryKeys.leads`) that slices 03 and 04 already fixed. A segment that disagrees with the resource it lists is one more thing to remember. |
| `meus-dados/leads` | `leads` | **The same view id, deliberately.** Two workspaces already share one view id twice over: `vendas` lives in `operacional` and in `meus-dados` (finder), and `comissoes` lives in `operacional` and in `meus-dados` (seller). Both are handled by `titleForView`'s `personal` flag and by `workspaceForView`'s visible-set precedence. A second id (`meus-leads`) would buy nothing and would need its own entry in every `Record<SalesOpsView, …>` in the tree. |
| `cadastros/etapas` | `etapas` | Fixed upstream by `00-OVERVIEW.md`'s slice index ("Tela `cadastros/etapas`"). It is the entity's plural under the same rule, and "etapa" is the word acceptance 5 and 6 use throughout. |

Rejected: `prospeccao` / `funil` / `pipeline` for the board. `pipeline` is not pt-BR;
`prospeccao` and `funil` name the *activity* rather than the *rows on the screen*, which no other
segment in this app does. The English `leads` is not an anomaly here — `finders` is already a live
segment, and "lead" is the word pt-BR commercial teams use verbatim.

### Labels (pt-BR, the display layer, free to be accented)

| where | label |
|---|---|
| `operacional` nav | `Prospecção` |
| `meus-dados` (seller) nav | `Minha prospecção` |
| `cadastros` nav | `Etapas do funil` |

`Etapas do funil` and not the bare `Etapas`: the Cadastros sidebar already carries five one-word
nouns, and an unqualified `Etapas` beside `Áreas` and `Funções` reads as a sixth generic cadastro
with no hint of which thing it stages. `Produtos & Serviços` is the precedent that a Cadastros
label may be longer than one word when one word is ambiguous.

The nav label and the page title deliberately differ from the **segment**: the segment is the
entity (`leads`), the visible chrome is the activity (`Prospecção`). That is exactly how
`meus-dados/vendas` is labelled `Indicações` today.

### Icons

`LayoutGrid` for `leads`, `ListChecks` for `etapas`. Both are **already imported by
`apps/web/src/sales-ops/SalesOpsApp.tsx`** at this exact `lucide-react@^0.475.0` resolution, so
both are proven to exist; `navigation.ts` imports them from `lucide-react` the same way it imports
its other ten. `KanbanSquare` / `SquareKanban` / `Columns3` were rejected on purpose: lucide renamed
several of those around this range, node_modules is not installed in this worktree, and a missing
named export is a `pnpm run build` failure discovered in Verify for a purely cosmetic gain.
`LayoutGrid` reads as columns, which is what a Kanban is; `ListChecks` reads as an ordered list of
steps, which is what the etapas cadastro is.

---

## 2. Placement inside each list — APPEND, and why it is not negotiable

`getDefaultSalesOpsRoute` resolves a workspace's landing view as
`getSalesOpsNavigation(workspace, roles)[0]?.id`. The first element of each list is therefore a
**route**, not a rendering order. Prepending `leads` to `operational` moves the admin's
`Trocar painel → Operacional` landing from `Propostas` to `Prospecção`; prepending it to
`meusDadosSeller` moves **every seller's session start** from `Meu painel` to the board and changes
`getDefaultSalesOpsRoute(seller)`, which is pinned in four separate existing assertions and is the
first thing a seller sees after login.

So: `leads` is appended **last** in `operational` and **last** in `meusDadosSeller`.

Accepted cost, recorded rather than discovered: prospecção logically *precedes* a proposta, so the
sidebar reads `Propostas, Comissões, Prospecção` in reverse chronological sense. That is a
cosmetic cost, knowingly taken, because the alternative silently relocates two default routes. If
the order is ever wanted, the fix is to decouple "the landing view" from "the first nav item" in
`getDefaultSalesOpsRoute`, which is its own slice and its own oracle — not a quiet array reshuffle.

`etapas` is inserted in `cadastros` **between `funcoes` and `geral`**, not appended after it.
`geral` is the settings-and-history catch-all and is deliberately the last entry; `etapas` is an
ordinary cadastro and belongs with the other five. This position changes no default, because
`cadastros[0]` stays `produtos`.

`meusDadosFinder` gains **nothing**. Acceptance 15 scopes personal lead visibility to `seller`
only, and `getSalesOpsNavigation('meus-dados', finder)` staying byte-identical is one of the fences
in `must_not_break`.

---

## 3. `apps/web/src/sales-ops/navigation.ts` — the exact edits

Five edits, nothing else. `getVisibleWorkspaces`, `salesOpsWorkspaces`, `buildSalesOpsPath`,
`getDefaultSalesOpsRoute`, `aliasLegacyView`, `legacyCadastroViews`, `resolveSalesOpsRoute` and
`workspaceForView` are **byte-unchanged**. The whole feature is expressible as data.

**3.1** The `lucide-react` import list gains `LayoutGrid` and `ListChecks`, keeping the existing
alphabetical order:

```ts
import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Cog,
  ContactRound,
  Database,
  Layers,
  LayoutGrid,
  ListChecks,
  Search,
  Tags,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
```

**3.2** `SalesOpsView` gains two members, appended after `geral`:

```ts
export type SalesOpsView =
  | 'dashboard'
  | 'vendas'
  | 'vendedores'
  | 'finders'
  | 'comissoes'
  | 'produtos'
  | 'areas'
  | 'clientes'
  | 'pessoas'
  | 'funcoes'
  | 'geral'
  | 'leads'
  | 'etapas';
```

Adding to this union is what makes the compiler demand the two new `titleForView` entries; that
`Record<SalesOpsView, …>` is the type-level guarantee that no view can be routable and untitled.

**3.3** `operational` gains one appended entry:

```ts
const operational: SalesOpsNavigationItem[] = [
  { id: 'vendas', label: 'Propostas', icon: BriefcaseBusiness },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
  // Appended, never prepended: `getDefaultSalesOpsRoute` lands on `[0]`, so the first
  // entry of this list is the `operacional` landing ROUTE and moving it rewrites where
  // every `Trocar painel` click arrives.
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid },
];
```

**3.4** `cadastros` gains `etapas` between `funcoes` and `geral`:

```ts
const cadastros: SalesOpsNavigationItem[] = [
  { id: 'produtos', label: 'Produtos & Serviços', icon: Database },
  { id: 'areas', label: 'Áreas', icon: Layers },
  { id: 'clientes', label: 'Clientes', icon: ContactRound },
  { id: 'pessoas', label: 'Pessoas', icon: UsersRound },
  { id: 'funcoes', label: 'Funções', icon: Tags },
  // Before `geral`, which is the settings-and-history catch-all and stays last.
  // `produtos` remains `[0]`, so the Cadastros landing route does not move.
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks },
  { id: 'geral', label: 'Geral', icon: Cog },
];
```

**3.5** `meusDadosSeller` gains one appended entry. `meusDadosFinder` is untouched:

```ts
const meusDadosSeller: SalesOpsNavigationItem[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
  // Appended: `[0]` here is where EVERY seller's session starts.
  // Seller only - acceptance 15 gives a finder no personal lead scope, so
  // `meusDadosFinder` is deliberately byte-unchanged.
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid },
];
```

### What this buys for free, and the one behaviour worth stating

- `resolveSalesOpsRoute({workspace: 'operacional', view: 'leads'}, ['admin'])` →
  `{route:{workspace:'operacional',view:'leads'}, path:'/operacional/leads', redirect:false}`.
- A **seller** hitting `/operacional/leads` fails the `getVisibleWorkspaces` lookup first and is
  redirected to `/meus-dados/vendedores` — the same bounce `cadastros/produtos` already gets. The
  board's team view is admin-only through workspace visibility alone; no second gate is added, and
  the real scoping is the server's (acceptance 15).
- An **admin-only** operator hitting `/meus-dados/leads` is redirected to `/tatico/dashboard`,
  because `meus-dados` is not in their visible set.
- An **admin+seller** gets both, and `workspaceForView('leads', ['admin','seller'])` resolves to
  `operacional`, because `getVisibleWorkspaces` yields team workspaces first. That is the same
  precedence `workspaceForView('vendas', ['admin','finder'])` already relies on, and it is what
  makes the sidebar's `go('leads')` stay inside the current workspace when one is active.
- `aliasLegacyView` is untouched and `legacyCadastroViews` gains no member: neither new route has a
  predecessor URL, so there is nothing to rewrite.

---

## 4. The two containers — why they exist and what they hold

Both are thin, both live in `apps/web/src/sales-ops/leads/`, and both exist for one reason: a hook
cannot be called conditionally, so mounting a bare presentational view from the shell would force
`useLeadStages()` and `useLeadsBoard()` to run on **every** view, firing two lead requests from the
dashboard. Conditional mounting of a container is the only way to keep a lead query on a lead view.

### 4.1 `apps/web/src/sales-ops/leads/LeadStagesContainer.tsx` — NEW, this slice

```tsx
import {
  useLeadStages,
  useReorderLeadStages,
  useSaveLeadStage,
  useSetLeadStageStatus,
} from './hooks';
import { LeadStagesView } from './LeadStagesView';

/**
 * The `cadastros/etapas` mounting point. It exists so `useLeadStages()` runs only while
 * that view is on screen: `SalesOpsApp.tsx` mounts this conditionally, and a hook called
 * from the shell itself would fire a lead request from the dashboard.
 *
 * It holds NO state and NO logic. Every callback is `mutateAsync` and never `mutate`,
 * because `LeadStagesView`'s optimistic revert and its "dialog stays open on 409"
 * behaviour are both keyed on the REJECTION; a `mutate` wrapper always resolves and
 * silently disarms both (05's wiring contract, point 2).
 *
 * `stages` is passed RAW, both statuses: filtering is the view's job and the archived
 * section is the only restore path a stage has (05's wiring contract, point 3).
 */
export function LeadStagesContainer() {
  const stagesQuery = useLeadStages();
  const saveLeadStage = useSaveLeadStage();
  const setLeadStageStatus = useSetLeadStageStatus();
  const reorderLeadStages = useReorderLeadStages();

  return (
    <LeadStagesView
      onReorderStages={(orderedIds) =>
        reorderLeadStages.mutateAsync({ orderedIds }).then(() => undefined)
      }
      onSaveStage={(payload) => saveLeadStage.mutateAsync(payload).then(() => undefined)}
      onSetStageStatus={(input) => setLeadStageStatus.mutateAsync(input).then(() => undefined)}
      stages={stagesQuery.data ?? []}
    />
  );
}
```

`stagesQuery.data ?? []` and no skeleton: `LeadStagesView` already owns an `EmptyPanel` empty
state, and a second loading surface in the container would be two components answering one
question. If 05's component turns out to need a `pending` signal it takes it as a prop; it does not
learn about TanStack.

### 4.2 `apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx` — EDITED, owned by 06

06 shipped `LeadsBoardContainerProps` with `clients`, `people`, `products`, `sellers` and
`onRequestConversion`, and shipped `LeadsBoardProps.sellerFilter` documented as *"controlled by the
caller (slice 07)"*. It did **not** specify how the filter reaches slice 04's
`useLeadsBoard(filters)` / `useMoveLead(filters)`. That is the one contract gap between 06 and 07,
and this slice closes it **inside the container**, not in the shell.

Add exactly one prop:

```ts
export type LeadsBoardContainerProps = {
  clients: SalesOpsClient[];
  people: SalesOpsPerson[];
  products: SalesOpsProduct[];
  sellers: { value: string; label: string }[];
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
  /**
   * Whether to OFFER the vendedor narrowing filter. `true` under `operacional` (the team
   * board), `false` under `meus-dados` (acceptance 15).
   *
   * It is NOT a scope switch and must never be read as one. A seller's board is narrowed
   * SERVER-side inside `withTenant` from the verified token; this boolean only decides
   * whether an admin is offered a control, and setting it `true` for a seller would add a
   * picker, not data.
   */
  showSellerFilter?: boolean;
};
```

and give the container the filter state:

```tsx
const [sellerPersonId, setSellerPersonId] = useState<string | null>(null);

/**
 * ONE filters value, feeding BOTH hooks. `useMoveLead`'s optimistic patch writes the
 * cache key derived from the filters it was given, so a board reading
 * `queryKeys.leads.board({sellerPersonId:'x'})` while the mutation patches
 * `queryKeys.leads.board(undefined)` would revert nothing visible and leave the card
 * where the failed request put it. Memoized so the two hooks and the cache key do not
 * churn on every render.
 */
const filters = useMemo(
  () => (showSellerFilter && sellerPersonId ? { sellerPersonId } : undefined),
  [showSellerFilter, sellerPersonId],
);
const stagesQuery = useLeadStages();
// `useLeadsBoard` fans out one request PER COLUMN (slice 03's `GET /leads` requires a
// `stageId`), so it needs the stage list and stays disabled until it arrives. See slice 04 §7.
const boardQuery = useLeadsBoard(stagesQuery.data ?? EMPTY_STAGES, filters);
const moveLead = useMoveLead(filters);
```

`EMPTY_STAGES` is a module-level `const EMPTY_STAGES: SalesOpsLeadStage[] = []`, not an inline
`[]`: an inline literal is a new array identity on every render and would re-run the hook's
memoized derivations for nothing. `useLeadStages()` was already this container's call (06 §4.5);
the only change here is that its result now also feeds the board query.

and build 06's `sellerFilter` prop from that state, passing `undefined` when the filter is not
offered:

```tsx
sellerFilter={
  showSellerFilter
    ? { value: sellerPersonId, options: sellers, onChange: setSellerPersonId }
    : undefined
}
```

**Why the state lives here and not in `SalesOpsApp.tsx`.** The `productKind` precedent
(`CLAUDE.md`, "Produtos & Serviços") puts a filter in the shell **because the header action reads
it** — `Novo produto` vs `Novo serviço`. Nothing in the shell chrome reads the vendedor filter: the
board draws its own `Filtros` control and its own `Novo lead` button. So the reason that hoisted
`productKind` does not apply, and the honest placement is the lowest component that needs it. It is
also component state and not URL state for the same reason `productKind` is: `CLAUDE.md` makes the
URL the source of truth for the **workspace and the page**, and a narrowing filter is neither.

Everything else in the file is untouched. In particular `onRequestConversion` stays a
pass-through, so slice 08 still attaches to one prop and edits no board file.

---

## 5. `apps/web/src/sales-ops/SalesOpsApp.tsx` — mount and props, no screen

Six edits. No component is declared, no view is authored, nothing in the 8946 lines moves.

**5.1** Two imports, after the existing local imports:

```tsx
import { LeadsBoardContainer } from './leads/LeadsBoardContainer';
import { LeadStagesContainer } from './leads/LeadStagesContainer';
```

Static, like every other view in this file. The dependency direction is one-way — the shell imports
`leads/`, `leads/` never imports the shell — which is why 05 and 06 both carry local copies of the
style constants instead of importing them back out.

**5.2** `titleForView`'s `Record<SalesOpsView, …>` gains two entries. The compiler demands them the
moment 3.2 lands, which is the point:

```tsx
    leads: {
      title: personal ? 'Minha prospecção' : 'Prospecção',
      subtitle: personal
        ? 'Seus leads em negociação, por etapa, com o tempo parado em cada uma'
        : 'Leads em negociação por etapa, com vendedor responsável e tempo parado',
    },
    etapas: {
      title: 'Etapas do funil',
      subtitle: 'Etapas configuráveis do quadro de prospecção, na ordem em que aparecem nele',
    },
```

The `personal` ternary mirrors `vendas` and `comissoes`, the only other two views that render in
both a team and a personal workspace.

**5.3** The `sellers` option list, built beside the other `useMemo`s near `filteredSales`:

```tsx
/**
 * The vendedor options for the lead board and the lead dialog. Built HERE, not in
 * `leads/`, because `hasFuncao` and `FUNCAO_SLUG_VENDEDOR` are module-local to this
 * file: `react-refresh/only-export-components` allows only component exports from this
 * module, so they cannot be exported, and re-deriving them in `leads/` would be exactly
 * the per-call-site slug comparison CLAUDE.md ("Pessoas e Funções") forbids.
 *
 * Resolved through `person.funcoes`, never through the deprecated `is_seller` mirror,
 * which is acceptance 4 and is also why `hasFuncao` exists at all. Active pessoas only:
 * an archived pessoa disappears from every assignment picker.
 */
const leadSellerOptions = useMemo(
  () =>
    persistedBootstrap.people
      .filter((person) => person.status === 'active' && hasFuncao(person, FUNCAO_SLUG_VENDEDOR))
      .map((person) => ({ value: person.id, label: person.displayName })),
  [persistedBootstrap.people],
);
```

`persistedBootstrap` and not `bootstrap`: an in-flight optimistic pessoa must not become a
selectable vendedor on a lead that is about to be written.

**5.4** The two mount blocks, inside the existing
`!bootstrapQuery.isLoading && !bootstrapQuery.isError` fragment, placed after the `funcoes` block
and before the `geral` block:

```tsx
                {view === 'leads' ? (
                  /*
                    ONE component for both routes. The difference between the team board
                    and a seller's board is NOT this boolean - the scope is applied on the
                    SERVER inside `withTenant` from the verified token (acceptance 15).
                    `showSellerFilter` only decides whether an admin is OFFERED the
                    narrowing picker; flipping it for a seller would add a control, never
                    a row.
                    `persistedBootstrap` throughout: an optimistic cadastro row belongs to
                    the cadastro screen that created it, never to a picker on another page.
                  */
                  <LeadsBoardContainer
                    clients={persistedBootstrap.clients}
                    people={persistedBootstrap.people}
                    products={persistedBootstrap.products}
                    sellers={leadSellerOptions}
                    showSellerFilter={workspace === 'operacional'}
                  />
                ) : null}
                {view === 'etapas' ? <LeadStagesContainer /> : null}
```

`onRequestConversion` is deliberately **not** passed. Until slice 08 lands, 06's board does not
offer the conversion stage as a move target at all, so there is no half-wired door and no ghost
card to explain (06, §8). Slice 08's whole edit to this file is adding that one prop.

**5.5** `headerAction` gains one guard so neither view inherits the chain's `'Nova proposta'`
fallthrough:

```tsx
  const headerAction =
    view === 'geral' || view === 'leads' || view === 'etapas'
      ? null
      : view === 'produtos'
      /* …rest of the chain byte-unchanged… */
```

Both screens draw their own primary button (`Novo lead` on the board, `Nova etapa` in the stage
toolbar), and 05's wiring contract point 1 says so explicitly: a second button in the page chrome
would be two doors to one dialog. Without this guard the shell would render `Nova proposta` over a
Kanban board and open the proposta wizard from it.

**5.6** `runHeaderAction` is **byte-unchanged**, on purpose. Its trailing
`setSaleWizard({mode:'create'})` is unreachable for these two views because 5.5 renders no button
to call it, and adding two dead early-returns would enlarge the diff to defend against a state that
cannot occur.

The `Filtros` button's `(view === 'vendas' || view === 'comissoes')` guard is also unchanged: the
board renders its own filter inside its own header row (06, §5.3).

---

## 6. `CLAUDE.md` (acceptance 24)

### 6.1 The correction — exact current sentence

Line 332, inside "Organization context", in the `Workspace` → `Painel` bullet. Current text,
verbatim:

> `SalesOpsWorkspace`, the `workspace` URL segment, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute` and `buildSalesOpsPath` are unchanged, and `navigation.ts` is byte-unchanged, because the URL remains the single source of truth for the active Sales workspace and page and renaming the type or the segment would rewrite every stored link an operator holds.

Exact replacement (one line, replacing that one line):

> `SalesOpsWorkspace`, the `workspace` URL segment, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute` and `buildSalesOpsPath` are unchanged by that rename, because the URL remains the single source of truth for the active Sales workspace and page and renaming the type or the segment would rewrite every stored link an operator holds.
>   That bullet used to end `and navigation.ts is byte-unchanged`, and v4.1.0 corrected it in the same commit that stopped it being true: the Kanban slice ADDS `leads` and `etapas` to `SalesOpsView` and one entry each to `operational`, `cadastros` and `meusDadosSeller`, and nothing else in the file.
>   The fence the original sentence was really drawing still holds and is the one to keep: no existing segment, type name or function in `navigation.ts` may be renamed or reordered, and a rename of DISPLAY chrome may still touch nothing but display strings.

### 6.2 "Sales Ops Routing" line 271 — exact current sentence

> - Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|pessoas|funcoes|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.

Exact replacement:

> - Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes|leads`, `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|geral`, and `meus-dados/vendedores|comissoes|leads|finders|vendas`.

### 6.3 The new domain section

Inserted as a whole new `## Kanban de leads` section, immediately **after** `## Propostas domain`
and before `## Environments`, so the pre-proposta stage sits beside the proposta it feeds. Write it
verbatim:

```markdown
## Kanban de leads

- A LEAD is a first-class entity in `sales_ops_leads` and is not a venda with zeroed numbers. Creating one inserts NOTHING into `sales_ops_sales` and consumes no proposta code or sequence.
  Widening `sales_ops_sales.status` with pre-proposta stages was considered and REJECTED, and that decision is recorded here so it is not revisited: `total_brl` and `net_margin_pct` are `NOT NULL` and feed `getSalesOpsSummary`, the dashboard and `computeSaleFinancials`, so a pre-proposta row would either lie with zeroes in every financial panel or force those three to learn a status that means "no numbers yet".
- A lead carries the contact name, an OPTIONAL `client_id` plus a free-text company fallback, an estimated value in integer CENTS whose column name says `estimated` out loud, a description, `seller_person_id` and `stage_id`. Creating a lead NEVER creates a `sales_ops_clients` row; the resolve-or-create happens at conversion and not one moment earlier, which is why the lead dialog's company picker has no `onCreate` row.
- Lead produtos live in a CHILD TABLE with a nullable `product_id` plus a name snapshot, mirroring `sales_ops_sale_items`. It is deliberately not `jsonb`, under the rule this file already states: an id must not dangle inside `jsonb`. `sales_ops_product_funcao_costs` is a table because it holds a `funcao_id`; `cost_split_bp` is `jsonb` because a split part holds no id at all. A lead produto holds one, so it is a table.
- A lead's vendedor is resolved through `person_funcoes` against the `vendedor` SYSTEM função, never through the deprecated `is_seller` mirror. On the web side the one resolver is `hasFuncao(person, FUNCAO_SLUG_VENDEDOR)` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, and the vendedor option list for every lead screen is built THERE and passed down: both symbols are module-local because `react-refresh/only-export-components` allows only component exports from that module, and re-deriving them under `leads/` would be exactly the per-call-site slug comparison this file forbids.
- Etapas live in their own org-scoped table with `is_system`, an order column and an archivable `status`, following the `sales_ops_funcoes` precedent exactly: a system etapa answers `409` the way `funcao_is_system` does today, an etapa is NEVER deleted but only archived, and `salesOpsRouter` still has no DELETE verb.
- There is a terminal negative etapa, `Perdido`, that REQUIRES a reason. The API answers `validation_error` to a move into it with no reason, and the move dialog blocks the submit before the request is built. Both halves are load-bearing: the UI block is the one the operator meets, and the API refusal is the one that is true for a client that skips it.
- A card shows how many days the lead has been PARKED in its current etapa, derived from `stage_changed_at`, which moves ONLY when the etapa changes. An ordinary edit to the lead's name, value or description leaves it alone, and so does a manual reorder inside the same column: a "stale for 12 days" badge that any keystroke resets is a badge nobody can act on.
- Manual ordering inside a column persists in a position column and reordering does NOT touch `stage_changed_at`, for the same reason.
- The keyboard `Mover para` dialog is the SINGLE EMITTER of a `MoveLeadPayload`; the drag layer calls that same emitter and installs no `KeyboardSensor` of its own, so deleting the whole `@dnd-kit` layer removes a convenience and not a capability. Drag is the convenience, the menu is the real control, and its oracles pass with the drag layer deleted - which is the test that proves the design rather than describes it.
- Every movement is OPTIMISTIC and reverts the card to its exact prior etapa AND prior position when the API rejects, through the existing pattern in `apps/web/src/sales-ops/optimistic.ts`. The optimistic patch and the board read MUST derive their cache key from the SAME filters value, which is why `LeadsBoardContainer` memoizes one `filters` object and hands it to both `useLeadsBoard` and `useMoveLead`: a board reading the narrowed key while the mutation patches the unnarrowed one reverts nothing visible and leaves the card where the failed request put it.
- Moving a lead into the CONVERSION etapa opens the proposta wizard prefilled with the empresa, the vendedor, the produtos, the value and the description. The card changes etapa ONLY after `POST /sales` answers `201`. Cancelling the wizard leaves the card exactly where it was, with no intermediate state persisted anywhere - no optimistic write, no request, nothing to clean up. That needs its own oracle, because the wizard already refuses to save without a cliente, an item carrying an área and `totalCents > 0`, so an incomplete lead must not be able to become a ghost card in a column with no proposta behind it.
  The seam is ONE optional prop, `onRequestConversion` on `LeadsBoardContainer`, forwarded verbatim to `LeadsBoard`: resolve with the created sale id to commit the move, resolve with `null` when the operator cancelled and the board does nothing at all, reject to surface it like any other failed move. While the prop is absent the conversion etapa is not offered as a move target at all, so a half-wired door never exists.
- After conversion the card sits in a final READ-ONLY column that mirrors `sale.status` (`draft|open|won|lost|cancelled`) and is not draggable. No board action ever calls `POST /sales/:id/transition`, and dragging a card can never materialize payables: winning or losing still happens on the propostas screen, which remains the only writer of `sale.status`. `SALE_TRANSITIONS` and its `EXPECTED_MATRIX` are byte-inaltered by this whole feature.
- Stage movement writes NOTHING to `audit_log`. The ledger is hash-chained, every audited write queues behind a global tail lock and it is never purged, while a card move is high-frequency noise; only the archive/restore lifecycle is audited, exactly as for the other cadastros.
- Leads do NOT travel in `/bootstrap`. They have their own paginated endpoint, because `getSalesOpsSnapshot` already dumps every sale, item and payable with no pagination at all and leads are the highest-volume entity in the product. No lead value enters `getSalesOpsSummary`, the dashboard or `computeSaleFinancials`, and a test proves that creating leads moves no existing financial number.
- Seller scoping is applied on the SERVER, inside `withTenant`, and is proven in `apps/api/test/rls/`. It is NEVER a client-side filter. `showSellerFilter` on `LeadsBoardContainer` decides only whether an ADMIN is offered the vendedor narrowing picker under `operacional/leads`; it is not a scope switch, and setting it for a seller would add a control and never a row.
- Routing: `operacional/leads` is the team board, `meus-dados/leads` is a seller's own, and `cadastros/etapas` is the admin cadastro. `leads` is ONE view id serving two workspaces, exactly as `vendas` and `comissoes` already do, distinguished by `titleForView`'s `personal` flag and by `workspaceForView`'s team-first precedence. A finder gains nothing: `meusDadosFinder` is byte-unchanged, because acceptance 15 scopes personal lead visibility to `seller` alone.
  Both nav entries are APPENDED to their lists and never prepended, and `etapas` sits before `geral` rather than after it. `getDefaultSalesOpsRoute` lands on `getSalesOpsNavigation(workspace, roles)[0]`, so the first element of each list is a ROUTE: prepending `leads` would move every seller's session start off `Meu painel` and the admin's `Operacional` landing off `Propostas`. The accepted cost is that the sidebar reads `Propostas, Comissões, Prospecção` although prospecção precedes a proposta; decoupling the landing view from the first nav item is its own change with its own oracle, not a quiet array reshuffle.
- The two lead screens live in `apps/web/src/sales-ops/leads/` and NEVER inside `SalesOpsApp.tsx`, which is already 8946 lines. That file's whole share of this feature is two imports, two `titleForView` entries, one `useMemo` building the vendedor options, two conditional mount blocks and one `headerAction` guard. That guard is not optional: the `headerAction` chain ends in a `'Nova proposta'` fallthrough, so without naming `leads` and `etapas` the shell would render a proposta button over a Kanban board and open the wizard from it.
- `LeadStagesContainer` and `LeadsBoardContainer` exist so a lead query runs only on a lead view. A hook cannot be called conditionally, so mounting a bare presentational view from the shell would make `useLeadStages()` and `useLeadsBoard()` fire from the dashboard; a conditionally mounted container is the only way to keep them where they belong. Both are wiring and hold no logic, and every stage callback is `mutateAsync` and never `mutate`, because the optimistic revert and the "dialog stays open on 409" behaviour are both keyed on the REJECTION that `mutate` swallows.
```

---

## 7. Tests — the oracles, and the mutation each is decisive against

### 7.1 `apps/web/src/sales-ops/__tests__/navigation.test.ts` (EXTENDED)

**The one honest caveat, stated rather than hidden.** Three existing assertions in this file are
**exhaustive** `toEqual` lists over `getSalesOpsNavigation(...).map(item => item.id)` — for
`operacional`, for `cadastros` and for the `meus-dados` seller+finder union — plus their two
`.map(item => item.label)` twins. Any new sidebar item changes them **by construction**; a screen
that is reachable and absent from the sidebar is not a screen. So those five arrays gain exactly
their new member, at the position §2 specifies, and **nothing else in the file is edited**. Every
`getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView` and `buildSalesOpsPath`
assertion already in the file must pass **byte-unchanged**, and that is the real reading of "the
existing tests must still pass unchanged": no existing ROUTE answer moves. If an executor finds
themselves editing a `resolveSalesOpsRoute` expectation, the implementation is wrong, not the test.

Three new oracles:

**`keeps every pre-existing canonical route at its exact segment`** — the canonical-route fence.
It carries a **hand-written frozen literal table** of the twelve pre-existing `(workspace, view,
roles)` triples and their expected `{route, path, redirect}`, copied from the current behaviour, and
asserts `resolveSalesOpsRoute` over each:

```
['tatico','dashboard',team]  -> /tatico/dashboard            redirect:false
['operacional','vendas',team]-> /operacional/vendas          redirect:false
['operacional','comissoes',team] -> /operacional/comissoes   redirect:false
['cadastros','produtos',team]-> /cadastros/produtos          redirect:false
['cadastros','areas',team]   -> /cadastros/areas             redirect:false
['cadastros','clientes',team]-> /cadastros/clientes          redirect:false
['cadastros','pessoas',team] -> /cadastros/pessoas           redirect:false
['cadastros','funcoes',team] -> /cadastros/funcoes           redirect:false
['cadastros','geral',team]   -> /cadastros/geral             redirect:false
['meus-dados','vendedores',seller] -> /meus-dados/vendedores redirect:false
['meus-dados','comissoes',seller]  -> /meus-dados/comissoes  redirect:false
['meus-dados','finders',finder]    -> /meus-dados/finders    redirect:false
['meus-dados','vendas',finder]     -> /meus-dados/vendas     redirect:false
```

plus `getDefaultSalesOpsRoute` for `team`, `seller`, `finder`, `sellerFinder`, `everything`,
`(team,'operacional')`, `(team,'cadastros')` and `(everything,'meus-dados')`.
*Decisive against:* renaming any existing segment, and — the one this slice could actually cause —
**prepending** a new nav item, which flips `getDefaultSalesOpsRoute(seller)` to
`meus-dados/leads` and `(team,'operacional')` to `leads`. The table **must be written out by
hand**, never derived from `getSalesOpsNavigation`, because a derived table moves with the bug and
is a green check over nothing.

**`routes the three lead screens and scopes each to its workspace`** — reachability.
Asserts `redirect: false` and the exact path for `('operacional','leads',team)`,
`('meus-dados','leads',seller)`, `('cadastros','etapas',team)`, and both accepted for
`everything`; asserts the bounces for `('operacional','leads',seller)` →
`/meus-dados/vendedores` `redirect:true`, `('meus-dados','leads',team)` → `/tatico/dashboard`
`redirect:true`, `('cadastros','etapas',seller)` → `/meus-dados/vendedores` `redirect:true`; asserts
`getSalesOpsNavigation('meus-dados', finder).map(i => i.id)` is exactly `['finders','vendas']` and
`resolveSalesOpsRoute({workspace:'meus-dados',view:'leads'}, finder).redirect` is `true`; asserts
`workspaceForView('leads', ['admin','seller'])` is `'operacional'` and
`workspaceForView('leads', seller)` is `'meus-dados'`; asserts
`buildSalesOpsPath({workspace:'operacional',view:'leads'})` is `'/operacional/leads'` and
`buildSalesOpsPath({workspace:'cadastros',view:'etapas'})` is `'/cadastros/etapas'`.
*Decisive against:* omitting any of the three nav entries (each omission makes the route resolve to
the role default with `redirect: true`), and against giving the finder a lead entry.

**`does not alias either new view and keeps the alias scoped to cadastros`**.
Asserts `resolveSalesOpsRoute({workspace:'cadastros', view:'leads'}, team)` falls through to the
role default `/tatico/dashboard` with `redirect: true`, because there is no `leads` entry under
`cadastros` and no alias may invent one; that `legacyCadastroViews` grew no member, by checking
`resolveSalesOpsRoute({workspace:'cadastros', view:'vendedores'}, team)` still yields
`/cadastros/pessoas` `redirect:true`, and that
`resolveSalesOpsRoute({workspace:'operacional', view:'etapas'}, team)` redirects.
*Decisive against:* a lazy implementation that adds `etapas`/`leads` to every list, or that widens
`aliasLegacyView` past `cadastros`.

### 7.2 `apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` (NEW) — the mount oracle

A dedicated file rather than an extension of `routing.test.tsx`, for one concrete reason:
`routing.test.tsx` replaces `'../hooks'` wholesale with a hand-listed mock object and renders
without a `QueryClientProvider`. Slice 04 put the lead hooks in a **different** module
(`apps/web/src/sales-ops/leads/hooks.ts`), so that file and the other two shell tests that mock
`'../hooks'` stay byte-unchanged and green — but a lead view rendered inside them would still need a
query client. Keeping the mount oracle separate keeps the blast radius at one new file.

Setup, `// @vitest-environment happy-dom`, mirroring `routing.test.tsx`'s auth and bootstrap mocks:
- `vi.mock('@/auth/react', …)` and `vi.mock('../hooks', …)` copied from `routing.test.tsx`, with the
  bootstrap fixture carrying one ACTIVE pessoa holding the `vendedor` system função, one ACTIVE
  pessoa holding only `finder`, and one **archived** pessoa holding `vendedor`.
- `vi.mock('../leads/LeadsBoardContainer', …)` and `vi.mock('../leads/LeadStagesContainer', …)`,
  each rendering a marker div (`data-leads-board` / `data-lead-stages`) and recording its props into
  a module-level `vi.fn()`. Mocking the containers is what removes the TanStack requirement, and it
  is the right seam: this file's question is *does the shell mount the right thing with the right
  props at the right URL*, which 05's and 06's own suites cannot answer.

Four oracles:

**`mounts the leads board at operacional/leads with the seller filter offered`** — renders
`/operacional/leads` for `['admin']`, asserts `[data-leads-board]` is present, asserts the captured
props carry `showSellerFilter: true`, and asserts the `sellers` array is exactly
`[{value: <vendedor pessoa id>, label: <her displayName>}]`.
*Decisive against:* deleting the `{view === 'leads' ? … : null}` block (marker absent); against
hard-coding `showSellerFilter`; and against building `sellers` from `is_seller` or from every
pessoa — the archived-vendedor and the finder-only fixtures are the two rows a wrong derivation
lets through.

**`mounts the same board at meus-dados/leads without the seller filter`** — renders
`/meus-dados/leads` for `['seller']`, asserts the marker is present and the captured props carry
`showSellerFilter: false`.
*Decisive against:* passing a constant `true`, which would hand a seller a vendedor picker over a
board the server has already narrowed — the one mutation that makes the admin and seller boards
indistinguishable on the client. Together with the previous oracle this is the pair the Verify
agent should look hardest at.

**`mounts the etapas cadastro at cadastros/etapas and nowhere else`** — renders
`/cadastros/etapas` for `['admin']`, asserts `[data-lead-stages]` is present and
`[data-leads-board]` is absent; then renders `/cadastros/produtos` and `/tatico/dashboard` and
asserts **both** markers are absent on each.
*Decisive against:* an unconditional mount, which is the mutation that would make `useLeadStages()`
and `useLeadsBoard()` fire on the dashboard — the exact reason the two containers exist.

**`offers no proposta header action on either lead screen`** — renders `/operacional/leads` and
`/cadastros/etapas` and asserts the header contains no `Nova proposta`, no `Novo produto`, no
`Nova área`; renders `/operacional/vendas` in the same file and asserts `Nova proposta` IS present.
*Decisive against:* omitting the §5.5 `headerAction` guard, which makes the chain fall through to
`'Nova proposta'` and renders a proposta button over a Kanban board. The positive `vendas` case is
the non-vacuity control: without it the assertion passes over a shell that renders no header at all.

### 7.3 Commands

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/navigation.test.ts
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/leads-routing.test.tsx
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/routing.test.tsx
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/navigation.ts src/sales-ops/SalesOpsApp.tsx src/sales-ops/leads
pnpm --filter @fxl-sales/web run type-check
```

`routing.test.tsx` is in the slice's own command list although the slice does not edit it: it is the
file most likely to break from a shell edit, and running it here is cheaper than finding out in the
wave. The wave runs the full suite, full lint and `pnpm run build` (acceptance 23).

---

## 8. Deliberate omissions

- **No `?vendedor=` URL parameter for the board filter.** The URL is the source of truth for the
  workspace and the page and for nothing else (`CLAUDE.md`, the `productKind` precedent). A
  shareable filtered board is a real want and belongs in `nexo/ROADMAP.md`, not here.
- **No `onRequestConversion` wiring.** Slice 08 owns it. Passing a stub now would offer the
  conversion column with nothing behind it.
- **No `NoRoleGuard` / legacy-tree change.** Neither new route touches `/admin/*`, `/finder/*`,
  `/seller/*` or `/no-role`, and `TERMINAL_AUTH_ROUTES` gains no member: a lead board is a real
  page, not a dead end, so it must remain restorable as a `returnTo`.
- **No `Alt+Arrow` card shortcut**, filed to `nexo/ROADMAP.md` by this slice as 06 asked. One line
  under the existing roadmap list: a third command path duplicating the `Mover para` dialog, with
  nowhere to type a lost reason.
- **No export of `hasFuncao`.** §5.3.
- **No change to `runHeaderAction`.** §5.6.
