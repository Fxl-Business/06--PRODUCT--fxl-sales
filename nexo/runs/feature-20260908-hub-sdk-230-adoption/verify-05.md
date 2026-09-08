# Verify - slice 05, contract single resolver

Branch `feat/05-contract-single-resolver`, one commit ahead of `master` (`b8a1c5a`), reviewed with
`git diff master...HEAD`.
Nothing was merged, pushed or amended.
Every mutation below was restored and the working tree and `node_modules` were confirmed pristine
afterwards.

**VERDICT: FAIL.**

The refactor itself is correct, the three new oracles are real, and the whole suite is green.
It fails on one defect that the brief asked for explicitly: a fresh clone that copies the SHIPPED
`.env.example` no longer reaches `503 hub_auth_not_configured`, it fails to boot - and
`auth-provider.ts`'s own new header states the opposite as fact.

---

## Per-criterion verdicts

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | One boot gate, not two | PASS |
| 2 | Fail-soft door survives and is narrow | PASS (test), see D1 for the shipped example |
| 3 | No blanket try/catch introduced | PASS |
| 4 | Minimal absent-check is genuinely minimal | PASS |
| 5 | `hubEnvBag` survives, sorted-key assertion bites | PASS |
| 6 | Three new oracles exist and are non-vacuous | PASS |
| 7 | Test-infrastructure change | PASS, load-bearing, does not mask a code defect |
| 8 | Named behaviour change is real and pinned | PASS |
| 9 | `resolveHubRedirectUri` gone, not replaced by a presence check | PASS |
| 10 | Full green | PASS |
| Adversarial A | 503 and boot-failure mutually exclusive | PASS (structurally) |
| Adversarial A2 | blank `.env.example` still reaches 503 | **FAIL - D1** |
| Adversarial B | no access-gate / tenancy / UI change | PASS |
| Adversarial C | no secret logged or echoed | PASS |

---

## 1. One boot gate, not two - PASS

```
$ grep -rn "assertBootConfiguration" apps/ | grep -v node_modules | grep -v /dist/ | grep -v __tests__
apps/api/src/middleware/app-auth.ts:86    (comment)
apps/api/src/middleware/app-auth.ts:132   (comment)
apps/api/src/middleware/app-auth.ts:230   (comment)
apps/api/src/middleware/app-auth.ts:282   (comment)
apps/api/src/config/auth-provider.ts:9    (comment)
```

Every production hit is prose.
The only executable references are in `app-auth-bff-production-boot.test.ts`, which drives the real
`assertBootConfiguration` deliberately.

`createHubBff` is passed no `healthToken`, no `redirectUri` and no `trustedOrigins`.
All three now ride on `hubSdkConfig`, which is `tryLoadHubAuthConfig(hubEnvBag(env))` whole and
unprojected.
The absence is pinned three ways, not merely by reading the source:

- `app-auth-bff-wiring.test.ts` > `carries the trusted web origin on the config rather than as a second option`
  asserts `'trustedOrigins' in bffOptions === false`, and the same for `redirectUri` and `healthToken`.
- `app-auth-bff-production-boot.test.ts` asserts the same three, off the captured config.

I confirmed against the installed SDK that the concern is real: `createHubBff`
(`dist/server.js:451-459`) spreads `options.healthToken` / `options.redirectUri` /
`options.trustedOrigins` OVER the config before `assertBootConfiguration` parses it, so a second
resolution really would validate one configuration and construct another.

## 2. The fail-soft door survives, and is still narrow - PASS

`app-auth-unconfigured.test.ts` keeps its exact title and its exact assertion:

```
it('answers 503 hub_auth_not_configured and never a 401, 402 or an allow', ...)
  expect(res.status).toBe(503);
  resolves.toEqual({ error: 'unavailable', code: 'hub_auth_not_configured' });
```

The whole 7-line diff on that file is two comment blocks plus one added
`vi.stubEnv('FXL_HUB_TRUSTED_ORIGINS', '')`, which only strengthens the all-blank fixture.
It was proven still to bite: under the D-C mutation below (see criterion 6) it stayed GREEN while the
partial-config oracle went RED, which is the correct complementary behaviour.

The narrowness holds in code: `tryLoadHubAuthConfig` is a single `if (hubConfigIsAbsent(bag)) return null;`
and nothing else.

See D1: the door survives in the CODE, but the shipped `.env.example` no longer walks through it.

## 3. No blanket try/catch - PASS

Read `apps/api/src/config/auth-provider.ts` in full (145 lines).

```
$ grep -n "try\|catch" apps/api/src/config/auth-provider.ts
19: * THERE IS NO BLANKET try/catch HERE, AND THAT IS THE POINT.   (comment)
23: * the operator nothing. `tryLoadHubAuthConfig` returns null ONLY when ...  (comment)
137:export function tryLoadHubAuthConfig(
```

There is no `try` statement anywhere in the file.
`loadHubAuthConfig` is `return loadHubConfig(bag);` and nothing else.
The previous narrow rethrow (`nameDiscreteVar`) is gone with the `try` that fed it, so the "acceptable
only if it genuinely never returns" caveat does not even arise.
`app-auth-partial-config.test.ts` and `auth-provider.test.ts` > `throws rather than answering null when
the discrete form is only partly set` are what go red if a catch comes back.

## 4. The minimal absent-check is genuinely minimal - PASS

`hubConfigIsAbsent(bag)` is one line:
`return !HUB_CREDENTIAL_ENV_VARS.some((key) => isSet(bag[key]));` over the six credential names.

```
$ grep -rn "hubConfigPresence\|HubConfigPresence\|HUB_DISCRETE_ENV_VARS\|nameDiscreteVar\|HUB_FIELD_TO_DISCRETE_VAR" apps/*/src scripts
apps/api/src/middleware/__tests__/app-auth-partial-config.test.ts:5   (comment, historical)
```

The two-forms ambiguity detection, the `json` / `discrete` / `incomplete` verdicts and the
discrete-name remapper are all deleted with no successor.
The two-forms rule is not lost: it moved to the SDK, and
`auth-provider.test.ts` > `refuses to boot when FXL_HUB_CONFIG is set beside a discrete variable and
names every offender` still passes against the SDK's own message, including the negative
`not.toContain('FXL_HUB_API_URL')`.

No second validator was left behind. `hubEnvBag` is a pure projection with no branching; the only other
export is `HubEnvSource` / `HubAuthConfig`, and `HubAuthConfig` is now a bare alias of the SDK's
`HubConfig` (no local extension).

## 5. `hubEnvBag` survives as the bridge, and the sorted-key assertion bites - PASS, proven

Mutation: renamed the OUTPUT key of one bag entry without touching the schema.

```diff
-    FXL_HUB_TRUSTED_ORIGINS: source.FXL_HUB_TRUSTED_ORIGINS,
+    FXL_HUB_TRUSTED_ORIGIN: source.FXL_HUB_TRUSTED_ORIGINS,
```

```
$ CI=true ./node_modules/.bin/vitest run src/config/__tests__/auth-provider.test.ts
   × hubEnvBag > projects exactly the auth variables off the validated env object
     → expected [ 'CORS_ORIGIN', …(12) ] to deeply equal [ 'CORS_ORIGIN', …(12) ]
      Tests  1 failed | 12 passed (13)

$ ./node_modules/.bin/tsc --noEmit -p tsconfig.json
tsc_exit=0
```

RED in the test, SILENT to `tsc` - exactly the claim.
That assertion is the only thing standing between the bag and the schema.
Restored and re-verified clean.

## 6. The three new oracles exist and are NON-VACUOUS - PASS

All three mutations were run with `test/unit-setup.ts` in place, so the setup file is not what makes
them pass.

### `a partially configured Hub is a boot failure, not a 503`

Mutation - restore the old `incomplete` semantics by widening the absent check:

```diff
-  return !HUB_CREDENTIAL_ENV_VARS.some((key) => isSet(bag[key]));
+  return !HUB_CREDENTIAL_ENV_VARS.every((key) => isSet(bag[key]));
```

```
 FAIL  src/middleware/__tests__/app-auth-partial-config.test.ts > a partially configured Hub > is a boot failure, not a 503
 FAIL  src/middleware/__tests__/app-auth-partial-config.test.ts > a partially configured Hub > names the variable to fix ...
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 1 passed (3)
```

RED, and `app-auth-unconfigured.test.ts` stayed GREEN in the same run, which proves the two files are
genuine complements rather than two spellings of one fixture.

### `refuses a missing health token outside development`

Mutation - disable SDK check 6 in `node_modules/@fxl-business/hub-sdk/dist/server.js`:

```diff
-  if (!isDevelopment && (config.healthToken === void 0 || config.healthToken.length === 0)) {
+  if (false && !isDevelopment && (config.healthToken === void 0 || ... )) {
```

```
 × ... > refuses a missing health token outside development
   → expected function to throw an error, but it didn't
      Tests  1 failed | 7 passed (8)
```

RED, and exactly one test red - the mutation is targeted, not a shotgun.

### `refuses a redirect uri on the Hub's own origin outside development`

Mutation - disable SDK check 7:

```diff
-  if (!isDevelopment && callbackOrigin === originOf(config.apiUrl)) {
+  if (false && !isDevelopment && callbackOrigin === originOf(config.apiUrl)) {
```

```
 × ... > refuses a redirect uri on the Hub's own origin outside development
   → expected the boot assertion to throw
      Tests  1 failed | 7 passed (8)
```

RED, one test.
The SDK file was restored byte-identically (`diff` clean) after each mutation.

Both boot oracles use the `bootBase()` factory and the `caughtField()` helper, so a `toThrow()` cannot
pass because some unrelated rule refused the fixture - the `field` is asserted, and the
`not.toThrow()` half proves the accepted case really is accepted.
That is stronger than what the file carried before.

## 7. THE TEST-INFRASTRUCTURE CHANGE - PASS, with the story confirmed

`apps/api/test/unit-setup.ts` blanks six names via `vi.stubEnv`, wired as `setupFiles` in the unit
branch of `vitest.config.ts`.

**Is it load-bearing?** Yes. Removed it and ran the api suite:

```
$ # setupFiles line deleted from vitest.config.ts
$ CI=true ./node_modules/.bin/vitest run
 FAIL  src/domains/sales-ops/__tests__/history-route.test.ts
 FAIL  src/domains/sales-ops/__tests__/routes.test.ts
 FAIL  src/domains/sales-ops/__tests__/transition-routes.test.ts
 Test Files  3 failed | 40 passed (43)
      Tests  355 passed (355)

HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production",
"staging" or "development". ...
 ❯ loadHubAuthConfig src/config/auth-provider.ts:130
```

Three files, not four (the commit message says four - see D5).
They fail at IMPORT, before any assertion runs: they transitively import a router, which imports
`middleware/app-auth.ts`, which resolves the contract at module scope.

**Does it mask failures?** No. This machine's `apps/api/.env` carries exactly one of the five canonical
identity names:

```
$ grep -E "^FXL_HUB" apps/api/.env | sed 's/=.*/=<redacted>/'
FXL_HUB_API_URL=<redacted>
FXL_HUB_PUBLISHABLE_KEY=<redacted>     # retired name
FXL_HUB_SECRET_KEY=<redacted>          # retired name
FXL_HUB_REDIRECT_URI=<redacted>
```

So the ambient configuration is PARTIAL, which is now a boot failure by design.
Those three route files need no Hub configuration whatsoever; their verdict was simply being decided by
a file outside the repo.
Blanking makes the unit suite hermetic, which is the right fix - the alternative (a blanket catch, or
softening "partial is a boot failure") is exactly what this slice exists to remove.

**Does it weaken any oracle?** No. Every file that needs a configured Hub stubs its own values in
`beforeAll` behind `vi.resetModules()`, and `vi.stubEnv` overwrites.
Proven directly: all three new oracles went RED under mutation WITH the setup file active (criterion 6),
and `app-auth-unconfigured.test.ts` sets its own six blanks rather than leaning on the setup file.

**Does it hide a real product defect?** It hides no defect in the code under test.
It does hide one CONSEQUENCE of the slice from the suite: that a partial ambient `.env` now stops the
API booting. That consequence is real, is correct by the slice's own design, and is separately pinned
by `app-auth-partial-config.test.ts` - so it is pinned deliberately rather than merely suppressed.
The consequence itself is developer-facing and is stated plainly below.

**Scope:** it blanks `FXL_HUB_CONFIG`, `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`,
`FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE` and nothing else.
`FXL_HUB_REDIRECT_URI`, `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_TRUSTED_ORIGINS` and
`FXL_HUB_SESSION_ENCRYPTION_KEY` are untouched. Confirmed by reading the file.

It was not in the planned file list. It should have been, but it is the right change and it is
documented at length in the file itself. I accept it.

## 8. The named behaviour change is real and pinned - PASS

Pinned at two levels, both in NEW files/tests rather than by weakening an old one:

- unit: `auth-provider.test.ts` > `throws rather than answering null when the discrete form is only partly set`
- boot: `app-auth-partial-config.test.ts` > `is a boot failure, not a 503`, which asserts
  `importedModule` is `undefined` and `importError instanceof HubConfigError` - i.e. the module never
  resolved, so there is no middleware left to answer 503 with.

The old unconfigured test was not weakened: the diff on it is comments plus one extra blank stub
(criterion 2).
The partial-config file also asserts `error.field === 'clientSecret'` and
`error.message.not.toContain(HUB_CLIENT_ID)`, so it cannot pass on some unrelated refusal and cannot
pass on a message that leaks a value.

## 9. `resolveHubRedirectUri` is gone and NOT replaced by a presence check - PASS

The function is deleted, its export is gone, and its six unit tests went with it, replaced by a
tombstone comment that says why nothing is written in its place.

```
$ grep -rn "FXL_HUB_REDIRECT_URI" apps/api/src | grep -v __tests__
apps/api/src/env.ts:51   FXL_HUB_REDIRECT_URI: emptyToUndefinedUrl,
... all other hits are comments
```

`emptyToUndefinedUrl` is a SHAPE validator on an optional value, not a presence assertion - an unset
variable passes it.
There is no `if (!redirectUri) throw` anywhere.
The origin rule is the SDK's, and criterion 6 proves this repo notices when it is removed.

## 10. Full green - PASS

All from the repository root, real runs, real exit codes.

```
$ pnpm run lint          -> 0
$ pnpm run type-check    -> 0
$ pnpm run build         -> 0   (tsbuildinfo deleted first; api tsc + web vite, "✓ built in 2.80s")
$ CI=true pnpm test      -> 0
    packages/shared-utils   Test Files  3 passed (3)    Tests  80 passed (80)
    apps/api                Test Files 43 passed (43)   Tests 428 passed (428)
    apps/web                Test Files 56 passed (56)   Tests 784 passed (784)
    guards                  # tests 11  # pass 11  # fail 0
    build-contract: ok
$ node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs -> 0 (11/11)
$ node scripts/no-legacy-auth.mjs      -> 0
$ node scripts/no-legacy-env-names.mjs -> 0
$ node scripts/build-contract.mjs      -> 0
```

### The api delta, accounted for in full

Ran master in a throwaway worktree for a true baseline: **42 files, 428 tests**.
Branch: **43 files, 428 tests**. Net zero, so every test in the delta needs naming.

| File | master | branch | delta |
| --- | --- | --- | --- |
| `config/__tests__/auth-provider.test.ts` | 12 | 13 | **+1** |
| `middleware/__tests__/app-auth-bff-production-boot.test.ts` | 6 | 8 | **+2** |
| `middleware/__tests__/app-auth-bff-wiring.test.ts` | 23 | 24 | **+1** |
| `middleware/__tests__/app-auth-partial-config.test.ts` | - | 2 | **+2** |
| `middleware/__tests__/app-auth.test.ts` | 17 | 11 | **-6** |
| everything else (38 files) | identical | identical | 0 |

+6 added:
`carries the four operational values through onto the config, not beside it` (auth-provider);
`refuses a redirect uri on the Hub's own origin outside development` and
`carries the browser-facing redirect on the config, never the Hub default` (production-boot);
`carries the trusted web origin on the config rather than as a second option` (wiring);
`is a boot failure, not a 503` and `names the variable to fix rather than saying only that something is
wrong` (partial-config).

-6 removed: the six `resolveHubRedirectUri` unit tests, deleted with the function they tested.
Their coverage was relocated: the origin rule is now covered above the SDK boundary against the real
`assertBootConfiguration`.
One assertion did NOT relocate - the old `resolves the redirect to this app's own origin, never the
Hub's` guarded against the `apiUrl` default in DEVELOPMENT, and SDK check 7 fires only outside
development. That gap is the mechanism behind D2.

Note the pre-slice baseline supplied in the brief (api 428) is the same number as the post-slice count.
That is a coincidence of +6/-6, not evidence that nothing was added; the table above is the real
accounting.

---

## Independent adversarial checks

### 503 and boot failure cannot both be taken - PASS

`tryLoadHubAuthConfig` branches on one boolean: absent -> `null` (503 door), otherwise ->
`loadHubConfig`, which either returns or throws.
Structurally exclusive for every input; there is no third path and no fallthrough.

### A machine with the shipped `.env.example` still reaches 503 - **FAIL, see D1**

### No access-gate, tenancy or UI change - PASS

`git diff master...HEAD --stat` touches only `apps/api/src/config/auth-provider.ts`,
`apps/api/src/env.ts`, `apps/api/src/middleware/app-auth.ts`, five api test files, the new
`test/unit-setup.ts`, `vitest.config.ts` and a `nexo/` notes file.
Zero files under `apps/web`, zero under `domains/`, zero migrations.
`requireHubAuth`, `appAuthMiddleware`'s deny taxonomy, `withTenant` and every `orgId` filter are
byte-unchanged; `app-auth-access-gate.test.ts` (9 tests) is untouched and green.

### Nothing newly logs or echoes a secret - PASS

`auth-provider.ts` now constructs no message at all; every message comes from the SDK's own
`HubConfigError`.
`auth-provider.test.ts` > `never leaks the client secret out of the optional loader` drives two bags
through the failing path and asserts the secret appears in neither `String(error)`, nor
`error.message`, nor `error.stack`.
`app-auth-partial-config.test.ts` adds `expect(error.message).not.toContain(HUB_CLIENT_ID)`.
Both green.
I read the SDK's message builders: they interpolate `audience`, `apiUrl`, `environment` and
`redirectUri` (identifiers and URLs) and never `clientSecret`.
Nothing in the diff adds a `console.*` or a logger call.

### Diff conventions - PASS

No em dash anywhere in the diff; a grep for the character over `git diff master...HEAD` returns nothing.
No `Co-Authored-By` and no agent attribution in the commit message.

---

## Defects

### D1 - BLOCKING. A fresh clone using the shipped `.env.example` no longer boots

`auth-provider.ts`'s new header asserts, as the justification for the whole behaviour change:

> A fresh clone is unaffected: `.env.example` ships all five blank, which is still absent.

That is false. Both `apps/api/.env.example` and `apps/api/.env.dev.example` ship THREE of the five
populated:

```
FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_ENVIRONMENT=development
FXL_HUB_AUDIENCE=app.fxl-sales
FXL_HUB_CLIENT_ID=          # blank
FXL_HUB_CLIENT_SECRET=      # blank
```

That is a PARTIAL configuration, which this slice makes a boot failure.
Proven by driving the real loader over the real file on both sides:

```
$ tsx probe.mts   # branch, bag parsed verbatim from apps/api/.env.example
FXL_HUB set in .env.example: [ 'FXL_HUB_API_URL', 'FXL_HUB_ENVIRONMENT', 'FXL_HUB_AUDIENCE' ]
VERDICT: THREW -> BOOT FAILURE: hub-sdk: FXL_HUB_CONFIG.clientId is missing or empty.
                                It looks like pk_<slug>_<environment>_<random>.

$ tsx probe-master.mts   # master worktree, same file
MASTER VERDICT: NULL -> 503 door
```

So the exact invariant the header and `CLAUDE.md` both protect - "that is what keeps
`503 hub_auth_not_configured` alive for a fresh clone" - is dead for the configuration this repo
actually ships. `cp .env.example .env && pnpm dev` used to start and answer 503; it now crashes at
module load.

The unit suite cannot see this: `app-auth-unconfigured.test.ts` hand-writes an all-blank bag rather than
reading the shipped example, so the fixture and the artefact have silently diverged.

Note the error message also names `FXL_HUB_CONFIG.clientId`, a variable the operator of the five
discrete names never sets - the deleted remapper is what used to fix that. The deletion was mandated by
this slice's brief, so it is not itself a defect, but it makes D1's failure mode worse to read.

Fix options, in order of preference:
1. blank `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT` and `FXL_HUB_AUDIENCE` in both API examples, so the
   shipped artefact really is absent and the header's sentence becomes true; then
2. add an oracle that PARSES `apps/api/.env.example` and asserts `tryLoadHubAuthConfig` answers null,
   so the fixture can never drift from the artefact again.

Slice 06 as planned does not fix this - it ADDS two more populated names to those files, which makes the
fresh-clone path worse, not better.

### D2 - The local-development redirect claim is false today

`app-auth.ts:138` states, present tense:

> The local development convenience is preserved by SETTING `FXL_HUB_REDIRECT_URI` in the `.env` examples.

It is not set. Both examples ship `FXL_HUB_REDIRECT_URI=` blank, under a comment that still describes the
DELETED behaviour ("Local dev defaults to http://localhost:8006/auth/callback from CORS_ORIGIN").

With it blank in development, `parseRedirectUri` defaults to `${apiUrl}/auth/callback` - the HUB's own
origin - and SDK check 7 does not fire in development, so the API boots cleanly and local login is
silently broken (the Hub rejects an unregistered redirect_uri).
This is the one assertion that did not survive the six deleted tests: the old
`resolves the redirect to this app's own origin, never the Hub's` covered exactly the development case.

Planned for slice 06, but the sentence in this slice's source is wrong as committed, and the local dev
regression is live in the interval.

### D3 - OPERATOR ACTION REQUIRED before the next staging/production deploy

`trustedOrigins` changed provenance from `env.CORS_ORIGIN` (always passed) to
`FXL_HUB_TRUSTED_ORIGINS` (unset -> the SDK resolves `[]`, verified in the SDK's `parseTrustedOrigins`).

Staging and production Infisical MUST gain `FXL_HUB_TRUSTED_ORIGINS=https://sales.fxlbusiness.com`
before this ships, or every browser POST to the BFF from `sales.*` to `sales-api.*` answers
`403 origin_not_trusted` - the 2026-08-10 outage, exactly.

The commit message discloses this honestly, which is good.
It is documented nowhere an operator will look: not in `.env.example`, not in `.env.dev.example`, not in
`CLAUDE.md`'s "Required API vars" block. Slice 06 covers the examples; the Infisical change is a human
action that must be gated on Gate 3.

### D4 - `CLAUDE.md` invariant deviated from without being recorded

`CLAUDE.md` says of the trusted-origin mount tests: "Its two mount tests keep their exact titles and
assertions".
Both titles were renamed here (`... from CORS_ORIGIN` -> `... from the trusted web origin`, and
`... not CORS_ORIGIN` -> `... not trusted`).
The renames are justified - CORS_ORIGIN is genuinely no longer the source - and the assertions are
unchanged, so nothing is weakened. But `CLAUDE.md` now contradicts the tree, and slice 06's plan does not
name this line among what it rewrites. Add it.

### D5 - Two small inaccuracies in the commit message

- "a partial ambient config broke four files at import" - it is three:
  `history-route.test.ts`, `routes.test.ts`, `transition-routes.test.ts`. Measured above.
- "app-auth-partial-config.test.ts, the exact complement of app-auth-unconfigured.test.ts, which is
  untouched" - that file WAS touched (two comment blocks and one added blank stub). Its title and its
  assertion are untouched, which is what criterion 2 required, but "untouched" is not accurate.

---

## Consequences to state plainly

**Developer-facing.** A partial `apps/api/.env` now stops the API booting.
This is deliberate and defensible, but it is a real change: any developer whose `.env` predates the
canonical names - including this machine, which carries only `FXL_HUB_API_URL` plus the two retired
`FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY` names - will find `pnpm dev` crashing with a
`HubConfigError` where it previously started and answered 503.
The fix is for each developer to fill in all five canonical names or blank them all.
Say this in the release notes; it will otherwise be reported as "the API is broken on main".

**Developer-facing.** Until slice 06 lands, local Hub login is broken for anyone whose
`FXL_HUB_REDIRECT_URI` is blank, silently and with a clean boot (D2).

**Developer-facing.** A five-discrete-variable operator now reads `FXL_HUB_CONFIG.clientId` in the boot
error - a variable they never set. Brief-mandated, but `CLAUDE.md`'s paragraph defending the remapper
must be rewritten in slice 06 rather than left contradicting the tree.

**Operator-facing.** `FXL_HUB_TRUSTED_ORIGINS` must be set in staging and production Infisical before
the next deploy (D3). Without it the cross-origin outage returns in full.

---

## What was mutated and restored

| Target | Mutation | Restored |
| --- | --- | --- |
| `apps/api/src/config/auth-provider.ts` | `.some` -> `.every` in `hubConfigIsAbsent` | yes, `git diff` clean |
| `apps/api/src/config/auth-provider.ts` | bag key `FXL_HUB_TRUSTED_ORIGINS` renamed | yes, `git diff` clean |
| `node_modules/.../hub-sdk/dist/server.js` | check 6 disabled | yes, `diff` byte-identical |
| `node_modules/.../hub-sdk/dist/server.js` | check 7 disabled | yes, `diff` byte-identical |
| `apps/api/vitest.config.ts` | `setupFiles` removed | yes, `git diff` clean |
| a throwaway `master` git worktree | created for the baseline | removed, `git worktree list` clean |

Final state re-verified: `git status --porcelain -- apps packages scripts` empty, and a full
`CI=true pnpm test` re-run after every restore exits 0 with 80 / 428 / 784 / 11.
