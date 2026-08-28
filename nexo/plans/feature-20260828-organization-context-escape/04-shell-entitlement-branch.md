---
id: 04-shell-entitlement-branch
milestone: v2.8.0
status: done
depends_on: [03-missing-entitlement-panel]
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx]
acceptance: "given an operator whose active Hub Organization does not carry FXL Sales, when the sales-ops bootstrap query fails with 402 {error:'payment_required', code:'missing_entitlement'}, then the shell renders MissingEntitlementPanel and the string 'Verifique o servidor local' is absent from the document"
goal: Route a 402 missing_entitlement in the sales-ops shell to MissingEntitlementPanel so the generic API-fault copy is unreachable for that error.
must_not_break:
  - a 401 or an unavailable token still renders the 'Sessão expirada' panel (blank-bearer-token.test.tsx, session-loss-keeps-route.test.tsx)
  - a 500 or any transport failure still renders 'A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.'
  - bootstrapQuery.isLoading still renders LoadingPanel and never an empty state or an error panel
  - the success branch, the header 'Atualizando' indicator and every view under !isLoading && !isError render exactly as today
rules:
  - do not add the account-dropdown Organization switcher here; that is slice 05, which edits this same file in a later wave
  - do not edit apps/web/src/auth/react.tsx, apps/web/src/lib/*, or apps/web/src/sales-ops/MissingEntitlementPanel.tsx
  - do not edit apps/web/src/sales-ops/CadastroHistoryPanel.tsx
  - no API change, no SDK upgrade, no ?organization= deep link, no change to the entitlement gate
  - no window.location.reload and no full page reload anywhere in this slice
  - no em dash or en dash on any added line
verifier_focus: that the new test genuinely fails when the entitlement branch is removed, and that the 401 and 500 branches are still reached by their own cases rather than being swallowed by the new first branch
---

# 04 - Route the shell's 402 to the entitlement panel

## Context

This slice implements row 4 of the slice table in `nexo/plans/feature-20260828-organization-context-escape/00-OVERVIEW.md`.

The reported defect is a dead end with a lie on it.
`apps/api/src/middleware/app-auth.ts:171-172` answers `402 {error:'payment_required', code:'missing_entitlement'}` when the operator's ACTIVE Hub Organization does not carry FXL Sales.
That verdict is correct and is explicitly out of scope to change.
What is wrong is that `apps/web/src/sales-ops/SalesOpsApp.tsx:1679` renders it as:

> A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.

The operator is told their local server is broken. It is not. Their Organization is simply the wrong one.
This slice makes that copy UNREACHABLE for a 402 `missing_entitlement`.

This slice is a pure routing change in one JSX chain plus one new test file. It builds nothing new: slice 01 supplies the classifier and slice 03 supplies the panel.

## Assumed interface

Slices 01 and 03 had not been written to `nexo/plans/feature-20260828-organization-context-escape/` when this plan was authored (the directory held only `00-OVERVIEW.md`), so the following shapes are assumed from the overview's slice table and from the code as it stands today. If a dependency landed with a different shape, STOP and escalate rather than reshaping it from inside this slice.

1. `apps/web/src/lib/require-token.ts` exports:

   ```ts
   export function isEntitlementFailure(error: unknown): boolean;
   ```

   It returns `true` for an object carrying `status === 402`, and `false` for everything else, including every auth failure. It keys on the STATUS ALONE and deliberately does NOT require `code`: slice 01 verified by grep that `app-auth.ts:172` is the only 402 the API emits, and requiring `code` would fail CLOSED back onto the "verifique o servidor local" copy whenever the 402 body does not parse (`apiFetch` does `res.json().catch(() => ({}))`). `ApiError.code` is preserved for reading and logging, not for branching. It duck-types rather than importing `ApiError`, exactly as `isAuthFailure` already does, because that module's header comment pins that it imports nothing (`api-client.ts` imports it, so any import back is a cycle).

2. `isAuthFailure` is unchanged and returns `false` for a 402. Confirmed against the file as it stands: its only non-token branch is `status === 401`.

3. `apps/web/src/lib/api-client.ts` `ApiError` gains an optional `code?: string`, and both `apiFetch` and `apiFetchBlob` copy `body.code` onto the thrown object. Today they drop it entirely (fact 6 in the overview), which is why nothing downstream can see `missing_entitlement` yet.

4. `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` exports a NAMED `MissingEntitlementPanel` that this slice renders with NO props: `<MissingEntitlementPanel />`. It reads the active Organization, the account's Organizations and `setActive` from the auth-context seam itself (slice 02), so the shell hands it nothing. `onRetry` is OPTIONAL on that component by agreement with slice 03, and this slice deliberately passes nothing. See "Refetch wiring" below for why.

## The change

One file, one JSX chain: `apps/web/src/sales-ops/SalesOpsApp.tsx`, the error block currently at lines 1665-1683.

### Import

Extend the existing import at line 75:

```tsx
import { isAuthFailure, isEntitlementFailure } from '@/lib/require-token';
```

Add, beside the `CadastroHistorySection` and `ProfessionalSplitPanel` imports at lines 127-128 and in the same local-module group:

```tsx
import { MissingEntitlementPanel } from './MissingEntitlementPanel';
```

Keep the group alphabetical if it already is at the time of the edit; `MissingEntitlementPanel` sorts between `CadastroHistoryPanel` and `ProfessionalSplitPanel`, so no reordering is needed.

### The branch chain

Replace the block that today reads (lines 1665-1683):

```tsx
{bootstrapQuery.isLoading ? <LoadingPanel /> : null}
{bootstrapQuery.isError ? (
  isAuthFailure(bootstrapQuery.error) ? (
    /* ... */
    <EmptyPanel title="Sessão expirada" text="..." />
  ) : (
    <EmptyPanel title="Não foi possível carregar" text="..." />
  )
) : null}
```

with a three-way chain in which the entitlement test comes FIRST. The `isLoading` line above it is unchanged, and the `EmptyPanel` copy for both surviving branches is unchanged to the character.

Write it exactly like this, comments included:

```tsx
{bootstrapQuery.isLoading ? <LoadingPanel /> : null}
{bootstrapQuery.isError ? (
  /*
    Most specific classification first, and it must STAY first.
    A `402 missing_entitlement` is the Hub telling us the operator's ACTIVE
    Organization does not carry FXL Sales. It is a correct verdict about WHICH
    tenant is selected, not a transport fault and not a dead session, and it is
    the only one of the three that the operator can fix from inside the app.
    `isAuthFailure` is false for a 402 today, so the order is not what makes this
    branch reachable - it is what keeps it reachable if `isAuthFailure` is ever
    widened, and it is what stops a reader from believing the generic panel below
    is the fallback for "any non-401".
    The invariant this chain encodes: the "verifique o servidor local" copy is
    reachable ONLY for an error that is neither an entitlement failure nor an auth
    failure. `entitlement-dead-end.test.tsx` is the oracle for all three arms.
  */
  isEntitlementFailure(bootstrapQuery.error) ? (
    <MissingEntitlementPanel />
  ) : isAuthFailure(bootstrapQuery.error) ? (
    /*
      An expired or unrenewable Hub session used to render as the API-fault
      panel below, so a logged-out operator was told the server was broken.
      Covers both halves: no token was available, and a token the API rejected.
    */
    <EmptyPanel
      text="Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente."
      title="Sessão expirada"
    />
  ) : (
    <EmptyPanel
      text="A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."
      title="Não foi possível carregar"
    />
  )
) : null}
```

Nothing else in the file changes. In particular the `{!bootstrapQuery.isLoading && !bootstrapQuery.isError ? (` success gate at line 1684 is untouched, so the entitlement panel and the views remain mutually exclusive by construction.

## Design decisions

### Why the entitlement branch goes first

Three orderings were possible.

- FIRST among the error branches (chosen).
- Between `isAuthFailure` and the generic fallback.
- Folded into the generic fallback as a nested test.

They are behaviourally identical TODAY, because `isAuthFailure` is `isAuthTokenUnavailableError(error) || status === 401` and a 402 satisfies neither. The choice is therefore about which one stays correct under change, and about what the chain teaches its next reader.

First position wins on both counts:

- It is capture-proof. `nexo/ROADMAP.md` already carries an open intent to widen the auth classification (threading a `reason` so a transient `/auth/refresh` failure stops reading as `Sessão expirada`). Any widening of `isAuthFailure` that reaches beyond 401 would, in the second ordering, silently steal the 402 and reinstate a dead end with different copy. In first position the entitlement verdict cannot be captured by an upstream branch, because there is no upstream branch.
- It reads as a classification ladder from most specific to least: "this exact tenant verdict", then "the session", then "everything else". The third ordering inverts that and buries the only actionable state inside the panel that exists to say we do not know what happened.

The invariant, stated once so a reviewer can check the chain against it: **the "verifique o servidor local" copy is reachable ONLY for an error that is neither an entitlement failure nor an auth failure.** The test file below pins all three arms, so a future reorder that breaks the invariant fails a named oracle rather than a code review.

### Loading

The mandatory rule is that `isLoading` renders a skeleton, never an empty state.

The existing `{bootstrapQuery.isLoading ? <LoadingPanel /> : null}` already satisfies it and is NOT edited by this slice. `LoadingPanel` (line 991) is the spinner card reading `Carregando dados comerciais`.

This change cannot create a window where an error panel renders during a first load, because `isLoading` in TanStack Query v5 is `isPending && isFetching`, and `isError` is `status === 'error'`; a query cannot hold both statuses at once, so the two lines are mutually exclusive whatever the third branch does. This slice adds a branch strictly INSIDE the already-guarded `isError` subtree and touches neither predicate.

The one window worth naming is the one AFTER an error: TanStack keeps `status: 'error'` while a plain `refetch()` of a failed query is in flight, so an error panel does stay on screen during such a refetch, with `isFetching` true and `isLoading` false. That is precisely the window the next decision removes.

### Refetch wiring: nothing is passed, the cache flush does it

`SalesOpsApp` passes NO refetch callback to `MissingEntitlementPanel`. It does not pass `bootstrapQuery.refetch`.

CLAUDE.md pins that `setActive` in `apps/web/src/auth/react.tsx` calls `queryClient.clear()` on every COMPLETED workspace switch, after `await client.setActive(...)` and after the `operationGeneration` check, and before `tokenCache.seed` and `observeToken`. That ordering is load-bearing and has two dedicated oracles in `apps/web/src/auth/__tests__/react.test.tsx` (`keeps the current tenant's cache while a workspace switch is still in flight` and `does not flush when a superseded workspace switch resolves late`).

`clear()` destroys the query, not just its data, so the mounted `useSalesOpsBootstrap` observer re-subscribes against a fresh entry with `status: 'pending'` and no data and fetches immediately. `refetch()` would not: it leaves `status: 'error'`.

So the two options differ in what the operator actually sees between the switch and the new data:

- With the flush alone: the entitlement panel disappears the moment the switch completes, `isLoading` becomes true, and `LoadingPanel` renders until the new tenant's bootstrap lands. Exactly the mandated skeleton-not-empty-state behaviour, for free.
- With `refetch()`: `status` stays `'error'`, so the operator keeps staring at the MissingEntitlementPanel naming the OLD Organization while the new tenant's request is in flight. That is a stale, actively misleading frame, and it is the same class of leak CLAUDE.md gives as the reason `clear()` was chosen over `invalidateQueries()` in the first place.

Passing both would be worse than either: a `refetch()` racing a `clear()` re-subscribe issues a second request for the same key, and the flush's whole point is that a request issued before it cannot write back afterwards.

Token ordering, since the refetch reads a token: `queryClient.clear()` notifies observers through the notify manager (a scheduled microtask), while `tokenCache.seed` runs synchronously in the same block immediately after the flush. The refetch's `await requireToken(getToken)` therefore cannot resolve before the new Organization's token is seeded. This slice introduces no new dependence on that ordering; it is the same path every workspace switch already takes.

Concretely, the operator sees: entitlement panel naming Organization A -> click the switch to Organization B in the panel -> panel's own pending affordance (slice 03 owns it) while `setActive` is in flight -> flush -> `Carregando dados comerciais` skeleton -> Organization B's dashboard. No reload, no white flash, no stale panel.

### CadastroHistoryPanel.tsx is OUT of scope

`apps/web/src/sales-ops/CadastroHistoryPanel.tsx:124-135` carries the same `isAuthFailure ? Sessão expirada : generic` shape, with its own generic copy `Não foi possível carregar o histórico de arquivamentos.`

It stays untouched in this slice, for a structural reason rather than a budget one.

`CadastroHistorySection` is rendered at `SalesOpsApp.tsx:1770`, inside the `{!bootstrapQuery.isLoading && !bootstrapQuery.isError ? (` success branch, under `view === 'configuracoes'`. It is reachable only AFTER a bootstrap that SUCCEEDED. If the active Organization lacks the entitlement, the bootstrap 402s and that subtree never mounts; if the Organization changes under a mounted shell, the switch flushes the cache and the bootstrap fails first, replacing the whole section with the shell's own error block. So that panel cannot be the dead end that was reported, and its generic copy is not reachable for a 402 by any path that exists today.

Note also that its generic copy does not lie about the server: it says only that the history could not be loaded. The reported defect is specifically the false "verifique o servidor local" claim, which appears in exactly one place.

Editing it here would widen `files_modified`, drag `MissingEntitlementPanel` into a `MutedBlock`-shaped surface it was not designed for, and force this slice's oracle to cover a second component to stay non-vacuous. Instead, file one line in `nexo/ROADMAP.md` during Capture:

```
- chore: `apps/web/src/sales-ops/CadastroHistoryPanel.tsx` still classifies only `isAuthFailure` vs generic, so a `402 missing_entitlement` there would read as "não foi possível carregar o histórico". Unreachable today - the section renders only inside the bootstrap's success branch, and a 402 fails the bootstrap first - so `feature-20260828-organization-context-escape` slice 04 deliberately left it alone. Close it if that panel ever gains a route that does not sit behind a successful bootstrap.
```

## Test contract (the locked oracle)

New file: `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`

Base it on `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx`, which is the closest existing shape and the right one: it mounts the REAL `SalesOpsApp` inside a real `QueryClientProvider` and `MemoryRouter`, mocks `@/auth/react` and `@/components/ui/dialog`, and stubs the global `fetch` while deliberately leaving `../api` and `@/lib/api-client` unmocked. That last point is what makes this oracle worth having: the 402 body travels the real `apiFetch` error path, so the test also proves that slice 01's `code` really survives into `ApiError`. Do NOT stub `../hooks` here (that is `routing.test.tsx`'s idiom, and it would replace the very classification under test with a hand-written `error` object).

Copy verbatim from `blank-bearer-token.test.tsx`: the `// @vitest-environment happy-dom` pragma, the `act` extraction, the `@/components/ui/dialog` mock, the `beforeEach` / `afterEach` pair with `vi.stubGlobal('fetch', fetchMock)`, `flushReact`, and `renderApp` with `retry: false` on both queries and mutations. `retry: false` is mandatory: without it the 402 is retried and the error frame never settles.

The `@/auth/react` mock must additionally export every hook `MissingEntitlementPanel` reads from that module (per slice 02, at least `useOrganizations`; `useAccessToken`, `useAuthProfile` and `useLogout` are already in the existing factory). `vi.mock` with a factory REPLACES the module, so a missing export throws at render rather than failing an assertion, and the failure will not look like the thing under test. Give `useOrganizations` the full seam stub below, two-entry so the panel renders its switch affordance rather than an empty-list state:

```ts
  useOrganizations: () => ({
    active: { id: 'org-a', name: 'Alfa Consultoria' },
    activeName: 'Alfa Consultoria',
    organizations: [
      { id: 'org-a', name: 'Alfa Consultoria' },
      { id: 'org-b', name: 'Beta Engenharia' },
    ],
    others: [{ id: 'org-b', name: 'Beta Engenharia' }],
    setActive: vi.fn(async () => undefined),
    client: { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') },
  }),
```

`client.checkoutUrl` is mandatory here: `MissingEntitlementPanel` calls it from a mount effect, and an undefined `client` throws inside that effect rather than failing an assertion, which would read as the routing change being broken.

Helper for the failing response, mirroring what `app-auth.ts` really sends:

```tsx
const missingEntitlement = {
  ok: false,
  status: 402,
  json: async () => ({ error: 'payment_required', code: 'missing_entitlement' }),
};
```

The four cases:

1. **`renders the entitlement panel for a 402 missing_entitlement`**
   `mocks.getToken.mockResolvedValue('hub-access-token')`, `fetchMock.mockResolvedValue(missingEntitlement)`, render `/tatico/dashboard`.
   Assert the panel is on screen by BOTH of the markers slice 03 owns: `container.querySelector('[data-missing-entitlement]')` is not null, and `container.textContent` contains `FXL Sales não está ativo nesta Organização` (slice 03's `MISSING_ENTITLEMENT_COPY.title`). Slice 03 explicitly forbids `data-testid` in production markup, so `[data-missing-entitlement]` on its `<section>` is the stable hook. Use `[data-missing-entitlement]` as "the entitlement panel marker" in cases 2, 3 and 4 as well. The positive assertion is what stops case 1's `not.toContain('Verifique o servidor local')` from passing because the shell rendered nothing at all.
   Then, and this is the assertion that IS the reported defect:

   ```tsx
   expect(container.textContent ?? '').not.toContain('Verifique o servidor local');
   ```

   Nothing in the suite catches that absence today. Also assert `not.toContain('Sessão expirada')`, so a future collapse of the two branches into one is caught here too.

2. **`still renders the generic API fault for a 500`** (must-not-break)
   `fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'internal_error' }) })`.
   Assert `toContain('Verifique o servidor local')`, and that the entitlement panel marker is ABSENT. The absence is what keeps case 1 non-vacuous.

3. **`still renders Sessão expirada for a 401`** (must-not-break)
   `fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })`.
   Assert `toContain('Sessão expirada')`, `not.toContain('Verifique o servidor local')`, and the entitlement panel marker absent. This is the case that proves the new FIRST branch does not swallow a 401.

4. **`renders the skeleton and no error panel while the bootstrap is loading`**
   `fetchMock.mockReturnValue(new Promise(() => {}))` (a fetch that never settles), render, flush.
   Assert `toContain('Carregando dados comerciais')`, and `not.toContain` for all three of the entitlement panel marker, `'Sessão expirada'` and `'Verifique o servidor local'`.
   Do not use fake timers; the existing `flushReact` already awaits a macrotask.

Non-vacuity check the Verify agent should run: delete the `isEntitlementFailure(...) ? <MissingEntitlementPanel /> :` arm and confirm case 1 fails on the `not.toContain('Verifique o servidor local')` line specifically. Restore afterwards.

### RUN-ONCE command for the named oracle

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx
```

`vitest run` is single-shot; never `vitest` alone, which watches. The web package's own `test` script is already `vitest run`, so `pnpm --filter @fxl-sales/web test` is the whole-package equivalent.

Full gate before the slice is called done, from the repo root:

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/blank-bearer-token.test.tsx src/sales-ops/__tests__/session-loss-keeps-route.test.tsx src/sales-ops/__tests__/routing.test.tsx
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm test
```

## Sequencing and risks

1. Confirm slices 01 and 03 have landed and that `isEntitlementFailure` and `MissingEntitlementPanel` match the "Assumed interface" section. If not, escalate; do not stub either one inside this slice.
2. Add the two imports.
3. Replace the error block with the three-way chain, comments verbatim as written above.
4. Write the test file. Run case 2 and case 3 FIRST and watch them pass against the new code, so the must-not-break arms are known good before case 1 is trusted.
5. Run the non-vacuity check on case 1.
6. Run the full gate.

Risks, each with its mitigation:

- **The panel marker string drifts from slice 03.** Read `MissingEntitlementPanel.tsx` before writing the assertion and use the string it actually renders. Do not edit that file to suit the test.
- **The `@/auth/react` factory is missing an export the panel reads.** Symptom is a render-time throw, not a copy mismatch. Add the export to the factory; that is a test-file change only.
- **The 402 is retried and the frame never settles.** `retry: false` in `renderApp`'s `QueryClient`, copied from `blank-bearer-token.test.tsx`.
- **Prettier reflows the nested ternary.** Run the repo's formatter over the file and commit the formatted result; the comment text above is what must survive, not the exact indentation.
