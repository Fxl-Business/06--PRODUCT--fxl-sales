# Slice 04 - shell entitlement branch - Gate 2 verify (fast tier)

Branch: `feat/04-shell-entitlement-branch`
Diff under test: `git diff master...HEAD`
Verdict: **PASS**

## Acceptance criterion

> A 402 `{error:'payment_required', code:'missing_entitlement'}` on the sales-ops bootstrap renders `MissingEntitlementPanel`, and `Verifique o servidor local` is ABSENT.

Established. The `isError` chain in `apps/web/src/sales-ops/SalesOpsApp.tsx` now reads
`isEntitlementFailure -> isAuthFailure -> generic`, so the generic copy is reachable only for
an error that is neither an entitlement failure nor an auth failure.

## Commands (run-once, no watcher)

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx` | 1 file / 4 tests passed |
| 2 | `pnpm --filter @fxl-sales/web exec vitest run` | 54 files / **758 tests passed**, 0 failed |
| 3 | `pnpm --filter @fxl-sales/web lint` | exit 0, no output |
| 4 | `pnpm --filter @fxl-sales/web type-check` | exit 0 (`tsc --noEmit`) |

The five closed-`vi.mock` files are all green inside run 2, including
`blank-bearer-token.test.tsx` (3), `no-role-redirect.test.tsx` (26), `routing.test.tsx`,
`cadastros-refresh.test.tsx` and `optimistic-row-guard.test.tsx`.

## Mutation table (each applied alone, reverted between)

| ID | Mutation | Expected | Observed | Failing case(s) |
| --- | --- | --- | --- | --- |
| M1 | entitlement branch deleted, 402 falls to generic | RED | **RED** (1 failed / 3 passed) | 402 case: `expected null not to be null` (`[data-missing-entitlement]`) |
| M2 | entitlement branch moved LAST, behind a `bootstrapQuery.isError` generic arm, so unreachable | RED | **RED** (1 failed / 3 passed) | 402 case, same marker assertion |
| M3 | both arms keyed on `isAuthFailure` | RED on the 401 case | **RED** (2 failed / 2 passed) | 401 case: text does not contain `Sessão expirada`; plus the 402 case |
| M4 | first condition widened to `bootstrapQuery.isError` alone | RED on the 500 case | **RED** (2 failed / 2 passed) | 500 case: text does not contain `Verifique o servidor local`; plus the 401 case |
| M5 | `<MissingEntitlementPanel />` replaced by `<></>` | RED (decisive) | **RED** (1 failed / 3 passed) | 402 case: `expected null not to be null` |

No mutation stayed green. Note M2's first attempt produced a syntax error (my patch, not the
implementation); it was rewritten into a compiling reordering and re-run, and that run is the
one reported above.

### Verifier focus 3 - can the absence assertion pass for the wrong reason?

No. The 402 case makes two positive assertions before the two negative ones:
`expect(entitlementPanel()).not.toBeNull()` over the panel's `[data-missing-entitlement]`
marker, and `expect(text()).toContain(MISSING_ENTITLEMENT_COPY.title)` against the exported
literal `'FXL Sales não está ativo nesta Organização'` (a real non-empty string, so the
`toContain` is not trivially satisfiable). M5 - the empty-fragment mutation - goes RED on the
marker assertion, which is the decisive proof that an empty render cannot pass this test.
The 500 and 401 cases each also assert `entitlementPanel()` is null, so the panel is proven
402-only in both directions.

## Read checks

- **Dashes**: 0 occurrences of U+2014 and 0 of U+2013 in `git diff master...HEAD` (counted by code point).
- **Scope**: exactly three files - `apps/web/src/sales-ops/SalesOpsApp.tsx`,
  `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`, and the run note
  `nexo/runs/feature-20260828-organization-context-escape/04-execute.md`. No scope violation.
- **Slice 05 leakage**: none. The only production hunk is the `isError` ternary chain plus two
  imports. No account dropdown, no Organization switcher, no sidebar chrome.
- **`window.location.reload`**: absent from the code; the single textual hit in the diff is the
  run note asserting its absence.
- **`MissingEntitlementPanel` props**: rendered as `<MissingEntitlementPanel />`, no `onRetry`,
  as the slice requires. The prop is optional in the component, so this type-checks.
- **Untouched**: `bootstrapQuery.isLoading ? <LoadingPanel /> : null`, both `EmptyPanel` copies
  character for character, and the `!isLoading && !isError` success gate.
- **Commit trailers**: `f03d34c` carries exactly
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01SPY9R3AFFgJ2LrCwaAxtyU`, and no other
  co-author trailer.

## Observations (not findings)

- `isEntitlementFailure` (pre-existing on `master` from slice 03) keys on `status === 402`
  alone and never reads the `code: 'missing_entitlement'` discriminator. That is out of this
  slice's diff and is safe while 402 is the API's only entitlement verdict, but it is the place
  a second 402 code would land silently on this panel.
- The oracle drives the real `apiFetch` error path (`../api`, `@/lib/api-client` and `../hooks`
  are deliberately unmocked), so it also proves the status survives into the `ApiError` the
  shell classifies rather than only pinning the ternary.

## Working tree

Restored exactly as found: `SalesOpsApp.tsx` is byte-identical to `HEAD`, and the only entries
in `git status` are the pre-existing modified `budget.json` and the untracked `.vscode/` and
`agents/execute-04.result.json`.
