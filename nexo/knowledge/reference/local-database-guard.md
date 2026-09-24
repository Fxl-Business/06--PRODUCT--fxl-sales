# Local database guard - full reference

Moved verbatim from `CLAUDE.md` on 2026-09-22 so the standing context stays short.
`CLAUDE.md` keeps the rules; this file keeps the reasoning, history and oracle names.

This section exists because of a measured incident on 2026-09-16, not a hypothesis.
`apps/api/.env` carried an ACTIVE, uncommented `DATABASE_URL` pointing at the staging database with a write credential, over a Tailscale host that resolves and answers on a developer machine, so `make back`, `make migrate` and `make db-reset` all ran against STAGING with nothing on screen saying so.
`make db-reset` was the worst of the three, because it drops the local docker volume and then chains `$(MAKE) migrate`, which applied DDL to staging.
Everything below is the mechanism that stops the next occurrence, and every rule in it is load-bearing.

- There are exactly THREE guarded entrypoints, `apps/api/src/server.ts`, `apps/api/src/db/migrate.ts` and `apps/api/scripts/seed-dev.ts`, and the number three is deliberate rather than incidental.
  `migrate.ts` is the one that MATTERS most: it reads `process.env.DATABASE_URL` raw and never passes through `apps/api/src/env.ts`, so a check living in the zod schema would have missed exactly the path that applies DDL.
  A fourth call site is not free - the guard's value is that all three doors are provably guarded by `scripts/__tests__/local-database-guard.test.mjs`, and that test names those three paths - so adding one means adding its assertion in the same change.
  `apps/api/drizzle.config.ts` is a known UNGUARDED fourth door: it has its own `import 'dotenv/config'` and a `localhost:5006` fallback, so `db:studio` reaches a database without passing any of the three entrypoints.
  It is out of scope by decision (read-mostly, no `make` target) rather than by oversight, and it is recorded here so a future `db:push` script does not inherit an unguarded path with a green suite over it.
  `seed-dev.ts` is the THIRD entrypoint, added in v4.1.0: it seeds the dev-fake identity roster's orgs, and it DELETES rows before it inserts them, which makes it the second most dangerous door after `migrate.ts`.
  Unlike the other two it does NOT accept `SALES_ENV_FILE`: it calls the guard with `namedEnvFile` hard-coded to `null`, because seeding a shared database is never the right thing to do on purpose, so the escape hatch that lets `make back-stg` reach staging does not apply here at all.
- `apps/api/src/db/local-database-guard.ts` is PURE.
  It imports NOTHING, performs no I/O, and never reads `process.env`; every input arrives as an argument.
  That is what lets its unit test cover every branch with no database, no file and no ambient environment, and it is what keeps the module safe to import without making any importing test suite environment-dependent.
  The guard DECIDES and returns a `string[]` of violation lines; it does not print and it does not exit, and the two entrypoints do both.
- The local hosts are exactly `localhost`, `127.0.0.1`, `::1` and `db`, matched EXACTLY through a `Set`, with no suffix matching, no wildcard and no regex - `evil-localhost` is not local.
  `db` is the docker compose SERVICE NAME and must pass, because inside the compose network that is what the API resolves the database as.
  `::1` needs its bracket-stripping: `new URL('postgresql://u:p@[::1]:5432/x').hostname` yields `'[::1]'` with the brackets, which is the WHATWG serialization of an IPv6 literal and not a quirk of this code, and losing the strip breaks one of the four required hosts in the SAFE-looking direction, refusing an IPv6 loopback as remote.
- A `DATABASE_URL` that does NOT PARSE is NOT a violation, and this must not be "tightened".
  The guard answers ONE question: is the host local.
  Refusing an unparseable URL here would produce a second, worse-worded version of the error the caller already raises (`DATABASE_URL is required`) or that the driver raises on connect, and it would attach that failure to the wrong cause.
  A violation is returned only when all three hold together: `nodeEnv !== 'production'`, the host parses and is not local, and `namedEnvFile === null`.
- `SALES_ENV_FILE` is the ONLY escape hatch.
  There is no `ALLOW_REMOTE`, no CLI flag and no second variable, because two exits for one rule is divergence and the second one is always the one nobody remembers to guard.
  It is one name per repository, with no alias and no fleet-wide name, and it mirrors the Hub's `HUB_ENV_FILE`: the standardization is in the PATTERN, not in the string.
  It is typed by a human in front of a command, and it is deliberately not in the zod schema, because it is an operator input read before the schema exists rather than validated configuration.
  `apps/api/test/unit-setup.ts` blanks it alongside the six Hub credential names, so a developer who happens to export it in a shell cannot decide the unit suite.
- An unreadable named file THROWS, and it must never fall back to the default environment.
  The fallback IS the original bug: an operator who asked for another environment being quietly handed the LOCAL one - or, in the mirror case, believing they are local while they are not.
  Readability is checked BEFORE anything is loaded, so the refusal happens with `process.env` untouched; a half-loaded default environment plus a crash is worse to reason about than a crash.
- `apps/api/src/env.ts` and `apps/api/src/db/migrate.ts` share ONE resolver, `loadEnvFiles` in `apps/api/src/config/env-files.ts`, so the two cannot diverge again.
  It loads `.env`, then `.env.local` with override, then - only when the operator named one - that file LAST with override, and it returns `namedEnvFile`, which is the guard's third input.
  `migrate.ts` must NEVER regain a bare `import 'dotenv/config'`.
  That import read `.env` from the CWD, never saw `.env.local`, never saw a named file and never saw this ordering, so the one entrypoint that applies DDL reached a DIFFERENT environment from the API it migrates for.
  `API_ROOT_DIR` is `resolve(import.meta.dirname, '../..')` and not `'..'`, because the module sits two directories below `apps/api` in BOTH `src/` and `dist/`; it is the single place in the tree that knows that depth, and `env.ts` no longer computes its own.
  A real consequence of the merge, worth knowing: `db:migrate` now also reads `apps/api/.env.local`, which the old bare import ignored.
- `server.ts` statically imports ONLY `./env.js` and `./db/local-database-guard.js`, and loads everything else with `await import(...)`.
  This is NOT untidiness waiting to be cleaned up, and converting it back to plain static imports is exactly the change someone will make.
  ESM evaluates the ENTIRE static import graph before the first statement of the module body runs, and `./middleware/app-auth.js` loads the Hub configuration at its own module top level and throws there.
  With a static import list the guard's lines were NEVER printed - the first server run died on `HubConfigError` with the guard's verdict buried under an unrelated module-load failure, and any future module-scope database work anywhere in that graph would beat it the same way.
  The two static imports are both pure with respect to the database, the dynamic imports keep the original ORDER and the original binding names because module top-level side effects run in that order, and the body is byte-identical from `const app = new Hono();` onward.
  The ordering oracle is that a remote `DATABASE_URL` produces the three `[local-database-guard]` lines and exit 1 with `HubConfigError` never appearing at all, which is impossible with a static import list.
  One accepted consequence: `server.ts` is now an async module, which is inert while nothing imports it.
- Each guarded entrypoint prints exactly ONE boot line naming HOST and PORT, gated on `NODE_ENV !== 'production'`.
  Its ABSENCE is what made the staging write invisible, and `describeDatabaseTarget` can only ever return `{host, port}` - never the user, the password, the database name or the whole URL - so the line is safe in any log and there is no second interpolation site to audit.
- `make stg`, `make back-stg` and `make front-stg` are the named staging entrypoints, and `make migrate-stg` DELIBERATELY DOES NOT EXIST.
  Applying DDL to staging is a DEPLOY step, run by the deploy pipeline against the deploy's own credentials, not a target sitting one typo away from `make migrate` on a developer's machine.
  `back-stg` carries the ONLY `SALES_ENV_FILE` assignment in the tracked tree; nothing else may set it.
  `db-reset` prints the host `migrate` is about to receive, before anything is destroyed.
  That line is an ANNOUNCEMENT and not a guard - the enforcement is in `migrate.ts` and refuses by exit code - and it too is host and port only.
- `scripts/__tests__/local-database-guard.test.mjs` is what makes all of the above IRREMOVABLE, and it runs on every `pnpm run test`.
  It asks three questions about two named paths - does `server.ts` still invoke `assertLocalDatabase`, does `migrate.ts`, and did `migrate.ts` regain a raw `dotenv/config` - and it reads those two files rather than shelling out to `git grep`, because a repo-wide grep would pass with the call sitting in some third irrelevant file and would not notice either file being renamed away.
  It proves itself by re-spawning against mutated fixture trees and asserting a NON-ZERO exit, never a message.
  `runAgainst` strips every `NODE_TEST_`-prefixed key from the child env FOR A REASON: `node --test` sets `NODE_TEST_CONTEXT` in each test file's process, and spreading it into the grandchild makes node warn `run() is being called recursively within a test file`, run ZERO TESTS and exit `0`, so all four negative cases pass while proving nothing.
  The positive control does not catch that, because a vacuous child exits 0 and that is precisely what the positive control asserts; the four negatives are what catch it.
  A real run reports `# pass 17` and a fixture-mode run reports 8, so the count is itself a tripwire.
- `SALES_ENV_FILE` is deliberately NOT in `scripts/no-legacy-env-names.mjs`.
  That guard has a single purpose, retired names, and this is a NEW name.
