# Run record - feature-20260916-local-db-guard

Flow: feature, autopilot.
Trunk: `master`.
Not promoted, not tagged, not deployed - the run stops at `master`.

## Why this run exists at all

This run has a measured incident behind it, not a hypothesis.

On 2026-09-16 `apps/api/.env` carried an ACTIVE, uncommented `DATABASE_URL` pointing at `fxl-db-server:5432/fxl_sales_stg_db`, with a write credential.
That host resolves and answers on this machine over Tailscale, so the URL was not merely wrong, it was reachable.
`make back`, `make migrate` and `make db-reset` therefore all ran against the STAGING database, with nothing on screen saying so.

`make db-reset` was the worst of the three.
It drops the local docker volume, which is harmless, and then chains `$(MAKE) migrate`, which used that same `DATABASE_URL` and applied DDL to staging.

The credential was moved by hand to a gitignored `apps/api/.env.staging` BEFORE this run started, and `.env` was pointed back at `localhost:5006`.
That was the incident cleanup, and it is not what this run did.
This run built the MECHANISM that stops the next occurrence.

The aggravating factor shaped the whole design.
`apps/api/src/db/migrate.ts` did `import 'dotenv/config'` and read `process.env.DATABASE_URL` raw, never passing through `apps/api/src/env.ts`.
A check living in the zod schema would therefore have missed exactly the entrypoint that applies DDL, which is the dangerous one.

## Slices

| # | Slice | Wave | Gate 2 | Merge |
| --- | --- | --- | --- | --- |
| 01 | `env-file-resolution` | 1 | PASS | `2facf27` (branch `55d1ba4`) |
| 02 | `local-database-guard` | 2 | PASS | `6099395` (branch `44b0da1`) |
| 03 | `staging-make-targets` | 2 | PASS | `8f5660a` (branch `9fe990f`) |
| 04 | `structural-guard` | 3 | PASS | `ffb5245` (branch `fb0e8b6`) |

Wave gates: wave 1 FAIL on a pre-existing condition (recorded, not reverted - see below), wave 2 PASS, wave 3 PASS as the final feature gate.
Every slice passed Gate 2 on its first verify attempt; the budget records one replan, which is the plan-check BLOCKER below.

## The ordering inversion, taken deliberately

The human's brief numbered the guard as Fatia 1 and the named opt-in as Fatia 2.
Execution inverted them: `env-file-resolution` landed first and `local-database-guard` second.

The reason is in the brief itself.
The guard consumes `namedEnvFile`, and that value does not exist until the resolver does.
Building the guard first would have meant writing both call sites against a `null` literal and rewriting them one slice later, which is a call site written twice and a slice boundary Gate 2 cannot grade honestly.
The composite end state is byte-identical either way; nothing about the WHAT changed, only the order in which two already-approved pieces landed.

## The plan-check BLOCKER

Slice 02 was planned in parallel with slice 01, before `01-env-file-resolution.md` existed, and it wrote its call sites against a placeholder: `import { resolvedNamedEnvFile } from '../env-file.js'`, with the instruction "substitute the real names; change nothing else."

Slice 01 lands no such thing.
The module is `apps/api/src/config/env-files.ts`, plural, and the value is a RETURN of `loadEnvFiles(...)` at `migrate.ts` and an `export` re-read from `./env.js` at `server.ts` - wrong in path, wrong in symbol, and wrong in mechanism at both sites.

The path and symbol errors are caught by `tsc`, so they are cheap.
The mechanism error is not.
Slice 02's verbatim "Becomes" block for `migrate.ts` contained no `loadEnvFiles` call at all, so an executor obeying "change nothing else" and replacing the file wholesale would have silently DROPPED slice 01's env loading from the migrate path.
That regression type-checks and lints cleanly, and it surfaces only as `make migrate` dying with `DATABASE_URL is required` on every developer machine.

The plan-check graded it BLOCKER and supplied the four replacement lines verbatim, and the fix was applied as an authoritative supersede block on top of slice 02's plan rather than as a rewrite of it, so the superseded wording stays readable beside what replaced it.
The landed diff shows the correction took: `migrate.ts` DESTRUCTURES slice 01's existing statement (`-loadEnvFiles({...})` / `+const { namedEnvFile } = loadEnvFiles({...})`) rather than deleting or duplicating it.

## The ESM discovery in slice 02

This is the most valuable technical finding of the run.

The plan placed the guard as the first statement of `server.ts`'s module BODY, below the full static import list.
That is not first.
ESM evaluates the ENTIRE static import graph before the first statement of a module body runs, and `apps/api/src/middleware/app-auth.ts` loads the Hub configuration at its own module top level (`app-auth.ts:96`), throwing `HubConfigError` there on a bad one.

It was found empirically, not reasoned about in advance: the first run of the server arm printed `HubConfigError: FXL_HUB_CONFIG.environment must be ...` and NEVER the guard lines.
The guard's verdict was buried under an unrelated module-load failure, and any future module-scope database work anywhere in that graph would have beaten it the same way.

The fix stayed inside the slice's four permitted files.
`server.ts` now statically imports only `./env.js` and `./db/local-database-guard.js` - both pure with respect to the database, the guard module importing nothing at all - runs the guard, and then loads every other module with `await import(...)` in the original order with the original binding names.
Top-level await was already in use in this package, in `migrate.ts`.

The verifier did not take the restructure on trust.
It confirmed the ESM claim three ways (the offending top-level statement at `app-auth.ts:96`, an independent minimal two-module experiment, and the live stack trace showing the Hub error now arriving through the dynamic import at `dist/server.js:44`), then proved the rewrite changed nothing else:

- the body is BYTE-IDENTICAL from `const app = new Hono();` onward, so every `app.use` / `app.route` / `app.get`, `setupNightlyJob()` and `serve(...)` are untouched, in place and in order, including the comment recording that the admin group is mounted ahead of the finder group;
- module evaluation order is identical specifier for specifier across all 20 moved modules, with `./env.js` promoted from 4th to 1st, which is inert because it was already a transitive dependency of `app-auth.js`;
- all 25 original bindings survive, with exactly three additions.

The decisive evidence is behavioural rather than structural: with a remote `DATABASE_URL` the process prints the three `[local-database-guard]` lines and exits 1, and `HubConfigError` never appears at all.
That is impossible with a static import list on this machine.

One finding recorded and not acted on: `server.ts` is now an async module.
Nothing imports it today, so there is no consumer to defer.

## The `NODE_TEST_CONTEXT` vacuity trap in slice 04

Slice 04's structural guard proves itself by spawning ITSELF against throwaway fixture trees in which the guard call has been mutated away, and asserting the child exits non-zero.
Transcribed verbatim from the plan, it went RED: 6 pass, 4 fail, with all four mutation cases reporting a child exit status of `0`.

The cause was diagnosed with a scratch probe rather than guessed.
`node --test` runs each test FILE in a child process carrying `NODE_TEST_CONTEXT=child-v8`.
The plan's `runAgainst` spread `process.env` into the grandchild, which then believed it was already inside a runner, warned `Warning: node:test run() is being called recursively within a test file. skipping running files.`, executed ZERO TESTS, produced empty stdout and exited `0`.

That is exactly the vacuity class the file exists to prevent, arriving through the harness instead of through the sources.
The fix is confined to `runAgainst` and documented in a comment there: build the child env, then delete every key beginning `NODE_TEST_`.

The sharp detail is worth keeping.
The POSITIVE CONTROL did NOT catch it.
A vacuous child exits `0`, and exiting `0` is precisely what the positive control asserts, so it was green throughout.
The four NEGATIVE cases are what went red, which is the non-vacuity argument working from the other side.

The independent verifier reproduced the hazard from its own fixtures rather than reusing the implementer's helpers, and also confirmed the tripwire that stops a fixture-mode parent from passing for the wrong reason: a real run reports `# pass 10`, a fixture-mode run reports 5.

## The orchestrator's own vacuous gate

The secret-leak sweep written into the wave-1 and wave-2 verify contracts was

```sh
git grep -n -E '^\s*SALES_ENV_FILE=' -- . ':(exclude)nexo'
```

`git grep`'s ERE does not honour `\s`, and the one legitimate assignment is TAB-indented inside the `Makefile`'s `back-stg` recipe.
So the pattern matched nothing and reported a clean sweep WITHOUT HAVING LOOKED.

Measured directly afterwards: the `\s` form exits 1 finding nothing, while `^[[:space:]]*SALES_ENV_FILE=` exits 0 and finds `Makefile:56`, which is the expected and only hit.
Nothing had leaked - the corrected pattern confirms exactly one assignment and it is the mandated one - but the check had been passing for the wrong reason.
The wave-2 verifier found it by re-running the check rather than trusting the pattern it was handed, and wave 3 used the corrected form with an explicit positive control on every "must return nothing" grep.

### The throughline

This run produced THREE separate instances of the same failure: a check that reports green without having looked.

1. The ESM placement - a guard that was "first" in the file and was in fact never reached, so a green boot said nothing about the guard.
2. The `NODE_TEST_CONTEXT` spread - four negative cases all passing over a child that ran zero tests and exited 0.
3. The `\s` grep - a security sweep certifying a tree it had not searched.

Three different mechanisms, one shape.
Each was caught only because something forced the check to demonstrate that it could still FAIL: the remote-URL refusal proof, the four negatives, and the positive control on the grep.
None of the three was caught by the thing that looked like the obvious safeguard.

## The wave-1 FAIL that was correctly NOT reverted

The wave-1 verifier graded `master` at `2facf27` and returned FAIL on exactly one check: `node apps/api/dist/server.js` does not boot, dying on

```
HubConfigError: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging" or "development".
```

Everything the run's own acceptance criteria name was green at that point: `type-check`, `lint`, `pnpm run test` (1318 tests, 0 failures, both legacy-name guards included), `build`, and `db:migrate` against the local database.

The cause is the untracked `apps/api/.env` on this machine, which is STALE against `@fxl-business/hub-sdk@2.3.0`.
It still names the retired `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY` and supplies none of the five canonical identity variables, but it DOES set `FXL_HUB_API_URL`, so `hubConfigIsAbsent` is false and this is a PARTIAL discrete configuration - which `CLAUDE.md` already records as a deliberate v3.1.0 boot failure rather than a `503 hub_auth_not_configured`.
The SDK behaved exactly as documented.

The verifier ISOLATED the cause rather than asserting it: the same binary with the five identity values supplied in-process only boots and serves `/health` 200, and `git diff 22a08a1 2facf27 -- apps/api/src/env.ts` shows that with `SALES_ENV_FILE` unset the new loader does byte-for-byte what the old one did.
The failure predates this run, dates from the SDK 2.3.0 adoption, and survived until now only because nothing in the suite had ever started the real server.

Reverting slice 01 would not have fixed it and would have destroyed correct, independently verified work.
Under the autopilot rule the wave was recorded and the run continued.

Part of this was the orchestrator's own overreach in the gate contract, and it is recorded as such.
The brief states plainly that the Hub values come later, by hand, with credentials not yet issued; asking a verifier for "the API boots and `/health` answers 200" asked for a property the stated state of the machine forbids.
Waves 2 and 3 graded the achievable and strictly STRONGER property instead: that the guard runs and prints BEFORE the `HubConfigError`, which is the boot ordering slice 02 owes and which a 200 would not have proven.

## Behaviour change worth knowing about

`pnpm --filter @fxl-sales/api db:migrate` now also reads `apps/api/.env.local`, which the old bare `import 'dotenv/config'` ignored.
That is the intended consequence of the two entrypoints sharing one resolver, and it is what makes them unable to diverge - but it is a real change for anyone who keeps overrides in `.env.local`.

## What the human must still do by hand

- **Update `apps/api/.env` to the nine-name Hub contract**, using `apps/api/.env.dev.example` as the source, and delete the retired `FXL_HUB_PUBLISHABLE_KEY` and `FXL_HUB_SECRET_KEY` lines.
  Only the human can do it: the file is gitignored, holds their own values, and the brief forbids this run from editing it.
  Until then the API cannot complete a local boot, which is pre-existing and unrelated to this feature.
- **Decide whether `apps/api/drizzle.config.ts` should be guarded too.**
  It carries its own `import 'dotenv/config'` and reads `process.env.DATABASE_URL` raw with a `localhost:5006` fallback, so `pnpm --filter @fxl-sales/api db:studio` reaches a database without passing either guarded entrypoint.
  It is out of scope by decision rather than by oversight - `db:studio` is read-mostly, there is no `make` target for it, and the brief names exactly two entrypoints - but slice 04 does not pin it either, so a future `db:push` script would inherit an unguarded path with a green suite over it.
  The remedy is one more call site plus one more assertion in `scripts/__tests__/local-database-guard.test.mjs`, and it is a human decision because "exactly two entrypoints" is a human decision.

## Final evidence

The final feature gate ran on `master` at `ffb5245` with all four slices merged, by an agent separate from every implementer, against the FEATURE's acceptance criteria rather than the last wave's diff.
Verdict PASS on all six.

1. **`type-check` and `lint` green.** Both exit 0 across all four workspaces; `pnpm run build` exit 0 for completeness.
2. **`pnpm run test` green with the local database up**, exit 0: shared-utils 80, api 478, web 784, plus all three `node --test` guard files in one invocation (`# pass 21 # fail 0`), plus `no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs` in the `&&` chain.
3. **The central criterion, proven BOTH ways by process exit code and never by message text.**
   `DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales'` exits 1 at the migrate entrypoint and exits 1 at the built server entrypoint, each printing the three `[local-database-guard]` lines naming `db.example.invalid` and pointing at `make stg`.
   The migrate arm never prints `Running migrations from ./drizzle`, so nothing connected; the server arm never reaches `HubConfigError`, which is the ordering oracle.
   The refusal is SPECIFIC and not blanket: the same command against `localhost:5006` prints one host-and-port line, applies migrations and exits 0.
   The remote fixture is `db.example.invalid` throughout, RFC 6761 reserved and unresolvable; no real host was contacted on any step of this run.
4. **Exactly one boot line, host and port only**, judged under the documented `NODE_ENV !== 'production'` qualifier that both emitters spell explicitly.
   Observed `[fxl-sales-migrate] database host=localhost port=5006` and `[fxl-sales-api] database host=localhost port=5006`, once each, with no user, password, database name or whole URL anywhere in either log.
   `describeDatabaseTarget` is a thin projection that can only return `{host, port}`, so there is no other interpolation site to audit.
5. **No tracked file gained a credential, a remote URL or a secret.**
   Every "must return nothing" grep used POSIX `[[:space:]]` and carried a positive control proving the pattern still finds a known hit.
   No infrastructure hostname appears outside `nexo/`; `SALES_ENV_FILE` has exactly ONE assignment in the tracked tree, `Makefile:56` in the `back-stg` recipe, with every other occurrence classified as comment, help text, `.env.*.example` prose or a literal object key in the resolver's own test; all 46 credentialed `postgres://` hits are localhost, docker or test placeholders; both `.env.staging.example` files are shape-only.
6. **`git status --porcelain` shows no local `.env` and no `.env.staging`.**

### The mutation tier was SKIPPED

Nexo's feature tier calls for mutation testing once after all waves are green.
This repository configures no mutation tool - there is no Stryker configuration and no mutation script in any `package.json` - so the tier was skipped rather than faked.

What stands in its place is real, and it is recorded here so the gap is visible rather than papered over.
The slice-02 verifier applied four mutations to the landed `apps/api/src/db/local-database-guard.ts` by hand, ran the named oracle after each, and restored the file from a scratch backup with `git diff --quiet` confirming clean restoration: dropping the IPv6 bracket-stripping goes red on four tests, deleting each of the guard's three early returns goes red on a differently named test each time.
Slice 04's whole purpose is mutation of the two entrypoints, and it performs it inside a tracked test on every `pnpm run test`.
That is targeted mutation of the mechanisms this feature adds; it is not a coverage-wide mutation score, and no such score exists for this run.

## Not done, deliberately

No deploy, no promotion, no tag.
Gate 3 untouched.
The run stops at `master`.
