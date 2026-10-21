# Release verify v4.7.2 (Gate 2) - hotfix/v4.7.2 @ ba1505f

Verdict: FAIL (only because integration could not run; everything else green).

| Step | Exit | Result |
| --- | --- | --- |
| pnpm run lint | 0 | clean |
| pnpm run type-check | 0 | clean |
| CI=true pnpm test | 0 | shared-utils 174, auth-fake 48, api 1488 (101 files), web 1749 (129 files), node guards 91 pass / 0 fail |
| cold build (tsbuildinfo + dist removed) | 0 | built; assert-web-bundle-clean ok |
| pnpm install --frozen-lockfile --offline | 0 | nothing to change, git status clean |
| pnpm --filter @fxl-sales/api test:integration | 1 (twice) | no test ran, see below |

## Integration
The worktree has no apps/api/.env, so the first run refused (TEST_DATABASE_URL unset).
I re-ran with the documented LOCAL urls (localhost:5006) as env vars.
Global setup then aborted: `Error: applied migration timestamp 1792567056888 is not in the journal` (src/db/migration-runner.ts:455).
The local test DB already has a migration applied from master that the v4.7.1 journal (hotfix tree) does not contain, so the DB schema is ahead of this candidate.
Deterministic on re-run. Nothing was reset or modified. This is an environment/schema-skew failure, not a code failure from the diff (zero migration files touched).
To get a real run: use a fresh local test DB (or one at v4.7.1 schema).

## Diff check 6465c92..HEAD
- Files: CLAUDE.md, apps/api/package.json, import domain (parse.ts, template.ts, xlsx-package.ts, 2 tests), pnpm-lock.yaml, nexo reference + plan docs. Nothing outside the allowed set.
- Migration files in apps/api/drizzle touched: 0.
- Added lines containing U+2014: 0.
- jszip pinned `"jszip": "3.10.2"` (no caret).
