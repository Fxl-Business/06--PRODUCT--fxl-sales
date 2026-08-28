# 03 - `MissingEntitlementPanel` - execute

Branch: `feat/03-missing-entitlement-panel`, cut from `master`.
Slice plan: `nexo/plans/feature-20260828-organization-context-escape/03-missing-entitlement-panel.md`.

## Files

THREE files, not the two the plan's front matter declares.

| File | Why |
|---|---|
| `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` | new component |
| `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` | new locked oracle, 18 tests |
| `apps/web/src/sales-ops/missing-entitlement-copy.ts` | **the plan's noted escape hatch, and it WAS required** |

### Why the third file was required

The plan anticipated it under "Anticipated snags" and it fired. `react-refresh/only-export-components`
is configured with `allowConstantExport: true`, but that option covers a PRIMITIVE literal export
only. An exported `as const` OBJECT still trips the rule, so
`export const MISSING_ENTITLEMENT_COPY = { ... } as const;` beside the component produced

```
32:14  warning  Fast refresh only works when a file only exports components  react-refresh/only-export-components
```

The copy therefore lives in its own `missing-entitlement-copy.ts`, exactly the escape
`combobox-filter.ts` already took, and the component and the oracle both import it from there.
`files_modified` for this slice is three files, not two.

A second, smaller consequence of the same rule: the plan floated exporting a
`switchOrganizationAriaLabel(organization)` helper for slice 05 to share. Exporting a FUNCTION
beside a component trips the rule with no `allowConstantExport` escape at all, so the aria label is
interpolated at the call site instead (`` `Trocar para ${orgLabel(organization)}` ``) and the agreed
spelling is recorded in a comment. The plan explicitly permits this
("or drop it and interpolate at the call site; either is fine as long as the two slices spell it
identically"). **Slice 05 must spell it `Trocar para <orgLabel>` by hand.**

## What was built

`MissingEntitlementPanel({ onRetry }: { onRetry?: () => void })` reads the slice 02 seam with a
single `useOrganizations()` destructure and renders, in this order:

1. `h3` title.
2. The active Organization line. `active` non-null gives `orgLabel(active)`; `active === null` with a
   non-empty `activeName` still NAMES the Organization on the same prefix/suffix copy; only
   `active === null && !activeName` renders `activeUnknown`.
   The label span carries `data-active-organization` and switches to
   `font-mono text-xs text-muted-foreground` when `isOrgLabelFallback(active)`.
3. The lead paragraph, `leadWithOthers` or `leadWithoutOthers`.
4. `[data-organization-switch]`, rendered ONLY when `others.length > 0`.
   `>= 2` is one `Combobox` (`aria-label="Organização"`, `h-10`, description = the raw id under the
   `isOrgLabelFallback` branch). `=== 1` is a direct button with
   `aria-label="Trocar para <label>"`. `=== 0` renders nothing at all: no block, no listbox, no
   trigger.
5. `[data-hub-checkout={status}]`, ALWAYS rendered, three states.

`others` is taken from the seam and is NOT re-derived here.

### The checkout state machine

Resolved in an effect on mount, `attempt` in the deps so `Tentar novamente` really re-runs it,
`cancelled` flag before every write, `.catch()` so nothing ever escapes as an unhandled rejection.

One deviation from the plan's literal sketch, forced by lint: the plan wrote
`setCheckout({ status: 'loading' })` as the first statement of the effect, which
`react-hooks/set-state-in-effect` rejects as an ERROR (cascading render). Instead the resolution is
STAMPED with the attempt it answers:

```ts
const [resolved, setResolved] = useState<{ attempt: number; state: CheckoutState } | null>(null);
const checkout: CheckoutState =
  resolved && resolved.attempt === attempt ? resolved.state : { status: 'loading' };
```

Same three observable states, same retry behaviour, no synchronous setState in an effect body.

### Switching

`switchingId` / `switchFailed`, one switch at a time, `onRetry?.()` strictly AFTER the `setActive`
await, `setSwitchFailed(true)` on rejection, and `setSwitchingId(null)` guarded by a `mountedRef` in
both paths. No `window.location.reload` and no navigation of any kind.

## Exact copy strings shipped

All in `apps/web/src/sales-ops/missing-entitlement-copy.ts`, verbatim from the plan's table:

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
| `switchSinglePrefix` | `Ir para ` |
| `switching` | `Trocando de Organização...` |
| `switchFailed` | `Não foi possível trocar de Organização. Verifique se você ainda faz parte dela e tente novamente.` |
| `checkoutHeading` | `Contratar o FXL Sales` |
| `checkoutBody` | `A contratação acontece no FXL Hub e vale para a Organização ativa.` |
| `checkoutLink` | `Abrir o FXL Hub` |
| `checkoutLoading` | `Preparando o link do FXL Hub` |
| `checkoutFailed` | `Não foi possível preparar o link do FXL Hub agora.` |
| `checkoutRetry` | `Tentar novamente` |

The single-other button's accessible name is `Trocar para <orgLabel(organization)>`, interpolated at
the call site.

## How the real slice 02 seam differed from the plan's assumption

It did not, in shape. `useOrganizations` is exported from `apps/web/src/auth/react.tsx` (as an alias
of `useHubOrganizations`) with exactly the fields and types the plan assumed, and
`export type Organization = HubWorkspacePreview`. Three details worth recording because the panel
depends on them:

- `active` is resolved ID FIRST from the `workspaceId` claim, with the NAME match kept only as the
  documented fallback for a token that carries no id. When `workspaceId` is present, `active` is
  always non-null and its `name` prefers the top level `workspaceName` claim, so the panel's
  primary path is `orgLabel(active)` and the `activeName` path really is only the degenerate token.
- `others` is already derived by the seam as `workspaces.filter((w) => w.id !== active?.id)`, and
  when `active` is null it removes nothing. The panel consumes it directly and re-derives nothing.
  The test's `makeSeam` reproduces that same derivation so a fixture cannot present an impossible
  combination.
- `client` is the RAW SDK client, deliberately unwrapped, and `checkoutUrl(sku?): Promise<string>`
  is present on `@fxl-business/hub-sdk@1.3.1`'s `client.d.ts`. Confirmed against the installed
  package, not assumed.

## One test-harness deviation

Test 15 reads the source with `join(dirname(fileURLToPath(import.meta.url)), '..', ...)` rather than
the plan's `fileURLToPath(new URL(relative, import.meta.url))`. Under happy-dom in THIS file the
global `URL` ignores a `file:` base and resolves to `http://localhost:3000/...`, so `fileURLToPath`
threw `The URL must be of scheme file`. (`combobox-adoption.test.tsx` gets away with the `new URL`
idiom; this file does not, and the `node:path` form is base-independent, so it is the safer spelling
either way.) The assertion itself is unchanged, and it now covers BOTH the component and the copy
module, since the copy moved out.

`Object.defineProperty(window.location, 'reload', ...)` worked as planned; no substitution needed.

## Test results - run once, no watcher

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
  Test Files  1 passed (1)
       Tests  18 passed (18)

pnpm --filter @fxl-sales/web exec vitest run
  Test Files  53 passed (53)
       Tests  753 passed (753)

pnpm --filter @fxl-sales/web lint          clean, 0 errors 0 warnings
pnpm --filter @fxl-sales/web type-check    clean
```

753 = the 735 that were green on `master` plus this slice's 18. No existing test changed.

Red first: the oracle was written before the component and failed to collect with
`Failed to resolve import "../MissingEntitlementPanel"`, which is the right reason.

`grep -P '[\x{2014}\x{2013}]'` over all three added files returns nothing.

## Not touched

`SalesOpsApp.tsx` (slice 04 owns the wiring), `apps/web/src/auth/react.tsx`,
`apps/web/src/lib/*`, `apps/web/src/components/ui/*`. No API change, no SDK upgrade, no
`?organization=` deep link.

---

## Follow-up 03b - closing the M4 ordering gap (2026-08-28)

Verify graded this slice PASS but found one surviving mutant, M4: rendering the Hub
checkout block BEFORE the switch block left the oracle fully green. The acceptance
criterion is an ORDER, and nothing in the file asserted an order. Every existing test
asserts PRESENCE, which a swap preserves exactly.

### The change

One test added to `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx`,
in the `- the switch offer` describe:

`renders the switch offer before the Hub checkout offer in document order`

It takes ONE `querySelectorAll('[data-organization-switch], [data-hub-checkout]')` over
the panel section, which by specification returns matches in document order, and asserts
`switchIndex < checkoutIndex`. Indices from a single sweep rather than a pair of separate
lookups, so the assertion cannot depend on how either block happens to be nested, and it
reads in the same `container.querySelector` idiom the rest of the file already uses.

It runs on the DEFAULT fixture, which is the case where BOTH affordances really exist:
two other Organizations, so the switch block renders as a Combobox, and a resolved
`checkoutUrl`, so the checkout block renders a live anchor. Both are asserted present
before the order is asserted, because an order over one block is vacuous - a swap-proof
test that silently degrades to "the checkout block exists" would be the same hole again.

`MissingEntitlementPanel.tsx` and `missing-entitlement-copy.ts` are BYTE-UNCHANGED. The
shipped order was already correct; what was missing was the proof.

### Mutation proof - all three observations

1. Test added, component untouched:
   `19 passed (19)`  GREEN.
2. The two JSX blocks physically swapped in `MissingEntitlementPanel.tsx` (the checkout
   `div` moved above the `others.length > 0` switch block, both moved verbatim):
   `1 failed | 18 passed (19)`  RED, with
   `AssertionError: expected 1 to be less than 0` at the new assertion.
   Exactly ONE test failed, and it was the new one - so the mutant is caught by this
   test and by nothing else, which is precisely the M4 finding.
3. `git checkout -- apps/web/src/sales-ops/MissingEntitlementPanel.tsx`:
   `19 passed (19)`  GREEN again.

### Verification

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
  Test Files  1 passed (1)
       Tests  19 passed (19)

pnpm --filter @fxl-sales/web lint          clean
pnpm --filter @fxl-sales/web type-check    clean
```

19 = the slice's 18 plus this one. No existing test changed.
`git status` shows only the test file and this note.
