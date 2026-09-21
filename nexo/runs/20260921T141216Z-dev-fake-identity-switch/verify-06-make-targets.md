# Verify: 06-make-targets

Status: PASS

## Scope

Worktree: `.worktrees/20260921T141216Z-dev-fake-identity-switch/run`
Files under test: `Makefile`, `apps/api/.env.example`, `apps/api/.env.dev.example`,
`apps/web/.env.example`, `apps/web/.env.dev.example`,
`apps/api/src/config/__tests__/env-example-contract.test.ts`.

## 1. No active flag in any shipped example

Checked all six example files (`apps/{api,web}/.env.example`, `.env.dev.example`,
`.env.staging.example`).

- `apps/api/.env.example`, `apps/api/.env.dev.example`: `SALES_AUTH_FAKE` appears only in prose
  and as `# SALES_AUTH_FAKE=1` (commented). No bare `SALES_AUTH_FAKE=` line.
- `apps/web/.env.example`, `apps/web/.env.dev.example`: same for `# VITE_AUTH_FAKE=1`.
- `apps/api/.env.staging.example`, `apps/web/.env.staging.example`: untouched by this slice
  (`git diff HEAD` empty for both) and `grep -i 'SALES_AUTH_FAKE\|VITE_AUTH_FAKE'` matches
  nothing at all in either file.

No active flag, no blank active `KEY=` line, anywhere. PASS.

## 2. Vacuity probe on the new test describe block

Baseline: `pnpm exec vitest run src/config/__tests__/env-example-contract.test.ts` inside
`apps/api` → 29 tests, all green.

Probe: uncommented the flag line in `apps/api/.env.example`
(`# SALES_AUTH_FAKE=1` → `SALES_AUTH_FAKE=1`), re-ran the same test file.

Result: RED. 2 failures:
- `never ENABLES the dev-fake switch in apps/api/.env.example` — `expected '1' to be undefined`
- The unified diff assertion in the same describe block also failed on the added line.

27 passed, 2 failed. This proves the new `never ENABLES the dev-fake switch` test is not
vacuous — it genuinely detects an active flag.

Reverted `apps/api/.env.example` from a pre-probe backup. Re-ran: 29/29 green again, and
`git diff HEAD -- apps/api/.env.example` matches the original slice diff exactly (confirmed via
`git status --short`, which reported only the expected `M`, i.e. no stray leftover state).

## 3. Pre-existing test titles/assertions byte-unchanged

`git diff HEAD -- apps/api/src/config/__tests__/env-example-contract.test.ts | grep -c '^-'` → 1,
and that one line is the `--- a/...` diff header itself, not file content. The diff is
pure addition (73 new lines), nothing removed or reworded. PASS.

## 4. `make help`

Ran `make help`. Lists, with help text:
- `dev-fake` — Run the full stack with development identities (no Hub required)
- `back-fake` — Run only the API with development identities
- `front-fake` — Run only the frontend with development identities
- `dev-fake-setup` — One-shot: start the DB, migrate, seed the dev dataset, then run dev-fake
- `db-seed` — Seed the local database with the deterministic development dataset

All five new targets present with sensible one-line help text. PASS.

## 5. `make -n` dry-runs

- `make -n dev-fake`: builds shared packages, echoes the banner, then backgrounds
  `SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev` and
  `VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev` under `set -m`, with a trap that kills
  `-$api -$web` (process groups) on INT/TERM/EXIT, then `wait`.
- `make -n back-fake`: builds shared packages, then `SALES_AUTH_FAKE=1 pnpm --filter
  @fxl-sales/api dev`.
- `make -n front-fake`: `VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev` — no shared-package
  build step.
- `make -n db-seed`: `pnpm --filter @fxl-sales/api db:seed:dev`.
- `make -n dev-fake-setup`: chains `make db-up` → `docker compose up db -d`, `echo "Waiting for
  PostgreSQL..."`, `sleep 3`, `make migrate` → `pnpm --filter @fxl-sales/api db:migrate`, `make
  db-seed` → `pnpm --filter @fxl-sales/api db:seed:dev`, then `make dev-fake` expanding as above.
  Does NOT call `db-reset` (confirmed by reading the expansion — matches the comment's claim).

Prerequisite parity, read from the Makefile rule lines directly:
- `back: build-shared`, `dev-fake: build-shared`, `back-fake: build-shared` — all three carry
  `build-shared`.
- `front:` (no prereq), `front-fake:` (no prereq) — both bare, matching each other.

PASS — API-side fake targets mirror `back`'s prerequisite; `front-fake` mirrors `front`'s
absence of one.

## 6. `SALES_ENV_FILE` assignment scope

`grep -n SALES_ENV_FILE Makefile` on the working tree shows 4 hits: one new prose comment line
(mentions the name, assigns nothing), one pre-existing prose comment, one pre-existing `printf`
display string inside the `stg` interactive menu (`"  1) api     (SALES_ENV_FILE=.env.staging)\n"`,
not a shell assignment), and the one real assignment inside `back-stg`
(`SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev`).

Cross-checked against `git show HEAD:Makefile`: the pre-existing file already had the same
comment, the same `printf` string, and the same `back-stg` assignment (3 of the 4 current hits
pre-date this slice; the 4th is the new prose line in the dev-fake header comment, which only
mentions the name and assigns nothing). Confirmed only `back-stg` assigns `SALES_ENV_FILE`, and
that this slice added no second assignment. PASS.

## 7. `stg` / `back-stg` byte-unchanged

`diff` of the `stg:` block (from `^stg:` up to `^back-stg:`) and of the `back-stg:` block (from
`^back-stg:` to the next blank line) between `git show HEAD:Makefile` and the working tree: both
empty diffs, i.e. byte-identical. PASS.

## 8. No em dash / en dash in added lines

For each of the six changed files, filtered `git diff HEAD -- <file>` to `^+` lines and grepped
for U+2014 (em dash) / U+2013 (en dash). Zero matches in all six files. PASS.

## 9. `make back-fake` actually works

Started `make back-fake` in the background (fresh PGID 63962, verified by `ps` that every
process in that group — `make`, `pnpm` (x2), `tsx watch`, the actual `node` server — was one I
spawned, nothing foreign).

Log showed:
```
[fxl-sales-api] database host=localhost port=5006
[dev-identity] Ignoring the Hub configuration because SALES_AUTH_FAKE is active: ...
[dev-identity] SALES_AUTH_FAKE is active. Roster: team-owner, team-admin, product-admin, seller,
finder, seller-finder, no-role, no-access, multi-org. Default identity: team-owner. Switch with
the "x-fake-identity" header.
[fxl-sales-api] listening on http://localhost:3006 (development)
```

`curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/health` → `200`.

Used the pre-existing local Postgres container already running from the main checkout on port
5006 (`apps/api/.env` in this worktree already pointed at `localhost:5006`, not staging); did not
migrate, seed, or otherwise write to it — only opened a read connection for the health check.

Note: an earlier `make db-up` attempt (before discovering the shared local DB was already up)
failed with `port is already allocated` (5006 taken) and left a stopped `run-db-1`
container/network/volume behind; cleaned up immediately with `docker compose down -v` in the
worktree before starting the API against the existing shared DB. No lasting docker side effect.

Cleanup: identified process group 63962 belonging entirely to this run (5/5 processes verified
mine), ran `kill -- -63962`. Confirmed `ps` shows zero processes left in that group and
`lsof -i :3006` returns nothing (port free). No `pkill -f`/name-pattern kill used anywhere.

PASS.

## 10. Root suites

- `pnpm run test` → exit 0. `auth-fake` 35/35, `shared-utils` 80/80, `apps/api` 601/601,
  `apps/web` 940/940, plus the root node-based script/contract tests (49/49, includes the
  `local-database-guard`, `dev-identity` production-refusal, `seed-dev.ts` guard, banned-provider
  and retired-env-name suites). All green.
- `pnpm run lint` → exit 0. `apps/api` and `apps/web` eslint both clean; the three `packages/*`
  workspaces have no lint script (`echo 'no lint for ...'`, pre-existing, unrelated to this
  slice).
- `pnpm run type-check` → exit 0. `packages/shared-types`, `packages/shared-utils`,
  `packages/auth-fake`, `apps/api` (both `tsconfig.json` and `tsconfig.scripts.json`), `apps/web`
  all clean.

## Tree state

`git status --short` and `git diff --stat HEAD` after all probes match exactly what they were at
the start of verification (same 7 modified/untracked paths, same insertion/deletion counts).
Nothing committed, staged, or left dirty beyond what the slice itself produced. No stray docker
resources.

## Verdict

PASS. Every checked property holds: no example ships an active flag, the staging examples don't
mention the flags at all, the new test genuinely fails when a flag is uncommented (not
decorative), pre-existing test content is untouched, `make help` and the five new/changed targets
match their prerequisite precedents, `SALES_ENV_FILE` is assigned only in `back-stg`, `stg` /
`back-stg` are byte-unchanged, no dashes were introduced, `make back-fake` boots the real API with
the fake-identity roster and answers `200` on `/health`, and the full root test/lint/type-check
suites are green.
