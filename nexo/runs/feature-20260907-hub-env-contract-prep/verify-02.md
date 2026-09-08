# Verify - slice 02 - local post-login rename

Branch `feat/02-local-post-login-rename`, one commit ahead of `master` (`bca655c`).
Graded adversarially by a separate agent.
Every probe below was designed and run here; no number from the implementer's notes was trusted.

**Verdict: PASS.**
Zero defects.

## Criterion 1 - behaviour unchanged

**PASS.**

### 1a. `resolveHubPostLoginRedirect` returns explicit, else `CORS_ORIGIN`, else `/`

`apps/api/src/middleware/app-auth.ts:154-156`:

```ts
export function resolveHubPostLoginRedirect(envBag: EnvLike): string {
  return envBag.SALES_POST_LOGIN_REDIRECT ?? envBag.CORS_ORIGIN ?? '/';
}
```

Identical to master's body except the key name.
Same `??` chain, same order, same `/` terminal.

### 1b. `resolveHubPostLoginErrorRedirect` preserves the `/` special case verbatim

`apps/api/src/middleware/app-auth.ts:158-172`:

```ts
export function resolveHubPostLoginErrorRedirect(envBag: EnvLike): string {
  const explicit = envBag.SALES_POST_LOGIN_ERROR_REDIRECT;
  if (explicit) {
    return explicit;
  }

  const redirect = resolveHubPostLoginRedirect(envBag);
  if (redirect === '/') {
    return '/?error=auth';
  }

  const url = new URL(redirect);
  url.searchParams.set('error', 'auth');
  return url.toString();
}
```

The diff for this function is exactly one line (`const explicit = ...`).
The `/` branch, the `new URL` branch and the `searchParams.set` are byte-unchanged.

### 1c. Both remain `emptyToUndefinedUrl` in `apps/api/src/env.ts`

`apps/api/src/env.ts:55-56`:

```ts
  SALES_POST_LOGIN_REDIRECT: emptyToUndefinedUrl,
  SALES_POST_LOGIN_ERROR_REDIRECT: emptyToUndefinedUrl,
```

Same validator both sides of the diff.

### 1d. Both still reachable through `hubEnvBag`

The bridge exists and is the only path. `grep -n` on `apps/api/src/middleware/app-auth.ts`:

```
79:const hubAuthConfig = tryLoadHubAuthConfig(hubEnvBag(env));
249:  const hubEnv = hubEnvBag(env);
309:    postLoginRedirect: resolveHubPostLoginRedirect(hubEnv),
310:    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(hubEnv),
```

`hubEnvBag` in `apps/api/src/config/auth-provider.ts:87-88` still projects both keys, and `HubEnvSource` (line 53-54) still `Pick`s them off the validated env type.
Only the key names changed; no key was dropped and none was added.

## Criterion 2 - `FXL_HUB_REDIRECT_URI` untouched

**PASS.**

```
$ git diff master...feat/02-local-post-login-rename -- apps/api/src/middleware/app-auth.ts \
    | grep -E '^[-+].*(REDIRECT_URI|resolveHubRedirectUri)'
  (no output)
```

`resolveHubRedirectUri` and the `FXL_HUB_REDIRECT_URI` schema line are byte-unchanged.
The name appears on added lines only as PROSE (`CLAUDE.md`, an `env.ts` comment, an `app-auth.ts` doc comment) and as one literal inside the new guard test's canonical-nine fixture.
No behavioural line touches it.

## Criterion 3 - no retired name survives

**PASS.** Full enumeration, case-insensitive, whole tree:

```
$ git grep -n -i -E 'FXL_HUB_POST_LOGIN_(ERROR_)?REDIRECT' -- .
CLAUDE.md:115
nexo/plans/feature-20260827-hub-sdk-210-access-model/02-explicit-hub-config.md:248,249,271,350,535,536
nexo/plans/feature-20260827-hub-sdk-210-access-model/04-sdk-210-flip.md:254,255,1532,1533
nexo/runs/feature-20260827-hub-sdk-210-access-model/recon-api.md:285,286
nexo/runs/feature-20260827-hub-sdk-210-access-model/recon-web.md:739,746
nexo/runs/feature-20260907-hub-env-contract-prep/exec-02-notes.md:7,8,69,70
```

Every survivor is inside `nexo/` or `CLAUDE.md`, both legitimately allowed.

```
$ git grep -n -i -E 'FXL_HUB_POST_LOGIN' -- apps packages scripts
  (no output, exit 1)
```

Both API `.env` example files carry only the new names.
`scripts/` holds the old spellings only as `String.fromCharCode` sequences.

Untracked and gitignored deployment files checked too: `apps/api/.env`, `apps/web/.env`, root `.env`, `apps/api/Dockerfile`, `docker-compose.yml` - none names either retired variable.
No `.github/`, CI config, or platform config file exists in this repo to update.

## Criterion 4 - the sorted-key pin still bites

**PASS, proven in both drift directions.**

### 4a. Bag drifts from schema (rename the emitted key in `hubEnvBag` only)

Mutation: `SALES_POST_LOGIN_REDIRECT: source.SALES_POST_LOGIN_REDIRECT` -> `SALES_POST_LOGIN_REDIRECT_MUTANT: source.SALES_POST_LOGIN_REDIRECT` in `apps/api/src/config/auth-provider.ts`.

```
$ CI=true pnpm --filter @fxl-sales/api exec vitest run \
    src/config/__tests__/auth-provider.test.ts -t 'projects exactly the auth variables'

- "SALES_POST_LOGIN_REDIRECT",
+ "SALES_POST_LOGIN_REDIRECT_MUTANT",

 ❯ src/config/__tests__/auth-provider.test.ts:188:37
     186|     const bag = hubEnvBag(source);
     188|     expect(Object.keys(bag).sort()).toEqual(

 Test Files  1 failed (1)
      Tests  1 failed | 11 skipped (12)
```

RED on `hubEnvBag > projects exactly the auth variables off the validated env object`.
Restored; `git diff --quiet` clean.

### 4b. Schema drifts from bag (rename the key in `env.ts` only)

Mutation: `SALES_POST_LOGIN_REDIRECT` -> `SALES_POST_LOGIN_REDIRECT_DRIFT` in `apps/api/src/env.ts`.

```
$ pnpm run type-check
apps/api type-check: src/config/auth-provider.ts(43,3): error TS2344: Type '... | "SALES_POST_LOGIN_REDIRECT"' does not satisfy the constraint ...
apps/api type-check:   Type '"SALES_POST_LOGIN_REDIRECT"' is not assignable ... Did you mean '"SALES_POST_LOGIN_REDIRECT_DRIFT"'?
apps/api type-check: src/middleware/app-auth.ts(79,54): error TS2345: ... Property 'SALES_POST_LOGIN_REDIRECT' is missing ... but required in type 'HubEnvSource'.
apps/api type-check: src/middleware/app-auth.ts(249,28): error TS2345: ... (same)
apps/api type-check: Failed
Exit status 2
```

RED. Restored; clean.

The test title changed from `projects exactly the Hub variables` to `projects exactly the auth variables`, which is a widening of the DESCRIPTION to cover two keys that are honestly not Hub variables.
The ASSERTION was not weakened: it is still an exact `toEqual` over the full sorted key list, and the list still has twelve entries, the same count as on master.

## Criterion 5 - the resolver tests still bite

**PASS.**

Mutation: drop the `CORS_ORIGIN` fallback, `return envBag.SALES_POST_LOGIN_REDIRECT ?? '/';`.

```
$ CI=true pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth.test.ts

 × resolveHubPostLoginRedirect > returns users to the web origin after Hub callback
   → expected '/' to be 'http://localhost:8006'
 × resolveHubPostLoginRedirect > adds an auth error query to the post-login error redirect
   → expected '/?error=auth' to be 'http://localhost:8006/?error=auth'

 Test Files  1 failed (1)
      Tests  2 failed | 15 passed (17)
```

Two NAMED tests RED. Restored; clean.

## Criterion 6 - the env-name guard bans both, and only both

**PASS on every sub-check.**

Baseline: `node scripts/no-legacy-env-names.mjs` -> exit 0.

### Planted probe A, plain retired name, staged

```
$ git add apps/api/src/probe-verify02.ts && node scripts/no-legacy-env-names.mjs
Retired env name found. Use SALES_POST_LOGIN_REDIRECT instead:
apps/api/src/probe-verify02.ts:1:export const a = process.env.FXL_HUB_POST_LOGIN_REDIRECT;
EXIT=1
```

Exactly ONE ban fired. The ERROR ban did not cross-fire.

### Planted probe B, ERROR retired name, staged

```
Retired env name found. Use SALES_POST_LOGIN_ERROR_REDIRECT instead:
apps/api/src/probe-verify02.ts:1:export const b = process.env.FXL_HUB_POST_LOGIN_ERROR_REDIRECT;
EXIT=1
```

Exactly ONE ban fired. The plain ban did not cross-fire.
This is the direction the previous slice's trap lived in, and it is clean here.

### Probe C, false-positive sweep

A staged file naming all NINE canonical SDK names plus both new `SALES_*` names:

```
CANONICAL_NINE_EXIT=0
$ git grep -c -w -i -- 'FXL_HUB_POST_LOGIN_REDIRECT' -- <that file>       -> exit 1 (no match)
$ git grep -c -w -i -- 'FXL_HUB_POST_LOGIN_ERROR_REDIRECT' -- <that file> -> exit 1 (no match)
```

Neither ban touches `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`, `FXL_HUB_REDIRECT_URI`, `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_SESSION_ENCRYPTION_KEY`, `FXL_HUB_TRUSTED_ORIGINS`, `SALES_POST_LOGIN_REDIRECT` or `SALES_POST_LOGIN_ERROR_REDIRECT`.

On the prefix question the brief raised: `FXL_HUB_POST_LOGIN_REDIRECT` is NOT in fact a substring of `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` - the shared part stops at `..._LOGIN_` and the tails diverge (`REDIRECT` vs `ERROR_REDIRECT`).
So no `-w` boundary subtlety is even reachable in this pair, and the two probes above confirm it empirically rather than by argument.
The guard's own comment states this correctly.

Probe file removed from both index and worktree; guard back to exit 0; `git status --short -- apps packages scripts` empty.

### Guard cannot match itself

`grep -rn -E 'FXL_HUB_POST_LOGIN' scripts/` returns nothing.
Both the guard and its test spell the retired names via `String.fromCharCode`, the same idiom the sibling `no-legacy-auth.mjs` uses, so the gate can pass on a clean repository.
`scripts/__tests__/no-legacy-env-names.test.mjs` runs the guard against synthetic temp repositories, never the real tree.

## Criterion 7 - CLAUDE.md prose record

**PASS.**

`CLAUDE.md:114-121` names each old name once, states what it became, states WHY (the nine canonical names are enumerated), states explicitly that `FXL_HUB_REDIRECT_URI` is one of the nine and is untouched, records that `createHubBff`'s `postLoginRedirect` / `postLoginErrorRedirect` CODE options are unchanged, restates the exact resolution order so the "behaviour unchanged" claim is checkable from the doc, and closes with the operator carry-across instruction.
It matches the style of the `SALES_SESSION_ENCRYPTION_IKM` paragraph immediately above it and relies on the same documented pathspec exemption.

## Criterion 8 - full green

| Command | Exit |
| --- | --- |
| `pnpm run lint` | **0** |
| `pnpm run type-check` | **0** |
| `CI=true pnpm test` | **0** |
| `node scripts/no-legacy-auth.mjs` | **0** |
| `node scripts/no-legacy-env-names.mjs` | **0** |

`CI=true pnpm test` detail: `packages/shared-utils` 3 files passed, `apps/api` 42 files passed, `apps/web` 56 files passed, and the two `node --test` guard suites reported `# tests 11 / # pass 11 / # fail 0`.
The root `test` script chains `no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs`, all of which ran inside that exit 0.

## Independent adversarial checks

### Revert one renamed read in `app-auth.ts` to its old name

The brief predicted `pnpm run type-check` would FAIL and called a pass a defect.
It PASSES, and after investigation this is **not** a defect.

```
$ # resolveHubPostLoginRedirect changed back to envBag.FXL_HUB_POST_LOGIN_REDIRECT
$ pnpm run type-check
apps/api type-check: Done
apps/web type-check: Done
```

The cause is structural and PRE-EXISTING, not a compatibility path.
`apps/api/src/middleware/app-auth.ts:14` declares `type EnvLike = Record<string, string | undefined>;`, an index signature, so ANY key name type-checks inside these resolvers.
That line is byte-unchanged from master, and master's own `resolveHubRedirectUri` reads `envBag.FXL_HUB_REDIRECT_URI` through the same index signature.
No aliasing, no `??` chain onto an old name, no fallback read of a retired variable exists anywhere - criterion 3's exhaustive grep proves it.

The slice recognised this gap and closed it with TWO independent oracles, both of which I drove against the same mutation:

```
$ CI=true pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth.test.ts
 × resolveHubPostLoginRedirect > prefers an explicit SALES_POST_LOGIN_REDIRECT over CORS_ORIGIN
   → expected 'http://localhost:8006' to be 'https://sales.fxlbusiness.com/tatico/…'
 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)

$ git add apps/api/src/middleware/app-auth.ts && node scripts/no-legacy-env-names.mjs
Retired env name found. Use SALES_POST_LOGIN_REDIRECT instead:
apps/api/src/middleware/app-auth.ts:155:  return envBag.FXL_HUB_POST_LOGIN_REDIRECT ?? envBag.CORS_ORIGIN ?? '/';
EXIT=1
```

The mutation is caught, twice, by the run-once suite and by the guard.
Restored; index and worktree clean.

This is worth recording for the later parked slices: for anything reached through `EnvLike`, `type-check` is NOT an oracle for a rename, and the guard plus a value-passing test are what must carry it.

### Deployment-facing files

`apps/api/.env.example` and `apps/api/.env.dev.example` both updated, with a comment that explains the `SALES_` choice and now also documents the error variant's derived default (which master's single-line comment did not).
`apps/api/Dockerfile` and `docker-compose.yml` name neither variable.
Local `.env` files name neither.
No CI config exists in this repository.
`CLAUDE.md` is updated.

### Conventions

- No em dash anywhere in the diff (grepping the diff for U+2014 returns no output).
- Commit message `bca655c` carries no `Co-Authored-By` and no agent attribution line.
- All test invocations were run-once (`vitest run`, `CI=true pnpm test`). No watcher was started, no process was left running, and nothing was killed by name.

## Operator-facing consequence

**This slice renames two deployment environment variables. Both are OPTIONAL and ship blank, so most environments need no action - but an environment that SET either one will silently change behaviour if the rename is missed.**

What must be set, where, and when:

- **Where:** wherever the API's environment is defined for each level - Infisical `staging` and Infisical `prod` per the Environments table in `CLAUDE.md`, and the local `apps/api/.env` for a developer who copied a non-blank value out of an example.
- **What:** if `FXL_HUB_POST_LOGIN_REDIRECT` holds a value, create `SALES_POST_LOGIN_REDIRECT` with the SAME value. Likewise `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` -> `SALES_POST_LOGIN_ERROR_REDIRECT`. Then delete the old names.
- **When:** before, or in the same change as, the deploy that ships this commit. The old names are read by nothing after this commit.
- **If it is missed:** nothing crashes and nothing fails to boot - which is precisely the risk. The API silently falls back. A successful Hub login lands the operator on `CORS_ORIGIN` (the web app root) instead of wherever the deployment pointed post-login, and a failed login lands on `CORS_ORIGIN` with `?error=auth` appended instead of the configured error destination. There is no error, no log line and no 503; the only symptom is landing on the wrong page after signing in.
- **If neither was ever set** (the documented default, and what both `.env` examples ship): there is nothing to carry across and no action at all is required. The fallback chain the operator is already relying on - `CORS_ORIGIN`, then `/` - is unchanged to the byte.

Unlike the `SALES_SESSION_ENCRYPTION_IKM` rename in the sibling paragraph of `CLAUDE.md`, missing this one **cannot** log users out or destroy stored data. It is a redirect destination, not keying material. The worst outcome is a wrong landing page.

## Defects

None.
