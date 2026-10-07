# Wave 1 verify (Gate 2, wave tier)

Verdict: PASS (tree at c6289bd; see integration NOTE about worktree contamination).

| Check | Command | Result |
| --- | --- | --- |
| Lint | `pnpm run lint` | exit 0 |
| Types | `pnpm run type-check` | exit 0 |
| Unit + guards | `pnpm test` | exit 0; auth-fake 48, shared-utils 174, api 1426, web 1595 (all pass); script guards 91 pass / 0 fail |
| Integration | `pnpm --filter @fxl-sales/api test:integration` | on clean HEAD checkout: exit 0, 47 files, 372 tests pass (see NOTE) |
| Build | `pnpm run build` (clean HEAD checkout) | exit 0; assert-web-bundle-clean: clean |
| Audit | `pnpm audit --prod --audit-level high` | exit 0; 13 vulns (1 low, 12 moderate), none high |

## NOTE - worktree contamination (not a product failure)
The first integration run in the 00-run worktree failed 4 tests, all in `apps/api/test/rls/zz-plan03-experiment.test.ts`.
That file is UNTRACKED, and `apps/api/src/domains/sales-ops/leads/lead-service.ts` had an UNCOMMITTED 5-line edit (`lockLeadBoard` advisory lock in `insertLead`).
Neither is in HEAD; they look like a planner's experiment for a later slice (plan03) running in this worktree concurrently.
To get an objective result on HEAD I made a throwaway worktree of c6289bd (scratchpad `wave1-head`, copied .env, `pnpm install --offline --frozen-lockfile`), built, and ran integration there: 47/47 files, 372/372 tests pass.
(An earlier run in that checkout failed only because shared-utils dist was not built yet; it passed after `pnpm run build`.)
Lint, tsc and `pnpm test` ran in the 00-run worktree, which included the uncommitted lead-service edit; they were green regardless.
ACTION for the owner: the stray experiment file and the uncommitted lead-service edit in 00-run must be removed or committed deliberately before merging; the experiment test fails as written (concurrent writes ok/err, ids [1,2,2]) so it must not ship.
The throwaway checkout should be removed with `git worktree remove --force` (done by this agent at the end).

## Security
- `git diff 1b26cf2..HEAD -- '**/package.json' pnpm-lock.yaml` is empty, so the 13 moderate/low advisories are pre-existing and unrelated (NOTE, not FAIL).
- Em dash in diff: 0. dangerouslySetInnerHTML in diff: 0. No secrets, no raw SQL string building (drizzle `or`/`isNull`/`eq` only).
- Authz: `leadSellerCondition` uses `or(own, isNull(seller))`, parenthesized by drizzle, and is appended as a conjunct beside the org filter in `listLeads`, `getLead` and `leadIdentityConditions` (used by update and move), so the IS NULL arm cannot escape the org. Admin path has no seller predicate and never claims. Pool visibility and claiming require an ACTIVE vendedor (`findActiveVendedor`), finder-only or inactive callers keep own leads only. A claim writes seller from the caller's own pessoa, a body naming another id is `403 seller_scope`, claim happens after validations and inside the row-locked tx (race loser gets not_found). Web diff is presentational only.
