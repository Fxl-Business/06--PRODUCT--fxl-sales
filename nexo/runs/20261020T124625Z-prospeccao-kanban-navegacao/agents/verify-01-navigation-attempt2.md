# Verify 01-navigation, attempt 2

Verdict: **PASS** at `10197757c6c6b9d50ca1804835de0537892454f4` against base `63cfc21`.

## Evidence

- Named oracle: `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-stage-navigation.test.tsx` passed, 13 tests.
- Mutation probe: temporarily replaced the list stage predicate with `true` in `LeadsBoard.tsx`; the named oracle failed two admin stage row assertions, showing `['a', 'b']` instead of `['a']` and `['b']`.
  Restored the file after the probe and confirmed a clean worktree before writing this report.
- Affected suites: 9 files, 276 tests passed, including routes, edition navigation, role redirect, proposal deep link, list, funnel, and conversion.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `git diff --check 63cfc21..HEAD` passed.

## Plan review

Admin and seller stage URLs resolve by stable stage ID; bare leads URLs redirect to Funil.
The routed stage list filters rows by the selected ID and an archived stage displays an unavailable message.
The Funil route renders the complete board.
The in-content view selector and stage chips are absent in routed mode.
The sidebar applies `boardStages` order, keeps an active stage expanded, and exposes loading, empty, error, and active link states.
Finder-only access resolves away from both stage and Funil routes; the existing proposal detail route and full edition entries remain covered.

## Review note

The new oracle focuses a stage button and activates it with `click()`, rather than dispatching an Enter or Space key event.
The stage control is a native button, so keyboard activation follows browser semantics, but an explicit key event assertion would strengthen regression coverage.
The affected list tests emit existing React `act(...)` environment warnings despite passing.
