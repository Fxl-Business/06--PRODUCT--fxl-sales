# Verify report: slice 05-isolation-guard

Status: PASS

## Scope

Verified `scripts/__tests__/auth-fake-isolation.test.mjs` and
`scripts/assert-web-bundle-clean.mjs` in worktree
`.worktrees/20260921T141216Z-dev-fake-identity-switch/run`, plus the wiring
change in the root `package.json` (`build` and `test` scripts). Did not fix
anything. All mutations described below were applied to the real tracked
tree, run, and reverted; `git status` at the end matches the start exactly
(`package.json` and `nexo/runs/.../budget.json` modified, plus the three new
untracked files - identical to the pre-verify snapshot).

## 1. The deviation: uniform comment-stripping, live-code decisive mutation

The executor's report is accurate. `apps/web/src/dev/dev-identity-registry.ts`
does name `@fxl-sales/auth-fake` in its own top-of-file doc comment (as prose
explaining why *that* file does not import it), and the guard strips comments
uniformly from every scanned file for both rule A (static-import ban) and
rule B (reference ban) rather than only inside the two sanctioned seams. This
is the right call: seam-only stripping would need a second code path anyway
(the seams' own load-bearing prose mentions the package too), and it would
make the pre-existing, correct registry file a false-positive violation on
day one.

The rule is still SUFFICIENT after the weakening. Comment-stripping only
removes comments; it does not touch executable code, so it can never hide a
static import, a live value reference, or an unsanctioned dynamic import -
all of those survive stripping unchanged. I verified this directly (section 2)
rather than trusting the file's own internal fixtures.

## 2. Mutation table (independent verification against the real tree)

Every row: mutation applied to a real file (or a temp tree for the
bundle-check cases), `node --test scripts/__tests__/auth-fake-isolation.test.mjs`
(or the bundle script directly) run against it, exit code recorded, then
reverted and diffed back to byte-identical.

| # | Mutation | Where | Exit code | Caught? |
|---|---|---|---|---|
| 1 | Static `import { roster } from '@fxl-sales/auth-fake'` in a new non-sanctioned file | `apps/api/src/__mut_static_import.ts` | 1 | YES (rule A) |
| 2 | `import type { Roster } from '@fxl-sales/auth-fake'` in a new non-sanctioned file | `apps/web/src/__mut_type_import.ts` | 1 | YES (rule A - no type-only carve-out) |
| 3 | Live value reference `export const NOTE = '@fxl-sales/auth-fake';` in a new non-sanctioned file | `apps/api/src/__mut_note.ts` | 1 | YES (rule B) |
| 4 | Dynamic `import('@fxl-sales/auth-fake')` inside a NON-sanctioned file | `apps/web/src/__mut_dynamic.ts` | 1 | YES (rule B - the dynamic-import carve-out is stripped only for the two named seam paths, not generally) |
| 5a | Package moved `devDependencies` -> `dependencies` | `apps/api/package.json` | 1 | YES |
| 5b | Package moved `devDependencies` -> `peerDependencies` | `apps/api/package.json` | 1 | YES |
| 5c | Package moved `devDependencies` -> `optionalDependencies` | `apps/api/package.json` | 1 | YES |
| 6 | Sanctioned seam renamed away (`install-dev-identity.ts` -> `.moved-away`) | `apps/web/src/dev/` | 1 | YES, fails LOUD (`loadError` propagates into "both sanctioned seams exist and are readable" plus 4 other tests) - does NOT pass by absence |

All eight cases are caught. I also independently ran the two "always fails
loud" checks the task calls out:

- **NODE_TEST_ strip, load-bearing check**: removed the
  `if (key.startsWith('NODE_TEST_')) delete childEnv[key];` line from
  `runAgainst` and re-ran the real file. Result: 10 of the 13 negative-block
  tests FAILED (exit non-zero for the whole run, `# pass 11 / # fail 10`),
  because each spawned grandchild now inherits `NODE_TEST_CONTEXT`, warns
  "run() is being called recursively within a test file", executes zero
  tests, and exits 0 - which the negative tests' own
  `assert.notEqual(status, 0)` correctly flags as a test failure. This proves
  the strip is load-bearing: without it the guard's own self-proof breaks
  loudly rather than silently passing. Reverted; file is back to
  byte-identical (`diff` confirmed).
- **Bundle-check failure mode 1 (absent dist)**: ran
  `scripts/assert-web-bundle-clean.mjs` with `FXL_AUTH_FAKE_BUNDLE_ROOT`
  pointed at a fresh temp tree containing only `packages/auth-fake/src`
  (sentinel present) and no `apps/web/dist` at all. Exit 1, message names the
  absent dist as a failure, never a skip.
- **Bundle-check failure mode 2 (sentinel deleted from package source)**: ran
  the same script against a temp tree with a populated `apps/web/dist` but a
  `packages/auth-fake/src/index.ts` that no longer defines
  `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL`. Exit 1, message names the missing
  sentinel and refuses to let the dist scan run at all.

Both bundle-check failure modes fire, confirmed independently of the test
file's own internal fixtures for the same cases.

## 3. Pass-count tripwire

Ran the guard alone twice:

- Real mode: `node --test scripts/__tests__/auth-fake-isolation.test.mjs` ->
  `# tests 21`, `# pass 21`, `# fail 0`. Matches the header's claimed
  "8 always-on plus 13 negative-block = 21" exactly.
- Fixture mode: `FXL_AUTH_FAKE_GUARD_ROOT=<repo root> node --test
  scripts/__tests__/auth-fake-isolation.test.mjs` -> `# tests 8`, `# pass 8`,
  `# fail 0`. Matches the header's claimed fixture-mode count exactly.

Both counts are current, not stale.

## 4. Wiring

- `scripts/__tests__/auth-fake-isolation.test.mjs` is in the root `test`
  script's `node --test` argument list (confirmed by reading `package.json`
  directly): `node --test scripts/__tests__/no-legacy-auth.test.mjs
  scripts/__tests__/no-legacy-env-names.test.mjs
  scripts/__tests__/local-database-guard.test.mjs
  scripts/__tests__/auth-fake-isolation.test.mjs`.
- `node scripts/assert-web-bundle-clean.mjs` runs as the last step of the
  root `build` script, after both the api and web builds. Confirmed both by
  reading `package.json` and by observing it execute and print
  `[assert-web-bundle-clean] clean: ...` at the tail of the real `pnpm run
  build` output below.

## 5. Carry-forward carve-out

`apps/api/src/auth/__tests__/dev-identity-production-refusal.test.ts` still
contains `vi.mock('@fxl-sales/auth-fake', () => { ... })` and a comment
mentioning the package. This file matches `isTestFile()` (under `__tests__/`
and ends in `.test.ts`), so rule B does not bind it at all, and `vi.mock(...)`
is a function call, not an `import`/`export ... from`/`require(...)`
statement, so rule A's regexes do not match it either. Confirmed by the guard
passing green against the real, unmodified tree (`# pass 21`, 0 violations
reported by both "no shipped source imports the package statically" and
"only the two sanctioned seams mention the package, and only dynamically").

## 6. Mutation-helper self-checks

Read every helper in the negative block: `movePackageToDependencies`,
`addPackageToRootDevDependencies`, `withoutLinesMatching`, and the inline
`web-hoisted-import` mutation each call `assert.notEqual(mutated, source, ...)`
(or the equivalent inline assertion) before building the fixture, so a
pattern that stops matching source and produces a no-op mutation fails the
test itself rather than silently producing a vacuous fixture.

## 7. Full command suite (real numbers)

All four run from the worktree root, none left running afterward (each was
launched via `nohup ... &`, monitored to completion, and confirmed dead
before moving on):

- **Guard alone**: `# tests 21 / # pass 21 / # fail 0` (see section 3).
- **`pnpm run test`**: completed clean, no `not ok` lines anywhere in the
  full log, no `ELIFECYCLE`/`npm ERR`/`pnpm ERR` lines. Per-package
  summaries: `packages/shared-utils` 80/80 passed, `packages/auth-fake`
  35/35 passed, `apps/api` 589/589 passed (55 test files), `apps/web`
  940/940 passed (75 test files), plus the root `node --test` line covering
  `no-legacy-auth`, `no-legacy-env-names`, `local-database-guard` and
  `auth-fake-isolation` together: `# tests 49 / # pass 49 / # fail 0`, then
  `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`
  and `node scripts/build-contract.mjs` (`build-contract: ok`) all completed
  with no errors.
- **`pnpm run lint`**: `apps/api lint: Done`, `apps/web lint: Done`, the
  three packages report "no lint" scripts and exit clean. (Root `scripts/`
  is not covered by any lint target in this repo - `eslint.config.js` only
  exists under `apps/api` and `apps/web` - which is the existing, unrelated
  convention this slice's two new root-level `.mjs` files simply inherit;
  not a gap introduced here.)
- **`pnpm run type-check`**: `packages/shared-types`, `packages/shared-utils`,
  `packages/auth-fake`, `apps/api` (`tsc --noEmit && tsc --noEmit -p
  tsconfig.scripts.json`) and `apps/web` all report `Done` with no errors.
- **`pnpm run build`**: `packages/shared-types`/`shared-utils` built,
  `apps/api` (`tsc && tsc-alias`) built, `apps/web` (`vite build`) built
  1853 modules in 1.85s, and the final step,
  `node scripts/assert-web-bundle-clean.mjs`, printed
  `[assert-web-bundle-clean] clean: FXL_SALES_DEV_FAKE_ROSTER_SENTINEL is
  absent from apps/web/dist and still present under
  packages/auth-fake/src.` and exited 0.

## 8. Other constraints

- No em dash or en dash found in either new file
  (`grep -nP '[\x{2013}\x{2014}]'` over both - no matches).
- No existing test title or assertion was touched: both files are new and
  untracked; `git diff` shows only `package.json` (the two script-line
  wiring edits) and `nexo/runs/.../budget.json` modified, nothing else.
- Did not fix, commit, stage, or stash anything. `git status --short` at the
  end of this verification is byte-identical to the snapshot taken at the
  start:
  ```
   M nexo/runs/20260921T141216Z-dev-fake-identity-switch/budget.json
   M package.json
  ?? nexo/runs/20260921T141216Z-dev-fake-identity-switch/agents/execute-05-isolation-guard.result.json
  ?? scripts/__tests__/auth-fake-isolation.test.mjs
  ?? scripts/assert-web-bundle-clean.mjs
  ```

## Verdict

PASS. All 8 targeted mutation cases (static import, type-only import, live
value reference, unsanctioned dynamic import, three dependency-field moves,
sanctioned-seam removal) are caught by the guard as it stands after the
comment-stripping deviation. The `NODE_TEST_` strip is present and proven
load-bearing by direct removal. Both real (21) and fixture-mode (8) pass
counts are accurate, not stale. The guard and the bundle script are correctly
wired into `test` and `build` respectively. The carry-forward `vi.mock` carve-out
is correctly exempted by the test-file check, not by a hole in the pattern.
Both bundle-check failure modes (absent dist, deleted sentinel) fire
independently of the test file's own fixtures. The full command suite - guard
alone, `pnpm run test`, `pnpm run lint`, `pnpm run type-check`, `pnpm run
build` - all pass with real, current numbers. No process was left running,
and the tree was returned to its exact starting state.
