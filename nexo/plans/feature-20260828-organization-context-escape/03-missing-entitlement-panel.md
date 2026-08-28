---
id: 03-missing-entitlement-panel
milestone: v2.8.0
status: todo
depends_on: [01-entitlement-classifier, 02-organization-seam]
files_modified: [apps/web/src/sales-ops/MissingEntitlementPanel.tsx, apps/web/src/sales-ops/missing-entitlement-copy.ts, apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx]
acceptance: "given an operator whose active Hub Organization does not carry FXL Sales, when MissingEntitlementPanel renders, then it names that Organization, offers the account's OTHER Organizations as switch targets through setActive followed by onRetry, then offers a Hub checkout link resolved from client.checkoutUrl(), renders NO picker when there is no other Organization, renders a skeleton while the checkout href is resolving, degrades to honest copy when checkoutUrl or setActive rejects, and never calls window.location.reload"
goal: Add a self-contained, unit-tested MissingEntitlementPanel that renders the honest PT-BR state for a 402 missing_entitlement.
must_not_break:
  - SalesOpsApp.tsx, which this slice does not touch at all (slice 04 owns the wiring)
  - apps/web/src/auth/react.tsx, which slice 02 owns
  - apps/web/src/lib/*, which slice 01 owns
  - the native picker ban enforced by no-restricted-syntax in apps/web/eslint.config.js
  - every existing web test, none of which imports this new module
rules:
  - no em dash and no en dash on any added line, plain hyphen only
  - every user-facing string says "Organização", never "workspace"
  - never window.location.reload and never a full page reload
  - a raw Hub workspace id is never a primary label; orgLabel / isOrgLabelFallback decide
  - any single-select picker is Combobox from @/components/ui/combobox
  - a picker is rendered only when it has at least one real option
verifier_focus: that the zero-other-Organization branch renders no picker at all while still offering a live checkout link, and that no branch can render an anchor whose href is unresolved
---

# 03 - `MissingEntitlementPanel`

## What this slice is

ONE new component file plus ONE new test file. Nothing else.

- `apps/web/src/sales-ops/MissingEntitlementPanel.tsx`
- `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx`

The component replaces, for the `402 missing_entitlement` case only, this copy from
`apps/web/src/sales-ops/SalesOpsApp.tsx:1679`:

> "A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."

That sentence is a lie for a 402: the API answered perfectly, and the local server is fine.
The Organization the session is anchored to simply does not carry FXL Sales.

**This slice does not modify `SalesOpsApp.tsx`.** The component is written, exported and tested
in isolation. Slice 04 imports it and routes `isEntitlementFailure(error)` to it. If you find
yourself opening `SalesOpsApp.tsx`, `apps/web/src/auth/react.tsx` or anything under
`apps/web/src/lib/`, stop: another slice owns that file and the overlap breaks parallel safety.

## Assumed interface

The seam below is slice 02's LANDED shape, reconciled against `02-organization-seam.md`. It is
consumed at exactly ONE place - a single destructure on the first line of the component body -
and mocked at exactly ONE place in the test. If slice 02 lands a different name or a different
field shape, reconcile in those two places and nowhere else. Do NOT change slice 02 to match
this plan.

```ts
// exported from apps/web/src/auth/react.tsx by slice 02
export type Organization = { id: string; name?: string; products?: string[] };

function useOrganizations(): {
  active: Organization | null;
  activeName: string | undefined;
  organizations: Organization[];
  others: Organization[];
  setActive: (organizationId: string) => Promise<void>;
  client: HubClient;
};
```

Two facts about that seam, already confirmed against the tree, that the component depends on:

1. `HubClient.setActive` "throws on failure (403 non-member, dead session, network)" - the SDK's
   own docstring. So a rejection is a real, expected branch, not a defensive nicety.
2. `client.checkoutUrl(sku?)` returns `Promise<string>` and DISCOVERS the Hub web origin over
   the network on first call. It can reject.

## Decision 1 - hook for the Organization seam, prop for the refetch

**The component reads `useOrganizations()` itself and takes `onRetry` as a prop.**

```tsx
export function MissingEntitlementPanel({ onRetry }: { onRetry?: () => void }) { ... }
```

Why the seam comes from the hook:

- It is auth state, not view state. Slice 05 puts the SAME switcher in the account dropdown; if
  this panel took `organizations` / `setActive` / `client` as props, `SalesOpsApp` would have to
  hold and forward them twice, which is exactly the duplicated switching logic the feature
  acceptance forbids.
- It keeps the panel's public surface to a single prop, so slice 04's wiring is one line.

Why `onRetry` is a prop:

- The bootstrap query lives in `apps/web/src/sales-ops/hooks.ts` and is owned by `SalesOpsApp`.
  Reaching into it from here would couple a presentational panel to a data hook and would make
  the component untestable without a `QueryClientProvider`.
- `onRetry` is exactly `() => void bootstrapQuery.refetch()` at any host that wants it.

`onRetry` is OPTIONAL. The shell (slice 04) passes nothing, because `setActive` already runs
`queryClient.clear()` after its await, which DESTROYS the query rather than invalidating it, so
the mounted `useSalesOpsBootstrap` observer re-subscribes at `status: 'pending'` and fetches on
its own; a `refetch()` would leave `status: 'error'` and keep this panel on screen naming the OLD
Organization while the new tenant's request is in flight. The prop stays in the signature because
it is the seam any future host needs, and because the test drives the ordering guarantee through
it.

Testability: with the seam behind ONE module (`@/auth/react`) the test does
`vi.mock('@/auth/react', ...)` and drives every branch with plain objects and `vi.fn()`. No live
Hub, no network, no `QueryClientProvider`, no router.

## Decision 2 - the short cases

`organizations` is the token's `workspaces` claim: a CAPPED, display-only preview. It may be
empty, may hold exactly one entry, and may not list every Organization the account really has.

`others` comes from the seam. Slice 02 derives it once, and when `active` is `null` it
deliberately removes nothing, which is the honest behaviour: offering one extra row is far less
harmful than hiding the operator's only escape. This panel does not re-derive it.

| `others.length` | What renders |
|---|---|
| `0` | NO picker, NO switch button, NO empty listbox. The lead paragraph says there is nowhere to switch to, and the Hub checkout is the only offer. |
| `1` | A direct switch BUTTON, not a picker. |
| `>= 2` | One `Combobox` from `@/components/ui/combobox`, `aria-label="Organização"`. |

Justification for the single-entry case being a button: a searchable picker whose whole purpose
is to choose among one item is theatre - it costs three interactions (open, read, click) to
express a one-bit decision, and its search field can only ever filter that single row away. A
button states the offer directly: "Ir para <Organização>". A one-item `Combobox` would be
defensible; a `Combobox` with nothing in it is forbidden, and that is the case this table
exists to make unreachable.

The active Organization is NEVER a switch target, in any of the three branches. It is named in
the copy and nowhere else.

## Decision 3 - the async `checkoutUrl()`

**Resolve in an effect on mount; render a `Skeleton` until it lands; render a real `<a href>`
once it does.** Not resolve-on-click.

Why:

- An anchor with a real `href` is the only affordance that supports middle-click, "open in new
  tab" and "copy link". A button that awaits then navigates is a link that lies about being one.
- Resolve-on-click means the operator's click does nothing visible for as long as the Hub
  discovery fetch takes, which on this exact screen (the operator is already stuck) reads as a
  second thing being broken.
- The discovery result is cached per process by the SDK, so the cost is paid once.

There is exactly one three-state machine for it:

```ts
type CheckoutState =
  | { status: 'loading' }
  | { status: 'ready'; href: string }
  | { status: 'failed' };
```

- `loading` renders `<Skeleton className="h-9 w-[168px] rounded-[10px]" />` plus an
  `sr-only` span carrying `Preparando o link do FXL Hub`. The artifact rule "isLoading renders
  a skeleton, never an empty state" applies to the panel's own loading states, so the checkout
  block must never be blank while resolving. `Skeleton` comes from `@/components/ui/skeleton`.
- `ready` renders the anchor. Mark the block `data-hub-checkout="ready"`.
- `failed` renders the honest muted line plus a `Tentar novamente` button that re-runs the
  effect by bumping an `attempt` counter in state. It renders NO anchor at all - a dead or
  `href="#"` link on this screen would be the same class of defect as the copy being replaced.

Effect hygiene, all three required:

- A `cancelled` flag in the effect closure, checked before every `setState`, so a resolution
  landing after unmount is dropped whole.
- `attempt` in the dependency array, so `Tentar novamente` really re-runs it.
- `.catch()` on the promise, never an unhandled rejection. A rejection sets `failed`; it must
  not propagate and must not crash the panel. The panel is the LAST thing standing between the
  operator and a blank screen, so nothing in it may throw during render.

No `sku` argument is passed. `checkoutUrl()` bare is the product's own checkout, which is what
"contratar o FXL Sales para esta Organização" means.

## Decision 4 - switching feedback, and why `onRetry` is still called

State: `const [switchingId, setSwitchingId] = useState<string | null>(null)` and
`const [switchFailed, setSwitchFailed] = useState(false)`.

The handler, exactly:

1. If `switchingId !== null`, return. One switch at a time.
2. `setSwitchFailed(false)`, `setSwitchingId(id)`.
3. `await setActive(id)`.
4. On resolve: call `onRetry?.()`. It is called AFTER the await, never before: firing it against
   the old token would just reproduce the same 402.
5. On reject: `setSwitchFailed(true)`.
6. In both paths, `setSwitchingId(null)` guarded by a `mountedRef`, because a successful switch
   very probably unmounts this panel and a `setState` on a dead root is a warning that will be
   read as a real bug by the next person.

**Why `onRetry` is optional, and why the shell passes nothing.** `setActive` in
`apps/web/src/auth/react.tsx:543-568` runs `queryClient.clear()` after the await and before
seeding the new token - documented at length, and correct. `clear()` DESTROYS the query rather
than invalidating it, so the mounted `useSalesOpsBootstrap` observer re-subscribes against a
fresh entry at `status: 'pending'` and fetches on its own. A `refetch()` on top of that would
leave `status: 'error'` and keep this panel on screen naming the OLD Organization while the new
tenant's request is in flight, which is a stale, actively misleading frame. Slice 04 therefore
mounts `<MissingEntitlementPanel />` with no callback at all, and the prop is OPTIONAL so that
mount type-checks. It stays in the signature because it is the seam any future host outside the
sales-ops shell needs, and because the test drives the after-the-await ordering guarantee
through it.

**`window.location.reload()` is forbidden here and everywhere in this component.** The whole
point of `setActive` is that components stay mounted across a tenant switch. A reload throws
away the operator's scroll position, any open dialog and the warmed cache to achieve something
the seam already did.

In-flight rendering:

- Single-other branch: the button is `disabled` and its text becomes `Trocando de Organização...`
  with a `<Loader2 className="h-[14px] w-[14px] animate-spin" />` from `lucide-react`, matching
  the `Restaurar` button in `CadastroHistoryPanel.tsx`.
- Combobox branch: `disabled={switchingId !== null}` on the `Combobox`, and a muted status line
  reading `Trocando de Organização...` under it.
- `switchFailed` renders the error line under whichever control is present. It does not replace
  the control - the operator must be able to try again or pick a different Organization.

## Exact copy strings

These become test assertions verbatim. PT-BR, tone matched to `Sessão expirada` and
`Não foi possível carregar`. No dash characters of any kind. Every one says "Organização", never
"workspace", because "workspace" already means a Sales-internal view group in this shell.

Declare them as module-level `const`s at the top of the file so the test can import them and so
a copy edit cannot silently desynchronise the oracle:

```ts
export const MISSING_ENTITLEMENT_COPY = { ... } as const;
```

| Key | String |
|---|---|
| `title` | `FXL Sales não está ativo nesta Organização` |
| `activePrefix` | `A Organização ativa nesta sessão é ` |
| `activeSuffix` | `, e o FXL Sales não está liberado para ela.` |
| `activeUnknown` | `Não foi possível identificar a Organização ativa nesta sessão, e o FXL Sales não está liberado para ela.` |
| `leadWithOthers` | `Troque para uma Organização que tenha o FXL Sales, ou contrate o FXL Sales para a Organização ativa no FXL Hub.` |
| `leadWithoutOthers` | `Não encontramos outra Organização nesta conta para onde trocar. Contrate o FXL Sales para a Organização ativa no FXL Hub.` |
| `switchHeading` | `Trocar de Organização` |
| `switchAriaLabel` | `Organização` |
| `switchPlaceholder` | `Selecionar Organização...` |
| `switchSearchPlaceholder` | `Buscar Organização...` |
| `switchEmptyMessage` | `Nenhuma Organização encontrada.` |
| `switchSingleAriaLabel` | `` `Trocar para ${orgLabel(organization)}` `` (interpolated, not a fixed string; the shared spelling agreed with slice 05 - see "The identifier law", item 3) |
| `switchSinglePrefix` | `Ir para ` |
| `switching` | `Trocando de Organização...` |
| `switchFailed` | `Não foi possível trocar de Organização. Verifique se você ainda faz parte dela e tente novamente.` |
| `checkoutHeading` | `Contratar o FXL Sales` |
| `checkoutBody` | `A contratação acontece no FXL Hub e vale para a Organização ativa.` |
| `checkoutLink` | `Abrir o FXL Hub` |
| `checkoutLoading` | `Preparando o link do FXL Hub` |
| `checkoutFailed` | `Não foi possível preparar o link do FXL Hub agora.` |
| `checkoutRetry` | `Tentar novamente` |

The active label resolves in two steps. When `active` is non-null, it is `orgLabel(active)`. When
`active` is `null` but `activeName` is a non-empty string, the panel STILL names the
Organization, using `activeName` verbatim on the `activePrefix` / `activeSuffix` copy - that is
the entire reason slice 02 exposes the field, and it is the degenerate-token case the feature
acceptance ("names the ACTIVE Organization") still has to serve. `activeUnknown` is reserved for
`active === null && !activeName`.

`leadWithoutOthers` is deliberately "Não encontramos outra Organização nesta conta" and NOT
"esta é a única Organização da conta". `workspaces` is a capped preview and cannot support the
stronger claim. Saying the stronger thing would be the same species of dishonesty as
"verifique o servidor local".

## Render order and structure

Strictly this order. Switch BEFORE checkout, because switching is free and instant while
checkout costs money.

```
<section data-missing-entitlement>
  h3   title
  p    activePrefix + <span>{activeLabel}</span> + activeSuffix     (or activeUnknown)
  p    leadWithOthers | leadWithoutOthers
  ---- switch block, ONLY when others.length > 0 ----
  <div data-organization-switch>
    p            switchHeading
    Combobox     (others.length >= 2)
    button       (others.length === 1)
    p            switching        (when switchingId !== null)
    p            switchFailed     (when switchFailed)
  </div>
  ---- checkout block, ALWAYS ----
  <div data-hub-checkout={status}>
    p            checkoutHeading
    p            checkoutBody
    Skeleton + sr-only checkoutLoading   (loading)
    <a href>     checkoutLink            (ready)
    p + button   checkoutFailed / checkoutRetry (failed)
  </div>
</section>
```

The `data-organization-switch` and `data-hub-checkout` attributes are production markup, in the
same spirit as `data-combobox-create="true"` in `combobox.tsx`. They give the test a stable hook
that does not depend on class names. Do not add `data-testid`; this codebase uses it only inside
test files.

### The identifier law, in all three places a label appears

`orgLabel` and `isOrgLabelFallback` come from `@/lib/displayNames`. That module is NOT owned by
another slice in this run; it is imported, never edited.

1. **The active Organization in the copy.** `orgLabel(active)`. When `isOrgLabelFallback(active)`
   the span carries `font-mono text-xs text-muted-foreground`; otherwise
   `font-semibold text-[#201f24]`.
2. **Combobox options.** Exactly the shape `HubUserControls` already uses:
   `{ value: org.id, label: orgLabel(org), description: isOrgLabelFallback(org) ? org.id : undefined }`.
   The id drops to the muted secondary line, never the primary one.
3. **The single-other button.** Its visible content is two spans: a plain `Ir para ` and then the
   label, styled by the same `isOrgLabelFallback` branch as (1). Its `aria-label` is
   `` `Trocar para ${orgLabel(organization)}` ``, which is the AGREED SHARED SPELLING for a
   switch control's accessible name across this slice and slice
   `05-shell-organization-switcher`, which states the same agreement in its own copy table.
   The law is relaxed for this one case on purpose: `orgLabel` falls back to the raw id BY
   DESIGN, and an `aria-label` that names the Organization the operator is about to switch to is
   worth more to a screen reader than one that refuses to name it. A fixed
   `Trocar de Organização` would leave a screen-reader user with a control that says only what
   KIND of thing it does. The identifier law still governs the VISIBLE label, which stays
   `orgLabel(...)` on the primary line with the raw id confined to the muted monospace branch.
   Update `switchSingleAriaLabel` in the copy table accordingly, or drop it and interpolate at
   the call site; either is fine as long as the two slices spell it identically.

### House style

Copy the local style constants pattern from `CadastroHistoryPanel.tsx`. That file re-declares
`mutedPanelClass` locally with an explicit comment explaining why it cannot import from
`SalesOpsApp.tsx` - here the reason is different but the outcome is the same: this module must
NOT import from `SalesOpsApp.tsx`, because slice 04 makes `SalesOpsApp.tsx` import THIS module,
and the other direction would be a cycle. Restate that in a comment.

Reuse verbatim, as local consts:

```ts
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const mutedStateClass = 'text-[13px] text-[#8b8b92]';
```

The outer section matches `EmptyPanel`'s footprint (`SalesOpsApp.tsx:982`) so slice 04 can drop
it into the same slot without layout surprise: `mutedPanelClass` plus
`flex min-h-[154px] flex-col ... p-6`. Left-aligned rather than centred, because this panel has
actionable controls and centred action rows read as a marketing card. The `Combobox` gets
`comboboxTriggerClass`-equivalent geometry: pass `className="h-10 w-full rounded-[10px] ..."` -
40px, the compact size, since this is not a form row next to an `Input`.

The primary link and the switch button reuse the `restoreButtonClass` shape from
`CadastroHistoryPanel.tsx` so the panel does not invent a fourth button style. Copy it locally;
do not import it.

## Implementation order

1. Write the copy consts and the pure derivation `activeLabel`. `others` comes from the seam.
2. Write the static markup: title, the two paragraphs, and the always-present checkout block in
   its `loading` state. Get the test's copy assertions green first.
3. Add the checkout effect and its three states.
4. Add the switch block: the `>= 2` Combobox branch, then the `=== 1` button branch, then the
   `=== 0` no-render branch.
5. Add `switchingId` / `switchFailed` and the `onRetry` call.
6. Run lint. The `no-restricted-syntax` picker rule and `react-hooks` are the two that will bite.

## Test contract - the locked oracle

`apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx`

First line is `// @vitest-environment happy-dom`, exactly as `cadastro-history.test.tsx` and
`combobox-adoption.test.tsx` do. Vitest reads `apps/web/vitest.config.ts`, which sets
`environment: 'node'` (it is kept separate from `vite.config.ts` because `vitest/config` resolves
a newer vite types version), so the pragma is what supplies the DOM.

Harness, lifted from `combobox-adoption.test.tsx` (lines 245-360) - do not invent a new one:

- `const act = (React as typeof React & { act: ... }).act;`
- `mountContainer()` in `beforeEach` creating a div, `createRoot`, and rendering inside `act`.
- `afterEach`: `await act(async () => root.unmount())`, `container.remove()`,
  `vi.restoreAllMocks()`.
- Helpers `flushReact`, `buttonByText`, `comboboxTrigger(ariaLabel)`, `optionRows()`,
  `click(element)` - copy them.
- Options are read via `[...container.querySelectorAll('[role="option"]')]`; the Combobox panel
  is inline and non-portalled, by design, so a plain DOM query reaches it.

The seam mock, the only mock this file needs:

```ts
vi.mock('@/auth/react', () => ({
  useOrganizations: () => seam,
}));
```

where `seam` is a mutable module-scope object rebuilt in `beforeEach` from a `makeSeam(overrides)`
factory holding `active`, `activeName`, `organizations`, `others`,
`setActive: vi.fn().mockResolvedValue(undefined)` and
`client: { checkoutUrl: vi.fn().mockResolvedValue('https://hub.example/checkout/sales') }`.

`makeSeam` derives `others` as `organizations.filter((org) => org.id !== active?.id)` and
`activeName` as `active?.name` UNLESS the test overrides either explicitly, so a fixture can
never present a combination the real seam could not produce. Tests 2 and 2b are the two that
override `activeName` on their own.

The reload guard, in `beforeEach`:

```ts
reloadSpy = vi.fn();
Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
```

Fixtures: `orgAtiva = { id: 'org-active', name: 'Acme Holding' }`,
`orgAlfa = { id: 'org-alfa', name: 'Alfa Consultoria' }`,
`orgBeta = { id: 'org-beta', name: 'Beta Engenharia' }`,
`orgSemNome = { id: 'org-sem-nome' }` (no `name`, for the fallback law).

### The tests, by exact name

Group A - the honest copy

1. `it('names the active Organization in the panel copy')` - `active = orgAtiva`; the section's
   textContent contains `MISSING_ENTITLEMENT_COPY.activePrefix`, contains `Acme Holding`, and
   does NOT contain `Verifique o servidor local`.
2. `it('names the active Organization from the name claim when the token carries no id')` -
   `active = null`, `activeName = 'Acme Holding'`; the section contains `activePrefix` and
   `Acme Holding` and does NOT contain `activeUnknown`.
2b. `it('says the Organization could not be identified when neither an id nor a name is known')` -
   `active = null`, `activeName = undefined`; renders `activeUnknown`.
3. `it('never renders the word workspace in user facing copy')` - the section's textContent, lower
   cased, does not include `workspace`.

Group B - the switch offer

4. `it('lists the account other Organizations and never the active one')` -
   `organizations = [orgAtiva, orgAlfa, orgBeta]`; open `comboboxTrigger('Organização')`; the
   option rows are exactly `['Alfa Consultoria', 'Beta Engenharia']` and no row's text contains
   `Acme Holding` or `org-active`.
5. `it('switches with setActive using the chosen Organization id and never reloads the page')` -
   pick `Beta Engenharia`; `setActive` called once with `'org-beta'`; `reloadSpy` not called.
6. `it('calls onRetry after a successful switch and never before')` - pass an `onRetry` spy;
   assert it was called once and that its invocation order is AFTER `setActive` resolved (a
   shared call-order array, not call counts alone).
6b. `it('switches without an onRetry prop and does not throw')` - render the panel with NO
   `onRetry`, click a switch row, and assert `setActive` was called once and no error was thrown.
   6b is the exact shape slice 04 mounts.
7. `it('reports an honest error when setActive rejects and does not refetch')` -
   `setActive.mockRejectedValue(new Error('403'))`; the panel renders
   `MISSING_ENTITLEMENT_COPY.switchFailed`, `onRetry` is not called, `reloadSpy` is not called,
   and the picker is still present so the operator can retry.
8. `it('offers a direct switch button when the account has exactly one other Organization')` -
   `organizations = [orgAtiva, orgAlfa]`; there is NO `button[role="combobox"]`; a button with
   `aria-label="Trocar para Alfa Consultoria"` exists, its text contains `Ir para` and
   `Alfa Consultoria`, and clicking it calls `setActive('org-alfa')`.
9. `it('renders no picker at all when there is no other Organization and still offers the Hub checkout')` -
   `organizations = [orgAtiva]`; `container.querySelector('[data-organization-switch]')` is
   `null`; `container.querySelectorAll('[role="listbox"], [role="option"], button[role="combobox"]')`
   is empty; the copy is `leadWithoutOthers`; and after the checkout resolves the anchor is
   present with the resolved href.
10. `it('keeps the raw Organization id on the muted secondary line of every picker row')` -
    `organizations = [orgAtiva, orgSemNome, orgAlfa]`; open the picker; the row for
    `org-sem-nome` contains a node with class `text-muted-foreground` whose text is
    `org-sem-nome`, which is the `description` the `isOrgLabelFallback` branch populates. Do NOT
    assert `font-mono` on that node: the shared `Combobox` renders its description as
    `text-xs text-muted-foreground` and adding a `font-mono` there would mean editing
    `components/ui/combobox.tsx`, which this slice may not touch. `font-mono` applies only to the
    ACTIVE Organization's span in the panel's own copy, which is this slice's own markup and is
    asserted separately.
10b. `it('styles a fallback active Organization label as muted monospace')` - `active = orgSemNome`;
    the span rendering the active label carries `font-mono` and `text-muted-foreground`.

Group C - the checkout affordance

11. `it('resolves the Hub checkout href through client.checkoutUrl')` - after `flushReact`, an
    `a` whose text is `Abrir o FXL Hub` has
    `href === 'https://hub.example/checkout/sales'`, and `checkoutUrl` was called exactly once.
12. `it('renders a skeleton, never an empty state, while the Hub checkout link is resolving')` -
    `checkoutUrl` returns a promise resolved manually from the test (a deferred). Before
    resolving: `[data-hub-checkout="loading"]` exists, it contains an element with the
    `animate-pulse` class, it contains the `Preparando o link do FXL Hub` text, and it contains
    NO `a` element. After resolving: the anchor is present.
13. `it('degrades honestly when client.checkoutUrl rejects and renders no dead link')` -
    `checkoutUrl.mockRejectedValue(new Error('discovery failed'))`; the panel renders
    `checkoutFailed`, `container.querySelector('[data-hub-checkout] a')` is `null`, and the panel
    did not throw (the test itself passing under a `root.render` inside `act` is that assertion).
14. `it('retries the Hub checkout discovery when Tentar novamente is clicked')` - first call
    rejects, second resolves; click `Tentar novamente`; `checkoutUrl` called twice and the anchor
    appears.

Group D - the source invariants

15. `it('contains no page reload, no native picker and no dash characters in its source')` - read
    `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` with `readFileSync` and
    `fileURLToPath(new URL(...))`, exactly the idiom `combobox-adoption.test.tsx` already imports
    for. Assert the source does not match `/location\s*\.\s*reload/`, does not match
    `/<\s*(select|option|datalist)\b/`, and does not contain the em dash or en dash code points
    (refer to them ONLY as the escapes \u2014 and \u2013 inside a RegExp or String.fromCharCode,
    so this test file itself stays ASCII on that line). This is the cheap invariant that survives every future copy edit.

### Why these tests and not others

Test 9 is the acceptance criterion the verifier is pointed at. The failure mode it pins is
subtle: the natural implementation renders the switch block unconditionally and lets the
`Combobox` render an empty listbox, which looks fine on a developer's account (which always has
several Organizations) and is a dead end for the exact operator this feature exists for.

Test 12 pins the artifact rule against the natural shortcut of rendering `null` while the href
is unknown.

Test 6's ordering assertion matters because calling `onRetry()` before awaiting `setActive`
refetches under the OLD token and reproduces the same 402, which would look like the feature not
working at all while every call count assertion still passed.

## Verify - run once, never a watcher

Named oracle:

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
```

Lint on the changed files:

```
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/MissingEntitlementPanel.tsx src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
```

Types:

```
pnpm --filter @fxl-sales/web exec tsc --noEmit
```

`apps/web`'s `test` script is already `vitest run`, so `pnpm --filter @fxl-sales/web test` is
run-once by construction. Never invoke a bare `vitest`; it watches.

## Anticipated snags

- **Slice 02 not landed yet.** The test mocks `@/auth/react` wholesale, so the test file compiles
  and runs against the mock even before the real export exists. The COMPONENT will not typecheck
  until slice 02 lands. That is the correct dependency order and is why `depends_on` lists it; do
  not stub a local `useOrganizations` to unblock, and do not add a temporary export to
  `apps/web/src/auth/react.tsx`.
- **`react-refresh/only-export-components`.** The file exports `MISSING_ENTITLEMENT_COPY`
  alongside a component. The rule is configured with `allowConstantExport: true`, and a
  `const ... as const` object satisfies it. If it still warns, move the copy consts into a sibling
  `missing-entitlement-copy.ts` - the same escape `combobox-filter.ts` already took, and note it
  in `files_modified` if you do.
- **`Object.defineProperty` on `window.location.reload`.** happy-dom defines `reload` on the
  `Location` prototype, so an own property shadows it cleanly. If it throws in this happy-dom
  version, fall back to test 15's source-level assertion alone and record the substitution.
- **Effect double-run under StrictMode.** The tests do not render in StrictMode, but the app does
  not either at this call site; still, the `cancelled` flag makes a double run harmless. Do not
  add a ref-based "already fetched" guard - it breaks `Tentar novamente`.
