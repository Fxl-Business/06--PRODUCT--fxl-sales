# Wave verify - `feature-20260907-hub-env-contract-prep`, integrated on `master`

- **Verdict: PASS**
- Verifier: a fresh agent, no exec notes and no context pack opened.
- Range: `5eeff1e..HEAD`, HEAD = `a70628d`.
- Working tree at start and at end: clean apart from the pre-existing untracked `.vscode/`.
- Nothing merged, pushed, tagged, amended or deployed. Every planted probe was removed and the tree re-verified clean.

## 1. Commits in the range

```
a70628d Merge branch 'feat/03-staged-sdk-230-adoption'
0fd5d37 docs(nexo): stage the hub-sdk 2.3.0 adoption and record the prep run
65ce35a Merge branch 'feat/02-local-post-login-rename'
bca655c refactor(auth)!: rename the post-login redirect pair off the Hub namespace
01a5753 Merge branch 'feat/01-local-session-ikm-rename'
288a0fc refactor(auth)!: rename HUB_SESSION_ENCRYPTION_KEY to SALES_SESSION_ENCRYPTION_IKM
a95865c Merge branch 'feat/00-guard-pathspec-fix'
09d32c0 fix(scripts): keep the legacy-auth guard off the append-only records
```

43 files changed, 2636 insertions, 52 deletions. Of those, 26 files are new and 23 of the 26 are under `nexo/`.
Source touched: `apps/api/src/env.ts`, `apps/api/src/config/auth-provider.ts`, `apps/api/src/auth/session-crypto.ts`,
`apps/api/src/middleware/app-auth.ts`, six `apps/api` test files, both `apps/api/.env*.example`,
`scripts/no-legacy-auth.mjs`, and three new files in `scripts/`.
**Zero files under `apps/web`, `packages/` or any migration directory were touched.**

## 2. Full verification tier - real commands, real exit codes, real numbers

### `pnpm run lint`

```
> fxl-sales@1.0.0 lint
> pnpm -r lint
Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types   Done
packages/shared-utils lint: no lint for shared-utils   Done
apps/api  lint$ eslint src/   Done
apps/web  lint$ eslint src/   Done
```

**exit 0.** No warnings emitted.

### `pnpm run type-check`

```
build:packages -> shared-types tsc --build --force, shared-utils tsc --build --force
packages/shared-types type-check$ tsc --noEmit   Done
packages/shared-utils type-check$ tsc --noEmit   Done
apps/api  type-check$ tsc --noEmit   Done
apps/web  type-check$ tsc --noEmit   Done
```

**exit 0.**

### `CI=true pnpm test`

**exit 0.**

| package | test files | tests | duration |
| --- | --- | --- | --- |
| `packages/shared-utils` | 3 passed (3) | 80 passed (80) | 184 ms |
| `apps/api` | 42 passed (42) | 428 passed (428) | 2.59 s |
| `apps/web` | 56 passed (56) | 784 passed (784) | 11.11 s |
| **total vitest** | **101 files** | **1292 tests** | |

`packages/shared-types` has no `test` script, so `--if-present` skips it.

The root script also runs, in order, after the vitest packages:

```
node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs
  1..11
  # tests 11   # pass 11   # fail 0   # cancelled 0   # skipped 0   # todo 0
  # duration_ms 904.437125
node scripts/no-legacy-auth.mjs        -> exit 0
node scripts/no-legacy-env-names.mjs   -> exit 0
node scripts/build-contract.mjs        -> build-contract: ok
```

Grand total for `pnpm test`: **1303 assertions across 103 files**, all green.
This is the check that was RED on `master` at `5eeff1e`; slice 00 is what makes it green, and it is green here on the integrated trunk.

### `pnpm run build` (a real build, not a type-check)

**exit 0.** `shared-types` and `shared-utils` `tsc --build --force`, `@fxl-sales/api` build, then the web Vite production build:

```
dist/assets/index-GDCgzJVC.js     262.79 kB | gzip:  66.43 kB
dist/assets/vendor-DdtIS_KG.js    417.55 kB | gzip: 128.83 kB
dist/assets/vendor-radix-...js     72.24 kB | gzip:  21.91 kB
dist/assets/vendor-query-...js     41.37 kB | gzip:  12.34 kB
✓ built in 2.28s
```

### The two guards, invoked standalone

```
node scripts/no-legacy-auth.mjs        -> AUTH_GUARD_EXIT=0
node scripts/no-legacy-env-names.mjs   -> ENV_GUARD_EXIT=0
```

### Integration suite - the DB was confirmed first

The brief forbids running it on an unconfirmed database. Both preconditions were checked before running anything:

```
$ docker ps
06--product--fxl-sales-db-1   0.0.0.0:5006->5432/tcp   Up 4 days (healthy)
$ nc -z -w 2 127.0.0.1 5006   -> succeeded
```

and the fall-through hazard was inspected rather than assumed. `apps/api/.env` really does point `DATABASE_URL` at
`postgresql://***@fxl-db-server:5432/fxl_sales_stg_db` (staging), but `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL`
and `ADMIN_DATABASE_URL` are all `postgresql://***@localhost:5006/fxl_sales`, and
`apps/api/test/rls/setup-env.ts` does `process.env.DATABASE_URL = appUrl` as a **hard override, not `??=`**. So the
first `??` in `setup-env.ts` resolves on `TEST_DATABASE_URL` and staging is unreachable from the suite.

```
$ CI=true pnpm --filter @fxl-sales/api test:integration
 Test Files  25 passed (25)
      Tests  169 passed (169)
   Duration  14.98s
INT_EXIT=0
```

Every invocation above was run-once. No watcher, no dev server, no background process was started, so none was left running.

## 3. Integration-level checks

### Check 1 - no retired name survives anywhere it matters: **PASS**

```
$ for N in HUB_SESSION_ENCRYPTION_KEY FXL_HUB_POST_LOGIN_REDIRECT FXL_HUB_POST_LOGIN_ERROR_REDIRECT; do
    git grep -n -w -i -- "$N" -- . ':(exclude)nexo' ':(exclude)CLAUDE.md'
  done
HUB_SESSION_ENCRYPTION_KEY          -> none outside nexo/ and CLAUDE.md
FXL_HUB_POST_LOGIN_REDIRECT         -> none outside nexo/ and CLAUDE.md
FXL_HUB_POST_LOGIN_ERROR_REDIRECT   -> none outside nexo/ and CLAUDE.md
```

The full unrestricted sweep was also run, and every hit is inside the two permitted records. The complete inventory of
files that *can* carry a name was enumerated from `git ls-files` rather than guessed, and each was covered:

| surface | result |
| --- | --- |
| `apps/**` | zero hits for all three |
| `packages/**` | zero hits for all three |
| `scripts/**` | zero hits (the guard itself spells the bans by `String.fromCharCode`, deliberately, so its own grep cannot find them) |
| `apps/api/.env.example`, `apps/api/.env.dev.example` | zero hits; both now carry `SALES_POST_LOGIN_REDIRECT=`, `SALES_POST_LOGIN_ERROR_REDIRECT=`, `SALES_SESSION_ENCRYPTION_IKM=` |
| `apps/web/.env.example`, `apps/web/.env.dev.example` | zero hits (none of the three is a web variable) |
| `apps/api/Dockerfile` | zero hits |
| `docker-compose.yml` | zero hits |
| `.github/workflows/ci.yml` | zero hits |
| `vercel.json` | zero hits |
| `nexo/**`, `CLAUDE.md` | hits present and **legitimate** - append-only delivery record and prose record, both excluded from both guards' pathspec by design |

Note, since it is easy to miss: `apps/api/.env.example` previously carried **no** session-sealer line at all.
Slice 01 did not merely rename it there, it added `SALES_SESSION_ENCRYPTION_IKM=` where the variable had been
undocumented. That is an improvement, and it means the two example files now agree.

### Check 2 - the three renames did not collide: **PASS**

`apps/api/src/env.ts` schema keys (final integrated set):

```
FXL_HUB_API_URL, FXL_HUB_CONFIG, FXL_HUB_ENVIRONMENT, FXL_HUB_CLIENT_ID, FXL_HUB_CLIENT_SECRET,
FXL_HUB_AUDIENCE, FXL_HUB_HEALTH_TOKEN, FXL_HUB_REDIRECT_URI,
SALES_POST_LOGIN_REDIRECT: emptyToUndefinedUrl        (env.ts:55)
SALES_POST_LOGIN_ERROR_REDIRECT: emptyToUndefinedUrl  (env.ts:56)
SALES_SESSION_ENCRYPTION_IKM: emptyToUndefined        (env.ts:63)
```

`HubEnvSource` (`auth-provider.ts`) projects exactly twelve keys, and `hubEnvBag` emits exactly the same twelve, in the
same spelling:

```
NODE_ENV, CORS_ORIGIN, FXL_HUB_CONFIG, FXL_HUB_API_URL, FXL_HUB_ENVIRONMENT, FXL_HUB_CLIENT_ID,
FXL_HUB_CLIENT_SECRET, FXL_HUB_AUDIENCE, FXL_HUB_HEALTH_TOKEN, FXL_HUB_REDIRECT_URI,
SALES_POST_LOGIN_REDIRECT, SALES_POST_LOGIN_ERROR_REDIRECT
```

The sorted-key assertion in `apps/api/src/config/__tests__/auth-provider.test.ts:188-203` lists those same twelve and
no others, with `SALES_POST_LOGIN_ERROR_REDIRECT` / `SALES_POST_LOGIN_REDIRECT` present and no `FXL_HUB_POST_LOGIN_*`
survivor. Because both sides are `.sort()`ed, the assertion is genuinely set-equality on the **final integrated** key
set, not an intermediate one - a leftover key on either side would fail it. It passes on the integrated trunk.

`SALES_SESSION_ENCRYPTION_IKM` is deliberately **not** in `HubEnvSource` or `hubEnvBag`, and never was under its old
name either: it is read straight off the validated `env` in `app-auth.ts`, because the SDK never sees it. That
asymmetry is intentional and unchanged by the rename.

Type-check exit 0 is the second half of this check: `HubEnvSource` is a `Pick<Env, ...>`, so a key that survived in
one file and not the other could not compile.

### Check 3 - `FXL_HUB_REDIRECT_URI` is byte-unchanged: **PASS**

```
$ git diff 5eeff1e..HEAD -- apps | grep -E '^[-+].*FXL_HUB_REDIRECT_URI'
+  // (FXL_HUB_REDIRECT_URI among them) belong to that namespace.
```

That is the **only** changed line in `apps/` that even mentions the name, and it is a comment in `env.ts` explaining
why the *neighbouring* pair was renamed and this one was not. There is no `-` line for it anywhere in the range.

`resolveHubRedirectUri` (`apps/api/src/middleware/app-auth.ts:133-145`) is untouched: the diff of that file contains
no `-`/`+` line inside the function, its `envBag.FXL_HUB_REDIRECT_URI` read, its non-production
`${webOrigin}/auth/callback` default and its production `throw` are all byte-identical to `5eeff1e`.
Both `.env` examples still carry `FXL_HUB_REDIRECT_URI=` with its original comment (`apps/api/.env.example:37`,
`apps/api/.env.dev.example:51`).

### Check 4 - both guards work together and neither is vacuous: **PASS**

Each retired name was written into `apps/api/src/wave-verify-probe.ts` and **staged**, because `git grep` reads the
index for a file the tree has just gained.

| planted | `no-legacy-env-names.mjs` | `no-legacy-auth.mjs` |
| --- | --- | --- |
| `HUB_SESSION_ENCRYPTION_KEY` | **exit 1** - `Retired env name found. Use SALES_SESSION_ENCRYPTION_IKM instead:` + `apps/api/src/wave-verify-probe.ts:1:...` | exit 0 |
| `FXL_HUB_POST_LOGIN_REDIRECT` | **exit 1** - `Retired env name found. Use SALES_POST_LOGIN_REDIRECT instead:` | exit 0 |
| `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` | **exit 1** - `Retired env name found. Use SALES_POST_LOGIN_ERROR_REDIRECT instead:` | exit 0 |

Each ban fired on its own name and produced **exactly one** message. The two post-login bans did not cross-fire in
either direction, which matters because they share the `FXL_HUB_POST_LOGIN_` prefix; the `ERROR` segment sits in the
middle, so neither name is a substring of the other.

The auth guard's own non-vacuity was proven too: a file staged containing the banned provider literal made
`no-legacy-auth.mjs` exit **1** printing `apps/api/src/wave-verify-probe.ts:1:...`, while `no-legacy-env-names.mjs`
stayed at 0. So neither guard is passing because it matches nothing.

False positives on the canonical nine - a single staged file naming all of
`FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`,
`FXL_HUB_REDIRECT_URI`, `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_SESSION_ENCRYPTION_KEY`, `FXL_HUB_TRUSTED_ORIGINS`:

```
env-guard  exit=0
auth-guard exit=0
```

This is the load-bearing case for the `-w` flag. The retired `HUB_SESSION_ENCRYPTION_KEY` is a strict **suffix** of
the canonical `FXL_HUB_SESSION_ENCRYPTION_KEY`; a substring ban would have rejected a name the repo will legitimately
need to mention once 2.3.0 lands. `-w` treats `_` as a word character, so the longer canonical name is spared while the
retired one is still caught wherever it stands alone. Verified above, not assumed.

After every probe: `git rm --cached`, `rm`, then `git status --porcelain` showing only the pre-existing `?? .vscode/`,
and both guards re-run at exit 0.

### Check 5 - no SDK version moved: **PASS**

```
apps/api/package.json:19:    "@fxl-business/hub-sdk": "2.2.0",
apps/web/package.json:16:    "@fxl-business/hub-sdk": "2.2.0",
```

Both exact, no caret, in both apps.

```
$ grep -n 'hub-sdk' pnpm-lock.yaml | sort -u
'@fxl-business/hub-sdk@2.2.0':
'@fxl-business/hub-sdk@2.2.0(hono@4.12.28)':
$ grep -n '2\.3\.0' pnpm-lock.yaml | grep -i hub
(no hub 2.3.0)
```

`pnpm-lock.yaml` is not in the diffstat at all, so no install ran and no resolution moved.
No `file:`, `link:` or `portal:` specifier exists in any workspace `package.json`. No vendored tarball, no `.d.ts`
augmentation and no shim file was added - the only new source files in the range are `scripts/no-legacy-env-names.mjs`
and the two `scripts/__tests__/*.test.mjs`, all three plain Node scripts with no SDK import. The SDK-dependent half is
staged as `nexo/plans/feature-20260907-hub-sdk-230-env-contract/00-OVERVIEW.md`, an unexecuted plan document, which is
exactly what the brief required.

### Check 6 - the session sealer's behaviour is intact end to end: **PASS**

Read off the code, not inferred:

- **Exactly one read site.** `git grep -n 'SALES_SESSION_ENCRYPTION_IKM' -- . ':(exclude)nexo'` returns one production
  read: `apps/api/src/middleware/app-auth.ts:268`

  ```ts
  encryptionIkm: env.SALES_SESSION_ENCRYPTION_IKM ?? hubAuthConfig.clientSecret,
  ```

  Everything else is the `env.ts` declaration, the `.env` examples, comments, `CLAUDE.md`, the guard's replacement
  string and test `stubEnv` calls.
- **Absent still means derive from the Hub client secret.** The `?? hubAuthConfig.clientSecret` is unchanged in shape
  from `5eeff1e`; only the left operand was renamed. `apps/api/src/auth/session-crypto.ts:5-14` documents the same
  thing, and `deriveSessionKey` is HKDF-SHA256 over that IKM with an unchanged salt
  (`fxl-sales/hub-bff-session/v1`), info (`aes-256-gcm`) and 32-byte output. **No salt, info, format version or
  derivation constant was touched**, so a session sealed before this change opens after it, provided the IKM value is
  carried across (see the operator risk below).
- **A blank value still becomes `undefined`.** `apps/api/src/env.ts:63` is `SALES_SESSION_ENCRYPTION_IKM: emptyToUndefined`,
  the same preprocessor the retired key used. This is the fix for the historical bug where a blank value stopped the
  API booting: `??` does not catch `''`, `createSessionSealer('')` throws its 32-character floor, and
  `createAppAuthBff()` runs at `server.ts` module top level. It is still pinned by a real oracle, retitled to the new
  name: `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:269`
  `boots with the blank SALES_SESSION_ENCRYPTION_IKM that .env.dev.example ships`, and the example file really does
  ship it blank (`apps/api/.env.dev.example:64`).
- **The fallback itself gained a new oracle**, which the old name never had:
  `app-auth-bff-wiring.test.ts:289` `falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM is absent`,
  which `delete`s the variable rather than blanking it. Both pass.
- Non-vacuity of the rename is recorded by the executing slice and is structurally guaranteed here: `env.ts` types
  `Env`, so reverting the read to the old key is a `TS2339` and `pnpm run type-check` (exit 0 above) could not pass.

## 4. Security review of `5eeff1e..HEAD`

| axis | finding |
| --- | --- |
| **Credential, secret or token value introduced** | **None.** A scan of every added line for `sk_`/`pk_`/`secret`/`token`/`password`/`api_key` followed by a quoted 8+ character literal returns nothing. Both `.env` examples ship every slot blank: `SALES_SESSION_ENCRYPTION_IKM=`, `SALES_POST_LOGIN_REDIRECT=`, `SALES_POST_LOGIN_ERROR_REDIRECT=`, and the pre-existing `FXL_HUB_CLIENT_SECRET=`, `FXL_HUB_HEALTH_TOKEN=`, `FXL_HUB_REDIRECT_URI=`, `FXL_HUB_CONFIG=`. The only tracked `.env*` files are the four `*.example` ones; `.gitignore:4-8` covers `.env`, `.env.local`, `.env.*.local`, `.env.test`, `**/.env.test`. Test files use obvious fixtures (`http://localhost:8006`, `https://sales.fxlbusiness.test`) and no credential. The new guard scripts embed only variable NAMES, by character code. |
| **Auth or entitlement gate weakened** | **None.** `git diff 5eeff1e..HEAD -- apps packages | grep -E '^[-+].*(requireHubAuth\|allowWithoutAccess\|entitlements\|requiredModule\|payment_required\|no_org_access\|forbidden\|401\|402\|403)'` returns **zero lines**. The single access gate is untouched: `requireHubAuth` with `allowWithoutAccess` at its default of `false` still is the whole gate, and no second gate, helper or bypass was added. `apps/api/src/middleware/app-auth.ts`'s only changes are the two post-login resolver renames and comments. |
| **Tenant scoping (`org_id`) touched** | **None.** `grep -E '^[-+].*(orgId\|org_id\|withTenant)'` over the `apps`/`packages` diff returns **zero lines**. No query, no RLS policy, no migration. |
| **Raw account or workspace id newly rendered in UI** | **None, structurally.** The range changes **zero files under `apps/web`** - `git diff --name-only 5eeff1e..HEAD -- apps/web packages` is empty. No user-facing string was added anywhere. |
| **New logging that could print a secret** | **None introduced by this range, but see the observation below.** The only added output statements are the four in `scripts/no-legacy-env-names.mjs`: `console.error(result.error.message)`, `process.stderr.write(result.stderr)`, the `Retired env name found. Use X instead:` header, and `process.stderr.write(result.stdout)`. No production code gained a log line. |

**Observation on the guard scripts, reported rather than buried.** `process.stderr.write(result.stdout)` prints raw
`git grep -n` output, which is the full matching **line**, not just the name. If a retired name ever reappeared in a
tracked file in the form `NAME=<value>`, the guard would echo that value into CI output. This is bounded and is not a
new exposure:

- it is the identical shape `scripts/no-legacy-auth.mjs` already had before this range, so the range introduces no new
  class of leak;
- `git grep` reads only tracked files, and no real `.env` is tracked - `.gitignore` covers them all;
- the only tracked `.env*` files are the four examples, which ship every secret slot blank;
- the guard only ever prints when it is already **failing**, i.e. when a retired name has come back somewhere it must
  not be - and that is itself the condition an operator must fix.

It is not a defect and I am not failing the wave on it. If it is ever tightened, the fix is one line: print
`result.stdout` with everything after the first `=` on a match line replaced.

I also confirmed the guards do not *weaken* anything: `no-legacy-auth.mjs`'s pathspec change (slice 00) excludes only
`nexo/` and `CLAUDE.md`. `apps/`, `packages/`, `scripts/`, every lockfile and every `.env` example remain inside the
gate, which is the whole of what "the removed auth provider was reintroduced" can mean, and the non-vacuity probe above
proves the gate still fires on `apps/`.

## 5. Conventions

**Em dash: one deviation, reported rather than waved through.**

```
$ git diff 5eeff1e..HEAD | grep '^+' | grep -c '—'
7
```

All seven are in a single file, `nexo/runs/feature-20260907-hub-env-contract-prep/context-pack.md`, and all seven are
in the Nexo tooling's **own generated boilerplate**, not in prose anybody wrote:

```
# Repo context pack — FACTS ONLY. No reasoning, no plan, no decisions.
# Execute/planner sub-agents only — NEVER the Verify agent.
Convention files detected (existence only — not content):
  scripts/ — 4 file(s)
  nexo/knowledge/ — 2 item(s)
  nexo/plans/ — 36 item(s)
  nexo/runs/ — 44 item(s)
```

The file header shows `# Generated: 2026-09-08T02:06:46Z`, so this is emitted by the context-pack generator rather than
authored. Added lines under `apps/`, `packages/` and `scripts/` contain **zero** em dashes, and so does every
hand-written `nexo/` document in the range. No product string, comment, commit message or plan carries one.

This is a real deviation from the standing convention and it is recorded here as such, but it is cosmetic, sits in a
tool-generated append-only artifact, and the correct fix is in the generator rather than in this feature's diff. It
does not affect the verdict.

**Commit attribution: clean.** All eight commits are authored `CauetPinciara <cauetpinciara@gmail.com>`. Grepping every
commit message body in the range for `co-authored-by`, `claude`, `generated with` and `Claude-Session` returns only
three ordinary prose mentions of the file name `CLAUDE.md` inside two commit bodies. **No `Co-Authored-By` trailer and
no agent attribution line exists anywhere in the range.**

The four `refactor(auth)!` / `fix(scripts)` / `docs(nexo)` commits are Conventional Commits, and the two `!` commits
carry a real `BREAKING CHANGE:` footer naming the operator action.

## 6. Defects

**None that block the trunk.** One cosmetic convention deviation is recorded in section 5 (em dashes in the generated
`context-pack.md`). No functional, security or contract defect was found in the integrated diff.

Two pre-existing conditions were noticed while sweeping, both outside this range and neither caused by it, recorded so
they are not lost:

1. `.github/workflows/ci.yml` triggers on `push: branches: [main]`, but this repo's trunk is `master`, so the workflow
   never runs on a trunk push. It only runs `bash fxl-doctor.sh` in any case, and this repo's contract is local
   verification with no hosted CI requirement, so nothing in this feature depends on it.
2. `apps/api/.env` really does point `DATABASE_URL` at the staging database. That is the documented local setup and the
   integration suite is provably pinned away from it (section 2), but it stays a live foot-gun for any command that
   reads `DATABASE_URL` without going through `test/rls/setup-env.ts`.

## 7. Operator risk that MUST be acted on before deploying

This is the one thing that matters outside the repository. All three renames are **breaking configuration changes**:
the API reads only the new names, and the old names are now inert.

1. **`SALES_SESSION_ENCRYPTION_IKM` - highest risk, act before the deploy, not after.**
   First **check whether `HUB_SESSION_ENCRYPTION_KEY` currently carries a value** in each of Infisical `staging` and
   Infisical `prod`. Do not assume it is blank; confirm it.
   - If it carries a value: create `SALES_SESSION_ENCRYPTION_IKM` with **the same value, byte for byte**, before the
     deploy. If you do not, the sealer silently falls back to HKDF from `FXL_HUB_CLIENT_SECRET`, every
     `hub_bff_sessions` row becomes undecryptable, and **every user is logged out at once**. The failure is silent -
     a seal that will not open is reported `absent`, not an error - so nothing will alert you.
   - If it is blank or unset: nothing to carry. The derivation already comes from `FXL_HUB_CLIENT_SECRET` and continues
     to, unchanged.
   - Only after the new name is in place and the deploy is green should the old name be deleted.
2. **`SALES_POST_LOGIN_REDIRECT` and `SALES_POST_LOGIN_ERROR_REDIRECT`.** If either
   `FXL_HUB_POST_LOGIN_REDIRECT` or `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` holds a value in staging or production, create
   the `SALES_`-prefixed name with the same value before the deploy. If you do not, the redirect silently falls back to
   `CORS_ORIGIN` (and the error variant to that value with `?error=auth` appended). That is a **degradation, not an
   outage** - login still completes, it just lands on the app origin rather than the configured destination. Then
   delete the old names.
3. **`FXL_HUB_REDIRECT_URI` must NOT be renamed.** It is one of the nine names the SDK will own. It is byte-unchanged
   here (check 3) and it stays as it is.
4. **Do not install `@fxl-business/hub-sdk` 2.3.0.** It is not published; the registry's highest version is 2.2.0. The
   SDK-dependent work is staged as an unexecuted plan and must stay that way until the package actually exists.
5. **Rollback is a pure code revert.** This range contains **zero migrations** and touches no schema, so reverting the
   commits is sufficient - provided the environment still carries the old variable names, which is why step 1 says
   create the new name rather than rename in place.

## 8. Verdict

**PASS.** `master` is safe to leave as the trunk.

- Every gate in the tier is green on the integrated trunk with real exit code 0: lint, type-check, 1303 tests across
  103 files, a real production build, both guards standalone, and 169 integration tests against a confirmed local
  database.
- All six integration-level checks pass, each proven by execution rather than by reading: the retired names are gone
  from every surface that matters, the three renames agree across the schema, the bag, the type projection and the
  set-equality oracle, `FXL_HUB_REDIRECT_URI` and `resolveHubRedirectUri` are byte-unchanged, both guards fire on all
  three planted names and on the auth literal while sparing all nine canonical names, no SDK version or specifier
  moved, and the session sealer keeps its single read site, its client-secret fallback and its blank-means-absent
  behaviour.
- All five security axes are clean, with one bounded observation about the guards echoing a matched line, which is
  pre-existing behaviour and cannot reach a real secret through a tracked file.
- One cosmetic convention deviation (em dashes in a tool-generated `nexo/` artifact), no functional defect.
- The trunk is not safe to **deploy** until the operator has performed the three configuration steps in section 7, and
  step 1 in particular. That is a deployment precondition, not a code defect, and it is exactly what the two
  `BREAKING CHANGE:` footers in the range announce.
