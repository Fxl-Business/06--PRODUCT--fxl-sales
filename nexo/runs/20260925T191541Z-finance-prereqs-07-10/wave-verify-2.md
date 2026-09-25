# Wave verify 2 (Gate 2, integration tier)

Target: integrated master `80d425c` (slices 13, 11, 08 since green point `c79abed`).
Verdict: PASS.
Run in a fresh detached worktree `.worktrees/20260925T191541Z-finance-prereqs-07-10/wave-verify-2`, env copied from the main checkout, `pnpm install --frozen-lockfile --offline`; worktree removed at the end.

## Commands (run once each)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean, including the new `tsc -p apps/api/tsconfig.test.json` |
| `CI=true pnpm test` | 0 | auth-fake 35, shared-utils 155, api 680 (63 files), web 1048 (93 files), node --test 58/58, guard scripts green |
| `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 272/272 (35 files), as expected |
| cold `pnpm run build` (all tsbuildinfo and dist deleted) | 0 | built |
| `node scripts/assert-web-bundle-clean.mjs` | 0 | roster sentinel absent from `apps/web/dist` |

DB safety: `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL`, `ADMIN_DATABASE_URL` all point at `localhost:5006`; `setup-env.ts` hard-overrides `DATABASE_URL`. No `db:migrate` was run.

## Security review of `git diff c79abed 80d425c`

- No secrets in the diff.
- No new migrations; only test files mentioning migrations changed (type fixes).
- Access gate unchanged: the only `apps/api/src` change is `c.set('hubAuth', auth)` in `applyHubAuthContext`. On the real path the SDK already set the same object, so it is idempotent; the dev path reaches it only via `select.ts`, which still throws `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE` before the dynamic `import('@fxl-sales/auth-fake')`. auth-fake is still reached only by dynamic import (isolation test green); web bundle clean.
- Settlement actions admin-only: UI `canSettle = workspace === 'operacional' && profile.roles.includes('admin')`, default `false` on shared views (meus-dados read-only); API routes `POST /settlements`, `POST /settlements/:id/reverse`, `GET /sales/:id/settlements` remain behind `requireAdmin` (API domain code untouched by this wave).
- No raw ids rendered: ids appear only as React keys and request paths; history renders `actorName`, the type declares no `actorUserId`, and a test asserts a leaked user id is not rendered. Blocking rows render via `describeLockedRows` labels.
- `recordSettlement` builds the body field by field and never sends an amount.
- Org scoping intact (no API query changes).
- No integration code: no outbox, feed, Hub or Finance calls added (`origin: 'finance'` is only a type literal).

## Processes

No process started by this agent remains running.
