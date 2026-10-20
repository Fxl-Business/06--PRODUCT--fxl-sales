# Execute 01-navigation

Verdict: PASS, ready for independent Nexo Verify.

## Changes

- Added canonical stage URLs using stage IDs and a separate Funil route.
- Redirected bare legacy lead URLs to Funil while preserving proposal detail IDs.
- Added an expandable Prospecção group driven by the shared stage query and active board ordering.
- Routed Funil to the complete Kanban and stage URLs to a filtered list.
- Removed the in-content view selector and stage chips from routed production views.
- Showed an unavailable-stage state for inactive or deleted stage URLs.
- Updated route and conversion test fixtures for the new navigation.

## Verification

- Red oracle was written first; its initial run could not execute because this worktree lacked dependencies.
- `pnpm install --frozen-lockfile --prefer-offline` and `pnpm run build:packages` passed.
- `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run` passed: 130 files, 1,755 tests.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `git diff --check` passed.

## Decisions and review

- Stage links use the existing `/:workspace/:view/:saleId?` route object and interpret the optional segment as a stage ID only for `leads`.
- The stage query mounts when the Prospecção group opens, and its TanStack cache is shared with the board container.
- The host exports `NODE_ENV=production`; React DOM `act` tests require `NODE_ENV=test` for run-once Vitest invocations.
- The first attempt used `pnpm test -- path`, which passed a literal separator to Vitest and ran the full suite under production React; subsequent targeted and full runs used `pnpm exec vitest run` with `NODE_ENV=test`.
- The plan's approximate seven-file ceiling became thirteen code and test files because existing literal route oracles needed updates for the new URLs and removed selector.
- Revisão: no visual capture was made in this slice; the unattended request states visual checks are not a delivery gate.
