# exec 05 - `contract-single-resolver`

Branch `feat/05-contract-single-resolver`, from `master` at `5c7ff66`.

## What landed

`loadHubConfig` is now the only env resolver for the Hub contract, and
`createHubBff`'s own `assertBootConfiguration` is the only boot gate.

Deleted from `apps/api/src/config/auth-provider.ts`:

- `HUB_DISCRETE_ENV_VARS`
- `HubConfigPresence` and the `json` / `discrete` verdicts, including the two-forms ambiguity detection
- `HUB_FIELD_TO_DISCRETE_VAR` and `nameDiscreteVar`
- the local `healthToken` requirement
- `HubAuthConfig`'s `& { healthToken: string | undefined }` extension - it is now a plain alias of `HubConfig`

Deleted from `apps/api/src/middleware/app-auth.ts`:

- `resolveHubRedirectUri`
- the `healthToken`, `redirectUri` and `trustedOrigins` options to `createHubBff`
- the five-field projection of `hubSdkConfig`; the config now travels whole

`createHubBff` calls `assertBootConfiguration` itself, so this repo does NOT call it
separately, exactly as the amendment requires. One call site, one options object, no
possibility of validating one configuration and constructing another.

## What survived, deliberately

- `tryLoadHubAuthConfig`'s fail-soft door. `app-auth-unconfigured.test.ts` keeps its exact
  title and assertion; only the stale comment naming `hubConfigPresence` was updated.
- A MINIMAL absent-check, `hubConfigIsAbsent`, over the six credential-bearing names
  (`FXL_HUB_CONFIG` plus the five discrete ones). The four OPERATIONAL names are
  deliberately NOT members: none identifies a Client, so a stray `FXL_HUB_REDIRECT_URI`
  in a shell profile must not turn a fresh clone into a boot failure. That exclusion has
  its own test.
- No blanket try/catch. `auth-provider.ts` has no `try` at all now; the strict door is a
  one-line delegation to `loadHubConfig`.
- `hubEnvBag` as the bridge, with its sorted-key assertion. It gained
  `FXL_HUB_TRUSTED_ORIGINS` and the assertion was updated to match.

## The named behaviour change, pinned rather than absorbed

A PARTIAL discrete configuration - some of the five set, not all - used to answer `503`
and is now a boot failure carrying the SDK's own message. Its oracle is a NEW file,
`apps/api/src/middleware/__tests__/app-auth-partial-config.test.ts`, the exact complement
of `app-auth-unconfigured.test.ts`, whose title and assertion are unchanged (its stale
comment naming `hubConfigPresence` was updated).

**The premise under that change was FALSE, and Gate 2 caught it. See the section below.**

## `trustedOrigins` changed PROVENANCE - this needs an operator action before deploy

This is the one thing in the slice that reaches outside the repo, so it is stated plainly.

`trustedOrigins: [env.CORS_ORIGIN]` is gone. The value now rides on the config, resolved
by `loadHubConfig` from the canonical `FXL_HUB_TRUSTED_ORIGINS`, which was added to
`env.ts`. Acceptance criterion 4 asks for exactly that.

The consequence: **staging and production must set `FXL_HUB_TRUSTED_ORIGINS` in Infisical
before the next deploy.** Unset, `parseTrustedOrigins` returns `[]`, the browser's
cross-origin POST from `sales.*` to `sales-api.*` is refused, and that is the 2026-08-10
outage reproduced. This feature is explicitly no-deploy, so nothing is broken today, but
it is a gate on the eventual promotion and does not belong only to slice 06's `.env`
examples.

The guard is continuous across the change: dropping the value still reddens
`does not 403 a cross-origin refresh from the trusted web origin, through the real mount`,
proven below.

## A cost I am recording rather than hiding

The plan's deletion table justifies removing `HUB_FIELD_TO_DISCRETE_VAR` / `nameDiscreteVar`
on the grounds that "2.3.0's `operationalMessage` names the discrete variable itself".
Read against the shipped bundle, that is true only for the four OPERATIONAL fields. The
five IDENTITY fields still go through `message()`, which formats
`hub-sdk: FXL_HUB_CONFIG.<field> ...` - the JSON form - even for an operator who set the
five discrete variables.

So deleting the remapper is a small DIAGNOSTIC regression for that operator: a missing
`FXL_HUB_CLIENT_SECRET` now reports `FXL_HUB_CONFIG.clientSecret`. I deleted it anyway,
because the instruction is explicit and repeated, and because the cost is bounded - the
`field` is still exact, no behaviour changes, and the same operator now gets a LOUD boot
failure where they previously got a silent 503, which is a net gain in diagnosability.
The affected test was retitled from `... and names the client secret field` to
`... and names the offending field`, and its `toContain('FXL_HUB_CLIENT_SECRET')`
assertion dropped; `field === 'clientSecret'` and the no-secret-leak assertions stay.

Flagging it so the loss is a decision on the record rather than something discovered later.

## An unplanned but necessary fix: unit tests were coupled to the machine's `.env`

Three sales-ops route files (`routes`, `transition-routes`, `history-route`) failed to
IMPORT after the flip, with `HubConfigError: FXL_HUB_CONFIG.environment ...`. So did
`app-auth.test.ts`.

The cause is not the slice, it is what the slice stopped masking. `app-auth.ts` resolves
the Hub contract at MODULE scope - correctly, because `server.ts` calls
`createAppAuthBff()` at module top level and a bad configuration must be a boot failure.
Every test that transitively imports a router therefore inherits whatever
`apps/api/.env` holds. This machine's `.env` is a PARTIAL Hub config (it carries
`FXL_HUB_API_URL` and `FXL_HUB_REDIRECT_URI`, plus the pre-canonical
`FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY`). Under the old code that took the
fail-soft `incomplete` door and answered null. Under the new code it is the boot failure
the change exists to produce.

Fixed once, not four times: `apps/api/test/unit-setup.ts`, wired as `setupFiles` on the
non-integration branch of `vitest.config.ts`, blanks the six credential names so no unit
file inherits an ambient credential. Files that WANT a configured Hub stub their own
values in `beforeAll` behind `vi.resetModules()`; setup files run first and `vi.stubEnv`
overwrites, so all six Hub-configuring test files are unaffected - verified, they stayed
green throughout. `app-auth.test.ts` also got the same blanking in its own `vi.hoisted`
block, widened from the one name it already blanked, so the file states its own
independence.

Worth noting for whoever runs the API locally next: `pnpm dev` on this machine will now
REFUSE TO BOOT rather than answer 503, until `apps/api/.env` carries all five discrete
variables. That is the intended behaviour change working, and slice 06 owns the examples.

## Required oracles, and their non-vacuity - real output

All three were mutated to violate the property, confirmed RED, and restored.

**1. `refuses a redirect uri on the Hub's own origin outside development`**
(`app-auth-bff-production-boot.test.ts`, drives the real `assertBootConfiguration`)

Mutation: point the refused fixture at the browser origin instead of the Hub's.

```
 × refuses a redirect uri on the Hub's own origin outside development 2ms
   → expected the boot assertion to throw
      Tests  1 failed | 6 passed (7)
```

**2. `refuses a missing health token outside development`**

Written and watched PASS against the SDK BEFORE the local check in `auth-provider.ts` was
deleted (`7 passed` on the untouched source), so the deletion provably removed a duplicate
rather than a boot failure.

Mutation: supply the health token in the arm that is meant to throw.

```
 × refuses a missing health token outside development 1ms
   → expected the boot assertion to throw
      Tests  1 failed | 6 passed (7)
```

**3. `a partially configured Hub is a boot failure, not a 503`**
(new file `app-auth-partial-config.test.ts`)

Mutation: `hubConfigIsAbsent` restored to the old `incomplete`-is-absent semantics
(`.some` to `.every`).

```
 × a partially configured Hub > is a boot failure, not a 503 5ms
   → expected { …(8), …(1) } to be undefined
```

Four `tryLoadHubAuthConfig` tests went red with it, and
`app-auth-unconfigured.test.ts` stayed GREEN - which is the complement holding.

**Bonus, because it guards a real outage.** Blanking `FXL_HUB_TRUSTED_ORIGINS` in the
wiring test's setup:

```
 × carries the trusted web origin on the config rather than as a second option 3ms
   → expected [] to deeply equal [ 'http://localhost:8006' ]
 × does not 403 a cross-origin refresh from the trusted web origin, through the real mount 0ms
   → expected 403 not to be 403 // Object.is equality
      Tests  2 failed | 22 passed (24)
```

The second is end-to-end through the real mount, so the 2026-08-10 protection is
continuous across the provenance change.

## Verification - real exit codes

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean, both apps |
| `pnpm run type-check` | 0 | clean, all four projects |
| `CI=true pnpm test` | 0 | shared-utils 80, api 437, web 784, guard oracles 11 |
| `pnpm run build` | 0 | api + web built |
| `node scripts/no-legacy-auth.mjs` | 0 | |
| `node scripts/no-legacy-env-names.mjs` | 0 | |

### The api test delta, accounted for per file

Baseline 428. After the refactor alone it was still 428; after the Gate 2 fixes it is
**437**, `+9`. Per file:

| File | Before | After | Delta |
| --- | --- | --- | --- |
| `app-auth.test.ts` | 17 | 11 | -6 |
| `auth-provider.test.ts` | 12 | 13 | +1 |
| `app-auth-bff-production-boot.test.ts` | 6 | 8 | +2 |
| `app-auth-bff-wiring.test.ts` | 23 | 24 | +1 |
| `app-auth-partial-config.test.ts` | 0 | 2 | +2 |
| `env-example-contract.test.ts` (Gate 2) | 0 | 9 | +9 |

The `-6` is the whole `describe('resolveHubRedirectUri')` block, deleted with the resolver
it tested. Its coverage did not vanish, it moved UP a level onto the real
`assertBootConfiguration`, where it is one test rather than six because the SDK's rule is
one rule rather than four fallback branches. So the refactor itself was net zero, and the
`+9` is entirely the Gate 2 examples oracle.

## Gate 2 round 2 - two defects found and fixed on this branch

Gate 2 returned FAIL on the refactor's PREMISE rather than on the refactor. Both defects
were real, both are fixed here, and neither required weakening the partial-config boot
failure, which is correct and stays.

### D1 - the fail-soft door was dead on the exact path it exists for

The plan asserted, and I repeated without checking, that "`.env.example` ships all five
blank, which is `absent` and unchanged". False. Both examples shipped THREE of the five
identity variables populated - `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT` and
`FXL_HUB_AUDIENCE`, with only the two credential halves blank.

So a fresh clone following the documented "copy `.env.dev.example` to `.env`" step was
PARTIAL, not absent, and after the flip it could not boot at all:

```
 × reaches the 503 door rather than a boot failure from .env.example
   → hub-sdk: FXL_HUB_CONFIG.clientId is missing or empty. It looks like pk_<slug>_<environment>_<random>.
```

That is the fail-soft door killed on the one path it is for: a developer with no Hub
credentials who wants to work on sales-ops. `auth-provider.ts`'s header claimed the door
survived for a fresh clone, so the header was false as written.

Fixed in both `apps/api/.env.example` and `apps/api/.env.dev.example`: all five identity
variables now ship BLANK, with the three known-good non-secret values one uncomment away
on adjacent lines, in the files' existing comment style. The surrounding prose now states
the rule the contract actually enforces - all five together, or none - and says what each
state gets you (boot failure versus the 503 door).

This is honest rather than a workaround. Those three values are only meaningful alongside
a client id, so shipping them pre-filled always described a configuration that did not
exist.

### D2 - local login was silently broken, and that WAS my regression

Both examples ship `FXL_HUB_REDIRECT_URI=` blank, under a comment describing the
`${CORS_ORIGIN}/auth/callback` default that `resolveHubRedirectUri` used to supply. I
deleted that resolver and nothing replaced it for the development case.

An absent value now takes `parseRedirectUri`'s own default, `${apiUrl}/auth/callback` -
the HUB's origin. Check 7 refuses exactly that, but it is gated on `!isDevelopment`, so a
local clone BOOTS PERFECTLY CLEANLY and fails at the Hub with an unregistered
`redirect_uri`. Verified in the shipped bundle, not inferred.

Fixed by shipping the value in both examples:

```
FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback
```

The WEB origin and not the api one - vite proxies `/auth` from 8006 to the api on 3006 -
which is the value `CLAUDE.md`'s "Required API vars" block already documents, so the
examples now agree with the documentation rather than inventing anything. The stale
comment describing the deleted default is rewritten.

This does NOT conflict with D1: `FXL_HUB_REDIRECT_URI` is operational, not one of the five
identity variables, so setting it cannot make a configuration partial.

### The oracle that was missing, and would have caught both

`apps/api/src/config/__tests__/env-example-contract.test.ts` (9 tests). It READS the two
shipped files off disk, parses them, and drives the REAL `hubConfigIsAbsent` and
`tryLoadHubAuthConfig` rather than re-implementing either.

Every other test in the suite constructs its own env bag, so nothing in the repository had
ever read the file a human is actually told to copy. That is the whole gap, and it is why
a false premise survived planning and execution.

It asserts, per file: the Hub configuration described is ABSENT; the door answers null
rather than throwing; the callback's origin is NOT the Hub's `apiUrl` origin; and the three
known-good values are still SHOWN as comments so nobody has to guess the local Hub port.
It also carries a vacuity guard - every other assertion here has the form "nothing
Hub-shaped is set", which a parser returning `{}` would satisfy perfectly, so one test
reads a non-Hub variable back to prove the file was found and understood.

Non-vacuity, both directions, real output:

- Against the SHIPPED files before the fix: **8 of 9 RED**, including the D1 door failure
  quoted above.
- With `FXL_HUB_REDIRECT_URI` blanked again after the fix, the D2 assertion fails on the
  ORIGIN comparison rather than merely on a missing comment, which is the property itself:

```
 × keeps the callback off the Hub's own origin in .env.example
   → expected 'http://localhost:9016' not to be 'http://localhost:9016'
      Tests  1 failed | 8 passed (9)
```

The documented identity values are read back OUT of the comments rather than hard-coded,
so if someone changes the commented Hub URL the assertion follows it and still means "the
callback is not on the Hub these examples describe".

## Out of scope, left alone

- `CLAUDE.md` - slice 06, untouched here. Its "Auth Model" section now
  describes several things that no longer exist (`hubConfigPresence`, the healthToken
  option, `trustedOrigins: [env.CORS_ORIGIN]`, `resolveHubRedirectUri`) and needs the
  same-pass rewrite that slice already owns, including its now-stale "keep their exact
  titles" line. The `.env` examples were slice 06's too, but D1 and D2 made them blocking
  for THIS slice: without them `master` would carry a trunk on which a fresh clone cannot
  boot and local login is silently broken.
- `getHubSdkConfig()` in `app-auth.ts` has no caller in the tree. Not deleted here; it is
  unrelated to this contract and removing it is not this slice's business.
