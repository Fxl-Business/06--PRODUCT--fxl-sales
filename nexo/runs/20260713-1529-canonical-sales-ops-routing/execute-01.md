# Execute 01 - Canonical workspace routes

- Slice: `01-canonical-workspace-routes`
- Branch: `feat/01-canonical-workspace-routes`
- Worktree: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/01-canonical-workspace-routes`
- Result: PASS
- Commit: `4d6e912430197828c14f7b22314809da1b0f4d6a`
- Commit message: `feat(web): add canonical workspace routes`

## Delivered behavior

The Sales Ops shell now uses `/tatico/:page`, `/operacional/:page`, and `/cadastros/:page` as canonical URLs.
The URL parameters are the only active workspace and page source.
Root, unknown, mismatched, and role-forbidden routes replace to the active role's tactical default.
Workspace, page, dashboard-card, and role-switch handlers navigate through React Router.
Browser Back and Forward restore the workspace, page, and heading represented by each history entry.
The `config` workspace vocabulary was replaced with `cadastros`, with the visible label `Cadastros`.
The `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` route declarations and guards were not changed.
The protected `/:workspace/:view` route was added after all static legacy trees and before the catch-all.

## TDD evidence

### RED 1

Command:

```sh
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/navigation.test.ts
```

The command exited 1 as expected.
The navigation oracle reported 81 expected feature failures and 4 passing navigation assertions.
Failures identified the old `config` metadata and the missing `buildSalesOpsPath`, `getDefaultSalesOpsRoute`, and `resolveSalesOpsRoute` helpers.
The test file was locked after this failure and was not changed afterward.

### GREEN 1

The same command exited 0 after the navigation model implementation.
`navigation.test.ts` passed 85 of 85 tests.
The collected web run passed 134 of 134 tests.

### RED 2

Command:

```sh
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/routing.test.tsx
```

The command exited 1 as expected.
All five required rendered routing tests failed for missing URL-driven shell behavior.
The failures covered canonical deep links, history synchronization, replace redirects, role switching, and dashboard-card navigation.
The test file was locked after this failure and was not changed afterward.

### GREEN 2

The same command exited 0 after router and shell wiring.
`routing.test.tsx` passed 5 of 5 tests.
The collected web run passed 139 of 139 tests.

## Final executor verification

The final focused-oracle command passed with 12 test files and 139 of 139 collected tests.
The route-specific totals were 85 pure navigation tests and 5 rendered routing tests.
React Router printed its existing v7 future-flag notices during the happy-dom run, with no test failure.

| Check | Result |
| --- | --- |
| Focused route oracles | PASS - 139/139 collected tests |
| `pnpm --filter @fxl-sales/web lint` | PASS |
| `pnpm --filter @fxl-sales/web type-check` | PASS |
| `pnpm --filter @fxl-sales/web build` | PASS - 1,807 modules transformed |
| `git diff --check` | PASS |
| Commit hook performance audit | PASS |

## Diff and security inspection

Only the five planned product and test files were committed.
Route resolution preserves a URL only when the exact workspace-page pair appears in `getSalesOpsNavigation(workspace, role)`.
Dynamic values outside the canonical matrix cannot select a Sales Ops page and replace to the role default.
Non-team Cadastros navigation is an empty array, while both operational pages remain available to every role.
No auth claims, role grants, API calls, persistence, server rewrites, database code, or legacy route behavior changed.
The worktree was clean after commit.

## Browser E2E note

An authenticated browser audit was not run because no authenticated team, seller, or finder session or credentials were available to this executor.
This is an environment blocker for the user-equivalent browser check, not a substitute result.
The rendered real-shell MemoryRouter oracle covers the specified route, click, role, and history behavior without claiming authenticated browser coverage.

## Gate 2 replacement-history oracle fix

- Finding: `B1 - Rendered redirects do not prove replacement history semantics`
- Test-only commit: `9048035bda32526326c88b0f964316b5981e247c`
- Commit message: `test(web): prove canonical redirect replacement`
- Updated head: `9048035bda32526326c88b0f964316b5981e247c`

Two rendered history oracles were added without modifying or weakening the prior five routing tests.
Both start with safe `/operacional/vendas` history followed by `/cadastros/produtos`.
The direct canonicalization oracle proves seller Back navigation reaches the safe prior entry instead of restoring the role-forbidden Cadastros URL.
The role-switch oracle proves switching from Equipe to Finder replaces the forbidden Cadastros entry, so Back reaches the safe authorized operational entry.

### Mutation proof

Both production replacement flags were temporarily removed in the worktree only.
The exact routing command exited 1 with exactly the two new tests failing.
The direct canonicalization case remained at `/tatico/vendedores` after Back instead of reaching `/operacional/vendas`.
The role-switch case remained at `/tatico/finders` after Back instead of reaching `/operacional/vendas`.
The run reported 139 passed and 2 failed tests out of 141 collected tests.
Both production replacement flags were then restored byte-for-byte against the original product commit.

### Post-restore verification

| Check | Result |
| --- | --- |
| Exact routing oracle | PASS - routing 7/7, collected 141/141 |
| Exact two-file route oracles | PASS - navigation 85/85, routing 7/7, collected 141/141 |
| `pnpm --filter @fxl-sales/web lint` | PASS |
| `pnpm --filter @fxl-sales/web type-check` | PASS |
| `pnpm --filter @fxl-sales/web build` | PASS - 1,807 modules transformed |
| `git diff --check` | PASS |
| Commit hook performance audit | PASS |

The final fix commit changes only `apps/web/src/sales-ops/__tests__/routing.test.tsx` with 45 added lines.
No product file differs from the original canonical-route implementation commit.
