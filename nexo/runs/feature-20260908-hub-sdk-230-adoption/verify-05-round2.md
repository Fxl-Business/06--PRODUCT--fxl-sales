# Verify - slice 05, contract single resolver - ROUND 2

Branch `feat/05-contract-single-resolver`, one commit ahead of `master` (`762117f`, amended),
reviewed with `git diff master...HEAD`.
Nothing was merged, pushed or amended.
Every mutation below was restored and the working tree was confirmed pristine afterwards
(`git status --porcelain -- apps packages scripts` empty).
I am a different agent from the implementer and from round 1's verifier; every verdict below was
re-derived from the tree rather than taken from `verify-05.md`.

**VERDICT: PASS.**

Both blocking defects are genuinely closed, proven by driving the real loader over the real shipped
files myself. The new oracle is real, reads the artefacts off disk, drives the real predicate and the
real door, carries a working vacuity guard, and bites on all three mutations the brief named. The
refactor is undisturbed. The suite is green at 80 / 437 / 784 / 11 with the +9 fully accounted for.

One residual instance of the same defect class survives in `README.md` and `CLAUDE.md` (D6 below).
It is documentation-only, is off the instructed copy path, and is consumed by no tool or test, so it
is recorded as a non-blocking follow-up for slice 06 alongside round 1's still-open D3 and D4.

---

## Per-criterion verdicts

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | D1 really closed, proven against the real files | PASS |
| 2 | D2 really closed, web origin, agrees with CLAUDE.md | PASS |
| 3 | Setting the redirect did not re-break D1 | PASS |
| 4 | New oracle is real and non-vacuous | PASS |
| 5 | Refactor undisturbed, round-1 oracles still bite | PASS |
| 6 | Nothing else regressed | PASS |
| 7 | Commit message accurate | PASS |
| Adv A | Other artefacts of the same class | PASS with D6 recorded |
| Adv B | No secret value on a reachable error path | PASS |
| Adv C | No access-gate, tenancy or UI change | PASS |
| Conv | No em dash, no agent attribution | PASS |

---

## 1. D1 is really closed - PASS, proven against the real files

Not read off the new test's output. I copied a probe into `apps/api/src/config/`, imported the REAL
`hubConfigIsAbsent` / `tryLoadHubAuthConfig` / `loadHubAuthConfig` from `../auth-provider.js`, parsed
both shipped files verbatim, and deleted the probe afterwards.

```
=== .env.example ===
keys parsed: 19 | CORS_ORIGIN = http://localhost:8006
FXL_HUB set: [ 'FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback' ]
hubConfigIsAbsent: true
tryLoad -> NULL (503 door)

=== .env.dev.example ===
keys parsed: 20 | CORS_ORIGIN = http://localhost:8006
FXL_HUB set: [ 'FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback' ]
hubConfigIsAbsent: true
tryLoad -> NULL (503 door)
```

Both files now ship all five identity variables blank, with the three known-good local values
preserved as commented lines (`# FXL_HUB_API_URL=http://localhost:9016`,
`# FXL_HUB_ENVIRONMENT=development`, `# FXL_HUB_AUDIENCE=app.fxl-sales`).
`cp .env.example .env && pnpm dev` therefore reaches `503 hub_auth_not_configured` again, and
`auth-provider.ts`'s header sentence - "`.env.example` ships all five blank, which is still absent" -
is now TRUE rather than the false premise round 1 found.

`scripts/setup.sh` scaffolds `apps/*/.env` from `.env.dev.example` (line 263-275), so the automated
onboarding path lands on the fixed file too, and `docker-compose.yml` reads `env_file: apps/api/.env`,
which is derived from it. Both are therefore fixed by the same change.

## 2. D2 is really closed - PASS

Both examples now ship `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback`.

Driven through the real loader on the operator's own path (uncomment the three documented values,
paste a credential, keep the shipped redirect):

```
operator-path redirectUri: http://localhost:8006/auth/callback | apiUrl: http://localhost:9016
redirect origin: http://localhost:8006 | apiUrl origin: http://localhost:9016 | equal? false
```

- The callback origin is NOT the Hub `apiUrl` origin the same files describe (8006 vs 9016).
- It is the WEB origin, not the api origin (3006), which is correct: `apps/web/vite.config.ts:52-56`
  proxies `/auth` from 8006 to `VITE_AUTH_PROXY_TARGET` (3006) with `changeOrigin: false`, so the
  registered callback the browser actually visits is on 8006.
- It agrees byte for byte with `CLAUDE.md`'s "Required API vars" block, which documents
  `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback`.

The prose that round 1 found false is now true: `app-auth.ts` still says "The local development
convenience is preserved by SETTING `FXL_HUB_REDIRECT_URI` in the `.env` examples", and it now is.
The stale comment describing the deleted `CORS_ORIGIN` default is gone from both examples and is
replaced by an explicit "ALWAYS SET IT / there is no local default any more" block naming the
`${FXL_HUB_API_URL}/auth/callback` failure mode and the check-7 gating.

## 3. Setting the redirect did not re-break D1 - PASS, verified in code

`hubConfigIsAbsent` is `!HUB_CREDENTIAL_ENV_VARS.some((key) => isSet(bag[key]))` over exactly six
names: `FXL_HUB_CONFIG`, `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`,
`FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE` (`auth-provider.ts:80-126`).
`FXL_HUB_REDIRECT_URI` is not a member, and the file states outright why: none of the four
operational names identifies a Client, so counting one would turn a stray shell-profile variable into
a boot failure on a fresh clone.

Confirmed behaviourally as well as structurally: the probe above shows
`FXL_HUB_REDIRECT_URI` as the ONLY set `FXL_HUB_*` value in both files, and
`hubConfigIsAbsent` still answers `true` and the door still answers `null`.

## 4. The new oracle is real and non-vacuous - PASS, proven by four mutations

`apps/api/src/config/__tests__/env-example-contract.test.ts`, 9 tests, green at baseline.

**Reads the files off disk?** Yes - `readFileSync(new URL('../../../<name>', import.meta.url))`,
resolving to `apps/api/.env.example` and `apps/api/.env.dev.example`.
**Drives the real predicates?** Yes - it imports `hubConfigIsAbsent` and `tryLoadHubAuthConfig` from
`../auth-provider.js`, and the redirect case goes through `tryLoadHubAuthConfig` into the SDK's real
`loadHubConfig`, asserting on the resolved `config.redirectUri` / `config.apiUrl` rather than on file
text. There is no re-implementation of the absent rule anywhere in the file.

### Mutation A - point the reader at a nonexistent path

`EXAMPLES` changed to `["nope.env.example", "nope.env.dev.example"]`.

```
Failed Tests 9
  → ENOENT: no such file or directory, open '.../apps/api/nope.env.example'
```

All 9 RED. A missing file cannot pass as "nothing Hub-shaped is set", because `readFileSync` throws
rather than yielding an empty bag.

### Mutation A2 - the harder vacuity case: a parser that returns `{}` for a file that DOES exist

`if (trimmed === '' || trimmed.startsWith('#')) continue;` -> `if (true) continue;`.

```
× parses at all, so a green run below cannot mean an empty bag
  → expected undefined to be 'http://localhost:8006'
✓ describes an ABSENT Hub configuration in .env.example         <- VACUOUSLY GREEN
✓ describes an ABSENT Hub configuration in .env.dev.example     <- VACUOUSLY GREEN
✓ reaches the 503 door rather than a boot failure from ...      <- VACUOUSLY GREEN (x2)
× keeps the callback off the Hub's own origin in ... (x2)
✓ still SHOWS the known-good local values, commented, in ... (x2)
```

This is the decisive result. The four absence assertions really are satisfiable by an empty bag,
exactly as the brief warned, and the guard `parses at all, so a green run below cannot mean an empty
bag` is the only thing that catches it - it asserts a NON-Hub variable (`CORS_ORIGIN`) reads back and
that more than ten keys parsed. The guard is load-bearing and necessary, not decorative.

### Mutation B - re-populate `FXL_HUB_API_URL` in one example

```
× describes an ABSENT Hub configuration in .env.example
  → expected false to be true
× reaches the 503 door rather than a boot failure from .env.example
  → hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of ...
Tests  2 failed | 7 passed (9)
```

RED, and only for the mutated file - the `.env.dev.example` cases stayed green, so the two files are
independently pinned rather than sharing one fixture. Restored, `git diff` clean.

### Mutation C - blank `FXL_HUB_REDIRECT_URI` in one example

```
× keeps the callback off the Hub's own origin in .env.example
  → expected 'http://localhost:9016' not to be 'http://localhost:9016'
Tests  1 failed | 8 passed (9)
```

RED on the ORIGIN COMPARISON specifically (`expect(new URL(config.redirectUri).origin).not.toBe(new
URL(config.apiUrl).origin)`, line 145), not on a missing-line or text-presence check. Exactly the
property check 7 would assert if it ran in development. Restored, `git diff` clean.

Two further points in the oracle's favour, both checked by reading it:

- `documentedIdentity` reads the three values back out of the file's own COMMENTS via
  `^# KEY=(.+)$` and THROWS if a commented line is missing, so the redirect case cannot silently
  degrade into a hand-written fixture, and it follows the documentation if the Hub port ever changes.
- The dotenv reader errs toward "this counts as set" (it strips no quotes and expands nothing), which
  can only make the absence assertion stricter.

## 5. The refactor was not disturbed - PASS, re-proven by mutation

All three round-1 oracles still exist with their titles intact:

```
src/middleware/__tests__/app-auth-partial-config.test.ts:69      it('is a boot failure, not a 503', ...)
src/middleware/__tests__/app-auth-bff-production-boot.test.ts:168 it('refuses a missing health token outside development', ...)
src/middleware/__tests__/app-auth-bff-production-boot.test.ts:202 it("refuses a redirect uri on the Hub's own origin outside development", ...)
```

I re-proved the partial-config one myself rather than trusting round 1.
Mutation: `hubConfigIsAbsent` `.some` -> `.every`, which restores the old "partial falls into the null
door" semantics.

```
× a partially configured Hub > is a boot failure, not a 503
× a partially configured Hub > names the variable to fix rather than saying only that something is wrong
✓ src/middleware/__tests__/app-auth-unconfigured.test.ts (1 test)   <- stayed GREEN
```

RED on the partial oracle, GREEN on the unconfigured one in the same run - the two files are genuine
complements, and a partial Hub configuration is still a boot failure. Restored, `git diff` clean.

The examples oracle also reddened under that mutation (the fully-populated redirect bag stops
resolving), which is correct behaviour and further evidence it is wired to the real predicate.

`app-auth-unconfigured.test.ts` remains weakened in no way: its whole diff is two comment blocks plus
one added `vi.stubEnv('FXL_HUB_TRUSTED_ORIGINS', '')`. Title and assertion byte-unchanged.

## 6. Nothing else regressed - PASS, real runs and real exit codes

All from the repository root. `*.tsbuildinfo` deleted before the build.

```
$ pnpm run lint                          -> exit 0
$ pnpm run type-check                    -> exit 0   (api tsc --noEmit, web tsc --noEmit)
$ CI=true pnpm test                      -> exit 0
    packages/shared-utils   Test Files  3 passed (3)    Tests   80 passed (80)
    apps/api                Test Files 44 passed (44)   Tests  437 passed (437)
    apps/web                Test Files 56 passed (56)   Tests  784 passed (784)
    guards                  # tests 11  # pass 11  # fail 0
    build-contract: ok
$ pnpm run build                         -> exit 0   (api tsc + web vite, "built in 1.73s")
$ node --test scripts/__tests__/no-legacy-auth.test.mjs \
             scripts/__tests__/no-legacy-env-names.test.mjs -> exit 0 (11/11)
$ node scripts/no-legacy-auth.mjs        -> exit 0
$ node scripts/no-legacy-env-names.mjs   -> exit 0
```

Matches the claim exactly: 80 / 437 / 784 / 11.

**The api delta, accounted for.** Round 1 measured the true `master` baseline at 42 files / 428 tests
and the round-1 branch at 43 files / 428 tests (a +6/-6 wash: six `resolveHubRedirectUri` unit tests
deleted with the resolver, six added across `auth-provider`, `production-boot`, `wiring` and
`partial-config`). Round 2 is 44 files / 437 tests. The delta over round 1 is therefore +1 file and
+9 tests, and I measured the new file directly:

```
$ CI=true vitest run src/config/__tests__/env-example-contract.test.ts
 ✓ src/config/__tests__/env-example-contract.test.ts (9 tests)
```

9 tests = 1 vacuity guard + 4 `it.each` cases x 2 files. The entire rise over the 428 baseline is the
examples oracle, exactly as claimed. No other file's count moved.

## 7. The commit message is accurate - PASS, both round-1 inaccuracies corrected

- "**three** sales-ops route files at import" - corrected from "four", and re-measured by me. I removed
  the `setupFiles: ['./test/unit-setup.ts']` line from `apps/api/vitest.config.ts` and ran the api
  suite:

  ```
   FAIL  src/domains/sales-ops/__tests__/history-route.test.ts
   FAIL  src/domains/sales-ops/__tests__/routes.test.ts
   FAIL  src/domains/sales-ops/__tests__/transition-routes.test.ts
   ❯ loadHubAuthConfig src/config/auth-provider.ts:130 ❯ src/middleware/app-auth.ts:96
   Test Files  3 failed | 41 passed (44)
  ```

  Three, and the setup file is confirmed still load-bearing. Restored, `git diff` clean.
- "`app-auth-partial-config.test.ts`, the exact complement of `app-auth-unconfigured.test.ts`, **whose
  title and assertion are unchanged**" - corrected from "which is untouched", and the new wording is
  precisely true against the diff shown under criterion 5.

No new inaccuracy found. I checked every other factual claim in the message:
the deleted symbols, the `hubConfigPresence` -> `hubConfigIsAbsent` shrink, the `trustedOrigins`
provenance change and its deploy warning, the two new `assertBootConfiguration` oracles, the
"all five now ship blank with the known-good local values one uncomment away" claim, the
"both examples now ship the web origin callback CLAUDE.md already documents" claim, and the numbers
block (lint 0, type-check 0, 80/437/784/11, build 0, api +9) - all verified true above.

---

## Independent adversarial checks

### Other shipped artefacts of the same class - PASS, with D6 recorded

I swept every tracked file that a human is told to copy or follow.

| Artefact | Verdict |
| --- | --- |
| `apps/api/.env.example`, `apps/api/.env.dev.example` | FIXED and pinned |
| `scripts/setup.sh` | Safe. Copies `.env.dev.example` -> `.env` (lines 263-275), so it inherits the fix, and it already tells the operator to fill the Hub secrets |
| `docker-compose.yml` | Safe. `env_file: apps/api/.env`, derived from the fixed example. Its inline `environment:` block sets only `NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ORIGIN` - no `FXL_HUB_*` |
| `apps/api/Dockerfile` | Safe. No `FXL_HUB_*` |
| `apps/web/.env.example`, `apps/web/.env.dev.example` | Safe. Only `VITE_*` names, which the API loader never reads and which cannot make an API configuration partial. No callback value at all |
| `Makefile` | Safe. No env scaffolding |
| `README.md`, `CLAUDE.md` | **D6 - documentation drift, non-blocking** |

**D6.** `README.md:43-52` and `CLAUDE.md`'s "Required API vars" block each carry a fenced `dotenv`
block that still shows THREE of the five identity variables populated
(`FXL_HUB_API_URL=http://localhost:9016`, `FXL_HUB_ENVIRONMENT=development`,
`FXL_HUB_AUDIENCE=app.fxl-sales`) with `FXL_HUB_CLIENT_ID=` and `FXL_HUB_CLIENT_SECRET=` blank. Pasted
verbatim, that is a partial configuration and therefore this slice's boot failure - the same shape as
D1, reached through a different door, and made wrong by this slice rather than pre-existing.

I am recording it as non-blocking rather than failing the round, for three reasons, and I want the
reasoning on the record rather than the conclusion alone:

1. It is not the instructed copy path. `README.md:36` says "Copy each `.env.dev.example` to `.env`",
   and `scripts/setup.sh` does it automatically; the `dotenv` blocks sit under a "Hub Environment"
   heading and read as a listing of the Hub-related names and their local values.
2. No tool, script, test or container consumes either block.
3. Round 1 classified the analogous `CLAUDE.md` drift (D4) as non-blocking, and treating an identical
   documentation-accuracy issue as blocking here would be inconsistent grading, not stricter grading.

Both blocks' `FXL_HUB_REDIRECT_URI` is already correct (`http://localhost:8006/auth/callback`), so
D6 is the partial-config half only; there is no Hub-origin callback anywhere in the tree.

Fix, for slice 06 alongside D3 and D4: comment the three values in both blocks the same way the
examples now do, and add a one-line "all five together, or none" note.

### Round-1 carry-overs, re-checked

- **D3 (open).** `FXL_HUB_TRUSTED_ORIGINS` appears in NEITHER example file, so staging and production
  Infisical must gain `FXL_HUB_TRUSTED_ORIGINS=https://sales.fxlbusiness.com` before this deploys.
  I confirmed LOCAL development is unaffected by the absence, which round 1 did not establish:
  the SDK's guard (`dist/server.js:480-494`) allows a POST when
  `origin === requestOwnOrigin(c)`, and `apps/web/vite.config.ts:55` proxies `/auth` with
  `changeOrigin: false`, so the Host reaching the api is still `localhost:8006` and the origins match
  without any trusted list. `sec-fetch-site` is `same-origin` for the same reason. So D3 is a
  deploy-time operator action only, as the commit message discloses.
- **D4 (open).** `CLAUDE.md`'s "Its two mount tests keep their exact titles and assertions" still
  contradicts the tree; the two titles are now `... from the trusted web origin` and `... not trusted`
  (`app-auth-bff-wiring.test.ts:600,631`). Assertions unchanged, so nothing is weakened.
- **D5 (closed).** Criterion 7 above.

### No secret value on any reachable config error path - PASS

`auth-provider.ts` constructs no message at all; every message comes from the SDK's `HubConfigError`.
The diff adds no `console.*`, no logger call and no `process.stdout` / `process.stderr` write
(grepped over `git diff master...HEAD` for added lines). `auth-provider.test.ts` >
`never leaks the client secret out of the optional loader` and `app-auth-partial-config.test.ts`'s
`not.toContain(HUB_CLIENT_ID)` are both green.
The new oracle contains two obviously synthetic literals
(`pk_fxl-sales_development_unit-test-only-...`, `sk_..._not-a-real-secret-...`); they carry no entropy,
exist only because `loadHubConfig` resolves nothing without them, and are labelled as such in the file.

### No access-gate, tenancy or UI change - PASS

`git diff master...HEAD --name-only` is 15 files: the two api env examples, `config/auth-provider.ts`,
`env.ts`, `middleware/app-auth.ts`, six api test files (one new), `test/unit-setup.ts`,
`vitest.config.ts` and one `nexo/` notes file.
Zero files under `apps/web`, zero under `domains/`, zero migrations.
`app-auth-access-gate.test.ts` is byte-untouched. The only `requireHubAuth`-adjacent lines in the
`app-auth.ts` diff are two comment edits; `allowWithoutAccess`, the 401/402/403/503 deny taxonomy,
`withTenant` and every `orgId` filter are unchanged.

### Diff conventions - PASS

`git diff master...HEAD | grep -c '-'` -> 0. Commit message -> 0.
No `Co-Authored-By` and no agent attribution; the single match for "claude" is the phrase
"CLAUDE.md already documents", which is a file reference.

---

## What was mutated and restored

| Target | Mutation | Restored |
| --- | --- | --- |
| `env-example-contract.test.ts` | `EXAMPLES` -> nonexistent paths | yes, `git diff` clean |
| `env-example-contract.test.ts` | parser skips every line (`{}` for a real file) | yes, `git diff` clean |
| `apps/api/.env.example` | `FXL_HUB_API_URL` re-populated | yes, `git checkout`, clean |
| `apps/api/.env.example` | `FXL_HUB_REDIRECT_URI` blanked | yes, `git checkout`, clean |
| `apps/api/src/config/auth-provider.ts` | `.some` -> `.every` in `hubConfigIsAbsent` | yes, `git checkout`, clean |
| `apps/api/vitest.config.ts` | `setupFiles` removed for the three-file measurement | yes, `git diff` clean |
| `apps/api/src/config/__probe.mts` | throwaway probe driving the real loader | deleted |

`node_modules` was NOT mutated this round. Final state re-verified: `git status --porcelain -- apps
packages scripts` empty, and the full green run above was taken AFTER every restore.

---

## Consequences to carry into the release notes

Unchanged from round 1 except where noted:

1. A partial `apps/api/.env` now stops the API booting, with the SDK's own message naming
   `FXL_HUB_CONFIG.<field>` even for a five-discrete-variable operator. Developers whose `.env`
   predates the canonical names must fill all five or blank all five.
2. `FXL_HUB_TRUSTED_ORIGINS` must be set in staging and production Infisical before the next deploy
   (D3). Local development is confirmed unaffected.
3. Local Hub login is no longer silently broken on a fresh clone: the examples now ship the web-origin
   callback (D2 closed).
4. A fresh clone reaches `503 hub_auth_not_configured` again rather than failing to boot (D1 closed).
