# Autopilot audit - run feature-20260916-local-db-guard

Flow: feature, autopilot. Trunk `master`. Gate 1 skipped by autopilot; Gate 2 enforced per slice
and per wave; Gate 3 not reached - this run stops at `master`.

## Recorded at Plan-check, before any code was written

### `apps/api/drizzle.config.ts` is a fifth, UNCOVERED door

- [ ] DECIDE: whether `db:studio` should be guarded too.

`apps/api/drizzle.config.ts` carries its own `import 'dotenv/config'` and reads
`process.env.DATABASE_URL` raw, with a `localhost:5006` fallback. `pnpm --filter @fxl-sales/api
db:studio` therefore reaches a database WITHOUT passing through `env.ts` or `migrate.ts`, which are
the only two entrypoints this feature guards.

It is deliberately out of scope for this run rather than forgotten: `db:studio` is read-mostly,
there is no `make` target for it, and the human's brief names exactly two entrypoints. It is
recorded here because slice 04's structural guard does not pin it either, so a future `db:push`
script would inherit an unguarded path with a green suite over it.

The remedy, if you want it, is one more call site plus one more assertion in
`scripts/__tests__/local-database-guard.test.mjs`. It is not a code change this run may make,
because the guard's "invoked ONLY from entrypoints, and exactly two of them" rule is a human
decision recorded in `00-OVERVIEW.md`.

### `SALES_ENV_FILE` exported in a developer's shell would reach the unit suite

Closed inside slice 01 rather than parked: `apps/api/test/unit-setup.ts` now blanks
`SALES_ENV_FILE` alongside the six Hub credential names it already blanks, so the unit suite is
decided by its own fixtures and never by the operator's shell. Recorded here because it is a file
the human's brief did not name.

## Wave 1 integration gate - FAIL on a PRE-EXISTING condition, NOT reverted

- [ ] **DO THIS BY HAND: update `apps/api/.env` to the nine-name Hub contract**, using
      `apps/api/.env.dev.example` as the source, and delete the retired `FXL_HUB_PUBLISHABLE_KEY`
      and `FXL_HUB_SECRET_KEY` lines. Only you can do it: the file is gitignored, holds your own
      values, and your brief forbids this run from editing it.

The wave-1 verifier graded `master` at `2facf27` and returned FAIL on exactly one of its checks.
Everything the run's own acceptance criteria name is GREEN: `type-check`, `lint`, `pnpm run test`
(1318 tests, 0 failures, both legacy-name guards included), `build`, and `db:migrate` against the
local database.

What failed is that `node apps/api/dist/server.js` does not boot:

```
HubConfigError: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging" or
"development".
```

The untracked `apps/api/.env` on this machine is STALE against `@fxl-business/hub-sdk@2.3.0`. It
still names `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY`, which that migration retired, and it
supplies none of `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`,
`FXL_HUB_AUDIENCE`. Because `FXL_HUB_API_URL` IS set, `hubConfigIsAbsent` is false, so this is a
PARTIAL discrete configuration - which `CLAUDE.md` records as a DELIBERATE v3.1.0 boot failure
rather than a `503 hub_auth_not_configured`. The SDK is behaving exactly as documented.

### Why this wave was NOT reverted

The verifier isolated the cause rather than asserting it. Same binary, same two env files, with the
five identity values supplied in-process only, boots and serves `/health` 200. And
`git diff 22a08a1 2facf27 -- apps/api/src/env.ts` shows that with `SALES_ENV_FILE` unset - which it
is, and must be - the new loader does byte-for-byte what the old one did. The slice touches no
Hub-config code.

The failure therefore predates this run and dates from the SDK 2.3.0 adoption, which updated both
`.env.example` files but could not update a developer's untracked `.env`. It survived until now
because nothing in the suite had ever started the real server.

Reverting slice 01 would not fix it and would destroy correct, independently verified work. Under
the autopilot rule the wave is recorded and the run continues.

### This was partly MY overreach in the gate contract

Check B ("the API boots and `/health` answers 200") is not reachable on this machine, and your brief
says so plainly: *"Os valores do Hub vem depois, a mao, com credenciais que ainda nao foram
emitidas."* I asked a verifier for a property the stated state of the machine forbids. The waves
that follow grade the achievable and still-decisive property instead: that the database guard runs
and prints BEFORE the `HubConfigError`, which is exactly the boot ordering slice 02 must guarantee.

That ordering is a STRONGER oracle than a 200 would have been. The guard is specified to run before
`const app = new Hono()`, so a remote `DATABASE_URL` must produce `[local-database-guard]` lines and
exit 1 WITHOUT the Hub error ever being reached - and the Hub error failing later is what proves the
guard really is first.

## Behaviour change worth knowing about, from slice 01

`pnpm --filter @fxl-sales/api db:migrate` now also reads `apps/api/.env.local`, which the old bare
`import 'dotenv/config'` ignored. That is the intended consequence of the two entrypoints sharing
one resolver, and it is what makes them unable to diverge - but it is a real change for anyone who
keeps overrides in `.env.local`.

## A gate of MINE was vacuous, and a verifier caught it

The secret-leak sweep I wrote into the wave-1 and wave-2 verify contracts used

```sh
git grep -n -E '^\s*SALES_ENV_FILE=' -- . ':(exclude)nexo'
```

`git grep`'s ERE does NOT honour `\s`, and the one legitimate assignment is TAB-indented inside the
`Makefile`'s `back-stg` recipe. So the pattern matched nothing and reported a clean sweep WITHOUT
HAVING LOOKED. Measured directly afterwards: the `\s` form exits 1 finding nothing, while

```sh
git grep -n -E '^[[:space:]]*SALES_ENV_FILE=' -- . ':(exclude)nexo'
```

exits 0 and finds `Makefile:56`, which is the expected and only hit.

Nothing was actually leaked - the corrected pattern confirms exactly one assignment, and it is the
mandated one. But the check had been passing for the wrong reason, which is the same failure mode as
an oracle that certifies nothing. The wave-2 verifier found it by re-running the check rather than
trusting the pattern it was handed, and wave 3 uses the corrected form.

Worth keeping because it generalises: a grep-based gate that reports "clean" is indistinguishable
from a grep-based gate that is broken, unless something proves it can still find a known hit.

## Blockers and parks during execution

(none yet)
