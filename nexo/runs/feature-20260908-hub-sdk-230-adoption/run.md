# Run record - feature-20260908-hub-sdk-230-adoption

Flow: feature, autopilot. Trunk: `master`. Not promoted, not tagged, not deployed.

## Why this run exists at all

The prep run parked because `@fxl-business/hub-sdk@2.3.0` did not exist. It was published at
`2026-09-08T10:23:37Z` while this session was open, so the block lifted and the operator's standing
instruction - park if absent, adopt if present - took effect.

The publication was found by CHECKING rather than by being told. A teammate session reported a SPLIT
registry (the testing twin published, the SDK not) and asked us to stay parked. That was true for
about 2m38s: `hub-sdk-testing@2.3.0` landed at 10:20:59Z and `hub-sdk@2.3.0` at 10:23:37Z. The peer's
reading was stale by the time it arrived.

Before trusting the publish, the packaging was checked against this repo's `1.3.0` scar - a package
that INSTALLED fine and then failed to RESOLVE because `main`/`types`/`exports` pointed at
`./src/*.ts` while `files` shipped only `dist`. `npm pack` of 2.3.0 yields `dist/` (28 files),
`schema/`, `MIGRATION.md`, `package.json`, and no `src/`. The contract is in the shipped bundle, not
only in the plan: all nine canonical names, the four operational fields, and ADR 0014's
`[0-9a-fA-F]{64}` regex with its `openssl rand -hex 32` message.

## Slices

| # | Slice | Gate 2 | Merge |
| --- | --- | --- | --- |
| 04 | `sdk-230-bump` | PASS | `4821d6b` |
| 05 | `contract-single-resolver` | FAIL, then PASS on round 2 | `762117f` |
| 06 | `examples-docs-guard` | PASS | `8250d89` |

Integrated wave-verify PASS on the second dispatch; the first was lost to a stall.

## The correction that changed the design, and it came from the peer

The staged plan recorded D6 as "`FXL_HUB_REDIRECT_URI` is required outside development". That was
read from the Hub's plan file mid-revision and it is NOT what shipped. Verified in the bundle:

```js
function parseRedirectUri(value, apiUrl, environment) {
  if (value === void 0) return `${apiUrl}/auth/callback`;   // every environment, no branch
```

The refusal is check 7 of `assertBootConfiguration`, on the ORIGIN of the effective value:
`!isDevelopment && callbackOrigin === originOf(config.apiUrl)`.

The distinction is load-bearing rather than pedantic. Under the presence reading the natural build
is a boot presence assertion, which would be a SECOND and WEAKER encoding of a rule the SDK owns:
it waves through the operator who pastes the Hub's own callback, which is the fxl-finance outage.
`loadHubConfig` also never throws on an absent redirect, so a test asserting "absent in production
throws at config load" would fail and invite exactly that local rule.

Corrected in place, with the superseded wording left in the prep run's record as a CORRECTION block
rather than edited away.

## Reading the shipped bundle answered both parked stop conditions

- **`healthToken`.** The type comment says its requirement "is decided in `boot.ts`", which this repo
  does not consume - so a naive deletion would have removed a boot failure. But check 6 lives inside
  `assertBootConfiguration`, which `createHubBff` calls itself. Our local check is REPLACED, not
  dropped.
- **The post-login pair.** `CreateHubBffOptions` still declares both as code options and the contract
  never claimed them, so the prep run's `SALES_POST_LOGIN_*` rename stands.

## The footgun the peer caught, and the second defect it exposed

`createHubBff` calls `assertBootConfiguration` internally, spreading any code-level overrides over
the config before parsing. Calling it separately and then constructing the BFF from a different
options object would validate one configuration and construct another, and `redirectUri` is exactly
what they would disagree about. So: one call site, and `healthToken`/`redirectUri`/`trustedOrigins`
stopped being passed as options entirely.

Working that deletion through found something the plan had wrong on its own: `hubConfigPresence`
cannot simply be deleted. `tryLoadHubAuthConfig` answers a question the SDK has NO API for - has this
machine been given credentials at all - and that is what keeps `503 hub_auth_not_configured` alive
for a fresh clone. The obvious recovery, wrapping `loadHubConfig` in a `try/catch`, is the blanket
catch the file header forbids and would turn every misconfiguration into a silent 503. It shrank to a
minimal absent-check instead. Reported upstream; the SDK's authors reproduced it and are considering
a `hubConfigPresence` predicate for 2.4.0.

## Gate 2 failed slice 05, correctly, on MY premise

The plan justified making a partial config a boot failure with "a fresh clone is unaffected:
`.env.example` ships all five blank". It shipped THREE of five populated. So the documented
`cp .env.example .env && pnpm dev` produced a partial config and stopped booting, killing the
fail-soft door on the exact path it exists for. The assertion was never verified and it propagated
into the frame, the slice plan, the code header and a message to the peer.

The suite could not see it because every test hand-wrote its own env bag; nothing had ever read the
file a human is told to copy. That oracle now exists, reads both files off disk, drives the real
predicates, and carries a VACUITY GUARD - proven necessary, since a parser returning `{}` makes all
four absence assertions trivially green and only the guard catches it.

Slice 06 then extended the same treatment to the fenced `dotenv` blocks in `README.md` and
`CLAUDE.md`, which carried the identical trap one file over.

## Findings the agents produced that no plan anticipated

1. **The bump was not behaviour-neutral.** 2.3.0's check 7 refused a boot fixture that omitted a
   redirect and had therefore been defaulting onto the Hub's origin. That test's `not.toThrow()` half
   had SILENTLY stopped testing the health token. Repaired at the fixture; no assertion weakened.
2. **`type-check` is not a rename oracle here.** `EnvLike` is an index signature, so reverting a
   renamed key read through it compiles cleanly.
3. **A substring ban would have been wrong.** `HUB_SESSION_ENCRYPTION_KEY` is a strict SUFFIX of the
   canonical `FXL_HUB_SESSION_ENCRYPTION_KEY`; the guard uses `git grep -w`.
4. **`git grep` reads the INDEX**, so a green guard run on unstaged work proves nothing.
5. **An accepted diagnostic regression.** `operationalMessage` names the discrete variable for the
   four OPERATIONAL fields but the five IDENTITY fields still format as `FXL_HUB_CONFIG.<field>`, so
   deleting `nameDiscreteVar` costs a discrete-variable operator their variable name. Kept deleted -
   the handoff forbade a second copy, `field` is still exact, and a loud boot failure beats a silent
   503 - and reported upstream as 2.4.0 feedback.
6. **Two real doc bugs found in passing:** the Audience was documented as `product.fxl-sales`, which
   the SDK's own regex rejects, and the deleted `/auth/switch` was still listed.

## Verification

Per slice: named oracles plus lint on the diff, by a SEPARATE Verify agent that had not written the
code, each proving non-vacuity by mutating the real mechanism and observing RED.

Integrated `master`, cold: lint 0, type-check 0, `CI=true pnpm test` 0 (shared-utils 80, api 445,
web 784, guards 11), `pnpm run build` 0 with tsbuildinfo and all four `dist/` deleted first, both
guards 0, and the integration suite 0 (25 files, 169 tests) after confirming the local Docker DB was
up rather than letting it fall through to the staging database `apps/api/.env` points at.

Security clean on every axis. The SDK's messages now surface through our boot, so those were audited
too: the only values it interpolates are `trustedOrigins`, `redirectUri`, `apiUrl`, a URL protocol
and a key LENGTH. Client secrets and ids never appear.

## Not done, deliberately

No deploy, no promotion, no tag. Gate 3 untouched, last release remains v3.0.0. Operator items are in
`AUDIT.md` and are what make shipping safe; they are not needed while this sits on `master`.
