# Verify - slice 06 `examples-docs-guard`

Branch `feat/06-examples-docs-guard`, commit `8250d89`, one ahead of `master`.
Reviewed with `git diff master...HEAD`. Nothing merged, pushed or amended.
The context pack was not opened.

**Verdict: PASS.** Two minor documentation inaccuracies are recorded below as follow-ups; neither is a safety defect and neither breaks a numbered criterion.

## Diff surface

```
CLAUDE.md                                                   +86/-...
README.md                                                   +34/-...
apps/api/.env.dev.example                                   +53
apps/api/.env.example                                       +53
apps/api/src/config/__tests__/env-example-contract.test.ts  +107
apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts  +11 (comment-only)
scripts/no-legacy-env-names.mjs                             +13 (comment-only)
nexo/.../AUDIT.md, nexo/.../exec-06-notes.md                new
```

No access-gate, tenancy or UI file changed. No production source file changed at all: the only non-doc, non-nexo edits are one new test block, two comment-only edits, and two `.env` examples.

## 1. The copyable blocks are safe - PASS

Extracted every ```` ```dotenv ```` fenced block from `README.md` and `CLAUDE.md` myself with a throwaway `tsx` script importing the REAL `hubConfigIsAbsent` / `tryLoadHubAuthConfig` from `apps/api/src/config/auth-provider.ts` (not the test's copies).

```
README.md   2 blocks   block 0 keys: FXL_HUB_API_URL, FXL_HUB_ENVIRONMENT, FXL_HUB_CLIENT_ID,
                       FXL_HUB_CLIENT_SECRET, FXL_HUB_AUDIENCE, FXL_HUB_HEALTH_TOKEN,
                       FXL_HUB_REDIRECT_URI, FXL_HUB_TRUSTED_ORIGINS, PUBLIC_LINK_BASE_URL
                       hubConfigIsAbsent = true   tryLoadHubAuthConfig = null
            block 1 (VITE_*)  absent = true  tryLoad = null
CLAUDE.md   identical, 2 blocks, both absent = true, both tryLoad = null
```

All five identity variables are BLANK in both blocks. `FXL_HUB_CONFIG` does not appear in the doc blocks at all, which is equivalent to blank for `hubConfigIsAbsent` and is the safe state; the `.env` examples do ship it explicitly blank. Neither block resolves to a partial config; both reach the `503 hub_auth_not_configured` door, which is the correct fresh-clone behaviour.

Re-ran the same probe over the four shipped example files for completeness: `apps/api/.env.example` and `.env.dev.example` both carry `FXL_HUB_CONFIG=` plus the five identity names blank, `FXL_HUB_HEALTH_TOKEN=` blank, `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback`, `FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006`; both `hubConfigIsAbsent = true`, `tryLoad = null`. The web examples carry only `VITE_FXL_HUB_*`, which are not inputs to the API's config loader.

## 2. The new tests are real and non-vacuous - PASS

The file has 17 tests on the branch and 9 on `master` (1 + 4 `it.each` over 2 examples). Delta is exactly the 8 claimed.

They read `README.md` and `CLAUDE.md` off disk through `readFileSync(new URL('../../../../../<name>', import.meta.url))` and hand the block body to the same `parseEnvExample`-shaped grammar, then to the REAL `hubConfigIsAbsent` imported from `auth-provider.ts`. Not a mock in sight.

**Mutation 1 - repopulate an identity variable.** Set `FXL_HUB_API_URL=http://localhost:9016` inside the `README.md` fenced block:

```
× the fenced dotenv blocks ... > describes an ABSENT Hub configuration in every README.md block
  Tests  1 failed | 16 passed (17)
```

Red. Restored; suite green again.

**Mutation 2 - vacuity.** Renamed the info string from ```` ```dotenv ```` to ```` ```env ```` in `README.md`, so the parser finds ZERO blocks:

```
× has a block in README.md that really names all five identity variables
× still SHOWS the known-good identity values, commented, in README.md
× keeps the callback off the Hub's own origin in README.md
  Tests  3 failed | 14 passed (17)
```

It fails loudly. The `describes an ABSENT ...` test does pass vacuously over an empty block list, exactly as its own comment says, and the vacuity guard (`expect(blocks.length).toBeGreaterThan(0)` plus `expect(hubBlocks).toHaveLength(1)`) is what refuses that - proven by mutation, not by reading the comment. Restored.

The parser is deliberately narrow (`/^```dotenv\n([\s\S]*?)^```$/gm`), and its only failure mode - finding too few blocks - is the one the guard covers.

## 3. Redirect uri described as an ORIGIN rule, never a presence rule - PASS

Verified against the installed bundle, `dist/chunk-DJ323EJE.js:4275`:

```js
function parseRedirectUri(value, apiUrl, environment) {
  if (value === void 0) { return `${apiUrl}/auth/callback`; }
```

An absent value defaults in EVERY environment. What refuses is in `dist/server.js:329` inside `assertBootConfiguration`:

```js
if (!isDevelopment && callbackOrigin === originOf(config.apiUrl)) { throw new HubConfigError('redirectUri', ...) }
```

An ORIGIN comparison. (There is also an https rule inside `parseRedirectUri` outside development, which does not change the analysis.)

Every description on the branch matches. `README.md`: "`FXL_HUB_REDIRECT_URI` is not governed by a presence rule. An absent value is not left absent: it DEFAULTS to ... and outside development the boot refuses any effective value whose origin equals the Hub's." `CLAUDE.md` line 56: "`FXL_HUB_REDIRECT_URI` IS NOT A PRESENCE RULE, and writing it as one is how this gets broken", with the same mechanism spelled out and an explicit warning that a future presence check would wave through the Hub-origin paste. `AUDIT.md` frames its item as a *confirmation* rather than a requirement, for the stated reason.

Grepped all four docs for `requir|must be set|always set|mandat` within a `REDIRECT_URI` line: no hit. The `.env` examples say "ALWAYS SET IT" and immediately continue "This is not a presence rule and there is no local resolver any more: an ABSENT value is not left absent, it DEFAULTS to ${FXL_HUB_API_URL}/auth/callback". That is operator advice with the mechanism attached, not a presence rule, and it does not lead a maintainer to write a presence check.

## 4. `FXL_HUB_TRUSTED_ORIGINS` as a DEPLOY-time gate only - PASS

Verified the local claim mechanically rather than taking it. `apps/web/vite.config.ts:53-55` proxies `/auth` with `changeOrigin: false`, so the upstream request keeps `Host: localhost:8006`. The SDK's guard (`dist/server.js:445-495`):

```js
function requestOwnOrigin(c) { ... `${proto}://${url.host}` ... }
...
const listed = origin !== undefined && trustedOrigins.has(origin);
if (origin !== undefined && !listed && origin !== requestOwnOrigin(c)) return 403;
if (site === 'cross-site' && !listed) return 403;
```

Browser `Origin: http://localhost:8006` equals `requestOwnOrigin`, and `sec-fetch-site` is same-origin, so the POST is admitted with the list empty. Local development genuinely needs nothing.

Both docs say exactly this. `README.md`: "`FXL_HUB_TRUSTED_ORIGINS` is a DEPLOY-time gate. Local development needs nothing from it ... Staging and production ... both must set it before the next deploy". `CLAUDE.md` line 119: "IS A PROMOTION GATE, not a `.env` matter ... a developer must never be told to set it" plus "STAGING AND PRODUCTION MUST SET IT before the next deploy". `AUDIT.md` carries it as an unchecked operator item with the value spelled out. Nothing tells a developer to set it locally.

The copyable blocks and the `.env` examples do ship `FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006`. `.env.example` states outright that the value is "shipped so the shape is documented rather than because a fresh clone requires it". I checked the value is inert locally: it makes the browser origin `listed`, which the own-origin branch already admitted. Not a defect.

## 5. No deleted symbol described as live - PASS

`git grep` over `CLAUDE.md` and `README.md` for all seven:

| symbol | hits | tense |
| --- | --- | --- |
| `hubConfigPresence` | CLAUDE.md:65 | "are all DELETED" |
| `HUB_DISCRETE_ENV_VARS` | CLAUDE.md:65 | same sentence |
| `HUB_FIELD_TO_DISCRETE_VAR` | CLAUDE.md:65 | same sentence |
| `nameDiscreteVar` | CLAUDE.md:65, 69 | "DELETED"; "ACCEPTED COST of deleting" |
| local health-token requirement | CLAUDE.md:65, 129 | "this repo's local requirement is deleted" |
| `HubAuthConfig` healthToken extension | CLAUDE.md:65, 66 | "now a bare alias of the SDK's `HubConfig`" |
| `resolveHubRedirectUri` | CLAUDE.md:63 | "is DELETED and must not come back" |

`README.md` names none of them. Every occurrence is a deletion or decision record. This is the legitimate use `CLAUDE.md`'s pathspec exemption exists for.

## 6. The `nameDiscreteVar` cost recorded honestly - PASS

Verified the claim against the bundle rather than accepting it. `dist/chunk-DJ323EJE.js:4119`:

```js
function message(field, wrong, correct) { return `hub-sdk: FXL_HUB_CONFIG.${field} ${wrong}. ${correct}.`; }
function operationalMessage(envVar, wrong, correct) { return `hub-sdk: ${envVar} ${wrong}. ${correct}.`; }
```

`parseRedirectUri`, `parseHealthToken`, `parseTrustedOrigins` and `parseSessionEncryptionKey` all call `operationalMessage` with the discrete name. The identity fields (`environment`, `apiUrl`, `clientId`, `clientSecret`, `audience`) all call `message`. Confirmed live:

```
loadHubConfig({API_URL, ENVIRONMENT, AUDIENCE})
  -> "hub-sdk: FXL_HUB_CONFIG.clientId is missing or empty. It looks like pk_<slug>_<environment>_<random>."
```

An operator on the discrete five is indeed pointed at `FXL_HUB_CONFIG.clientId`. The claim is exact.

It is recorded as a cost, not only as a deletion: `CLAUDE.md:69` ("ACCEPTED COST of deleting `nameDiscreteVar`, recorded rather than discovered later ... a diagnostic regression, knowingly taken to keep exactly one resolver, and it is filed upstream as 2.4.0 feedback") and `AUDIT.md` under "Accepted regression, recorded rather than left to be found".

## 7. Auth Model accurate against the code - PASS (two findings)

Spot-checked fourteen claims by reading source, not by plausibility.

| # | claim | verdict |
| --- | --- | --- |
| 1 | SDK pinned exactly `2.3.0`, no caret, in BOTH apps | correct (`apps/api/package.json:19`, `apps/web/package.json:16`) |
| 2 | `hono` pinned `4.12.28` by a `pnpm-workspace.yaml` override; 2.3.0's peer unchanged at `>=4.12.28` | correct (override present; SDK `peerDependencies` is `{"hono":">=4.12.28"}`) |
| 3 | `HubAuthConfig` is a bare alias of the SDK's `HubConfig` | correct (`auth-provider.ts`: `export type HubAuthConfig = HubConfig;`) |
| 4 | `hubConfigIsAbsent` reads the SIX credential names, not the four operational ones | correct (`HUB_CREDENTIAL_ENV_VARS`) |
| 5 | `tryLoadHubAuthConfig` returns null ONLY when `hubConfigIsAbsent` | correct, and there is no blanket try/catch in the file |
| 6 | boot assertion runs exactly once, inside `createHubBff`; this repo never calls it separately | correct - `git grep assertBootConfiguration -- apps/api/src` outside `__tests__` returns comments only |
| 7 | `healthToken`, `redirectUri`, `trustedOrigins` ride on CONFIG, never as `createHubBff` options | correct (`app-auth.ts:266-311`, none of the three keys passed) |
| 8 | `trustedOrigins` from `FXL_HUB_TRUSTED_ORIGINS`, NOT `env.CORS_ORIGIN` | correct (`env.ts:61`, resolved by `loadHubConfig` through `hubEnvBag`) |
| 9 | mount is the ordinary `router.route('', bff)` | correct |
| 10 | the two mount tests are now `does not 403 a cross-origin refresh from the trusted web origin, through the real mount` and `still 403s a cross-origin refresh from an origin that is not trusted` | correct, at lines 600 and 631; the self-correction of the earlier "keep their exact titles" claim is honest |
| 11 | `createHubBff` given `timeoutMs: 5_000` | correct (`HUB_BFF_TIMEOUT_MS = 5_000`) |
| 12 | sealer keyed from `FXL_HUB_CLIENT_SECRET` unless `SALES_SESSION_ENCRYPTION_IKM` overrides, read off validated `env` | correct (`app-auth.ts:263`) |
| 13 | `FXL_HUB_SESSION_ENCRYPTION_KEY` is read by nothing here | correct - it is absent from `env.ts`'s schema; every hit is a comment |
| 14 | `createAppAuthBff()` runs at module top level in `server.ts`, so a bad config is a real boot failure | correct (`server.ts:31`) |

**Finding A (minor, pre-existing, carried forward).** `CLAUDE.md:134` states "`@fxl-business/hub-sdk-testing` peer-requires the SDK at an exact `2.3.0`" as half the justification for the exact pin. That package is not in the dependency graph: it appears in no `package.json`, `node_modules/.pnpm` holds only `@fxl-business+hub-sdk@2.3.0`, and the only other mentions are in a parked plan under `nexo/plans/feature-20260827-...`. The clause was already on `master` (reading `2.2.0`) and this slice only bumped the number, so it is not a regression - but the version was asserted rather than verified, and the sentence describes a constraint this repo does not currently have. The pin itself is correct and its first justification ("the only spelling that survives an unrelated `pnpm install`") stands unaided. Recommend deleting the clause or re-grounding it when that package is actually installed.

**Finding B (minor, authored by this slice).** `README.md:44` and `CLAUDE.md:516` both introduce the block with "a partial set is a boot failure naming the missing variable". Against the shipped SDK, a partial DISCRETE set throws `hub-sdk: FXL_HUB_CONFIG.clientId is missing or empty` - it names the JSON field, not the discrete variable. That is precisely the `nameDiscreteVar` cost this same run records two sections up, so the prose is in mild tension with its own decision record. Nothing unsafe follows from it (the block is blank either way, and the failure is loud), but "naming the missing field" would be the accurate wording. Recommend the one-word fix in a follow-up.

Neither finding changes what an operator or maintainer does with these files, so neither blocks Gate 2.

## 8. The guard still works - PASS

`scripts/no-legacy-env-names.mjs` changed only in JSDoc; the `retired` array, `PATHSPEC` and the loop are byte-identical to `master`. Exercised it anyway.

Baseline: `node scripts/no-legacy-env-names.mjs` exits 0.

Planted each retired name as `apps/api/__guard_probe.ts` and staged it with `git add -N` so `git grep` sees it:

```
guard rejected HUB_SESSION_ENCRYPTION_KEY under apps/
guard rejected FXL_HUB_POST_LOGIN_REDIRECT under apps/
guard rejected FXL_HUB_POST_LOGIN_ERROR_REDIRECT under apps/
```

Tolerance: planted all three in `nexo/__probe/p.md` (staged) AND appended all three to `CLAUDE.md` at once - guard exits 0, "TOLERATES nexo/ and CLAUDE.md".

Canonical names: planted a staged file naming all nine (`FXL_HUB_API_URL`, `ENVIRONMENT`, `CLIENT_ID`, `CLIENT_SECRET`, `AUDIENCE`, `REDIRECT_URI`, `HEALTH_TOKEN`, `TRUSTED_ORIGINS`, `SESSION_ENCRYPTION_KEY`) - guard exits 0. The `-w` flag correctly spares `FXL_HUB_SESSION_ENCRYPTION_KEY`, of which the retired name is a strict suffix.

Every probe removed; `git status` clean of them afterwards. The guard's own `node --test` suite is 11/11 green.

## 9. Full green - PASS

| gate | result |
| --- | --- |
| `pnpm run lint` | green, api and web |
| `pnpm run type-check` | green, all four projects |
| `CI=true pnpm test` | shared-utils **80**, api **445**, web **784**, guard suites **11**, `no-legacy-auth` ok, `no-legacy-env-names` ok, `build-contract: ok` |
| `pnpm run build` | real build green (packages, api tsc, web vite `built in 1.83s`) |

Delta accounted for exactly: api 437 -> 445, `+8`, all of them in `apps/api/src/config/__tests__/env-example-contract.test.ts` (9 on `master`, 17 here). No other file gained or lost a test; shared-utils, web and the guard suites are unmoved. No fall anywhere.

## Independent adversarial checks

**Hunting the defect class, not the two known instances.** Enumerated every tracked artefact a human is told to copy or follow: `scripts/setup.sh`, `fxl-doctor.sh`, `docker-compose.yml`, `apps/api/Dockerfile`, `.github/workflows/ci.yml`, `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `docs/nexo/verify/06-financeiro-integration-uat.md`, and the four `.env` examples.

`git grep -i FXL_HUB` over all of them except the `.env` examples returns nothing - no other artefact writes a Hub variable at all. `scripts/setup.sh` scaffolds `apps/*/.env` by copying `.env.dev.example` (falling back to `.env.example`), both of which I ran through the real predicates above and both of which are absent. So the whole copy path a human follows - `bash scripts/setup.sh`, or the README/CLAUDE blocks by hand - now resolves to a clean absent config and a web-origin callback. I found no third instance of the class.

**No credential value in a tracked file.** Scanned for `pk_*_<env>_*` and `sk_*` shapes across all tracked files bar the lockfile. Every hit is a test or plan placeholder (`pk_fxl-sales_development_integration-test-client-id`, `sk_fxlfin_seed_placeholder`, and plan-document examples under `nexo/`). No real value. Every identity slot in every shipped example and doc block is empty.

**No access-gate, tenancy or UI file changed.** The diff touches no file under `apps/web/src`, no route, service or schema, and no middleware source. `app-auth-bff-production-boot.test.ts` changed in comments only; `scripts/no-legacy-env-names.mjs` changed in comments only.

## Conventions

- No em dash anywhere in the added lines (`git diff | grep '^+' | grep -c '—'` -> `0`).
- Commit message `docs(auth): align the env examples, README and CLAUDE.md with the 2.3.0 contract` carries no `Co-Authored-By` and no agent attribution.
- All test invocations were run-once (`vitest run`, `CI=true pnpm test`). No watcher started, no process killed by name.

## Recommended follow-ups (non-blocking)

1. `CLAUDE.md:134` - drop or re-ground the `@fxl-business/hub-sdk-testing` peer clause; the package is not installed (Finding A).
2. `README.md:44` and `CLAUDE.md:516` - "naming the missing variable" should read "naming the missing field", to agree with the recorded `nameDiscreteVar` cost (Finding B).
