# Slice 03 - `MissingEntitlementPanel` - Gate 2 verify (fast tier)

Branch `feat/03-missing-entitlement-panel`, diff under test `git diff master...HEAD`, commit `23e507a`.
Verifier did not write this code.

## Verdict

**PASS**, with one reported oracle gap that is NOT a defect in the shipped code.

The implementation satisfies every clause of the acceptance criterion, including the ordering clause.
Five of the six required mutations went RED.
M4 (render-order swap) stayed GREEN: the ordering clause of the acceptance criterion is **unpinned by any test**.
Per the M4 instruction, that is reported as a finding rather than converted into a slice failure, because the code under test really does render switch-first and the gap is in oracle coverage only.

## Commands run (all run-once, no watcher)

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` | **PASS** - 1 file, 18 tests, 46ms |
| 2 | `pnpm --filter @fxl-sales/web exec vitest run` | **PASS** - 53 files, 753 tests, 5.36s |
| 3 | `pnpm --filter @fxl-sales/web lint` | **PASS** - clean, no output |
| 4 | `pnpm --filter @fxl-sales/web type-check` | **PASS** - `tsc --noEmit` clean |

The full suite was re-run after the last mutation was reverted and returned 53 files / 753 tests passing, confirming the working tree was restored exactly.

## Mutation battery

Each mutation applied alone to `MissingEntitlementPanel.tsx`, reverted from a pristine copy between runs.

| ID | Mutation | Expected | Actual | Tests that caught it |
| --- | --- | --- | --- | --- |
| M1 | zero-others branch renders the picker anyway with an empty options array (`others.length > 0` to `true`) | RED | **RED** (1 failed / 17 passed) | `renders no picker at all when there is no other Organization and still offers the Hub checkout` |
| M2 | pass the Organization LABEL to `setActive` instead of its `id` (both the Combobox `value` and the single-button `onClick`) | RED | **RED** (3 failed / 15 passed) | `switches with setActive using the chosen Organization id...`, `switches without an onRetry prop...`, `offers a direct switch button...` |
| M3 | render the checkout anchor unconditionally with `href={undefined}` while resolving | RED | **RED** (1 failed / 17 passed) | `renders a skeleton, never an empty state, while the Hub checkout link is resolving` (asserts `loading?.querySelector('a')` is null) |
| M4 | swap render order so the Hub checkout block precedes the switch block | RED | **GREEN (18/18 passed)** | **none - real gap, see below** |
| M5 | call `onRetry?.()` before awaiting `setActive` instead of after | RED | **RED** (2 failed / 16 passed) | `calls onRetry after a successful switch and never before` (ordered `order[]` array), `reports an honest error when setActive rejects and does not refetch` |
| M6 | remove the active Organization's name from the rendered copy (`hasActiveLabel = false`) | RED | **RED** (3 failed / 15 passed) | `names the active Organization in the panel copy`, `names the active Organization from the name claim...`, `styles a fallback active Organization label as muted monospace` |

### M4 - the ordering gap (finding)

The acceptance criterion states plainly that order matters: switch Organization FIRST, Hub checkout SECOND.
The shipped component gets this right - `[data-organization-switch]` is emitted before `[data-hub-checkout]` in the JSX - and the execute note argues the rationale (switching is free and instant, checkout costs money).

But **no assertion in `missing-entitlement-panel.test.tsx` observes relative DOM position.**
Physically moving the checkout `<div>` above the switch block leaves all 18 tests passing.
Every existing assertion is either scoped to one block (`[data-hub-checkout] a`, `[data-organization-switch]`) or reads `section().textContent`, which concatenates in document order but is only ever tested with `toContain` on individual fragments, never on their sequence.

Suggested cheap oracle for a follow-up: assert
`section().compareDocumentPosition(checkoutBlock) & Node.DOCUMENT_POSITION_FOLLOWING` relative to the switch block, or simply that
`sectionText().indexOf(COPY.switchHeading) < sectionText().indexOf(COPY.checkoutHeading)` in the two-or-more-others fixture.
This is a one-line test and would close the last clause of the criterion.

## Verifier focus areas

**Zero-other-Organization branch renders NO picker while still offering a live checkout.**
Confirmed by reading and by M1. The whole `[data-organization-switch]` wrapper - heading, control, busy line and error line - sits behind a single `others.length > 0` guard, so at zero others there is no heading, no combobox, no listbox and no option row. The test asserts all three role selectors are length 0, not merely that the wrapper is absent, so a bare `<Combobox>` smuggled in outside the wrapper would also be caught. The checkout block is a sibling outside that guard and the same test asserts the anchor's `href` equals the resolved URL, so the branch is not a dead end.

**No branch can render an anchor whose href is unresolved.**
Confirmed. `CheckoutState` is a discriminated union of `loading | ready | failed`, and `checkout.href` exists only on the `ready` member, so the anchor is unreachable without a resolved string and TypeScript enforces it. `loading` renders a `Skeleton` plus an `sr-only` label; `failed` renders honest copy plus a `Tentar novamente` button and explicitly no anchor. M3 confirms the loading branch is pinned, and `degrades honestly when client.checkoutUrl rejects and renders no dead link` pins the failed branch.

One subtlety worth recording as correct: the retry does not `setState` inside the effect body. `resolved` is stamped with the `attempt` it answers and anything stale reads as `loading`, so clicking `Tentar novamente` returns the block to its skeleton by derivation. `retries the Hub checkout discovery...` pins that the second call really happens and lands.

## Read-only checks

| Check | Result |
| --- | --- |
| Em dash (U+2014) / en dash (U+2013) anywhere in the diff | **CLEAN.** `grep -P '[\x{2014}\x{2013}]'` over all four changed files returns 0 matching lines each. The suite also self-enforces it via the `source invariants` test, over both the panel and the copy module. |
| `window.location.reload` / any full page reload | **NONE.** No match in the diff. The test additionally installs a `reload` spy in `beforeEach` and asserts it was never called on both the success and the `setActive`-rejects paths. |
| Native `<select>` / `<option>` / `<datalist>` | **NONE.** No match; `pnpm lint` clean, so the `no-restricted-syntax` ban is satisfied. Switching goes through `Combobox` from `@/components/ui/combobox` at two or more others, and a plain `<button>` at exactly one. |
| Every user-facing string says "Organização", never "workspace" | **CONFIRMED.** The single occurrence of "workspace" in the slice is inside a JSDoc comment in `missing-entitlement-copy.ts` explaining why the word is avoided. It is not rendered. A dedicated test asserts `sectionText().toLowerCase()` never contains it. |
| `onRetry` optional and the panel works with NO props | **CONFIRMED both ways.** The type is `{ onRetry?: () => void }`, and every internal use is `onRetry?.()`. `switches without an onRetry prop and does not throw` mounts via `renderPanel()` with an empty props object and drives a full switch through. This is exactly the slice 04 mount shape. |
| Loading state is a skeleton, never an empty state | **CONFIRMED.** `<Skeleton className="h-9 w-[168px] rounded-[10px]" />` plus an `sr-only` "Preparando o link do FXL Hub". The test asserts the `.animate-pulse` element is present, so replacing the skeleton with an empty div fails. |
| Changed files exactly as scoped | **CONFIRMED.** `MissingEntitlementPanel.tsx` (+310), `__tests__/missing-entitlement-panel.test.tsx` (+374), `missing-entitlement-copy.ts` (+41), `nexo/runs/.../03-execute.md` (+171). 896 insertions, 0 deletions. No touch to `SalesOpsApp.tsx`, `auth/react.tsx`, `lib/*` or `components/ui/*`. The separate copy module was the anticipated escape hatch and is permitted. |
| Commit trailers | **CORRECT.** Exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SPY9R3AFFgJ2LrCwaAxtyU`. No other co-author trailer. |

## Exact shipped PT-BR copy

From `apps/web/src/sales-ops/missing-entitlement-copy.ts`, verbatim:

- **title**: `FXL Sales não está ativo nesta Organização`
- **activePrefix**: `A Organização ativa nesta sessão é ` (followed by the Organization label, then activeSuffix)
- **activeSuffix**: `, e o FXL Sales não está liberado para ela.`
- **activeUnknown**: `Não foi possível identificar a Organização ativa nesta sessão, e o FXL Sales não está liberado para ela.`
- **leadWithOthers**: `Troque para uma Organização que tenha o FXL Sales, ou contrate o FXL Sales para a Organização ativa no FXL Hub.`
- **leadWithoutOthers**: `Não encontramos outra Organização nesta conta para onde trocar. Contrate o FXL Sales para a Organização ativa no FXL Hub.`
- **switchHeading**: `Trocar de Organização`
- **switchAriaLabel**: `Organização`
- **switchPlaceholder**: `Selecionar Organização...`
- **switchSearchPlaceholder**: `Buscar Organização...`
- **switchEmptyMessage**: `Nenhuma Organização encontrada.`
- **switchSinglePrefix**: `Ir para ` (followed by the Organization label)
- **switching**: `Trocando de Organização...`
- **switchFailed**: `Não foi possível trocar de Organização. Verifique se você ainda faz parte dela e tente novamente.`
- **checkoutHeading**: `Contratar o FXL Sales`
- **checkoutBody**: `A contratação acontece no FXL Hub e vale para a Organização ativa.`
- **checkoutLink**: `Abrir o FXL Hub`
- **checkoutLoading**: `Preparando o link do FXL Hub` (screen-reader only, beside the skeleton)
- **checkoutFailed**: `Não foi possível preparar o link do FXL Hub agora.`
- **checkoutRetry**: `Tentar novamente`

The single-other-Organization button also carries the accessible name `Trocar para <Organização>`, spelled at the call site.

## Other observations (non-blocking)

- The identifier law is respected. `orgLabel` / `isOrgLabelFallback` route a nameless Organization into `font-mono text-xs text-muted-foreground`, both for the active label and for a picker row's secondary line. Two tests pin it. The one deliberate exception is the single-switch button's `aria-label`, which names the raw id rather than refusing to name the target; the visible label still goes through the muted monospace branch. The inline comment documents this trade explicitly.
- `handleSwitch` is re-entrancy guarded (`if (switchingId !== null) return`) and the control is `disabled` while switching, so a double click cannot issue two `setActive` calls.
- `mountedRef` guards both `setSwitchFailed` and `setSwitchingId`, which matters because a successful switch very likely unmounts this panel.
- The `others.length === 1` direct button is a deliberate departure from a picker and is not something the acceptance criterion forbids: the criterion requires a picker at two-or-more and none at zero, and both are satisfied.

## Working tree

Every mutation was reverted from a pristine pre-mutation copy. `git diff -- apps/web` is empty at the end of this run, and the full 753-test suite passes on the restored tree. The only modified files remaining are the pre-existing `nexo/plans/...` and `nexo/runs/.../budget.json` edits that were already present when this verify started, plus the untracked `.vscode/` that predates it. This report is written but not committed.
