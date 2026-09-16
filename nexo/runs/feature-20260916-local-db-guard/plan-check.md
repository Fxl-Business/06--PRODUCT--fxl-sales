# Plan check - feature-20260916-local-db-guard

Adversarial read of `00-OVERVIEW.md` and slices 01-04 against the real tree at `b789ea8`.
Read-only. No database touched, no `SALES_ENV_FILE` set, no `make` target that acts, and
`apps/api/.env.staging` never opened.

**VERDICT: FAIL** - one BLOCKER in slice 02 (section B). The remedy is four lines and is spelled out
below verbatim; everything else is SHOULD-FIX or NOTE.

---

## A. Does the set hit the goal?

### A1. The goal is hit on the dangerous path - NOTE (positive finding)

The stated goal is "a local process can no longer silently write to the staging database, and there
is a named, deliberate opt-in". The four entrypoints that can reach Postgres from a developer
machine were enumerated and checked against the real tree:

| entrypoint | reaches DB how | covered? |
| --- | --- | --- |
| `make back` -> `pnpm --filter @fxl-sales/api dev` -> `tsx src/server.ts` | `createAppAuthBff()` at module top level reaches `getAdminDb()` | YES, slice 02 call site 1 |
| `pnpm --filter @fxl-sales/api start` -> `node dist/server.js` | same | YES, same call site |
| `make migrate` -> `pnpm ... db:migrate` -> `tsx src/db/migrate.ts` | `runDatabaseMigrations` | YES, slice 02 call site 2 |
| `make db-reset` | `docker compose down db -v` then `$(MAKE) migrate` (Makefile:88) | YES, transitively via `migrate`, plus slice 03's announcement |

The central requirement (cover `migrate.ts`, which today is `import 'dotenv/config'` + raw
`process.env.DATABASE_URL`, verified verbatim in `apps/api/src/db/migrate.ts`) is met by slice 01
(shared loader) + slice 02 (guard) + slice 04 (structural pin). Good.

### A2. MISSING: `drizzle.config.ts` is an uncovered fifth door - SHOULD-FIX

`apps/api/drizzle.config.ts` is, verbatim:

```ts
import 'dotenv/config';
...
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5006/fxl_sales',
  },
```

`pnpm --filter @fxl-sales/api db:studio` (and `drizzle-kit push`, should anyone add the script)
connects through that file, bypassing both `env.ts` and `migrate.ts` and therefore bypassing the
guard entirely. Slice 01 explicitly parks it ("Leave `apps/api/drizzle.config.ts` ... alone"), which
is a defensible scope call - `db:studio` is read-mostly and there is no `make` target for it - but
nothing in the plan set RECORDS the residual gap. Slice 04's structural guard also does not pin it,
so a future `db:push` script would inherit an unguarded path with a green suite over it.

Recommendation: one line in the run's `AUDIT.md` or `nexo/ROADMAP.md` naming `drizzle.config.ts` as
the known-uncovered door. Do not expand scope mid-run.

### A3. `apps/api/test/rls/setup-env.ts` - NOTE, correctly out of scope

Both slice 01 and the repo's own `CLAUDE.md` state that `setup-env.ts` hard-overrides
`DATABASE_URL` at the local test database. That is the integration suite's own protection and the
plans correctly leave it alone.

### A4. Nothing present that was not asked for - NOTE

Checked against the overview's "Decisions already taken" and "Out of scope". No `ALLOW_REMOTE`, no
CLI flag, no second escape hatch, no fake identity mode, no SDK bump, no Hub/Finance change. Slice
03's `apps/web/.env.staging.example` and slice 01's `apps/api/.env.staging.example` are not named in
the overview's slice table but are direct consequences of `make front-stg` / `make back-stg` reading
gitignored files, and both are shape-only. Acceptable.

### A5. Acceptance criterion 4 is narrowed by slice 02 without saying so - SHOULD-FIX

Overview AC4: "Boot prints **exactly one line** naming the database HOST and PORT it is about to
use". Slice 02 gates BOTH boot lines on `NODE_ENV !== 'production'`:

```ts
if (env.NODE_ENV !== 'production') { ... console.log(`[fxl-sales-api] database host=...`) }
```

and in `migrate.ts` `if (nodeEnv !== 'production')`. So in production there is NO line. That is a
deliberate-looking narrowing of a feature-level acceptance criterion that the plan never states as a
decision. A Gate-2 verifier grading AC4 literally will mark it unmet. Either drop the production
gate (the line carries host and port only, which is safe in any log - that is the whole design of
`describeDatabaseTarget`) or amend AC4 in the overview. Do not let the executor decide.

---

## B. The known cross-slice disagreement - BLOCKER

### B1. What slice 01 actually lands

From `01-env-file-resolution.md` section 1:

> ### Path: `apps/api/src/config/env-files.ts`

Real module path: **`apps/api/src/config/env-files.ts`** (imported as `./config/env-files.js` from
`src/`, `../config/env-files.js` from `src/db/`).

Its exports, verbatim from the plan's "Exact content to write":

```ts
export const API_ROOT_DIR = resolve(import.meta.dirname, '../..');
export const NAMED_ENV_FILE_VAR = 'SALES_ENV_FILE';
export type EnvBag = Record<string, string | undefined>;
export interface LoadEnvFilesOptions { baseDir: string; bag: EnvBag; }
export interface LoadedEnvFiles { namedEnvFile: string | null; }
export function resolveNamedEnvFilePath(bag: EnvBag, baseDir: string): string | null
export function loadEnvFiles({ baseDir, bag }: LoadEnvFilesOptions): LoadedEnvFiles
```

**There is no export named `resolvedNamedEnvFile`, and there is no module named `env-file.js`
(singular) anywhere in the plan set or the tree.**

### B2. Module-level export, return value, or both? BOTH - but from two DIFFERENT modules

- From `config/env-files.ts` the named-file path is available **only as a return value**:
  `loadEnvFiles(...)` returns `{ namedEnvFile: string | null }`. Nothing in that module is a
  module-level binding holding the path.
- Slice 01 ALSO creates a module-level export, but in `env.ts`, not in `env-files.ts`. Section 2,
  "Replace it with exactly":

  ```ts
  export const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });
  ```

  and section 2's hard points say outright: *"`namedEnvFile` is EXPORTED ... That is what slice 02's
  `server.ts` call site will read"*.
- Slice 01 section 3 leaves `migrate.ts` **discarding** the return: *"The return value is
  **discarded** in this slice. Do not write `const { namedEnvFile } = loadEnvFiles(...)` here yet
  ... Slice 02 destructures it when it adds the guard call."*

So the two call sites are deliberately asymmetric: `server.ts` imports a value from `./env.js`;
`migrate.ts` destructures a call it already makes. Slice 02's placeholder (`import
{ resolvedNamedEnvFile } from '../env-file.js'`, identical shape at both sites) is wrong in **path,
symbol, AND mechanism**, at both sites.

### B3. What slice 02 says, quoted

> `nexo/plans/feature-20260916-local-db-guard/01-env-file-resolution.md` did not exist yet. ...
> Throughout this plan that value is written as `resolvedNamedEnvFile` imported from
> `'../env-file.js'` (from `src/db/`) / `'./env-file.js'` (from `src/`). **Substitute the real names;
> change nothing else.**

"Change nothing else" is the defect. At `migrate.ts` the mechanism must change too, and slice 02's
own verbatim "Becomes" block **contains no `loadEnvFiles` call at all**:

```ts
import { resolvedNamedEnvFile } from '../env-file.js'; // slice 01 - CONFIRM the real symbol/path
import { assertLocalDatabase, describeDatabaseTarget } from './local-database-guard.js';
import { runDatabaseMigrations } from './migration-runner.js';
```

An executor who obeys "change nothing else" and merely substitutes names writes
`import { namedEnvFile } from '../config/env-files.js'` - which does not exist and IS caught by
`tsc` - **or**, worse, deletes slice 01's `loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });`
statement while replacing the file wholesale. That second outcome **type-checks and lints cleanly**
and silently regresses slice 01: `.env` is never loaded on the migrate path, `process.env.DATABASE_URL`
is undefined, and `make migrate` dies with `DATABASE_URL is required` on every developer machine.
Only the manual step 5 of slice 02's §6 catches it.

Slice 02 does carry a correcting paragraph 200 lines later ("if slice 01 landed a function that must
be CALLED, call it as the first statement of this file and take `resolvedNamedEnvFile` from its
return"), but it contradicts the verbatim block it follows, and a FAST executor reads the block.
**BLOCKER.**

### B4. The exact lines slice 02's executor must write

**Call site 1 - `apps/api/src/server.ts`.** The existing line 4 is `import { env } from './env.js';`.
Change it to:

```ts
import { env, namedEnvFile } from './env.js';
```

Do **not** add an import from `./config/env-files.js` here and do **not** call `loadEnvFiles` a
second time - `env.js` already ran it at module evaluation, and a second call would re-run `dotenv`.
Add, at the end of the import block:

```ts
import { assertLocalDatabase, describeDatabaseTarget } from './db/local-database-guard.js';
```

The guard expression becomes (shorthand property, since the binding is already named right):

```ts
const databaseViolations = assertLocalDatabase({
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  namedEnvFile,
});
```

**Call site 2 - `apps/api/src/db/migrate.ts`.** Slice 01 leaves the first statement as
`loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });`. Slice 02 **destructures that same
statement** and adds nothing new for env resolution:

```ts
import { API_ROOT_DIR, loadEnvFiles } from '../config/env-files.js';
import { assertLocalDatabase, describeDatabaseTarget } from './local-database-guard.js';
import { runDatabaseMigrations } from './migration-runner.js';

const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });
```

then, unchanged from slice 02's sketch except for the property:

```ts
const databaseViolations = assertLocalDatabase({
  nodeEnv,
  databaseUrl: url,
  namedEnvFile,
});
```

`const nodeEnv = process.env.NODE_ENV ?? 'development'` and `const url = process.env.DATABASE_URL`
MUST sit **after** the `loadEnvFiles` line - `dotenv` populates `process.env` inside that call, so
reading either before it yields the pre-dotenv values. Slice 02's §"The ordering" already states
this ("Env resolution first"); it is restated here because the sketch's statement order is what an
executor copies.

---

## C. `depends_on` and `files_modified`

### C1. `depends_on` is sane - NOTE

`01: []`, `02: [01]`, `03: [01]`, `04: [02]`. That derives waves 1 / {2,3} / 4 exactly as stated.
`04` needs `01`'s dotenv removal too, but reaches it transitively through `02`. Slice 03's edge on
`01` is semantic only (the `SALES_ENV_FILE` literal in `back-stg` has to MEAN something); no file is
shared. Harmless, and it correctly keeps `03` out of wave 1 where the literal would be a lie.

### C2. No wave-2 overlap - NOTE (confirmed)

- Slice 02: `apps/api/src/db/local-database-guard.ts`, `apps/api/src/db/__tests__/local-database-guard.test.ts`,
  `apps/api/src/db/migrate.ts`, `apps/api/src/server.ts`.
- Slice 03: `Makefile`, `apps/web/.env.staging.example`.

Disjoint. Slice 03 §0 states the collision explicitly and §4 forbids creating
`apps/api/.env.staging.example` (slice 01 owns it - and slice 01 does declare it). Cross-wave,
`migrate.ts` is shared between 01 and 02, but they are sequential waves, which is exactly the
ordering rationale in the overview's last section.

### C3. Every file each BODY touches is declared - NOTE (confirmed)

- **01**: body touches `env-files.ts`, its test, the `.fixture`, `env.ts`, `migrate.ts`,
  `.env.staging.example`, `.env.example`, `.env.dev.example` - all eight declared. It explicitly
  forbids touching `.gitignore`, `README.md`, `CLAUDE.md`, `env-example-contract.test.ts`,
  `no-legacy-env-names.mjs`, `drizzle.config.ts`, `test/rls/*`. Clean.
- **02**: body touches exactly its four declared files. Note it DOES edit `server.ts`'s existing
  `import { env } from './env.js'` line (see B4) - `server.ts` is declared, so no hazard.
- **03**: body touches exactly `Makefile` and `apps/web/.env.staging.example`; §1.4 argues at length
  for leaving `.gitignore` out, and `git check-ignore` output pasted in the plan matches this
  checkout (`.gitignore:13:**/.env.staging`). Clean.
- **04**: body touches exactly `scripts/__tests__/local-database-guard.test.mjs` and the root
  `package.json` `scripts.test`. Clean.

---

## D. Is every `acceptance` testable as written?

### D1. Slice 01 - testable, with one grep-only arm - NOTE

Runnable: `pnpm --filter @fxl-sales/api test`. The four commissioned cases are named tests in
`apps/api/src/config/__tests__/env-files.test.ts`, and the path is inside the unit include glob -
confirmed against `apps/api/vitest.config.ts`: `include: ['src/**/__tests__/**/*.test.ts']`. The
depth pin `expect(API_ROOT_DIR).toBe(resolve(HERE, '../../..'))` is a genuine assertion (see E1).

The clause "migrate.ts no longer carrying a bare `import 'dotenv/config'`" has **no committed
assertion in slice 01** - it is verified by `grep -n dotenv apps/api/src/db/migrate.ts` until slice
04 lands the structural pin. Acceptable given the wave ordering; the verifier should run the grep.

### D2. Slice 02 - the migrate arm is testable, the SERVER arm has no command - SHOULD-FIX

Acceptance says "when `pnpm --filter @fxl-sales/api db:migrate` **or `node dist/server.js`** boots,
then the process ... exits with code 1". §6 gives the migrate command with the exit-code oracle:

```
DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"
```

There is **no command anywhere in slice 02 or 04 that exercises the `server.ts` arm**. It is worth
adding, and it is safe and cheap:

```
pnpm --filter @fxl-sales/api build && \
  DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js; echo "exit=$?"
```

Expect non-zero and the three `[local-database-guard]` lines. It is safe for the same reason the
migrate one is: `.invalid` is RFC 6761 reserved, and the guard is a string comparison that runs
before any socket. Without it, one of the two call sites in the feature's headline acceptance is
never actually exercised in this run - only its presence is pinned, by slice 04's text match.

### D3. Slice 03 - fully testable, and honest about its thin oracle - NOTE

V1-V8 are all runnable with `make help` / `make -n` / `grep` / `git check-ignore`. §1.3's claim that
nothing in the repo reads the `Makefile` was re-checked and holds. §1.4's `git check-ignore` output
reproduces on this checkout. The plan states plainly what cannot be asserted (that `make stg`
dispatches, that `back-stg` really boots staging) instead of faking an oracle - correct.

One weakness: **V5's grep is not discriminating.** `make -n db-reset | grep -E '://|@[a-zA-Z0-9.-]+:[0-9]+'`
already returns exit 1 on the UNCHANGED Makefile (measured on this checkout, GNU Make 3.81). It
proves the new line leaks nothing, but it would also pass if the line were never added. Pair it with
the plan's own `grep -c "db-reset: migrations will target host" Makefile` == 1 (§7 already names
this) so the pair is non-vacuous.

### D4. Slice 04 - testable, with a count oracle - NOTE

`node --test scripts/__tests__/local-database-guard.test.mjs; echo "exit=$?"` plus the `pass 10`
count. The count is correct: 5 inspection tests (`exist/readable`, `identity`, `server invokes`,
`migrate invokes`, `no raw dotenv`) + 5 fixture tests (positive control, 3 mutations, missing file).
A fixture-mode run reports 5, which is exactly the tripwire §"Anticipated problems" #4 relies on.

---

## E. The specific hazards

### E1. The `dist/` depth trap - HANDLED, and PINNED. NOTE

Real code today, `apps/api/src/env.ts:9`:

```ts
const baseDir = resolve(import.meta.dirname, '..');
```

Slice 01 gets the new depth right and argues it from the config rather than by assertion - and the
config agrees: `apps/api/tsconfig.json` has `"rootDir": "./src"`, `"outDir": "./dist"`,
`"include": ["src/**/*"]`, so `dist/config/env-files.js` mirrors `src/config/env-files.ts` and both
sit two levels below `apps/api`. The plan writes `resolve(import.meta.dirname, '../..')` and states
outright: *"Do not copy `'..'` across from `env.ts`."*

It IS pinned, by `it('points at apps/api when handed API_ROOT_DIR, in this tree and in dist')`:

```ts
expect(API_ROOT_DIR).toBe(resolve(HERE, '../../..'));
```

`HERE` is `apps/api/src/config/__tests__`, so the expectation is `apps/api`. A copied `'..'` yields
`apps/api/src` and the test goes red. Decisive mutation confirmed by hand. Also correct that
`tsc-alias` only rewrites `@/*` specifiers and cannot touch an `import.meta.dirname` computation.

### E2. `[::1]` bracket stripping - HANDLED, and pinned by its OWN named test. NOTE

Measured on this machine:

```
new URL('postgresql://u:p@[::1]:5432/x').hostname === '[::1]'   // brackets present
```

Slice 02 strips them:

```ts
const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
```

and pins it **twice**: inside the `it.each(localHostCases)` roster, and by the standalone
`it('accepts the bracketed IPv6 loopback form that new URL() produces')` (test 7). The loop itself
cannot go vacuous because test 1 (`covers exactly the four local hosts, and no more`) asserts
`localHostCases.map((c) => c.hostLabel)` deep-equals `['localhost','127.0.0.1','::1','db']`. This is
the strongest-designed part of the set.

Also verified: `new URL('postgresql://u:p@db:5432/x').hostname === 'db'` (the compose service name
really does survive WHATWG parsing), and an omitted port yields `''`, which the plan maps to
`'5432'` - the port the driver will actually dial.

### E3. Slice 04 loads at MODULE SCOPE - HANDLED, with a belt-and-braces layer. NOTE

The two `readFileSync` calls are at true module scope, outside every callback, wrapped in
`try/catch` into a `loadError` binding, and the FIRST registered test asserts `loadError === null`.
So a rename/move/delete is a REPORTED FAILING TEST rather than an import-time throw whose exit
semantics one has to trust. The `missing-server` fixture test is the live proof that this path
really exits non-zero. The plan's rule #1 in the frontmatter says this explicitly. Correct.

### E4. `FXL_LOCAL_DB_GUARD_ROOT` recursion and the positive control - HANDLED. NOTE

Termination: the child is spawned with `env: { ...process.env, [FIXTURE_ROOT_VAR]: dir }`, and the
whole spawn block is inside `if (!IS_FIXTURE_RUN)`. A child therefore registers only the 5
inspection tests and cannot spawn a grandchild. Depth is exactly 2. Correct.

Positive control: `test('an unmutated fixture passes (positive control)')` asserts `result.status === 0`
on a byte copy of the real sources. Without it three "it went red" assertions would pass under a
harness that reddens everything. Present and correctly reasoned.

Second non-vacuity layer: `withoutCall` asserts `mutated !== source`, so a mutation that removed
nothing fails loudly. Verified against slice 02's landed shape - the call is written
`const databaseViolations = assertLocalDatabase({` on ONE line at both sites, so the line filter
removes exactly one line, and the import line (`import { assertLocalDatabase, describeDatabaseTarget }
from ...`) does NOT match `\bassertLocalDatabase\s*\(` because the next character is a comma. So the
mutated fixture still satisfies `NAMED_IMPORT` and fails only on `CALL`, which is the precise
regression being proven.

One residual: slice 02's sketch could equally have been written with the object argument on the
following line; if the executor reflows it, `withoutCall` removes nothing and §"Anticipated problems"
#3 fires. Flagged there already. Keep the call's opening paren on the same line as the symbol.

### E5. Slice 03's `db-reset` announcement - HANDLED on all four counts. NOTE

- **Leak into `make -n`?** No. Verified the recipe text is `$`-free, so make expands nothing and
  prints the literal `node -e '...'` script, which contains only `"apps/api/.env"`,
  `"DATABASE_URL="` and `u.hostname`/`u.port`. `u.username` / `u.password` are never referenced.
- **Leak into normal output?** No. The only `console.log` is
  `"db-reset: migrations will target host "+host` where `host = u.hostname+":"+(u.port||"5432")`.
- **New dependency?** No. `node` is already a hard requirement of every target in this Makefile, and
  `fs` / `URL` are core. Note for the executor: `node -e` defaults to CommonJS (the root
  `package.json` has no `"type"` field anyway), so `require("fs")` is fine on Node 20 and 22.
- **Breaks on a fresh clone with no `apps/api/.env`?** No. `readFileSync` throws inside the
  `try`, the `catch` sets `host = "(unknown - DATABASE_URL unreadable or unparseable)"`, and the
  target continues. Exit status unaffected.
- The stated gap (the announcement does not consult `SALES_ENV_FILE`, so a hand-exported one could
  make it name the wrong host) is disclosed in §2.4 AND required to be written into the Makefile
  comment. Correct: the announcement is advisory, the enforcement is slice 02's exit code.
- Quoting is safe: the script is single-quoted and contains zero apostrophes.

Measured on this checkout for the record: `make -n db-reset` today prints five lines, the last being
`pnpm --filter @fxl-sales/api db:migrate` (GNU make runs the `$(MAKE)` line recursively even under
`-n`), and the V5 grep already exits 1 - see D3.

### E6. `SALES_ENV_FILE` set anywhere other than the Makefile literal? NO - but slice 03 states a repo-wide claim that slice 01 falsifies. SHOULD-FIX

Every occurrence across the four plans was enumerated. The only **assignment that reaches a
process** is `Makefile` `back-stg`:

```make
	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

which is the human's mandated literal. Everything else is either a `printf` label
(`"  1) api     (SALES_ENV_FILE=.env.staging)\n"` in the `stg` menu - a string, not an assignment),
prose, or a `#`-prefixed COMMENT inside `.env.example`, `.env.dev.example` and
`.env.staging.example`. Slice 01 §6 explicitly forbids a live `SALES_ENV_FILE=` line in the two
examples and gives the reason (they are copied verbatim to `apps/api/.env`). Correct.

The defect is slice 03's rule, which reads:

> "NEVER set `SALES_ENV_FILE` ... **It appears exactly once in the repo**: as a literal inside the
> `back-stg` recipe."

That is false the moment slice 01 lands (three example files carry it in comments, and the `stg`
menu's own `printf` is a fourth occurrence in the Makefile itself). Slice 03's own V8
(`grep -c 'SALES_ENV_FILE' Makefile` == 1) is ALSO wrong for the same reason: with the `stg` menu's
`printf` label, the count is **2**, not 1. A verifier running V8 as written will report a FAIL on a
correct implementation.

Fix: reword the rule to "appears exactly once as an ASSIGNMENT", and change V8 to
`grep -c 'SALES_ENV_FILE=\.env\.staging pnpm' Makefile` == 1, or accept 2 and say why.

### E7. Real staging host / credential in a tracked file? NO. NOTE

`fxl-db-server` and `tail89bca3.ts.net` appear ONLY inside `nexo/plans/**` prose (the overview's
incident record and the slices' prohibitions) - never in a source file, a fixture, a test, a
`.env.*.example` or a command. Every remote fixture is `db.example.invalid` (RFC 6761 `.invalid`,
guaranteed unresolvable) with the throwaway literal `u:p` or `guard:guard`. Slice 01's
`.env.staging.example` ships every host/URL/credential field BLANK. Slice 03's
`apps/web/.env.staging.example` sets only `VITE_FXL_HUB_ENVIRONMENT=staging` and
`VITE_FXL_HUB_AUDIENCE=app.fxl-sales`, both already committed verbatim in
`apps/web/.env.example`. Clean.

`nexo/` is outside `scripts/no-legacy-env-names.mjs`'s pathspec, and that guard bans neither of these
strings anyway (it bans three retired variable names, decoded and checked).

### E8. Guard at module load / suite environment-dependence - HANDLED for the guard; ONE new module-load throw in `env.ts`. SHOULD-FIX (disclose)

The guard itself: `assertLocalDatabase` is called from exactly `server.ts` and `migrate.ts`. Neither
is imported by any test - `grep -rn "server.js'" apps/api/src apps/api/test` returns nothing, and
`migrate.ts` is a `tsx` entrypoint. `env.ts` gains **no** guard call; slice 02 states this three
times and slice 01's rules repeat it. Good.

But slice 01 DOES put a new throw at `env.ts` module scope: `loadEnvFiles` calls `assertReadable`
and throws when `SALES_ENV_FILE` names an unreadable path. `env.ts` is imported by the unit suite
(via `config/auth-provider.ts`, `middleware/app-auth.ts`, `db/client.ts`, ...). So a developer who
has `SALES_ENV_FILE` exported in their shell will have `pnpm test` either (a) throw at module load if
the file is unreadable, or (b) silently load staging Hub values on top of `test/unit-setup.ts`'s
blanking. This is intrinsic to the design the human chose (the variable is the opt-in), and it is
narrow - it requires the operator to have exported it. It is NOT recorded anywhere in the plan set,
though, and `apps/api/test/unit-setup.ts` blanks six Hub names precisely because this class of leak
was hit before. Record it in `AUDIT.md`, or have `unit-setup.ts` blank `SALES_ENV_FILE` too - but
that is a slice-01 scope decision, not an executor's.

### E9. Does slice 01's documentation choice keep `env-example-contract.test.ts` green? YES - re-derived independently. NOTE

I re-derived this against the real assertions in
`apps/api/src/config/__tests__/env-example-contract.test.ts` rather than taking the plan's word:

1. **Vacuity guard** - `parseEnvExample` skips any line whose trimmed form `startsWith('#')`. Every
   line of slice 01's appended block, including `#   SALES_ENV_FILE=.env.staging pnpm --filter
   @fxl-sales/api db:migrate`, starts with `#`. So the bag is unchanged. Measured today:
   `.env.example` has 20 set keys and `.env.dev.example` 21, both `> 10`, and
   `CORS_ORIGIN=http://localhost:8006` is line 4 / line 10 respectively. Both assertions survive.
2. **`hubConfigIsAbsent` / `tryLoadHubAuthConfig`** - read only `FXL_HUB_CONFIG` plus the identity
   five. The block sets nothing. Survives.
3. **`documentedIdentity`** - `new RegExp('^# FXL_HUB_API_URL=(.+)$','m')` and the two siblings. The
   appended block contains no line of the form `# FXL_HUB_<KEY>=`, so no new match can shadow the
   existing ones (`# FXL_HUB_API_URL=http://localhost:9016` is line 36 of `.env.example` today) and
   nothing is removed. Survives.
4. **`still SHOWS the known-good local values, commented`** - raw `toContain` on three exact
   strings, untouched. Survives.
5. **The `DOC_BLOCKS` half** (`README.md`, `CLAUDE.md` fenced ```dotenv blocks) - slice 01 explicitly
   forbids touching either file. Survives.
6. **`EXAMPLES` tuple** is `['.env.example', '.env.dev.example']`; slice 01's new
   `apps/api/.env.staging.example` is correctly kept OUT of it, and the stated reason checks out -
   that file ships `CORS_ORIGIN=` blank, which would fail the vacuity guard's
   `expect(bag.CORS_ORIGIN).toBe('http://localhost:8006')` and the redirect assertion.

Insertion points also verified against the real files: `.env.example` has no `ADMIN_DATABASE_URL`
line (the block goes after `DATABASE_URL=...` on line 7, as the plan says), and `.env.dev.example`
does (line 21, as the plan says). The plan's derivation is accurate.

One adjacent check the plan does not make, done here: `scripts/no-legacy-env-names.mjs` greps with
`-w -i`, and the retired session name is a strict SUFFIX of `FXL_HUB_SESSION_ENCRYPTION_KEY`, which
slice 01's `.env.staging.example` comment mentions. `-w` refuses the longer name, so the new file
does NOT trip that gate. `.env.staging.example` is also not matched by any `.gitignore` pattern
(`.env.staging` is an exact-name pattern), so it will be tracked as intended.

### E10. Does the shared resolver transitively import `env.ts` or run zod? NO. NOTE

`apps/api/src/config/env-files.ts`'s complete import list, from slice 01's verbatim content:

```ts
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
```

Three imports, all leaves. No `../env.js`, no `zod`, no `./auth-provider.js`, no `@fxl-business/hub-sdk`.
So slice 02's stated protection - "`migrate.ts` must NOT import `apps/api/src/env.ts`; its zod schema
would `process.exit(1)` on unrelated Hub configuration" - survives slice 01's change intact, and
`migrate.ts`'s `process.env.NODE_ENV ?? 'development'` read stays correct. (It must, however, be read
AFTER `loadEnvFiles` runs - see B4.)

---

## F. Anything else that would make a FAST executor decide

### F1. Slice 02's test sketch declares an UNUSED `LOCAL_URL` - SHOULD-FIX

```ts
const REMOTE_URL = 'postgresql://u:p@db.example.invalid:5432/fxl_sales';
const LOCAL_URL = 'postgresql://u:p@localhost:5006/fxl_sales';
```

None of the sixteen enumerated assertions references `LOCAL_URL` - the local cases all go through
`localHostCases`. `apps/api/eslint.config.js` sets
`'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]`, and `pnpm lint` in
`apps/api` is `eslint src/`, which covers `src/**/__tests__/`. So the sketch as written **fails lint
on its first run** and the executor must decide whether to delete the constant or invent a use for
it. Delete it.

### F2. `describeDatabaseTarget` ships with no unit coverage - SHOULD-FIX

It is exported and it produces the boot line that satisfies overview AC4, yet slice 02 explicitly
tells the executor NOT to import it into the test ("`noUnusedLocals: true`: do not import
`describeDatabaseTarget` into the test unless it is asserted"). The port-defaulting branch
(`parsed.port === '' ? '5432' : parsed.port`) and the bracket-stripping branch are therefore pinned
only indirectly. Two assertions would close it:

```ts
expect(describeDatabaseTarget('postgresql://u:p@localhost/x')).toEqual({ host: 'localhost', port: '5432' });
expect(describeDatabaseTarget('postgresql://u:p@[::1]:5006/x')).toEqual({ host: '::1', port: '5006' });
```

### F3. Slice 02's `server.ts` guard placement vs. `createAppAuthBff()` - NOTE, plan is right

Verified in the real `apps/api/src/server.ts`: `const app = new Hono();` is line 23 and
`const authBff = createAppAuthBff();` is line 31. Inserting the guard immediately before line 23 is
genuinely the earliest executable point of the module body and is unambiguously ahead of the BFF
construction, `setupNightlyJob()` (line ~/end) and `serve(...)`. The plan's claim that
`createAppAuthBff()` reaches `getAdminDb()` synchronously is the right reason to place it there.

### F4. Import-style choice at `server.ts` - NOTE

B4 folds `namedEnvFile` into the existing `import { env } from './env.js'`. A second
`import { namedEnvFile } from './env.js';` statement would also work (no `no-duplicate-imports` rule
is configured), but one line is cleaner and slice 04's structural regexes are indifferent. Say which
so the executor does not deliberate.

### F5. Slice 03's `make help` column width - NOTE, no action

`help` uses `%-15s`; the longest new target is `front-stg` (9 chars). The grep
`^[a-zA-Z_-]+:.*?## ` matches `stg:`, `front-stg: ...## ` and `back-stg: build-shared ## ` - hyphens
are in the class. Verified against the real line 113-114. No `help` change needed, as the plan says.

### F6. GNU Make 3.81 - NOTE

This machine runs the Apple-bundled GNU Make 3.81, not 4.x. Nothing in slice 03 uses a 4.x-only
feature (no `.ONESHELL`, no `$(file ...)`, no `!=`). The `.PHONY` continuation style and the
`@read choice; \ case ... esac` idiom are copied from the existing `dev` target, which works today.
No action.

### F7. Slice 04's fixture keys are POSIX-relative paths - NOTE

`makeFixture` uses `path.join(dir, relative)` with `relative` = `'apps/api/src/server.ts'`. Fine on
darwin and ubuntu; the plan already dismisses Windows correctly.

---

## Summary of items

| # | Section | Grade | Item |
| --- | --- | --- | --- |
| 1 | B | **BLOCKER** | Slice 02's verbatim `migrate.ts`/`server.ts` blocks import a non-existent `resolvedNamedEnvFile` from a non-existent `env-file.js`, and the migrate block DROPS slice 01's `loadEnvFiles(...)` call - a silent regression that type-checks. Exact replacement lines given in B4. |
| 2 | A2 | SHOULD-FIX | `apps/api/drizzle.config.ts` (`db:studio`) is an uncovered fifth door; record it rather than expanding scope. |
| 3 | A5 | SHOULD-FIX | Both boot lines are gated on `NODE_ENV !== 'production'`, narrowing overview AC4 without saying so. Decide, do not let the executor. |
| 4 | D2 | SHOULD-FIX | Acceptance names `node dist/server.js` but no slice supplies a command exercising the server arm's refusal. |
| 5 | E6 | SHOULD-FIX | Slice 03's "appears exactly once in the repo" is false after slice 01, and its V8 (`grep -c 'SALES_ENV_FILE' Makefile` == 1) will read **2** because of the `stg` menu's own `printf` label. |
| 6 | E8 | SHOULD-FIX | Slice 01 adds a module-load THROW to `env.ts` reachable from the unit suite when a developer has `SALES_ENV_FILE` exported. Disclose or blank it in `unit-setup.ts`. |
| 7 | F1 | SHOULD-FIX | Slice 02's test sketch declares an unused `LOCAL_URL`; `no-unused-vars` is an ERROR and `eslint src/` lints `__tests__`. |
| 8 | F2 | SHOULD-FIX | `describeDatabaseTarget` ships untested despite producing the AC4 line. |
| 9 | D3 | NOTE | Slice 03's V5 grep already passes on the unchanged Makefile; pair it with the `grep -c "db-reset: migrations will target host"` check. |
| 10 | E1-E5, E7, E9, E10, C, F3-F7 | NOTE | Verified handled. The depth pin, the `[::1]` pin, the module-scope load, the recursion cut-off, the positive control and the `.env`-example contract derivation are all correct as written. |
