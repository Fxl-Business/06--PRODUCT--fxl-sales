---
id: 05-isolation-guard
milestone: v4.1.0
status: todo
depends_on: ["02-api-dev-adapter", "03-web-dev-identity"]
files_modified:
  - scripts/__tests__/auth-fake-isolation.test.mjs
  - scripts/assert-web-bundle-clean.mjs
  - package.json
acceptance:
  - "`pnpm run test` runs `scripts/__tests__/auth-fake-isolation.test.mjs` and that file is named explicitly in the root `test` script's `node --test` list."
  - "The guard FAILS when `@fxl-sales/auth-fake` appears under `dependencies` (or any non-`devDependencies` field) in `apps/api/package.json`, in `apps/web/package.json`, or anywhere in the root `package.json`."
  - "The guard FAILS when any shipped source file under `apps/api/src`, `apps/web/src`, `packages/shared-types/src` or `packages/shared-utils/src` carries a STATIC import of the package, including a type-only one."
  - "The guard FAILS when the literal package specifier appears anywhere in those trees other than inside a dynamic `import()` call in one of the two sanctioned seams, `apps/api/src/auth/select.ts` and `apps/web/src/dev/install-dev-identity.ts`."
  - "The guard FAILS when `apps/api/src/auth/select.ts` loses either its literal `'production'` comparison or its `throw new Error(...DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE...)`."
  - "The guard FAILS when `apps/web/src/dev/install-dev-identity.ts` loses its `import.meta.env.DEV` binding, loses the `if (!DEV_IDENTITY_ENABLED) return` early refusal, or reaches the package before that binding in source order."
  - "The guard FAILS when either sanctioned seam is renamed away or deleted, rather than passing because the banned pattern is now absent."
  - "Every one of those regressions is proven by re-spawning this same file (or the bundle script) against a MUTATED FIXTURE TREE and asserting a NON-ZERO exit status, never by asserting message text, and the real tracked files are never written to."
  - "`pnpm run build` runs `node scripts/assert-web-bundle-clean.mjs` after the web build, and that script exits non-zero when the roster sentinel is found in `apps/web/dist`, when `apps/web/dist` is absent, or when the sentinel no longer exists in `packages/auth-fake/src`."
  - "A real run of the guard reports `# pass 21` and a fixture run reports `# pass 8`, and both counts are written into the file's header comment as a tripwire."
  - "`pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm run build` all pass, and no existing test title or assertion is loosened."
goal: >
  Make the three structural defences of the dev-fake identity path irremovable by
  a self-proving tracked-file guard that runs inside `pnpm run test`, plus one
  build-time bundle assertion for the single property a source scanner cannot decide.
must_not_break:
  - "The root `package.json` `test` script keeps its existing order and every existing entry: `build:packages`, then `pnpm -r --if-present test`, then the `node --test` list, then `no-legacy-auth.mjs`, `no-legacy-env-names.mjs`, `build-contract.mjs`."
  - "`scripts/__tests__/local-database-guard.test.mjs`, `scripts/__tests__/no-legacy-auth.test.mjs` and `scripts/__tests__/no-legacy-env-names.test.mjs` are byte-unchanged, and so are `scripts/no-legacy-auth.mjs` and `scripts/no-legacy-env-names.mjs`."
  - "`scripts/no-legacy-env-names.mjs` does not learn any name from this feature; it has a single purpose, retired names, and every name here is new."
  - "No production code path is touched by this slice: it adds only two files under `scripts/` and two script strings in the root `package.json`."
  - "The guard never shells out to `git grep`, and never scans the repository as a whole for the banned specifier."
rules:
  - "The guard reads NAMED FILES and walks NAMED TREES, exactly as `local-database-guard.test.mjs` does, and never asks a repo-wide question."
  - "A negative case is proven by exit code alone; message text is never the oracle."
  - "The child environment of every re-spawn has every `NODE_TEST_`-prefixed key deleted."
  - "Every mutation helper asserts that it actually changed its input before the fixture is written."
  - "The guard forbids every textual mention of the package outside a dynamic `import()` in the two sanctioned seams; it carves no type-only exception."
  - "The build-time bundle check never skips: an absent `apps/web/dist` is a failure, not a pass."
verifier_focus:
  - "Run the guard alone and confirm it reports `# pass 21`; a lower count is the vacuity tripwire firing."
  - "Confirm the negative cases really go red by checking that each `runAgainst` / `runScriptAgainst` call asserts `status !== 0` and that the mutation helpers assert a changed input."
  - "Confirm `pnpm run build` actually invokes `scripts/assert-web-bundle-clean.mjs` and that the script fails on a missing dist."
---

# 05 - isolation guard

## Why this slice exists

Slices 01 through 04 put THREE structural defences around the dev-fake identity path.
The package is a `devDependency` and therefore absent from a `pnpm install --prod` tree.
Every reach to it is a DYNAMIC import, so it never enters a production build graph.
The web half sits behind `import.meta.env.DEV`, so a production bundle eliminates it as dead code.
None of those three is self-enforcing.
Each one is one careless edit away from silently ceasing to hold, with a fully green suite over the corpse.
This slice is the assertive layer that turns each of them into a test failure.

Acceptance 7 of the run names it directly, and names the model to follow: `scripts/__tests__/local-database-guard.test.mjs`.

## The names this guard pins

These are the CANONICAL spellings for the whole feature, and this slice is where they are asserted.

- The package is `@fxl-sales/auth-fake`, living at `packages/auth-fake`.
- The API seam is `apps/api/src/auth/select.ts`.
- The web seam is `apps/web/src/dev/install-dev-identity.ts`.
- The API seam THROWS `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`, which slice 02 exports from `apps/api/src/middleware/app-auth.ts` so that both refusals share one constant and cannot drift.
- The web seam declares `const DEV_IDENTITY_ENABLED = import.meta.env.DEV;`.
- The package exports a unique sentinel string literal, `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL`, which exists only so the bundle check below has something unambiguous to look for.

If slices 02 or 03 landed a seam at a different path, the executor of THIS slice updates the two path constants in the same commit and nothing else.
That is safe rather than sloppy, because the guard's first always-on test asserts both seams exist and are plausible, so a rename is RED and never a quiet pass.

## Question 1 - dependency placement

Read three JSON files by name: `package.json`, `apps/api/package.json`, `apps/web/package.json`.

For the two apps, assert `devDependencies[PKG]` is a non-empty string AND that the specifier appears in NO other dependency field.
The fields checked are `dependencies`, `peerDependencies` and `optionalDependencies`.
Checking only `dependencies` would wave through a `peerDependencies` entry, which pnpm will happily install into a production tree.

For the ROOT `package.json`, assert the specifier appears in NO dependency field at all, `devDependencies` included.
The root is not where a workspace consumer declares a workspace package, and a root declaration hoists the package into a position where nothing in this guard can reason about who reaches it.

## Question 2 - static imports, and the type-only question

There are TWO distinct rules here and they have different scopes.

RULE A, the static-import ban, applies to EVERY file in the scanned trees, test files included.
A static import is what pulls the package into the build graph, which is the property defence 2 exists to hold.
The regex is anchored per line: `^\s*import\s[^\n]*['"]@fxl-sales/auth-fake['"]` with the `m` flag, plus the `export ... from` form, plus the `require(` form.

RULE B, the reference ban, applies to every file EXCEPT test files.
Outside the two sanctioned seams, the literal specifier may not appear at all.
Inside a sanctioned seam, the ONLY permitted occurrence is inside a dynamic import call, matched as `import\s*\(\s*['"]@fxl-sales/auth-fake['"]\s*\)`.
The implementation strips every such match from the seam's source and then asserts the specifier no longer occurs.

Test files are exempt from rule B and NOT from rule A, for the reason finance records: a suite has to name the roster to assert anything about it, and a test module is never entered by the server or by the bundle, but the static-import ban is what actually keeps the package out of the build graph and it costs a test nothing to use `await import(...)`.
A test file is one matching `(^|/)__tests__/` or `\.test\.(ts|tsx|js|mjs)$`.

### The type-only carve-out, and why there is none

`import type { Roster } from '@fxl-sales/auth-fake'` is erased by the compiler, so on a narrow reading it is harmless.
This guard forbids it anyway, and the reason is that the erasure is not a property of the import site.
Whether a given `import { type X }` survives depends on `verbatimModuleSyntax`, on `isolatedModules`, and on whether a value binding shares the statement.
A rule whose verdict depends on three compiler settings is a rule a reviewer has to adjudicate, and an adjudicable rule is the weakest kind.
So the two seams declare the package's shape STRUCTURALLY, with a local interface written in the seam file itself, exactly as finance does, and no shipped file ever names the package outside a dynamic `import()`.
The cost is one hand-written interface per seam that can drift from the package.
That cost is paid back by `pnpm run type-check`, which checks the dynamically imported module against the local interface at the call site, so the drift is a type error rather than a silent divergence.

### What the four scanned trees deliberately EXCLUDE

PLAN-CHECK NOTE, 2026-09-21, recorded so it is a decision rather than an oversight.

`apps/api/scripts/` is NOT one of the four scanned trees, so slice 04's `seed-dev.ts` may name the
package in its own dynamic import without being a third sanctioned seam.
That is correct rather than convenient: `scripts/` is outside `apps/api/tsconfig.json`'s `rootDir`,
`tsc` never emits it into `dist/`, and it is therefore not part of the production artifact at all,
which is the property rules A and B exist to protect.
The seed is covered instead by `scripts/__tests__/local-database-guard.test.mjs`, which slice 04
extends to read it by name and to assert it carries the package specifier.
Adding `apps/api/scripts/` to the scanned trees here would force a third seam path into this guard
and would duplicate a claim slice 04 already proves.

`packages/auth-fake/src` is excluded for the obvious reason: it IS the package.

## Question 3 - the `import.meta.env.DEV` guard, answered honestly

A source scanner CANNOT prove that Vite eliminated the web half from the production bundle.
Dead-code elimination is a property of the emitted artefact, not of the source, and any source-level assertion is a proxy that a sufficiently creative edit walks straight past.
Saying otherwise would be exactly the vacuous green this repo has already paid for twice.

So the property is split in two, and each half is checked where it is actually decidable.

The SOURCE half is checked by the guard, statically, and it is deliberately a narrow structural pin rather than a claim about elimination.
On the comment-stripped web seam it asserts all three of:

- `/const DEV_IDENTITY_ENABLED\s*=\s*import\.meta\.env\.DEV\b/`
- `/if\s*\(\s*!DEV_IDENTITY_ENABLED\s*\)\s*return\b/`
- the index of the first `import.meta.env.DEV` occurrence is strictly less than the index of the first dynamic import of the package.

The ordering assertion is the one that carries weight.
It is what refuses a file that reaches the package at module top level and consults the flag afterwards, which is the shape that defeats elimination while satisfying a naive presence check.

The ARTEFACT half is checked at BUILD time by `scripts/assert-web-bundle-clean.mjs`, wired into the root `build` script immediately after the web build.
It reads every file under `apps/web/dist` and fails if `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` appears in any of them.
Before it scans, it asserts the sentinel still EXISTS somewhere under `packages/auth-fake/src`, because a deleted sentinel would make the dist scan trivially green forever.
An absent `apps/web/dist` is a FAILURE and never a skip, for the same reason.
That script is the only place in the tree where the dead-code claim is genuinely proven, and it says so in its own header.

It is deliberately NOT wired into `pnpm run test`, because it needs a web build that `pnpm run test` does not produce, and a test that skips when its input is missing is worse than no test.

## The ORACLE

There is exactly one oracle file: `scripts/__tests__/auth-fake-isolation.test.mjs`.

It follows `local-database-guard.test.mjs` in every structural respect.

- `FIXTURE_ROOT_VAR` is `FXL_AUTH_FAKE_GUARD_ROOT`, a harness knob only, set in no committed script.
- `ROOT` is derived from `import.meta.url` and never from `process.cwd()`.
- All file reads happen at MODULE SCOPE inside one `try`, and a read failure becomes a real failing assertion rather than a throw that could end the run with zero tests and exit 0.
- Sources are comment-stripped with whole-line `//` removal plus block-comment removal, so a commented-out guard cannot satisfy anything.
- The negative block is skipped when `FIXTURE_ROOT_VAR` is set, so a child never spawns a grandchild.
- `runAgainst(dir)` copies `process.env`, sets `FIXTURE_ROOT_VAR`, and DELETES every key beginning with `NODE_TEST_` before spawning `node --test <SELF>`.
  That deletion is load-bearing and carries the same comment finance's sibling carries: `node --test` sets `NODE_TEST_CONTEXT` in each test file's process, a grandchild that inherits it warns about recursive `run()`, executes NOTHING and exits 0, and every negative case would then read as green while proving nothing.
  The positive control cannot catch that, because a vacuous child exits 0 and 0 is precisely what the positive control asserts; the negatives are what catch it.
- Every mutation helper asserts `mutated !== source` before the fixture is written, so no negative case can pass for the wrong reason.
- A second spawner, `runScriptAgainst(dir)`, runs `node scripts/assert-web-bundle-clean.mjs` with `FXL_AUTH_FAKE_BUNDLE_ROOT` set to a fixture root, and reads its exit code the same way.

A fixture tree is a temp directory holding only the files a given case needs, written under their repo-relative paths.
The real tracked files are read and copied, never written.

## The tests, and the decisive mutation for each

### Always-on, eight tests, run in BOTH real and fixture mode

1. `both sanctioned seams exist and are readable` - the two seam files load.
   MUTATION: delete `apps/web/src/dev/install-dev-identity.ts` from the fixture.
2. `the sanctioned seams are the real seams, not empty or substituted` - each source exceeds a plausible minimum length and each contains its own signature symbol (`DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`, `DEV_IDENTITY_ENABLED`).
   MUTATION: replace a seam with a one-line stub.
3. `neither app declares the package outside devDependencies` - both app manifests carry it in `devDependencies` and in no other dependency field.
   MUTATION: move the entry from `devDependencies` to `dependencies` in `apps/api/package.json`.
4. `the root package.json does not declare the package at all` - no dependency field of the root manifest names it.
   MUTATION: add it to the root `devDependencies`.
5. `no shipped source imports the package statically` - rule A over the four scanned trees.
   MUTATION: prepend `import { roster } from '@fxl-sales/auth-fake';` to a shipped file in the fixture.
6. `only the two sanctioned seams mention the package, and only dynamically` - rule B.
   MUTATION: write a third fixture file containing the specifier in a comment.
7. `the api seam refuses under NODE_ENV=production` - the stripped source matches BOTH `/'production'/` and `/throw new Error\([^)]*DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE[^)]*\)/`.
   The second regex is deliberately loose about what sits between the parentheses, because slice 02's selector reaches the constant through its dynamic-import binding as `appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`; pinning the binding name would make this test red on a rename that changes nothing.
   The first regex is the literal `'production'` and NOT `nodeEnv === 'production'`, because slice 02's `isProductionEnv` really reads `(env.NODE_ENV ?? '').trim().toLowerCase() === 'production'`; the original spelling would have been red on the shipped code.
   MUTATION: delete every line matching `/DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE/`.
8. `the web seam is behind import.meta.env.DEV, and reaches the package only after it` - the three assertions listed under question 3.
   MUTATION: delete the `const DEV_IDENTITY_ENABLED = import.meta.env.DEV;` line, and separately, hoist the dynamic import above it.

### Negative block, thirteen tests, real run only

9. `an unmutated fixture passes (positive control)`.
10. `FAILS when apps/api/package.json moves the package to dependencies`.
11. `FAILS when apps/web/package.json moves the package to dependencies`.
12. `FAILS when the root package.json declares the package`.
13. `FAILS when a shipped file imports the package statically`.
14. `FAILS when a shipped file imports the package with a type-only import` - this is the carve-out being refused, and it is its own case so the decision is visible in the output.
15. `FAILS when a third file mentions the package outside the sanctioned seams`.
16. `FAILS when the api seam drops its production refusal`.
17. `FAILS when the web seam drops its import.meta.env.DEV binding`.
18. `FAILS when the web seam reaches the package before the DEV binding`.
19. `FAILS when a sanctioned seam is missing`.
20. `the bundle script passes on a clean fixture dist (positive control)` - fixture has `packages/auth-fake/src/index.ts` carrying the sentinel and an `apps/web/dist/assets/app.js` that does not.
21. `the bundle script FAILS on a dist carrying the sentinel, on an absent dist, and on a package source that lost the sentinel` - three `runScriptAgainst` calls in one test, each asserting a non-zero status.

### The pass-count tripwire

A real run reports `# pass 21`.
A fixture run reports `# pass 8`.

PLAN-CHECK NOTE, 2026-09-21: those two numbers are PREDICTIONS from this plan's own test list, not
measurements, and the executor MEASURES them exactly as slice 04 is required to.
Run `node --test scripts/__tests__/auth-fake-isolation.test.mjs`, read `# pass`, and write the
MEASURED numbers into the header comment and into this plan's acceptance line.
A tripwire seeded with a guessed number lies from its first run.
Both numbers go in the file's header comment, beside the sentence saying why: the count itself is a tripwire, and a run that reports fewer has gone vacuous rather than gone green.

## Exact wiring

In the root `package.json`, the `test` script gains ONE path, appended to the end of the existing `node --test` list and nowhere else:

```
"test": "pnpm run build:packages && pnpm -r --if-present test && node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/local-database-guard.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node scripts/build-contract.mjs"
```

The `build` script gains ONE trailing command:

```
"build": "pnpm run build:packages && pnpm --filter @fxl-sales/api build && pnpm --filter @fxl-sales/web build && node scripts/assert-web-bundle-clean.mjs"
```

No other script changes, and no other file in the repository changes.

## What this slice deliberately does NOT do

It does not touch `CLAUDE.md`.
The documentation slice owns that file and owns the reconciliation of the parked prohibition in `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md`.
What that slice must record about THIS one, so the two do not drift, is four facts: the guard's path, the fact that it proves itself by re-spawning against mutated fixtures and reading exit codes, the two pass counts, and the deliberate refusal of a type-only carve-out together with its reason.

It does not add a name to `scripts/no-legacy-env-names.mjs`.
That guard has a single purpose, retired names, and every name in this feature is new.

It does not write a wrapper checker script beside the test, as `no-legacy-auth.mjs` has.
Those two guards ask a repository-wide question, which is what a `git grep` pathspec is for.
This one asks about named files and named trees, so the test IS the guard, exactly as `local-database-guard.test.mjs` is.
