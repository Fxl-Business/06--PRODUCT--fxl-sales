# Canonical Sales Ops Routing Mutation Verification

Verdict: **PASS**

The locked focused tests killed the canonical workspace-path mutation.

## Baseline and isolation

The disposable detached worktree was `.worktrees/mutation-canonical-sales-routes`.
It was created from committed `master` at `b4c37f91c0d605c8a7aabf390d366e70ee51fc26`.
Dependencies were installed with `pnpm install --offline --frozen-lockfile` because the disposable worktree had no local dependency links.
The install reused 413 packages, downloaded 0 packages, and did not change the lockfile.
No production or test source in the main checkout was modified.

## Mutation

Exactly one production mutation was applied in `apps/web/src/sales-ops/navigation.ts`.
`buildSalesOpsPath` was changed from returning `/${route.workspace}/${route.view}` to returning `/${route.view}`.
This removes the canonical workspace segment from every generated Sales Ops path.
The locked tests were not changed.

## Locked focused test run

Command:

```text
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/routing.test.tsx
```

The command was run exactly once after the mutation was applied.
It exited with code 1, which is the expected outcome for a killed mutation.
Vitest reported 2 failed test files, 20 failed tests, and 70 passed tests out of 90 total tests.

Expected mutation-killing evidence:

- `navigation.test.ts` reported 15 failures out of 85 tests.
- Fourteen role-visible route-preservation cases received paths without their workspace segment, such as `/dashboard` instead of `/tatico/dashboard`.
- The exact canonical path builder case received `/dashboard` instead of `/tatico/dashboard`.
- `routing.test.tsx` reported failures in all 5 canonical routing scenarios.
- Shell navigation received `/comissoes` instead of `/operacional/comissoes`.
- Browser-history workspace navigation received `/vendas` instead of `/operacional/vendas`.
- Invalid-route replacement received `/dashboard` instead of `/tatico/dashboard`.
- Role switching received `/finders` instead of `/tatico/finders`.
- Dashboard-card navigation received `/vendas` instead of `/operacional/vendas`.
- React Router also reported unmatched mutated locations such as `/comissoes`, `/vendas`, `/dashboard`, and `/finders`.

These failures directly prove that the locked unit and shell-routing tests require canonical `/<workspace>/<view>` paths.

## Cleanup

The mutation was restored before cleanup.
The detached worktree had an empty `git status --short`, and its source diff matched `master` before removal.
`.worktrees/mutation-canonical-sales-routes` was removed.
Git worktree metadata was pruned and contains no entry for the disposable path.
No temporary branch was created because the worktree used detached HEAD.
The one-shot Vitest process exited, and no matching process remained after cleanup.
