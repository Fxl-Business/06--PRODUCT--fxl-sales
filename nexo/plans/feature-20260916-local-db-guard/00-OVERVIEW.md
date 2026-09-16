---
feature: feature-20260916-local-db-guard
milestone: v4.1.0
---

# Local database guard plus the named env-file opt-in

## Frame - what and why

### The measured fact, not a hypothesis

Verified on this machine on 2026-09-16. `apps/api/.env` carried, as an ACTIVE and uncommented
value, a `DATABASE_URL` pointing at `fxl-db-server:5432/fxl_sales_stg_db` with a write credential.
That host RESOLVES and RESPONDS here over Tailscale (`100.81.240.91`, port 5432 accepting).
`make back`, `make migrate` and `make db-reset` therefore ran against the STAGING database, with
nothing on screen saying so.

`make db-reset` was the worst of the three: it drops the local docker volume, which is harmless,
and then chains `$(MAKE) migrate`, which used that same `DATABASE_URL` and applied DDL to staging.

The credential has already been moved by hand to `apps/api/.env.staging` (gitignored) and `.env`
now points at `localhost:5006`. That is the incident cleanup. THIS RUN IS THE MECHANISM that
stops the next occurrence.

### The aggravating factor that shapes the design

`apps/api/src/db/migrate.ts` uses `import 'dotenv/config'` and reads `process.env.DATABASE_URL`
RAW. It never passes through `apps/api/src/env.ts`. A guard placed only in the env schema would
therefore NOT cover the path that applies DDL, which is exactly the dangerous path. Covering
`migrate.ts` is the central requirement of this feature and must not be simplified away.

### Acceptance criteria for the feature

1. `pnpm run type-check` and `pnpm run lint` are green.
2. `pnpm run test` is green with the local database up, including `no-legacy-auth` and
   `no-legacy-env-names`.
3. `pnpm --filter @fxl-sales/api db:migrate` with a REMOTE `DATABASE_URL` and no named env file
   REFUSES, naming the host it found, proven by the process EXIT CODE and not by the message text.
   This is the central acceptance criterion of the delivery.
4. In every `NODE_ENV !== 'production'`, boot prints exactly one line naming the database HOST and
   PORT it is about to use, and never a user, a password or the whole URL.
   The `NODE_ENV !== 'production'` qualifier is the human's own wording in the brief and is
   therefore part of the criterion, not a narrowing of it. An earlier revision of this file dropped
   the qualifier; the plan-check caught the disagreement between the two, and this line is the
   correction. The line is host-and-port only, so it would be safe in a production log too - it is
   simply not asked for there.
5. No tracked file gained a credential, a remote database URL or a secret.
6. `git status --porcelain` shows no local `.env` and no `.env.staging`.

## Decisions already taken by the human - not reopened

1. The named opt-in variable is `SALES_ENV_FILE`. It mirrors the Hub's `HUB_ENV_FILE`. One name
   per repository, no alias, no fleet-wide name. The standardization is in the PATTERN, not in the
   string.
2. The ONLY escape hatch from the guard is the named file. No `ALLOW_REMOTE`, no command-line flag.
   Two exits for one rule is divergence.
3. Local hosts are exactly `localhost`, `127.0.0.1`, `::1` and `db`. The last is the docker compose
   service name and must pass.
4. The guard is PURE, exported, returns a `string[]` of readable violations, and is invoked ONLY
   from entrypoints. Never at module load time, and in particular never in the body of
   `apps/api/src/env.ts`: that module is imported by tests, and an assertion there would make the
   whole suite environment-dependent.
5. A `DATABASE_URL` that does not parse is NOT a violation of this guard. It answers one question
   only: is the host local.
6. The guard must cover `apps/api/src/db/migrate.ts`.
7. `SALES_ENV_FILE` does NOT go into `no-legacy-env-names.mjs`. It is a NEW name, not a retired
   one, and that guard has a single purpose.

## Absolute prohibitions binding every agent on this run

- NEVER connect, migrate, seed, read or write to any database other than this repository's local
  Postgres (`docker compose`, host `localhost`, port `5006`, database `fxl_sales`).
- NEVER use the host `fxl-db-server` or any host on the tailnet `tail89bca3.ts.net`. It answers.
  A command fired at it reaches real staging data.
- NEVER set `SALES_ENV_FILE` in any command, script, test or file.
- NEVER read, copy, move or quote the contents of `apps/api/.env.staging`. It holds a live
  credential. It exists, it is gitignored, and it is not the subject of this run.
- NEVER run `make db-reset` before slice 02 is green.
- NEVER write a real credential, a remote database URL or a secret into a tracked file.
  `.env.*.example` files carry the SHAPE only.
- NEVER edit `apps/api/.env` or `apps/web/.env`. Both are local, gitignored and already corrected.
- NEVER reintroduce a retired variable name.
- If a step appears to require staging or production, stop the slice, record it in `AUDIT.md`,
  and move on. Do not improvise.

## Out of scope

- Any change to the CONTENTS of `apps/api/.env` or `apps/web/.env`.
- Introducing a fake identity mode. Sales is Hub-only locally and stays that way.
- Any `@fxl-business/hub-sdk` version bump.
- Anything in the Hub or Finance repositories.

## Slices

| # | id | wave | acceptance |
| --- | --- | --- | --- |
| 01 | `env-file-resolution` | 1 | `SALES_ENV_FILE` resolves against `apps/api`, loads LAST with override, throws when unreadable; `env.ts` and `migrate.ts` share one resolver |
| 02 | `local-database-guard` | 2 | remote host without a named file refuses at BOTH entrypoints by exit code; boot names host and port |
| 03 | `staging-make-targets` | 2 | `make stg` / `back-stg` / `front-stg` exist, `migrate-stg` does not, `db-reset` announces its host |
| 04 | `structural-guard` | 3 | a tracked `node --test` guard fails if either entrypoint stops invoking the guard or `migrate.ts` regains raw `dotenv/config` |

## The one ordering decision the agent took

The human's brief numbers the guard as Fatia 1 and the named opt-in as Fatia 2. The EXECUTION
order here is inverted: `env-file-resolution` lands first, `local-database-guard` second.

The reason is in the brief itself - the guard consumes `namedEnvFile`, and that value does not
exist until the resolver does. Building the guard first would mean writing both call sites against
a `null` literal and rewriting them one slice later, which is a call site written twice and a slice
boundary that Gate 2 cannot grade honestly. The composite end state is byte-identical either way.
Nothing about the WHAT changed; only the order in which two already-approved pieces land.
