# Slice 05 - shell Organization switcher - VERIFY (Gate 2, fast tier)

Branch `feat/05-shell-organization-switcher`, diff under test `git diff master...HEAD`.
Verified 2026-08-28. Verdict: **PASS**.

## Acceptance criterion

> Given an operator signed into the sales-ops shell whose account carries more than one Hub Organization, when the sidebar account menu is opened, then it lists the other Organizations beside `Sair`, and choosing one calls the auth context's `setActive` with that Organization's id, with no page reload.

Met. `AccountOrganizationSection` renders inside `DropdownMenuContent`, above the `Sair` group, driven entirely by `useOrganizations()`.
`onSelect` calls `setActive(organization.id)` and nothing else; `event.preventDefault()` keeps the menu open for the in-flight and failure states, and `onSwitched` closes it only on success.

## Commands run (all run-once, no watcher)

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/shell-organization-switcher.test.tsx src/sales-ops/__tests__/routing.test.tsx` | 2 files, **28 passed** |
| 2 | `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx` (real filename is `.tsx`) | 1 file, **9 passed** |
| 3 | `pnpm --filter @fxl-sales/web exec vitest run` | **55 files, 770 passed, 0 failed** |
| 4 | `pnpm --filter @fxl-sales/web lint` | clean, no output |
| 5 | `pnpm --filter @fxl-sales/web type-check` | clean, no output |

`master` carried 758 web tests; the slice adds 12, all in the new oracle file.
The named must-not-break files all pass: `routing.test.tsx` (16), `blank-bearer-token.test.tsx` (3), `cadastros-refresh.test.tsx`, `optimistic-row-guard.test.tsx`, `src/__tests__/no-role-redirect.test.tsx` (26), `sale-wizard-ui-contract.test.tsx` (9), `navigation.test.ts` (11).

## Mutation battery (each applied alone, reverted between)

| # | Mutation | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- |
| M1 | Delete `<AccountOrganizationSection …/>` from the account dropdown | RED | **RED - 8 of 12 oracle tests fail** | PASS (decisive) |
| M2 | `setActive(orgLabel(organization))` instead of `setActive(organization.id)` | RED | **RED - `calls setActive with the chosen Organization id`** | PASS |
| M3 | Render guard `organizations.length <= 1` instead of `others.length === 0` | RED | **RED - `offers the single other Organization when the preview lists one that is not active`** | PASS |
| M4 | Map `[active, ...others]` so the active Organization is a switch target too | RED | **RED - `does not offer the active Organization as a switch target` + the scroll-threshold count test** | PASS |
| M5a | Revert the sidebar eyebrow `Painel` back to `Workspace` | RED | **RED - `no longer labels the Sales view group with the word that now means Organization`** | PASS |
| M5b | Revert ONLY the two `aria-label` renames (`Painel: …`, `Fechar painéis`) back to `Workspace: …` / `Fechar workspaces` | - | **GREEN - full suite 770 passed** | **FINDING, non-blocking** |

M1 is the reported defect reproduced exactly, and it goes red hard. The oracle is not vacuous.

### Finding M5b

Part B's *visible text* renames are pinned (`title="Trocar painel"`, the `Painel` eyebrow, the `Painéis` menu heading - the oracle asserts both presence of the new string and `not.toContain('Workspace')` on the sidebar `textContent`).
Two `aria-label`-only strings are NOT pinned, because `textContent` does not see an attribute: the collapsed-sidebar trigger's `aria-label={\`Painel: …\`}` and the menu scrim's `aria-label="Fechar painéis"`.
Reverting just those two leaves the whole 770-test suite green.
Non-blocking: the shipped code has them renamed correctly, no user-visible text is affected, and `routing.test.tsx`'s `button[title="Trocar painel"]` selector plus the eyebrow assertion already fail on any realistic wholesale revert. Worth a one-line strengthening on a later touch.

## Read-checks

- **Dashes.** Scanned the whole diff for U+2014 and U+2013 by code point (python). Zero hits.
- **Seam discipline.** No `client.setActive`, no `queryClient.clear()`, no `window.location.reload`, no `<select>` / `<option>` / `<datalist>` / `NativeSelect` / `list="` added. The only grep hits for those tokens are the doc comment and the execute note stating they are *not* used. Switching goes solely through `useOrganizations().setActive`.
- **No page reload.** The oracle `disables every row while a switch is in flight and never reloads the page` stubs `window.location.reload` and asserts it was never called.
- **`others` is not re-derived.** `const { active, others, setActive } = useOrganizations();` - the component destructures the seam and filters nothing. No Organization is matched by name anywhere in the slice; every identity read is `organization.id`.
- **Raw ids.** `orgLabel` is the primary label; the raw id renders only in the secondary line, guarded by `isOrgLabelFallback`, styled `font-mono text-[10.5px] text-[#8b8b92]` (muted monospace, per CLAUDE.md). The `shows the raw id as muted monospace only, never as the primary label` test pins it against the nameless fixture `org-c`.
- **`Sair`.** Unchanged, still exactly `Sair`, still the only destructive item, still the last group; the new section sits above it behind its own `DropdownMenuSeparator`. Pinned by `still logs out from the same dropdown` and by the two zero-target tests.
- **Zero-other-Organization case.** `if (others.length === 0) return null;` after the hook call (hooks order is safe). Two tests cover it: one Organization total, and an empty preview.
- **Part B scope fence.** `SalesOpsWorkspace`, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute`, `buildSalesOpsPath`, `workspaceVisuals`, `availableWorkspaces`, `activeWorkspaceMeta` all have identical occurrence counts on `master` and `HEAD` (the single delta is `SalesOpsWorkspace` 4 -> 5, from the new explanatory comment, not a code reference). `navigation.ts` is byte-unchanged. No `path=`, `:workspace`, `/tatico`, `/operacional`, `/cadastros` or `/meus-dados` literal moved. The rename is display-strings-only. **Fence holds.**
- **Changed files** are exactly the four allowed:
  `apps/web/src/sales-ops/SalesOpsApp.tsx`, `apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx`, `apps/web/src/sales-ops/__tests__/routing.test.tsx`, `nexo/runs/feature-20260828-organization-context-escape/05-execute.md`.
  The other four closed-`vi.mock` files are untouched. `routing.test.tsx`'s edit is the minimum needed: it adds a `useOrganizations` stub with `others: []` (so the section renders nothing and every prior assertion is unchanged) and retargets its one `title="Trocar workspace"` selector.
- **Commit trailers.** One commit, `2a588e3`, carrying `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: …` and no other co-author trailer.
- **Working tree** left exactly as found (`budget.json` modified, `.vscode/` and `agents/execute-05.result.json` untracked - all pre-existing). Full suite re-run after the last revert: 770 passed.

## Shipped copy, verbatim

Section heading (uppercase-styled, source string):

    Organização

Active-Organization row - not a switch target, `disabled`, `aria-current="true"`, gold background, check icon:

- primary label: `orgLabel(active)`
- accessible name: `Organização atual: ${orgLabel(active)}`
- secondary line, only when `isOrgLabelFallback(active)`: the raw `active.id` in muted monospace

Switch-target row - one per entry of `others`, `Building2` icon:

- primary label: `orgLabel(organization)`
- accessible name: `Trocar para ${orgLabel(organization)}`
- secondary line, only when `isOrgLabelFallback(organization)`: the raw `organization.id` in muted monospace

In-flight: the row's `Building2` icon is swapped for a spinning `Loader2`, the row carries `aria-busy="true"`, and every row in the section is `disabled`. There is no in-flight text string.

Failure, `role="alert"`, rendered under the list, menu stays open and rows re-enable:

    Não foi possível trocar de organização. Tente novamente.

### Part B replacement term

The Sales view-group chrome now reads **`Painel`** where it read **`Workspace`**. Five strings moved:

| Old | New | Where |
| --- | --- | --- |
| `Trocar workspace` | `Trocar painel` | view-group trigger `title` |
| `Workspace` | `Painel` | view-group trigger eyebrow (visible) |
| `Workspace: ${label}` | `Painel: ${label}` | collapsed-sidebar trigger `aria-label` |
| `Fechar workspaces` | `Fechar painéis` | view-group menu scrim `aria-label` |
| `Workspaces` | `Painéis` | view-group menu heading (visible) |

## Verdict

**PASS.** The acceptance criterion is met, the oracle is non-vacuous under every decisive mutation, the part B scope fence holds, and the full web suite, lint and type-check are green. The one finding (M5b, two unpinned `aria-label` strings) does not affect shipped behaviour and does not block.
