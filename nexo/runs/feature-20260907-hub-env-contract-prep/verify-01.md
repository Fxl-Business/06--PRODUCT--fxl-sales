# Verify - slice 01, `01-local-session-ikm-rename`

Branch `feat/01-local-session-ikm-rename`, one commit ahead of `master` (`288a0fc`).
Reviewed with `git diff master...feat/01-local-session-ikm-rename`.
Nothing merged, pushed or amended. Every probe below was applied to the working tree and then reverted; the tree is byte-clean against the commit at the end of this run.

**Verdict: PASS.** All seven acceptance criteria pass. No defect found. Three observations are recorded at the end, none of which is a defect.

**Disclosure.** The brief forbade reading `exec-01-notes.md`. That file is part of the committed diff, so its text arrived unavoidably in the first `git diff`. `context-pack.md` was never opened. To neutralise the contamination, every probe in this report was designed and executed independently and every number quoted here is from a command run in this session, not from the implementer's table. Where my result differs from theirs it is stated.

## Criterion 1 - semantics byte-for-byte unchanged: **PASS**

### 1a. `emptyToUndefined` retained - PASS

`apps/api/src/env.ts:58`

```
  SALES_SESSION_ENCRYPTION_IKM: emptyToUndefined,
```

`emptyToUndefined` at `apps/api/src/env.ts:17-20` is unchanged by this diff:

```
const emptyToUndefined = z.preprocess(
  (v) => (typeof v === 'string' && v === '' ? undefined : v),
  z.string().optional(),
);
```

The floor it protects is real and still 32: `apps/api/src/auth/session-crypto.ts:35` `const MIN_IKM_LENGTH = 32;` and `:54` `if (ikm.length < MIN_IKM_LENGTH) { throw ... }`. The diff to `env.ts` changes the key name and the comment only; the validator is the same object as before.

### 1b. Read off the validated `env`, never `process.env` - PASS

The single production read is `env.SALES_SESSION_ENCRYPTION_IKM`. `git grep -n -i -- 'SESSION_ENCRYPTION' -- apps packages scripts` returns no `process.env.SALES_SESSION_ENCRYPTION_IKM` in any non-test file. The only `process.env` mentions of the name are inside the new test (`app-auth-bff-wiring.test.ts:291/294/312/314`), which must manipulate the raw environment to express "absent", and one doc comment at `app-auth-bff-wiring.test.ts:18` describing the historical bug.

### 1c. Exactly ONE read site - PASS

```
$ git grep -n 'SALES_SESSION_ENCRYPTION_IKM' -- apps packages scripts | grep -v __tests__ | grep -v '\.env'
apps/api/src/auth/session-crypto.ts:6,11,14   (comments)
apps/api/src/env.ts:54 (comment), :58 (declaration)
apps/api/src/middleware/app-auth.ts:248,259 (comments), :261 (THE READ)
scripts/no-legacy-env-names.mjs:24 (the replacement string in the guard's message)
```

`apps/api/src/middleware/app-auth.ts:261`:

```
    encryptionIkm: env.SALES_SESSION_ENCRYPTION_IKM ?? hubAuthConfig.clientSecret,
```

That is the only expression in the tree that reads the value. Everything else is a comment, the zod declaration, or the guard's own replacement label.

### 1d. Absent means HKDF from the Hub client secret - PASS

Proven behaviourally, not by reading the `??`. See criterion 4: with the key genuinely deleted from `process.env`, the real `createAppAuthBff()` hands the sealer `sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789`, which is the test's `HUB_CLIENT_SECRET`.

## Criterion 2 - no occurrence of the old name where it matters: **PASS**

Word-boundary grep across the entire tracked tree:

```
$ git grep -n -i -w -- 'HUB_SESSION_ENCRYPTION_KEY' -- .
```

22 files match. Every one is under `nexo/` except a single line in `CLAUDE.md:108`, which is the sanctioned prose record. Zero matches under `apps/`, `packages/` or `scripts/`.

A plain SUBSTRING grep (to catch a prefixed variant the `-w` search would miss) across `apps packages scripts` returns 7 hits, and every one is the SDK's canonical `FXL_HUB_SESSION_ENCRYPTION_KEY` appearing inside an explanatory comment about the distinction:

```
apps/api/.env.dev.example:57       apps/api/.env.example:43
apps/api/src/auth/session-crypto.ts:19
apps/api/src/env.ts:54             apps/api/src/middleware/app-auth.ts:256
scripts/__tests__/no-legacy-env-names.test.mjs:96
scripts/no-legacy-env-names.mjs:38
```

Those are references to a DIFFERENT variable and are correct.

Both API example files carry the new name only:
- `apps/api/.env.dev.example:61` `SALES_SESSION_ENCRYPTION_IKM=`
- `apps/api/.env.example:47` `SALES_SESSION_ENCRYPTION_IKM=`

Note a scope deviation, benign and in the right direction: the variable did not previously exist in `apps/api/.env.example` at all (the diff shows a pure `+` block there, no `-`). It was ADDED blank with the same comment, so the two example files now agree. That is an improvement, not a defect.

Deployment-facing files were swept independently. `.github/workflows/ci.yml`, `apps/api/Dockerfile`, `docker-compose.yml`, `vercel.json`, `apps/web/.env.example` and `apps/web/.env.dev.example` contain no `ENCRYPTION` reference at all, so no CI or container file tells an operator to set either name.

## Criterion 3 - blank-value boot oracle survives: **PASS**

`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:269-275`:

```
  it('boots with the blank SALES_SESSION_ENCRYPTION_IKM that .env.dev.example ships', () => {
    expect(encryptionIkm).toBe(HUB_CLIENT_SECRET);
    expect(authBff).not.toBeNull();
  });
```

Retitled only. Both assertions are byte-identical to the pre-rename version in the diff. The stub that feeds it is still `vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '')` at `:126`, which is exactly what `.env.dev.example` ships. `authBff` comes from the `beforeAll`, which calls the REAL `appAuth.createAppAuthBff()` (`:173`) - confirmed independently by the mutation stack trace below, which names `Module.createAppAuthBff src/middleware/app-auth.ts:244` in the frame list, so no stub stands between the test and the production function.

## Criterion 4 - the new oracle exists and is NON-VACUOUS: **PASS**

Test present at `app-auth-bff-wiring.test.ts:289`, titled exactly `falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM is absent`. It deletes the key from `process.env` outright (rather than stubbing it blank, which would only re-test the blank path), `vi.resetModules()`, re-imports `../app-auth.js`, calls the real `createAppAuthBff()`, asserts the captured `encryptionIkm` equals `HUB_CLIENT_SECRET`, and restores every shared capture variable and the env key in a `finally`.

**Baseline**, before any mutation:

```
$ CI=true npx vitest run src/middleware/__tests__/app-auth-bff-wiring.test.ts
 ✓ src/middleware/__tests__/app-auth-bff-wiring.test.ts (23 tests) 44ms
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

**Mutation A - the literal mutation the brief asked for.** Replaced line 261 with `encryptionIkm: env.SALES_SESSION_ENCRYPTION_IKM as string,` (the `??` removed outright):

```
 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts
TypeError: Cannot read properties of undefined (reading 'length')
 ❯ createSessionSealer src/auth/session-crypto.ts:54:11
 ❯ Module.createHubSessionStore src/auth/hub-session-store.ts:434:17
 ❯ Module.createAppAuthBff src/middleware/app-auth.ts:244:19
 Test Files  1 failed (1)
      Tests  23 skipped (23)
```

RED, so the criterion is met. But it is a blunt red: the throw lands in `beforeAll`, so the file fails as a suite and all 23 tests report skipped rather than the new one reporting failed. That does not distinguish the new oracle from the file's other 22 tests.

**Mutation B - my own sharper mutation**, designed to leave the BLANK path intact and break ONLY the ABSENT path, so that the new oracle is isolated:

```
    encryptionIkm:
      env.SALES_SESSION_ENCRYPTION_IKM ??
      (process.env.SALES_SESSION_ENCRYPTION_IKM !== undefined
        ? hubAuthConfig.clientSecret
        : 'MUTANT-ikm-value-0123456789abcdefghij'),
```

```
 FAIL  ... > createAppAuthBff wiring > falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM is absent
AssertionError: expected 'MUTANT-ikm-value-0123456789abcdefghij' to be 'sk_fxl-sales_development_unit-test-on...'
Expected: "sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789"
Received: "MUTANT-ikm-value-0123456789abcdefghij"
 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:307:29
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

Exactly ONE of 23 red, and it is the new oracle. The blank-value oracle stayed green, proving the two tests really do cover different inputs to the same `??` rather than one covering for the other. `app-auth.ts` restored from backup afterwards; `git diff --quiet` confirmed clean.

## Criterion 5 - `scripts/no-legacy-env-names.mjs` exists, is wired in, and works: **PASS**

Wired into the root `test` script (`package.json`), both the guard and its own oracle file:

```
pnpm run build:packages && pnpm -r --if-present test
  && node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs
  && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs
  && node scripts/build-contract.mjs
```

Its own oracle file passes standalone: `node --test scripts/__tests__/no-legacy-env-names.test.mjs` gives `# tests 5 / # pass 5 / # fail 0`. Those 5 build REAL throwaway git repositories and stage them, so `git` is never mocked.

**Planting probe, on this repository.** I planted `apps/api/src/verify-probe-planted.ts` containing `export const x = process.env.HUB_SESSION_ENCRYPTION_KEY;` (spelled from character codes so this report's own text stays greppable):

```
=== PROBE 1: planted under apps/, UNSTAGED ===
unstaged_exit=0     <- confirms the brief's warning: git grep reads the INDEX
=== PROBE 2: same file, STAGED ===
Retired env name found. Use SALES_SESSION_ENCRYPTION_IKM instead:
apps/api/src/verify-probe-planted.ts:1:export const x = process.env.HUB_SESSION_ENCRYPTION_KEY;
staged_exit=1
=== after git rm ===
after_cleanup_exit=0
```

The guard works, and the index caveat is confirmed empirically.

**Ban target, both directions** (each planted staged under `apps/`, then removed):

| Direction | Planted | Guard exit | Required |
| --- | --- | --- | --- |
| A - must NOT match the NEW name | `SALES_SESSION_ENCRYPTION_IKM=` | 0 | 0 - PASS |
| B - must tolerate the SDK canonical name | `FXL_HUB_SESSION_ENCRYPTION_KEY=deadbeef` | 0 | 0 - PASS |
| C - must catch the retired name | probe above | 1 | nonzero - PASS |

So the ban is neither permanently red nor permanently green. Direction B is the subtle one and the guard handles it correctly: the retired name is a strict SUFFIX of the SDK's canonical name, and the guard uses `git grep -w`. `_` is a word character, so the `FXL_HUB_` prefix defeats the word boundary and the SDK's real name passes, while the retired name still matches everywhere it stands alone (`env.X`, `X=`, `stubEnv('X', ...)`). A plain substring ban would have made slice 03 impossible without loosening the gate; this is right.

**Pathspec tolerance.** `PATHSPEC = ['.', ':(exclude)nexo', ':(exclude)CLAUDE.md']`. 22 tracked files name the retired term (all under `nexo/`, plus `CLAUDE.md:108`) and `node scripts/no-legacy-env-names.mjs` still exits 0 on the real repository - so the exclusion is doing real work and is not a grep that simply finds nothing. The guard's own oracle pins both exclusions independently (`passes when the retired env name appears only under nexo/`, `passes when the retired env name appears only in CLAUDE.md`).

**The guard cannot match itself.** `scripts/no-legacy-env-names.mjs` and its test are both tracked (`git ls-files --error-unmatch` succeeds for both), yet the guard exits 0 on this repository. Both spell the retired name via `String.fromCharCode(...)` and both write their explanatory comments so that no comment contains the literal - I checked the comment text directly, not just the exit code.

`node scripts/no-legacy-env-names.mjs` also correctly distinguishes git's exit codes: status 1 (no match) is the passing case, status above 1 is treated as git itself failing and exits 1 rather than reading as a clean gate. That is the right polarity.

## Criterion 6 - `CLAUDE.md` updated: **PASS**

Auth Model section, `CLAUDE.md:107-113`. The operative sentence now names `SALES_SESSION_ENCRYPTION_IKM`. The retired name appears exactly ONCE in the file under a word-boundary grep (`CLAUDE.md:108`), explicitly labelled as the prose record and explaining why `CLAUDE.md` and `nexo/` sit outside the guard's pathspec. The following lines state the SDK-collision reason, restate that the semantics did not change (`emptyToUndefined`, one read site, absent-means-HKDF), and carry the operator warning. The pre-existing `emptyToUndefined` / `??`-does-not-catch-`''` line survives intact underneath.

The one other textual occurrence in the file is inside `FXL_HUB_SESSION_ENCRYPTION_KEY`, which is the SDK's name and correct.

## Criterion 7 - full green: **PASS**

Every command run once, non-watching, in this session:

| Command | Exit | Evidence |
| --- | --- | --- |
| `pnpm run lint` | **0** | all four workspaces `Done` |
| `pnpm run type-check` | **0** | all four workspaces `Done` |
| `CI=true pnpm test` | **0** | shared-utils 3 files, api 42 files, web 56 files, node `# pass 8 / # fail 0` |
| `node scripts/no-legacy-auth.mjs` | **0** | silent |
| `node scripts/no-legacy-env-names.mjs` | **0** | silent |

## Independent adversarial checks

**Revert the single read to the old name; type-check must FAIL.** Applied `env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.clientSecret` at `app-auth.ts:261`:

```
$ pnpm run type-check
TYPECHECK_EXIT=2
apps/api type-check: src/middleware/app-auth.ts(261,24): error TS2339:
  Property 'HUB_SESSION_ENCRYPTION_KEY' does not exist on type
  '{ NODE_ENV: ...; PORT: number; ... 11 more ...; PUBLIC_LINK_BASE_URL?: string | undefined; }'
 ELIFECYCLE  Command failed with exit code 2.
```

FAILS as required. There is no compatibility alias, no residual optional key and no `[key: string]` escape hatch on the env schema. Restored, `git diff --quiet` clean.

**Ban target both directions.** Done above (criterion 5). Neither permanently red nor permanently green.

**Deployment-facing files.** Done above (criterion 2). Nothing outside `nexo/` and the `CLAUDE.md` prose line instructs an operator to set the old name.

**Conventions.** `LC_ALL=C grep` for U+2014 over the full `master...HEAD` diff returns nothing (exit 1). Per-file counts are 0 for `scripts/no-legacy-env-names.mjs`, its test, `app-auth.ts` and `CLAUDE.md`. The commit message carries no `Co-Authored-By` line and no agent attribution line; it is a Conventional Commit (`refactor(auth)!:`) with a `BREAKING CHANGE:` footer naming the operator action.

## Observations - none is a defect

1. **The blunt mutation is a suite-level red, not a test-level one.** Removing `?? hubAuthConfig.clientSecret` outright throws inside `beforeAll`, so all 23 tests report as skipped. The oracle is still non-vacuous (my Mutation B isolates it to exactly one failing test), but anyone re-running the brief's literal mutation should expect the coarse output and not read `23 skipped` as a pass.

2. **The absent-path test depends on the developer's untracked `apps/api/.env` not defining the variable.** `env.ts` re-runs `dotenv` on the module reload, so a value present in `.env` would be re-injected after the test's `delete`. I confirmed `apps/api/.env` contains no `ENCRYPTION` line and `.env.local` does not exist, so the test is genuinely testing the absent path here. Note the failure mode is safe: such a developer would get a false RED, never a false green.

3. **The guard matches with `-i` as well as `-w`.** Case-insensitivity is broader than strictly needed and is harmless. The `-w` boundary means a hypothetical prefixed variant (`VITE_HUB_SESSION_ENCRYPTION_KEY`) would slip past, but that is the same property that makes the SDK's canonical name pass, it is the intended trade, and no such name exists in the tree.

## OPERATOR-FACING CONSEQUENCE

This slice renames a DEPLOYMENT variable. Read this before the deploy, not after.

**What an operator must do.** Before the deploy that ships this commit, in BOTH staging and production (Coolify, and the Infisical `staging` / `prod` environments):

1. Check whether `HUB_SESSION_ENCRYPTION_KEY` currently carries a VALUE. Do not assume it is blank; confirm it.
2. If it carries a value, create `SALES_SESSION_ENCRYPTION_IKM` and set it to that value BYTE FOR BYTE. It is HKDF-SHA256 input keying material, so one differing character is a different derived key.
3. Deploy.
4. Only then delete `HUB_SESSION_ENCRYPTION_KEY`.

If it is blank or unset in an environment, there is nothing to carry: blank is the documented default, `emptyToUndefined` turns it into `undefined`, and the sealer falls back to HKDF from `FXL_HUB_CLIENT_SECRET` exactly as before. That is the expected state for this product today, but it must be CONFIRMED per environment.

**What happens if they do not.** The old name becomes inert the moment this commit deploys: nothing reads it. If it had carried a value, the sealer silently switches its IKM to `FXL_HUB_CLIENT_SECRET`, every row in `hub_bff_sessions` becomes undecryptable, and a decryption failure is deliberately treated as "unknown session". The blast radius is bounded and self-healing: every user is logged out ONCE and signs back in. It is not data loss and it is not an outage, but it is a visible mass logout, and it is silent - nothing logs a warning and no health check goes red.

**What CANNOT happen.** A blank value cannot stop the API booting, because `emptyToUndefined` still converts `''` to `undefined` before it reaches `createSessionSealer`'s 32-character floor. That was the original v2.4.0-era boot failure and its regression pin survives the rename intact (criterion 3).

**One thing to keep straight.** `SALES_SESSION_ENCRYPTION_IKM` is NOT `FXL_HUB_SESSION_ENCRYPTION_KEY`. The latter is the SDK 2.3.0 name for a required strict-hex 64-character key for a store this repo does not use. Putting one value in the other's slot is a boot failure at best. Keeping them one word apart is the entire point of this slice.
