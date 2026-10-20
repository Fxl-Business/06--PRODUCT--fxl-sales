# Verify 01-navigation

Status: **FAIL**.

Verified commit: `e10e0d81bbf194168c59e4932cc4ebb087e8c8ec` against `63cfc21`.

## Automated gates

- `pnpm run build:packages`: PASS.
- `NODE_ENV=test pnpm --filter @fxl-sales/web test -- <named oracle>`: PASS, 130 files and 1,755 tests.
- `NODE_ENV=test pnpm --filter @fxl-sales/web test -- <affected suites>`: PASS, 130 files and 1,755 tests.
- `pnpm --filter @fxl-sales/web type-check`: PASS.
- `pnpm --filter @fxl-sales/web lint`: PASS.
- `git diff --check 63cfc21..HEAD`: PASS.

The `pnpm test --` commands forwarded `--` to Vitest, so both invocations ran the whole web suite despite the supplied file paths.
The commands were run once and no process remains.

## Blocking findings

1. The named oracle does not exercise the shell or lead board and therefore does not establish the slice acceptance.
   `leads-stage-navigation.test.tsx` mounts only `LeadSidebarNavigation` with a location probe at lines 22-29.
   It never mounts `SalesOpsApp`, `LeadsBoardContainer`, or `LeadsBoard`, and never asserts stage rows, Funil board content, hidden in-content controls, unavailable stage URLs, or keyboard interaction.
   As an adversarial probe, I temporarily replaced the stage filter in `LeadsBoard.tsx:381` with an always-true filter and ran the named oracle directly.
   All six tests still passed, so the mutation survived.
   The original source was restored and `git status --short` was clean before this report was written.
   Add realistic routed shell or container coverage for admin and seller, including rows in two stages, a deleted or archived stage URL, finder denial, and keyboard activation, then repeat the mutation check.

2. The change exceeds the approved slice file boundary.
   The plan names seven files and approximately 450 changed lines, while this commit changes 13 application files plus an execution artifact, with 435 insertions and 173 deletions overall.
   Some test updates are likely necessary for the new canonical route, but the scope expansion needs explicit plan reconciliation before acceptance.

## Additional review

- The leads edition orders `Funil` before `Prospecção` in `navigation.ts:135-157`, while the dispatch describes Prospecção as the principal sidebar item with Funil as a separate destination.
- The existing routing tests were updated from `/leads` to `/funil`, but do not compensate for the missing stage route integration assertions.
- The code retains the proposal detail ID route, scopes Funil to existing lead workspaces, and renders an unavailable stage message after data loads.
  Those observations are source review only until the missing routed tests cover them.
