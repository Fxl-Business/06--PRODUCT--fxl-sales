# Verify 01 - env-file-resolution (Gate 2, fast per-slice tier)

Branch under test: `feat/01-env-file-resolution`, base `master`.
Diff read with `git diff master...feat/01-env-file-resolution -- . ':(exclude)nexo'`.
No file under `nexo/runs/` was read.

## Commands and real output

### 1. `pnpm --filter @fxl-sales/api test`

```
 Test Files  45 passed (45)
      Tests  454 passed (454)
   Duration  1.67s
```

Named files confirmed green by name in the run output:

```
 ✓ src/config/__tests__/env-files.test.ts (9 tests) 5ms
 ✓ src/config/__tests__/env-example-contract.test.ts (17 tests) 9ms
```

### 2. `pnpm --filter @fxl-sales/api lint`

```
> eslint src/
EXIT=0
```

### 3. `pnpm --filter @fxl-sales/api type-check`

```
> tsc --noEmit
EXIT=0
```

### 4. `pnpm --filter @fxl-sales/api build`

```
> tsc && tsc-alias
EXIT=0
```

### Extra: the legacy-env-name guard

```
$ node scripts/no-legacy-env-names.mjs
LEGACY-ENV-GUARD OK
```

## Property checks

### A. The depth trap - PASS

Source: `apps/api/src/config/env-files.ts:31`

```ts
export const API_ROOT_DIR = resolve(import.meta.dirname, '../..');
```

`src/config/env-files.ts` is two directories below `apps/api`, so `'../..'` is correct.

The pin is `points at apps/api when handed API_ROOT_DIR, in this tree and in dist`, which asserts
`expect(API_ROOT_DIR).toBe(resolve(HERE, '../../..'))` where `HERE` is `src/config/__tests__`.
That is an independently written expression, not a restatement of the implementation, so it is
decisive. Proven rather than reasoned: I mutated `'../..'` to `'..'`, ran the suite, and got

```
 FAIL  src/config/__tests__/env-files.test.ts > resolveNamedEnvFilePath > points at apps/api when handed API_ROOT_DIR, in this tree and in dist
Expected: ".../apps/api"
Received: ".../apps/api/src"
 Test Files  1 failed | 44 passed (45)
```

The mutation was reverted immediately; `git diff --stat -- apps/api/src/config/env-files.ts` is
empty afterwards.

Same answer from `dist/` after the build:

```
$ node -e "import('./dist/config/env-files.js').then(m=>console.log(m.API_ROOT_DIR))"
/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api
```

which equals `apps/api`. `dist/config/env-files.js` mirrors `src/config/env-files.ts`, so the
depth is identical in both trees.

### B. Four named resolution cases plus the throw - PASS

All five are separate, non-vacuous assertions in
`apps/api/src/config/__tests__/env-files.test.ts`, every one driven through the exported
`resolveNamedEnvFilePath` / `loadEnvFiles` with an INJECTED `bag`. The file never writes
`SALES_ENV_FILE` into `process.env`, not even via `vi.stubEnv`.

- absent -> null: `resolveNamedEnvFilePath({}, HERE)` is `null`; a second test also pins `''` and
  `'   '` to `null`.
- relative -> resolved against base: `{ SALES_ENV_FILE: '.env.staging' }` with baseDir
  `/srv/apps/api` is `'/srv/apps/api/.env.staging'`. Literal expected value, not recomputed.
- absolute -> unchanged: `'/etc/fxl/sales.env'` against the same baseDir is `'/etc/fxl/sales.env'`.
- unreadable -> THROWS quoting the resolved path: `.toThrow(missing)` where `missing` is the
  absolute `resolve(HERE, 'fixtures/there-is-no-such-file.fixture')`. A second test pins the
  refusal wording (`/deliberately/i`), i.e. that it is a refusal rather than a fallback.
- Plus a positive case: the named file loads LAST with override (fixture marker reaches
  `process.env`) and exactly one `[env] named env file loaded: <path>` line is printed, with a
  dedicated filter so dotenv's own banner is not being graded.

Implementation matches: readability is asserted BEFORE any `config()` call, so the refusal leaves
`process.env` untouched.

### C. `migrate.ts` - PASS

```
$ grep -n dotenv apps/api/src/db/migrate.ts
4:// NOT `import 'dotenv/config'`. That read `.env` from the CWD, never saw
```

The only surviving occurrence of the string `dotenv` is inside a comment. The bare
`import 'dotenv/config'` is gone and replaced by
`loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });` imported from
`../config/env-files.js`.

### D. Prohibitions - PASS

- `git grep -nE 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91' -- . ':(exclude)nexo'` returns
  nothing (exit 1). The only tracked hits anywhere are pre-existing `nexo/` plan, run and knowledge
  documents, none of them touched by this diff.
- No credential, remote database URL or secret in any file in the diff. The only URLs added are
  the blank-valued example keys and the local `localhost` defaults already present on `master`.
- `apps/api/.env.staging.example` read in full (74 lines). Every value is blank except
  `NODE_ENV=production` (line 25) and `PORT=3006` (line 26), which are shape, not credentials.
  `DATABASE_URL=`, `ADMIN_DATABASE_URL=`, all five Hub identity names, the three operational names,
  the three `SALES_*` names, `PUBLIC_LINK_BASE_URL=`, `SENTRY_DSN=`, `RESEND_API_KEY=`,
  `RESEND_FROM=` are all empty. I state this explicitly: the file carries SHAPE ONLY.
- `SALES_ENV_FILE` appears in the two `.env` examples only inside `#` comment lines
  (`.env.dev.example:23,27,31`, `.env.example:9,13,17`) and in `.env.staging.example:12,20`.
  `git grep -nE '^[[:space:]]*SALES_ENV_FILE=' -- . ':(exclude)nexo'` returns NOTHING - there is no
  live assignment anywhere in the tree.
- `scripts/no-legacy-env-names.mjs` is not in the diff (`--stat` for that path is empty).
- `apps/api/.env` and `apps/web/.env` are not in the diff; the only `.env*` paths touched are the
  three `.example` files. Both are confirmed gitignored (`.gitignore:4`).
- `apps/api/src/env.ts` gained exactly one statement, the `loadEnvFiles` call (exported as
  `namedEnvFile` for slice 02 to consume). No guard, assertion or throw was added there, and the
  now-unused `config` / `resolve` imports were deleted, which is why lint stays green.

### E. `unit-setup.ts` blanking - PASS

`SALES_ENV_FILE` was appended to the existing `vi.stubEnv(name, '')` loop. The reasoning holds:

- `apps/api/vitest.config.ts` wires `setupFiles: ['./test/unit-setup.ts']` for the unit project,
  and vitest evaluates setup files BEFORE importing the test module. `env.ts` calls `loadEnvFiles`
  at module scope, and it is only imported transitively from a test module, so the blanking really
  does land first.
- `vi.stubEnv(name, '')` assigns the empty string (only `undefined` deletes), so the name is
  present-but-blank.
- `resolveNamedEnvFilePath` does `bag[NAME]?.trim()` and maps `''` to `null`, so blank reads as
  absent and no throw and no extra load can happen.

Empirically consistent: the whole suite is green on this machine with `SALES_ENV_FILE` unset, and
the mechanism is the same one already proven for the six Hub names.

### F. Regression - PASS

`src/config/__tests__/env-example-contract.test.ts` passed by name, 17 tests, in the step-1 run.
Confirmed from the output, not assumed. Adding `.env.staging.example` did not disturb it.

### G. Working tree - PASS

```
$ git status --porcelain
 M nexo/runs/feature-20260916-local-db-guard/budget.json
?? .vscode/
?? nexo/runs/feature-20260916-local-db-guard/agents/exec-01.result.json
?? nexo/runs/feature-20260916-local-db-guard/exec-01-notes.md
```

No `.env` and no `.env.staging`. Nothing under `apps/` is dirty.

## Verdict

**PASS**

Findings:

1. All four commands green: 454/454 tests, eslint clean, `tsc --noEmit` clean, build clean.
2. The depth pin is real and decisive - proven by mutation, not by reading the comment.
3. `dist/config/env-files.js` computes `API_ROOT_DIR` as `apps/api`, so the dist-depth maths is
   confirmed against the built artefact.
4. All five resolution behaviours are separate non-vacuous assertions driven through an injected
   bag; nothing in the suite exports `SALES_ENV_FILE`.
5. `migrate.ts` and `env.ts` now share the one resolver; the bare `dotenv/config` import is gone.
6. Every prohibition holds: no tailnet host, no credential, no remote URL, shape-only staging
   example, comment-only `SALES_ENV_FILE`, guard script untouched, local `.env` files untouched.

Non-blocking observations (no action required, recorded for the wave):

- `apps/api/.env.staging.example` carries two non-blank values, `NODE_ENV=production` and
  `PORT=3006`. Both are shape rather than secrets and match the pattern of the other example
  files, so this satisfies "blank or an obvious placeholder".
- The build left `apps/api/dist/` populated on disk; it is gitignored and did not appear in
  `git status`, but it was produced by this verification run.
