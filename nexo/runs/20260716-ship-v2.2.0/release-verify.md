# Release verification - v2.2.0

## Verdict

**PASS**

Release candidate commit `db8df37d8c420bd800cf15a2c228aa85ff7fac66` passed the repository's complete run-once shipping checks, the separate database integration suite, and dependency security audits.

Verification started at `2026-07-17T02:08:03Z` and completed at `2026-07-17T02:13:34Z`.

## Candidate identity

The candidate was verified on branch `master`.

| Check | Result | Evidence |
| --- | --- | --- |
| `git rev-parse HEAD` | PASS | `db8df37d8c420bd800cf15a2c228aa85ff7fac66` |
| `git rev-parse refs/remotes/origin/master` | PASS | `db8df37d8c420bd800cf15a2c228aa85ff7fac66` |
| `git ls-remote --exit-code origin refs/heads/master` | PASS | Remote `master` resolves to `db8df37d8c420bd800cf15a2c228aa85ff7fac66` |
| Branch | PASS | `master` |

## Environment

- Node.js: `v22.22.3`, satisfying the repository requirement of Node.js 20 or newer.
- pnpm: `10.17.1`, matching the version declared by `packageManager`.
- Package manager lockfile: `pnpm-lock.yaml`.
- Database integration runtime: Docker Engine `29.4.0` with `postgres:16-alpine` from the repository Compose configuration.

## Verification results

| Area | Command | Result | Evidence |
| --- | --- | --- | --- |
| Dependency state | `pnpm install --frozen-lockfile` | PASS | Lockfile was current and all five workspace projects were already up to date. |
| Lint | `pnpm run lint` | PASS | API and web ESLint checks exited 0; the two shared packages ran their repository-defined no-op lint scripts. |
| Type checking | `pnpm run type-check` | PASS | Shared packages built, then all four workspace packages completed `tsc --noEmit` successfully. |
| Unit and contract tests | `pnpm test` | PASS | 33 test files passed with 256 tests: shared-utils 17, API 164, and web 75. |
| Legacy-auth security guard | Included in `pnpm test` | PASS | `scripts/no-legacy-auth.mjs` completed with exit 0 after the workspace tests. |
| Production build | `pnpm run build` | PASS | Shared packages, API TypeScript build, and web Vite production build completed; Vite transformed 1,810 modules. |
| Database integration tests | `pnpm --filter @fxl-sales/api test:integration` | PASS | 8 test files passed with 27 tests against a healthy repository-managed PostgreSQL 16 container. |
| Production dependency audit | `pnpm audit --prod` | PASS | `No known vulnerabilities found`. |
| Full dependency audit | `pnpm audit` | PASS | `No known vulnerabilities found`. |

The root test command also exercised the repository's no-legacy-auth tracked-file guard.

The separate integration suite covered migration setup, row-level security, cross-tenant isolation, public referral lookup, conversion ingest and replay handling, commission persistence, webhook signature rejection, and finder state transitions.

## Observations

- The web test suite emitted two React Router v7 future-flag warnings while passing; these are non-failing upgrade notices.
- The integration migration setup emitted PostgreSQL notices that the Drizzle schema and migration table already existed; these were idempotency notices, and all 27 integration tests passed.
- The shared package lint scripts are intentionally defined as `echo` no-ops in their package manifests, so lint coverage for those packages is limited by current repository configuration.
- No browser E2E or Playwright script is defined by the repository's package manifests or verification conventions, so no browser E2E command was available to run.
- Two unrelated untracked paths existed before verification and remained untouched: `.vscode/` and `nexo/knowledge/doubts/20260707-missing-entitlement.md`.
- Existing web and API development processes dated July 15 predated this verification and were not started or altered by the verifier.

## Cleanup and final consistency

The PostgreSQL container, Compose network, and test volume created for the integration suite were stopped and removed with `docker compose down --volumes --remove-orphans`.

No verifier-started server, watcher, test runner, container, or other persistent process remains.

Final `git diff --check` and `git diff --exit-code` both passed, confirming no tracked product-code modifications.

Final `HEAD`, local `origin/master`, and remote `master` remained pinned to `db8df37d8c420bd800cf15a2c228aa85ff7fac66`.
