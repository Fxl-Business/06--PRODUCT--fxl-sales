# Plan check - feature-20260827-hub-sdk-210-access-model

Adversarial review of the plan SET. I did not write any of these plans.
Every finding names a plan file, a section, and what breaks.

Verified against the unpacked 2.1.0 and 2.1.0-testing tarballs, the installed 1.3.1
tarball, and the working tree at `183333f`.

**VERDICT: PASS WITH REQUIRED EDITS.** The decomposition is sound. Five slices, four
waves, the right things in the right order. But three of the five plans will land RED
or lose an acceptance criterion as written, and two pairs of plans contradict each
other outright. The required edits are listed at the end.

---

## 1. COVERAGE

### 1.1 The feature goal

The set does achieve `00-OVERVIEW.md`'s two headline goals: the `product.<slug>`
audience derivation dies in 02 (`02-explicit-hub-config.md` section 2, "DELETE
`parseAudienceFromPublishableKey` entirely"), and the `sales.core` module gate dies in
03 (`03-access-entitlement-gate.md` step 1b). Both are correct fixes for real defects
at `apps/api/src/config/auth-provider.ts:11-17` and `apps/api/src/middleware/app-auth.ts:111-113`.

### 1.2 MIGRATION.md upgrade checklist, item by item

| # | Checklist item | Owner | Verdict |
|---|---|---|---|
| 1 | `pnpm add @fxl-business/hub-sdk@^2.0.0` | 04 §1.1 | OWNED. Exact `2.1.0` pin, justified by the testing package's exact peer. |
| 2 | `loadHubConfigFromEnv` to `loadHubConfig`, new variables | 02 §1 (vendored), 04 §2.1 (real) | OWNED but the handoff is broken. See finding C1. |
| 3 | Delete `deriveAudience` / `parsePublishableKeySlug` | 02 §2 | OWNED. The repo never called the SDK's; it hand-rolled its own, which 02 deletes. |
| 4 | Audience is `app.<slug>` | 02 (API), 04 §10 (web) | OWNED, but 02 and 04 disagree on whether `app.fxl-sales` may be written into a committed example file. See finding C6. |
| 5 | Port custom store: `get()` to `read()`, add `kind` | 01, 04 §4.1, 04 §22.3 | OWNED, and the two-step is correct. |
| 6 | `sessionStore` in every environment / `allowEphemeralSessionStore` | 04 §3.2 | OWNED. |
| 7 | `secureCookies` to `insecureCookies` | 04 §3.1 | OWNED, and correctly inverted once, at the single producer. |
| 8 | `healthToken` outside development | 02 §2 (carried), 04 §3.2 and §9 | OWNED. 04 §9.2's 404-when-unconfigured guard is a genuine improvement over the SDK's anonymous-in-dev default. |
| 9 | **Handle 402 and 403 from `requireHubAuth`, not just 401** | 03 (402 only) | **PARTLY UNOWNED. See finding U1.** |
| 10 | Move the four contract type imports | 04 §7.1 | OWNED. |
| 11 | Change the mount to `app.route('/', ...)` | 04 §8 | OWNED, and 04 adds the pin the repo never had. |
| 12 | **Pass an Organization id to `checkoutUrl` / `manageUrl`** | nobody | **UNOWNED, but null. See finding U2.** |
| 13 | Deploy, then `curl GET /auth/_health` | 04 §9, §19.18 | OWNED as far as this repo can go (the run makes no network call). |

### U1 - the 403 half of the taxonomy has no web owner, and the API now gates twice

`00-OVERVIEW.md`'s acceptance says "given a valid token without the membership, Seat,
module or role a route requires, then the answer is `403`". Two problems.

**(a) Nothing renders a 403 correctly on the web.** `03-access-entitlement-gate.md`
step 9a pins `isOrgAccessFailure rejects a 401, a 403 and a 500`, which means a 403
falls into the SAME generic "A API de vendas nao respondeu corretamente" panel that
step 7's own docstring calls out as the misdiagnosis this release exists to remove.
MIGRATION.md section 9 says a 403 should render an "ask an administrator" screen.
No slice owns that. This is not hypothetical after 04: 2.1.0's `requireHubAuth`
(`dist/server.d.ts`, the taxonomy table) answers `403 missing_role` whenever
`requiredRoles` is unmatched, and `403 missing_module` for `requiredModule`.

**(b) After 04 the API answers 402 twice, from two different places.**
`03-access-entitlement-gate.md` step 1b's own comment says slice 04 "replaces it with
`requireHubAuth`'s own option and deletes this". `04-sdk-210-flip.md` has a
"Reconciliation with slices 01 and 02" section (§22) and NO reconciliation with 03.
It never mentions `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` or
`requireHubModule`. So after 04 the SDK's own gate fires first and the repo's local
gate is unreachable dead code, still fully tested by
`apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` (which stubs
`requireHubAuth` and therefore keeps passing over dead code). Either decision is
defensible; the plans making OPPOSITE promises is not.

**(c) `401 contract_version_mismatch` is new in 2.1.0** (`dist/server.d.ts`, the
`requireHubAuth` taxonomy table: "A token whose `contractVersion` is not 1, including
an absent one"). No slice mentions it, no test covers it, and no doc records it.
It is benign (a 401 reaches the login screen, which is right), but 03 §10's CLAUDE.md
block claims to record the taxonomy exhaustively and would be wrong the day it lands.

### U2 - `checkoutUrl` / `manageUrl` (checklist item 12)

There is no production caller. `git grep checkoutUrl -- apps packages` returns only
the three `satisfies HubClient` mocks at `apps/web/src/auth/__tests__/react.test.tsx:20-21`,
`apps/web/src/__tests__/session-journey.test.tsx:44-45` and
`apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:20-21`, all of
which already declare them and take their signature from `HubClient[...]`, so the
Organization-id change flows for free. `04-sdk-210-flip.md` §11 lists them among the
ten members but never states the checklist item is a no-op. That is a gap in the
audit trail, not in the code. Say it once and move on.

### U3 - the local type declarations 01 leaves behind are never deleted

`01-session-store-read-contract.md`, "Exact type declarations", says "Slice 04 deletes
these declarations and adds the identifiers to the import above". The declarations are
`HubSessionStoreKind`, `HubSessionReadResult` and `HubSessionTransaction`.
`04-sdk-210-flip.md` §4.1 only instructs deleting the `get` member; §7.1 lists the
four CLAIM types and not these three. §22.4 restates §4.1 as "a pure deletion" and
still says nothing about the type declarations. Result: after 04 the repo carries
three local duplicates of SDK types. It compiles, so nothing goes red, but 01's stated
end state is not reached and `HubSessionReadResult` has two definitions in the tree.

### U4 - the SDK ships `loadHubPublicConfig` and `toPublicConfig`; 04 hand-rolls instead

`dist/config-CxunTdjI.d.ts:58,77` export both. `04-sdk-210-flip.md` §10.1 hand-writes
`loadHubBrowserConfig`. That is CORRECT (the SDK reads `FXL_HUB_*`, the browser has
`VITE_FXL_HUB_*`), but the plan never says why it is not using the SDK's, which is
exactly the kind of unexplained divergence a later reader reverts. One sentence.

---

## 2. CONFLICTS BETWEEN SLICES

### C1 - **04 reverts 02's entire config architecture and does not own the fallout. This is the largest defect in the set.**

`02-explicit-hub-config.md` §4 states the invariant in its own words: "Raw
`process.env` leaves this file completely." It builds `hubEnvBag`, `hubConfigPresence`,
`HUB_DISCRETE_ENV_VARS`, `HubEnvSource` and a `HubAuthConfig` that is
`HubConfig & { coreModule, healthToken }`. It removes the blanket `try/catch` and says
so as a design point: "There is no `try/catch` left in this file. That is the whole
point: today's blanket catch is what would turn a `product.` audience into a silent 503
instead of a boot failure."

`04-sdk-210-flip.md` §2.1 rewrites `auth-provider.ts` down to two exports, deletes
`HubAuthConfig`, takes `EnvLike` again, and **puts the blanket catch back**:

> `tryLoadHubAuthConfig(env)` ... `catch (err) { if (err instanceof HubConfigError) return null; ... }`

and §2.2 confirms the reversion in as many words: "`app-auth.ts` hands `process.env`
to `loadHubConfig`". §3.2 spells `resolveHubRedirectUri(process.env)`.

Consequences, each concrete:

1. **A feature acceptance criterion is lost.** `00-OVERVIEW.md` acceptance:
   "Given a configured environment that disagrees with the Client credential's
   environment segment, then the API refuses to boot, offline". Under 04's shape that
   throw is a `HubConfigError`, which 04's `tryLoadHubAuthConfig` swallows to `null`,
   which `appAuthMiddleware` answers as `503 hub_auth_not_configured`. The API BOOTS.
   Same for the `product.` audience and for the FXL_HUB_CONFIG ambiguity.
2. **02's oracle test 20 goes red and 04 does not list it.** 02's named test
   `refuses to boot on a product. audience rather than answering 503` asserts
   `expect(() => tryLoadHubAuthConfig(bag)).toThrow()`, and 02 explicitly calls it
   "the test that fails if anyone reinstates the `try/catch`". 04 reinstates the
   `try/catch`. 04 §17 lists `auth-provider.test.ts` edits and does not mention it.
3. **02's tests 19, 21, 22, 23, 25 go red and 04 does not list them.**
   - 19 `refuses to boot when FXL_HUB_CONFIG is set beside a discrete variable and names every offender` asserts the throw comes out of `tryLoadHubAuthConfig`. 04 §22.2 says to KEEP this test but 04's implementation returns `null` there.
   - 21 `requires FXL_HUB_HEALTH_TOKEN outside development` and 22 `does not require FXL_HUB_HEALTH_TOKEN in development` both read `HubAuthConfig.healthToken`, which 04 deletes.
   - 23 `projects exactly the Hub variables off the validated env object` tests `hubEnvBag`, which 04 deletes.
   - 25 `never leaks the client secret out of the optional loader` reads the ambiguity path through `tryLoadHubAuthConfig`.
4. **02's CLAUDE.md bullet becomes false.** 02 §6 writes into CLAUDE.md that Hub config
   is "read off the validated `env` object through `hubEnvBag`". 04 §18's CLAUDE.md list
   does not include correcting it.
5. **02's test 24** (`no API module derives the Hub audience from a key`) reads
   `../hub-config.ts`, which 04 deletes. 04 §22.2 gestures at re-pointing source guards
   but does not name this one.

This is not a small mismatch. It is two plans holding opposite positions on the single
question the feature exists to settle: is a bad Hub configuration a boot failure or a
503?

### C2 - **05 is written against a type 04 deletes, and its fixture is not assignable to the type 04 installs**

`04-sdk-210-flip.md` §7.1: "DELETE `MinimalHubAuthContext`. ... Every reference to
`MinimalHubAuthContext` becomes `HubAuthContext`."

`05-dev-identity-fixtures.md` §1a: "`MinimalHubAuthContext` is a structural SUBSET of
what `devAuthContext` returns", and §2a: "`const baseHubAuth: MinimalHubAuthContext =
devAuthContext('member');`". The symbol does not exist after 04.

Worse, the substitute does not fit. From the 2.1.0 tarball, `dist/index.d.ts:118-126`:

```ts
interface HubAuthContext {
  accountId: string;
  workspaceId: string;
  entitlements: HubEntitlements;
  roles: HubRoles;
  aud: string;
  claims: HubTokenClaims;
}
```

Six required members. `05`'s `devAuthContext` returns exactly three:
`{ accountId: claims.sub, workspaceId: claims.workspaceId, claims }`. It is missing
`entitlements`, `roles` and `aud`. **Slice 05 fails `tsc --noEmit` as written**, and
also fails the `declare module 'hono'` augmentation 04 §7.3 retypes to
`hubAuth?: HubAuthContext`, which is what `c.set('hubAuth', ...)` in
`routes.test.ts` and `history-route.test.ts` is checked against.

05's own §1a anticipates this ("If it is NOT assignable after slices 03 and 04, that is
a real finding") but treats it as a possibility. It is a certainty, readable off the
shipped `.d.ts`.

### C3 - **04 and 05 both replace `baseHubAuth`, with different fixtures, and 05 orphans 04's**

`04-sdk-210-flip.md` §7.4 creates `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts`
exporting `hubAuthContext(overrides)`, and §17 says the `baseHubAuth` fixture in
`app-auth.test.ts` "is REPLACED by `hubAuthContext()`", and that `routes.test.ts` and
`history-route.test.ts` move onto it too. It even says "Slice 05 re-points the claims
half of this at `devHubClaims`".

`05-dev-identity-fixtures.md` does not list `hub-auth-context-fixture.ts` in
`files_modified` at all. Its §2a/2b/2c replace all three consumers with
`devAuthContext(...)` from a NEW `dev-roster.ts`. Net effect: 04's fixture module is
created, then orphaned one wave later with no importer, contradicting 04's own comment.
Either 05 re-points 04's fixture (which is what 04 says will happen) or 04 should not
create it and 05 should own the whole thing.

### C4 - **05's roster literals are missing two REQUIRED `DevIdentity` fields**

From the testing tarball, `dist/index.d.ts:54-99`, `DevIdentity` requires `id`,
`label`, `exercises`, `accountId`, `activeOrganizationId`, `access`, `modules`,
`organizations`. `label` and `exercises` are NOT optional.

`05-dev-identity-fixtures.md` §1a gives `label` and `exercises` only for identities 1
and 6. Identities 2, 3, 4, 5 and 7 have neither. §1c's web roster gives neither for any
of its three. That is seven type errors and, if cast past, seven `assertDevRoster`
throws, which reddens 05's own oracle **T2** (`is a roster the Hub testing package
accepts`).

The GOOD news: 05's claim about required coverage is CORRECT. `dist/index.d.ts:128-135`
documents `REQUIRED_DEV_DENY_BRANCHES` as four branches with "`missing_module`,
`no_seat` and `not_a_member` are additionally SUPPORTED ... but not required", which is
exactly why 05's "do NOT put a `mintRefusal` organization in either roster" is sound and
why **T1** will pass once the literals are fixed. `DEV_TOKEN_ISSUER = "https://hub.invalid"`
(`dist/index.d.ts:188`) confirms **T5**'s expected `iss`. `DevOrganization.workspaceId`
(`:32-41`) confirms 05 used the right key name.

### C5 - does 02 keep `coreModuleFromAudience` alive the way 03 expects? YES, and 03's skip is correctly guarded

`02-explicit-hub-config.md` §2: "KEEP `coreModuleFromAudience`, which slice 03 owns, but
widen its prefix strip from `/^product\./` to `/^(?:app|product)\./`". Verified against
`apps/api/src/config/auth-provider.ts:19-22`: without the widen, `app.fxl-sales` would
yield `app.fxl-sales.core` and every existing 402 test would go red for an unrelated
reason. 02 calls that out under "Challenges the executor will actually hit". Good catch
by 02.

So `03-access-entitlement-gate.md` step 2's conditional ("Skip this step if slice 02
already did it") resolves to DO NOT SKIP, which is what 03's authors assumed. The only
textual drift is that 03 says to delete `coreModule: coreModuleFromAudience(audience),`
from a returned object literal, whereas after 02 it lives in
`return { ...config, coreModule: coreModuleFromAudience(config.audience), healthToken };`.
An executor will handle that. Not a defect.

Similarly 03 Step 3 fixture 5 (`auth-provider.test.ts:12-15`) will not exist after 02
rewrites that file, and 03's escape hatch covers it ("If slice 02 rewrote this test
file, keep whatever shape it asserts and add only the `not.toHaveProperty` line").
Fine.

### C6 - 02 and 04 disagree on whether `app.fxl-sales` may be committed

`02-explicit-hub-config.md` "Env example files" writes `FXL_HUB_AUDIENCE=app.fxl-sales`
into BOTH `apps/api/.env.example` and `apps/api/.env.dev.example`, and puts
`"audience":"app.fxl-sales"` in the JSON comment.

`04-sdk-210-flip.md` §14.4 writes `FXL_HUB_AUDIENCE=` (empty) into the same two files
with the comment "Hub-issued", and §14.3 says outright: "Do not invent `app.fxl-sales`
here; the operator confirms it."

One of these is wrong. Note the audience is NOT a credential (it is a public identifier,
and 02's rule 14 makes it derivable from the clientId slug anyway), so 02's position is
the defensible one, but the set must pick one.

### C7 - 04 never touches `hubSdkConfig` or `requireHubAuth`'s deleted `audience` option

`apps/api/src/middleware/app-auth.ts:85-92` declares `const hubSdkConfig: HubSdkConfig | null`,
`:150` returns it, `:153-155` is
`requireHubAuth(hubSdkConfig, { audience: hubAuthConfig.audience })`, `:159`, `:198`
and `:218` all read it.

MIGRATION.md section 9: "The `audience` option is REMOVED". `dist/server.d.ts`'s
`RequireHubAuthOptions` confirms it: `fetchImpl`, `allowWithoutAccess`,
`requiredModule`, `requiredRoles`, and nothing else.

`04-sdk-210-flip.md` §3.2 introduces `const hubConfig = hubAuthConfig;` and calls
`createHubBff(hubConfig, ...)`, but the plan NEVER instructs deleting `hubSdkConfig`,
never instructs changing `requireHubAuth(hubSdkConfig, { audience })` to
`requireHubAuth(hubConfig)`, and never instructs dropping
`import type { HubSdkConfig } from '@fxl-business/hub-sdk'` at `app-auth.ts:1`
(`HubSdkConfig` does not exist in 2.1.0). §17 only renames the type in the WIRING TEST.
That is three unowned compile breaks in the file 04's own §19 step 8 declares should
type-check clean.

### C8 - 04 §22.3 step 4 references an assertion slice 01 does not write

04 §22.3 step 4: "slice 01's `toBeInstanceOf(EphemeralHubSessionStore)` assertion
becomes `toBeInstanceOf(InMemoryHubSessionStore)`". Slice 01's oracle 7 writes no
`toBeInstanceOf` at all; it asserts `frozenStore(db).kind === 'persistent'`, the
envelope `kind === 'memory'` and `store.kind === 'ephemeral'`. The instruction is
harmless but names a thing that will not be there.

---

## 3. WAVE SAFETY

Wave 1 is 01 and 02, built in parallel worktrees and merged serially. Declared
`files_modified`:

**01:**
- `apps/api/src/auth/hub-session-store.ts`
- `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- `apps/api/src/auth/__tests__/hub-login-scope.test.ts`
- `CLAUDE.md`

**02:** `apps/api/src/config/hub-config.ts`, `apps/api/src/config/auth-provider.ts`,
`apps/api/src/config/__tests__/hub-config.test.ts`,
`apps/api/src/config/__tests__/auth-provider.test.ts`, `apps/api/src/env.ts`,
`apps/api/src/middleware/app-auth.ts`, `apps/api/src/middleware/__tests__/app-auth.test.ts`,
`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`,
`apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`,
`apps/api/src/auth/session-crypto.ts`, **`apps/api/src/auth/hub-session-store.ts`**,
`apps/api/.env.example`, `apps/api/.env.dev.example`, **`CLAUDE.md`**

### W1 - **TWO declared files overlap. This is a real wave-1 merge conflict, not a theoretical one.**

**`apps/api/src/auth/hub-session-store.ts`.** 01 rewrites the file header (`:1-29`),
the import block (`:32-38`), the interface bodies and `:237-287`. 02 §5 changes exactly
one line, `:27`, `FXL_HUB_SECRET_KEY` becomes `FXL_HUB_CLIENT_SECRET` - and `:27` is
INSIDE the header block 01 rewrites. Guaranteed textual conflict on the second merge.

**`CLAUDE.md`.** 01 replaces one sentence in the "HubSessionStore is ASYNC and
TRANSACTIONAL" paragraph of the Auth Model section. 02 adds a bullet to the same Auth
Model list and rewrites the Environments table and dotenv block. Different regions, so
git may auto-merge, but both are appending into the same bulleted list and a conflict
is likely.

Both are trivially avoidable: move 02's one-line comment edit at `hub-session-store.ts:27`
into slice 01 (which is already rewriting that header and already declares the file),
or into slice 04.

### W2 - under-declarations

- **02 under-declares `README.md`.** `README.md:45-46` and `:58` carry
  `FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2` and
  `FXL_HUB_SECRET_KEY=<operator-issued-secret>` in a block headed "Required API vars".
  After 02 those variables are removed from `apps/api/src/env.ts` and read by nothing,
  so `README.md` documents variables the API ignores for two waves. 04 §18 fixes it.
  This is a doc-drift under-declaration, not a merge hazard (nothing else in waves 1-3
  touches `README.md`), but 02's `files_modified` should carry it.
- **03 does not declare `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`**,
  which it only READS ("Copy the `vi.stubEnv` block VERBATIM"). Correct as declared.
- **04 declares `apps/api/test/rls/*.test.ts`.** Note that `apps/api/tsconfig.json`
  includes only `src/**/*`, so those two files are NOT covered by `pnpm run type-check`
  and NOT covered by `pnpm test`. 04 §20 correctly routes them to
  `pnpm --filter @fxl-sales/api test:integration` behind docker. Flagging so the
  verifier does not read a green `type-check` as proof those edits compile.
- I found no other under-declaration. 01's claim that
  `app-auth-bff-wiring.test.ts` needs no edit is correct: its `recordingSession()`
  fake is typed against the SDK's 1.3.1 `HubSessionTransaction` and `get()` survives
  slice 01.

---

## 4. ORDER

`depends_on`: 01 `[]`, 02 `[]`, 03 `[02]`, 04 `[01,02,03]`, 05 `[04]`. The derived
waves match.

### Is `depends_on` right?

- **03 -> 02 is real but soft.** 03's only reason to depend on 02 is its step 2 edit to
  `auth-provider.ts`. 02 explicitly KEEPS `coreModuleFromAudience` alive so 03 can
  delete it, so the dependency is a file-serialization dependency rather than a
  semantic one. It could have joined wave 1 alongside 01 if it dropped step 2 (its own
  "Skip this step if slice 02 already did it" shows the step is optional). Keeping it in
  wave 2 is the safer call. No change needed.
- **04 -> [01,02,03] is right.** 04 genuinely cannot compile without all three.
- **05 -> 04 is right** in ordering and wrong in content (finding C2).
- **Nothing in wave 1 needs anything from a later wave.** Confirmed.

### Can 03 really land green on 1.3.1, given 1.3.1's `requireHubAuth` has no 402?

**Yes, and that is precisely why 03 is shaped the way it is.** I verified 1.3.1 exports
no `RequireHubAuthOptions` and no access gate; 03 §"Facts this plan is built on" item 1
is accurate. 03 therefore owns the 402 locally, inside `appAuthMiddleware`, in exactly
the position the current code already owns a 402 at `app-auth.ts:171`. The only thing
that changes is the predicate and the response body. `hubAuthMiddleware` still runs
1.3.1's `requireHubAuth`, which 401s and 503s and nothing else, and 03's new
`app-auth-access-gate.test.ts` stubs it. This is the correct decomposition and it does
land green.

The unresolved question is the OTHER direction: 03 assumes 04 will delete the local
gate in favour of the SDK's, and 04 does not. See finding U1(b).

---

## 5. GREEN-AT-EVERY-MERGE

### Slice 01 - GREEN

- **The 1.3.1 typecheck question.** Slice 01's handle literal is
  `const handle: HubSessionTransaction = { read, get, update, delete }` where the local
  `HubSessionTransaction extends SdkHubSessionTransaction` and adds `read`. All four
  members are DECLARED on the annotated type, so there is no excess-property error.
  Handing `DurableHubSessionStore` to 1.3.1's `createHubBff` requires it to be
  assignable to 1.3.1's `HubSessionStore`; the extra `kind` property is fine (not a
  fresh literal), and the narrowed `withSession` callback parameter compares
  bivariantly because `withSession` is declared with method shorthand, which
  `strictFunctionTypes` exempts. **1.3.1's BFF still typechecks.** The
  `Omit<HubSessionStore, 'withSession'>` fallback 01 prescribes is a correct belt.
- Oracle 7's memory-branch half exercises `EphemeralHubSessionStore`, which 01 adds.
- `app-auth-bff-wiring.test.ts:250` asserts NOT an instance of `InMemoryHubSessionStore`
  on the durable path, so the new subclass cannot flip it. 01 checked this. Good.
- Lint, type-check, `pnpm test`, build: all green. The only failure mode is the wave-1
  merge conflict (W1), which is a process issue, not a red trunk.

### Slice 02 - **RED, or at best fragile**

1. **W1 merge conflict** with 01 on `hub-session-store.ts:27`.
2. **02 drops a claim without replacing it.** Today
   `apps/api/src/config/__tests__/auth-provider.test.ts:20-24` asserts
   `loadHubAuthConfig` THROWS `/FXL_HUB_SECRET_KEY/` on a missing secret. 02 says
   "`rejects missing secret keys` becomes the `incomplete` case", i.e. test 18, which
   asserts `tryLoadHubAuthConfig` returns `null`. That is a strictly WEAKER claim: it
   no longer proves the strict loader refuses an incomplete config, only that the soft
   one is soft. 04 §17 restores it as `rejects a missing client secret`. 02 should keep
   an equivalent rather than leave the gap open across two waves.
3. **The removed blanket catch makes a module-level throw reachable from a test file
   with no env stubs.** After 02, `app-auth.ts:84` is
   `tryLoadHubAuthConfig(hubEnvBag(env))` and `hubConfigPresence` THROWS on ambiguity.
   02 correctly stubs `FXL_HUB_CONFIG` blank in `app-auth-bff-wiring.test.ts` and
   `app-auth-bff-memory-path.test.ts` and says why. But
   `apps/api/src/middleware/__tests__/app-auth.test.ts` imports `../app-auth.js` at
   module scope with NO env stubs, so on a developer machine whose `apps/api/.env`
   carried `FXL_HUB_CONFIG` alongside the discrete variables, the whole file would
   crash at import. CI is safe (no `.env`). Cheap to close: stub it blank there too.
4. **`hubSdkConfig.publishableKey = hubAuthConfig.clientId`.** Correct: 1.3.1 sends it
   as `client_id`, and its `deriveAudience` is never reached because the audience is
   always passed explicitly. 02 flags this. Verified.

### Slice 03 - **RED on its own gates**

03's Verification section requires:

```
git grep -n -i "sales\.core" -- apps packages scripts
```

to print NOTHING. **03 itself writes `sales.core` into three places under `apps/`:**

- `apps/api/src/middleware/app-auth.ts`, step 1a's doc comment on `modules`:
  "The `sales.core` module was DELETED from the Hub's access model".
- `apps/api/src/middleware/__tests__/app-auth.test.ts`, step 5a's test
  `never reads entitlements.modules for baseline access`:
  `modules: ['sales.core', 'sales', 'core']`.
- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`, step 5b's test
  `answers 402 for a workspace that still carries the deleted core module but no access`:
  `modules: ['sales.core']`.

The last two are GOOD tests - they are exactly the "the defect, inverted" oracles - so
the fix is to narrow the grep gate (exclude `__tests__` and comments) rather than to
weaken the tests. But as written, 03 fails its own acceptance and
`04-sdk-210-flip.md`'s precondition 4
(`grep -rn 'coreModule\|sales\.core' apps/api/src apps/web/src # must be empty`) fails
too, which would make 04 STOP per its own instruction.

Otherwise 03 lands green. I verified there are exactly four `entitlements:` fixtures in
the tree (`app-auth.test.ts:15`, `:102`, `routes.test.ts:88`, `history-route.test.ts:53`)
and 03 accounts for all four, so making `access` required on `MinimalHubAuthContext`
reddens nothing else.

One correction to 03's §9b reasoning: it says `CadastroHistoryPanel` "is pure and
prop-driven, so this needs no `QueryClientProvider`, no api mock and no auth mock".
The EXPORTED `CadastroHistoryPanel` at `apps/web/src/sales-ops/CadastroHistoryPanel.tsx:77`
is indeed prop-driven (`{bootstrap, entries, error, hasMore, isError, isLoading, onRestore, restoringId}`),
so the claim holds for RENDER. But the module imports `./hooks` at `:31`, which pulls in
`@tanstack/react-query` and `@/auth/react` transitively; the existing
`cadastro-history.test.tsx` mocks `@/auth/react` and `@/components/ui/alert-dialog` for
exactly that reason. Expect to need at least the alert-dialog mock. Not a red, a
time-sink.

### Slice 04 - **RED as written**

Beyond C1 and C7 above:

- The 02-test fallout (C1, items 2 and 3) is six named tests going red with no
  instruction. 04 §21 claims "No test was deleted, skipped, retitled to a weaker claim,
  or had an assertion loosened", which cannot be true while §2.1 reinstates the catch
  that test 20 exists to forbid.
- **Does 02's vendored copy map the 1.3.1 field names?** Partly. 02 §4's `hubSdkConfig`
  block maps `clientId -> publishableKey` and `clientSecret -> secretKey` with a comment
  saying "Slice 04 renames them at the SDK boundary". 04 never performs that rename
  (C7). Also 04 §3.2's `encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubConfig.clientSecret`
  is right, and matches 02's change at `app-auth.ts:214`.
- 04's fixture value `sk_fxl-sales_development_unittestclientsecret` is 45 characters,
  clearing `createSessionSealer`'s 32-character floor. Verified against 04 §17's own
  warning. Good.
- 04 §16.2's boot-test bag sets `HUB_SESSION_ENCRYPTION_KEY=''`, which `emptyToUndefined`
  turns into `undefined`, so the sealer takes the HKDF-from-clientSecret path against a
  47-character secret. Fine.
- 04 §9.2's `if (env.FXL_HUB_HEALTH_TOKEN === undefined)` reads the VALIDATED env, where
  `emptyToUndefined` maps `''` to `undefined`, so a blank variable correctly 404s the
  route rather than mounting it anonymously. Correct.

### Slice 05 - **RED at type-check**

C2 (three-member fixture vs six-member `HubAuthContext`, and a deleted
`MinimalHubAuthContext`) and C4 (seven roster literals missing required `label` and
`exercises`). Both are `tsc --noEmit` failures before a test runs.

Residual, non-blocking: `apps/api/tsconfig.json` has `noEmit: false` and
`include: ["src/**/*"]`, so `apps/api/dist/auth/__tests__/dev-roster.js` WILL be
emitted into the production build output carrying a top-level import of
`@fxl-business/hub-sdk-testing`, which is absent from a `--prod` install. Nothing
imports it, so nothing breaks, and 05 §3 check 3 explicitly reasons about this dist
behaviour. Worth one sentence in the plan saying the emitted-but-unreachable artifact
is accepted.

---

## 6. TESTABLE ACCEPTANCE AND ORACLE QUALITY

Every slice has a testable `acceptance` line and named oracles with verbatim `it`
titles. This is the strongest part of the plan set. Specific judgements:

**Genuinely strong, non-vacuous oracles:**

- 01's oracle 1, `reports absent and leaves the row when the seal will not open`, with
  its in-test non-vacuity control (the identical row sealed with `IKM` returning
  `found`). That control is what proves the fixture is broken by the KEY and nothing
  else. Exemplary.
- 01's oracle 6, `never lets get() and read() disagree about the same locked row`,
  asserting `tx.recorded.deletes` is unchanged by the extra `get()`. This catches a
  second-lookup implementation that a status-only assertion would miss.
- 01's oracle 4, `reports absent and deletes nothing when there is no row at all`. This
  is the cheapest possible pin on the `absent` vs `expired` split and it is the exact
  rule MIGRATION.md section 4 states ("Report `expired` ONLY when you know the record
  existed and its TTL elapsed").
- 02's test 7, `refuses an environment that disagrees with the client id segment, and
  reaches no network`, with `vi.stubGlobal('fetch', spy)` throwing if called. That is
  how you prove "offline" rather than assert it.
- 02's test 13, `returns null for a key with no environment segment`, pinning the
  RETIRED literal shape. This is the test that documents why the committed key had to
  go.
- 03's `denies a claim set with no access key at all rather than allowing it` plus the
  hand-run fail-open probe in 03's Verification ("temporarily change `hasHubOrgAccess`
  to `!== false` and confirm BOTH go red. Revert."). Naming the mutation is the right
  standard.
- 04 §16.1's `pins entitlements.access as a real boolean rather than any under skipLibCheck`.
  `const accessIsNotAny: IsAny<HubEntitlements['access']> extends false ? true : false = true`
  is a genuine compile-time oracle: if the type degrades to `any`, the annotation
  resolves to `false` and the initializer fails to compile. The runtime `expect` beside
  it is decorative and the plan says so. This directly answers MIGRATION.md section 10.
- 04 §16.3's `mounts every BFF route under a single /auth prefix, never /auth/auth`.
  Recon found no existing pin on the composition; this closes checklist item 11.
- 04 §11.1's addition of `expect(mocks.client.getTokenResult).not.toHaveBeenCalled()`
  beside the existing `getToken` assertion, and its instruction "This is a
  strengthening. It must not be dropped if it is inconvenient."

**Oracles I would call weak or padding, but not vacuous:**

- 03's whole `describe('requireHubModule')` block. It tests a seam no route mounts and
  which 03's own comment says slice 04 deletes. It is not vacuous (it would fail if the
  function were wrong), but it is coverage for dead code that the set has already
  decided to remove. Given U1(b), decide the gate question first and this block either
  becomes load-bearing or becomes deletable.
- 05's **T2** `is a roster the Hub testing package accepts` is a vendor assertion
  wearing a repo-fixture hat. It is defensible as a guard on the roster literal.
- 02's test 14 `does not read NODE_ENV anywhere in the Hub config module` is a source
  grep. It is deleted one wave later with the file it reads (04 §22.2), so it buys one
  wave of protection. Acceptable given 02 must merge green alone.

**Vacuity flags:**

- **04 §16.2's `never passes insecureCookies outside development`**, spelled
  `expect('insecureCookies' in (bffOptions ?? {})).toBe(false)`. This is only
  non-vacuous because 04 §3.2 writes the option with a spread
  (`...(isHubDevelopment ? { insecureCookies: true } : {})`) so the KEY is genuinely
  absent. If an executor "simplifies" that to `insecureCookies: isHubDevelopment`, the
  key is present-and-false, the test goes red, and it will look like a test bug rather
  than what it is. Worth one sentence in the plan tying the two together.
- **04 §16.7's** `the app-level token reader is still named getToken`. It reads
  `src/auth/react.tsx` for the literal `const getToken = useCallback(` and
  `eslint.config.js` for `callee.name='getToken'`. That is a string match on
  formatting, not on behaviour: reformatting the declaration across two lines reddens
  it while the rule is intact, and moving the reader to a differently-spelled but
  equally matching form passes it. It is still better than nothing (the repo's own
  `route-error-and-auth-context.test.tsx` already uses this style) but it is the
  weakest new oracle in the set.
- **05's T1** `covers every deny branch the Hub contract requires a fixture roster to
  reach` is only meaningful because `REQUIRED_DEV_DENY_BRANCHES` is four specific
  branches. If a future testing-package release adds a fifth, this goes red on install,
  which is the point. Non-vacuous, and 05 explains it correctly.

Nothing in the set is an oracle that would pass with the change reverted, with the one
partial exception of 03's `app-auth-access-gate.test.ts` AFTER slice 04 lands: it stubs
`requireHubAuth`, so once the SDK owns the 402 the file is testing dead code and would
stay green even if `classifyHubAccess` were deleted from the middleware. That is finding
U1(b) restated as a test-quality problem.

---

## 7. WEAKENING

I looked hard. The set is unusually disciplined here.

**No plan instructs deleting, skipping or relaxing a test to make code compile.** The
closest things, in order of concern:

1. **02, "REWRITTEN `apps/api/src/config/__tests__/auth-provider.test.ts`"**:

   > "`rejects missing secret keys` becomes the `incomplete` case."

   This IS a reduction in what is proved. Today the test asserts `loadHubAuthConfig`
   throws naming the variable; the successor (test 18) asserts `tryLoadHubAuthConfig`
   returns `null`. The strict loader's refusal is no longer asserted anywhere in 02.
   04 §17 restores it. **Required edit:** 02 should keep a test asserting
   `loadHubAuthConfig` throws with `field === 'clientSecret'` on an incomplete bag.

2. **04 §22.2, deleting `hub-config.test.ts`.** This is handled RIGHT, and it is the
   model the rest of the set should follow. 04 states the rule explicitly ("Deleting a
   whole test file is a weakening unless the code under test is gone AND every claim
   those tests made is still made somewhere"), then splits the file in three: vendor
   re-assertions die with the module, boundary tests MOVE unchanged, and the two
   feature-acceptance tests are named and KEPT. No objection. (The mechanics collide
   with C1, but the discipline is correct.)

3. **04 §4.2 and §17**, renaming every `{ op: 'get' }` to `{ op: 'read' }` and every
   `reports absent` title to the 2.x wording. 04 pre-empts the objection: "That is the
   same assertion with the renamed op; it is NOT a weakening. There must be no place
   where an assertion is loosened to `expect.arrayContaining` or where a `toEqual`
   becomes a `toMatchObject`." Correct, and correctly forbidden.

4. **04's handling of the rotated-cookie non-vacuity oracle.** Exactly right.
   §5.3: `proves the rotation is genuinely lost without the wrapper, through the same
   real SDK handler` keeps its title and **must stay GREEN**, "which is the whole point:
   green means the defect is still there and the wrapper is still load-bearing". I
   independently confirmed the 2.1.0 regex at `dist/server.js` is byte-identical to
   1.3.1's `/(?:^|[,\s])fxl_hub_session=([^;]+)/` and still cannot match a `__Host-`
   prefixed name. The only edits are the `probe` literal gaining `kind` and the handle
   gaining `read`. No weakening.

   The one substantive move is retitling
   `persists the rotated refresh token ... on /auth/switch` to
   `... on an organization switch` and repointing it at
   `POST /auth/refresh` with `{organizationId}`. That is REQUIRED (2.0.0 deleted
   `/auth/switch`, MIGRATION section 11) and 04 STRENGTHENS it: the new assertion adds
   "`seen[0]` contains `/auth/refresh` AND contains `organizationId=org-2`", so an
   ordinary renewal cannot pass as a switch. Better than the test it replaces.

5. **04's handling of the origin-shim CSRF tests.** §6.3: "All 10 tests ... stay, with
   the same titles and the same assertions. The only edit is `buildBff()`'s config
   literal." And it DELETES the `as Parameters<typeof createHubBff>[0]` cast in favour
   of a real typed literal, which is a strengthening. The non-vacuity test
   `proves the guard is real by 403ing that same request without the shim` keeps its
   title and must stay green. I confirmed 2.1.0's `CreateHubBffOptions` still has no
   `origin`, `allowedOrigins`, `trustedOrigins`, `csrf`, `cookieDomain`, `cookieName`
   or `sameSite` key, so the shim is genuinely still load-bearing. No weakening.

6. **The fixture rewrites in 03 and 05.** 03 step 3 turns
   `entitlements: { modules: ['sales.core'] }` into `{ access: true, modules: [] }` and
   argues the case ("leaving the string in would keep a dead module alive in three
   fixtures and let a future accidental module read pass"). Each fixture proves what it
   proved. It also ADDS `expect(config).not.toHaveProperty('coreModule')` because
   "`toMatchObject` ignores extra keys, so without this line the deletion is not
   actually pinned". That is the right instinct and the right depth.

   05 §2a is explicit: "ONLY the fixture construction moves. No `it(...)` title, no
   `expect` argument and no control flow changes", and it provides the escape hatch
   "If slice 03 left a test whose denial variant is NOT expressible from the roster,
   LEAVE THAT TEST ALONE ... A weakened test is a worse outcome than an unswapped one."
   That escape hatch will be exercised: 03's `denies a claim set with no access key at
   all` and `denies a non-boolean access claim rather than coercing it` cannot be
   expressed through `DevIdentity`, whose `access` is a required `boolean`. Correctly
   anticipated.

**Verdict on weakening: one real instance (02's `rejects missing secret keys`), and it
is repaired one wave later.** Everything else is a rename or a strengthening.

---

## 8. SECURITY

**Nothing in the set fails OPEN in the request path.** 03's `hasHubOrgAccess` is
`auth?.claims?.entitlements?.access === true` with the reasoning spelled out
("the comparison is `=== true`, so `false`, `undefined`, `'true'`, `1` and a missing
`entitlements` object all deny"), and the `classifyHubAccess` verdict is a discriminated
union so the allow path carries the narrowed context with no cast. The fail-open probe
in 03's Verification is a real mutation test.

**One fail-SOFT regression, and it matters.** `04-sdk-210-flip.md` §2.1 reinstates the
`try { ... } catch (err) { if (err instanceof HubConfigError) return null; }` that
`02-explicit-hub-config.md` deliberately removed. That turns "this API is pointed at
the wrong Hub environment" and "this API asks for a `product.` audience the Hub never
mints" from a boot failure into a running API that answers 503 to everything. It denies
rather than permits, so it is not an auth bypass, but it defeats
`00-OVERVIEW.md`'s acceptance and it is exactly the "plausible-looking fallback"
MIGRATION.md's `assertBootConfiguration` docstring says this release exists to remove.

**Secret handling is good throughout.**
- 02 §"HARD CONSTRAINTS": "No error message may interpolate any INPUT VALUE", with
  named exceptions that are non-secret closed sets, and test 11 asserting neither
  `String(error)` nor `error.message` nor `error.stack` contains the secret AND that
  no console spy was called at all.
- 04 §16.2's `never puts the client secret or the health token in the /auth/_health body`
  asserts on the raw response TEXT, not just the parsed object. That is the right
  assertion: a stringified nested value would slip past a key check.
- 04 §9.3 forbids logging the health response, forbids wiring `/auth/_health` into
  `apps/api/src/routes/health.ts`, and forbids adding the token to `docker-compose.yml`.
- 04 §10.1 builds the browser config "from three named locals rather than by spreading
  `env`, so a secret in the environment can never reach the returned object by
  accident", pinned by §16.5's `never carries a client secret into the browser config,
  whatever the environment bag holds`.
- 01's Verification: "Nothing added by this slice may log a secret, a refresh token, a
  seal, a session id payload or a `HubSessionRecord`."

**The CSRF origin shim is preserved and its non-vacuity oracle stays green.** See
finding 7.5.

**05's "no runtime path" claim: VERIFIED, with one caveat.** The claim holds:
- 05 §"What this slice deliberately does NOT do" bans `createDevHubClient`,
  `mintDevToken`, `isDevToken` and `readDevTokenSubject` by name, and the verifier notes
  require `git grep` on all four to return nothing.
- Both rosters live under `__tests__/`.
- `scripts/dev-only-testing-package.mjs` check 3 fails on any mention of the package
  outside a `__tests__` or `/test/` path, and check 4 is a self-check ("A guard that
  cannot fail is not a guard") that runs the classifier over two in-memory manifests
  before touching disk. That self-check is the right move and I would not have expected
  it.
- The package's own `package.json` `comment` field confirms the mechanism: "`pnpm deploy
  --prod` and `npm install --omit=dev` both drop a devDependency by construction".

Caveat: `apps/api` emits its `__tests__` to `dist`, so the built API image will contain
`dist/auth/__tests__/dev-roster.js` importing a package that is absent from a
production install. Nothing reaches it, so it is inert, but the plan should say so
rather than leave a reviewer to discover it.

---

## 9. CREDENTIALS

**No plan step writes a real or guessed credential into a tracked file.** Checked every
literal.

- **02's confirmation is CORRECT, with one omission.** 02 does delete the committed
  `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2` literal from
  `apps/api/.env.example:11` and `apps/api/.env.dev.example:25`, and it gives the right
  reason: "it is not a valid 2.x client id (it has no environment segment) and keeping
  it would make the discrete form look complete while failing rule 9." 02 even turns
  that into an oracle, test 13 `returns null for a key with no environment segment`.
  Good.

  **The same literal survives in four more tracked files after 02:**
  `README.md:45`, `README.md:58`, `CLAUDE.md:387`, `CLAUDE.md:400`,
  `apps/web/.env.example:8` and `apps/web/.env.dev.example:11`. 02 §6 updates CLAUDE.md's
  Environments block (so `:387`/`:400` go), but 02 does not declare `README.md` and
  explicitly scopes the web `.env` files out. `04-sdk-210-flip.md` §14.3 and §18 remove
  all remaining copies. So the answer is: 02's claim is true for the files it owns, and
  the literal fully leaves the tree only at slice 04.

- **Nothing re-adds one.** Every replacement value is either empty or obviously
  synthetic:
  - 02's fixtures: `pk_fxl-sales_development_unit-test-only-0123456789`,
    `sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789`.
  - 04 §16.2: `pk_fxl-sales_production_boottestclientid`,
    `sk_fxl-sales_production_boottestclientsecret`,
    `boot-test-health-token-not-a-real-secret`.
  - 04 §17 / §12: `pk_fxl-sales_development_unittestclientid`,
    `sk_fxl-sales_development_unittestclientsecret`,
    `pk_fxl-sales_development_originshimtest`,
    `pk_fxl-sales_development_integrationtest`.
  - 05's roster: `hub-account-1`, `org_existing_1`, `acct_web_1` and so on, all
    reusing ids the existing tests already assert on.
  All are test inputs in test files, all are labelled, none has entropy. That is the
  correct line: the ban is on committed configuration, documentation and source.

- **`app.fxl-sales` is the one contested value.** 02 writes it into
  `apps/api/.env*.example`; 04 §14.3 forbids inventing it and ships the field empty. It
  is a public identifier, not a credential, and 02's own rule 14 makes it derivable from
  the clientId slug, so 02's position is the defensible one. But the set must be
  consistent. See finding C6.

- **04 §14 and §19.18 correctly refuse to touch the two gitignored `.env` files** and
  instead report the required operator actions. Right call.

---

## 10. HOUSE RULES

- **Em dashes and en dashes: CLEAN.** a grep for both dash characters over all six plan files
  returns nothing. Every plan carries `no em dash and no en dash on any added line` in
  its `rules`, and 05's verifier notes re-assert it. Note that the SDK's own shipped
  `.d.ts` contains an em dash (`session-store` docblock, "a `pg` Pool, a Drizzle
  instance ... - anything"), so the executor must not copy vendor comments verbatim
  into repo files. 04 §5.2 and §6.2 instruct re-quoting SDK line numbers, which is the
  place this could slip in. Worth one line of warning.
- **`--no-verify`: CLEAN.** The only two occurrences are prohibitions, both in
  `04-sdk-210-flip.md` (§19 step 17 and §21).
- **The fxl-hub repository: NOT touched.** No plan `cd`s into it, reads it or references
  a path outside this repo other than the read-only unpacked tarball.
- **Network calls to the Hub: NONE instructed.** Every SDK fact is read from the shipped
  tarball. 02's test 7 actively PROVES offline-ness with a throwing `fetch` stub. 03's
  `app-auth-access-gate.test.ts` stubs `requireHubAuth` specifically because "the real
  one calls `discover()` over HTTP on its first request". 04's supplementary assertions
  in §20 are all `pnpm why` / `grep`. `pnpm install` reaches the registry, which is
  unavoidable and is not a Hub call. Clean.

---

## VERDICT

**PASS WITH REQUIRED EDITS.**

The decomposition is right. Wave 1 stages the two independent, backportable contract
changes on the old SDK; wave 2 fixes the lockout defect on the old SDK; wave 3 is the
one unavoidably atomic bump; wave 4 is optional polish. That is the correct shape, and
the "keep master green on 1.3.1, delete the adapter in 04" discipline in 01 and 02 is
the strongest thing about the set.

But three plans land red as written, and two pairs contradict each other on the exact
question the feature exists to settle. Fix these before execution.

### Required edits, in priority order

1. **`04-sdk-210-flip.md` §2.1 and §2.2** - reconcile with what 02 actually builds.
   Either keep `hubEnvBag` / `hubConfigPresence` / `HubAuthConfig` / the no-catch rule
   and delegate only the PARSER to the SDK, or explicitly retire them and list every
   one of 02's tests 19, 20, 21, 22, 23, 24 and 25 in §17 with its replacement. Do not
   silently reinstate the blanket `try/catch`; it costs `00-OVERVIEW.md`'s
   "refuses to boot" acceptance criterion.
2. **`04-sdk-210-flip.md`, new section** - own `hubSdkConfig`. Instruct deleting the
   `HubSdkConfig` import at `apps/api/src/middleware/app-auth.ts:1`, deleting the
   `hubSdkConfig` local at `:85-92`, and changing `:153-155` to `requireHubAuth(hubConfig)`
   with the `audience` option removed per MIGRATION.md section 9.
3. **`05-dev-identity-fixtures.md` §1a and §2a** - rewrite against `HubAuthContext`.
   `devAuthContext` must return all six members (`accountId`, `workspaceId`,
   `entitlements`, `roles`, `aud`, `claims`), and every reference to
   `MinimalHubAuthContext` must become `HubAuthContext`.
4. **`05-dev-identity-fixtures.md` §1a and §1c** - add the required `label` and
   `exercises` fields to all seven API roster identities and all three web roster
   identities. They are non-optional on `DevIdentity`.
5. **`03-access-entitlement-gate.md`, Verification** - narrow the
   `git grep -n -i "sales\.core" -- apps packages scripts` gate so it excludes
   `__tests__` and the intentional doc comment in step 1a, or move the explanatory
   prose out of `app-auth.ts`. As written, 03 fails its own gate and trips 04's
   precondition 4.
6. **`02-explicit-hub-config.md` `files_modified`** - move the one-line comment edit at
   `apps/api/src/auth/hub-session-store.ts:27` into slice 01 (or 04) and drop the file
   from 02's list. It is a guaranteed wave-1 merge conflict with 01's header rewrite.
7. **`01-session-store-read-contract.md` and `02-explicit-hub-config.md`, CLAUDE.md
   sections** - state which paragraph each owns so the second merge is a clean append,
   or assign all CLAUDE.md edits for wave 1 to one slice.
8. **`03-access-entitlement-gate.md` and `04-sdk-210-flip.md`** - decide, once, whether
   the API keeps its own 402 gate or delegates to 2.1.0's `requireHubAuth`. 03's
   comments promise 04 deletes `requireHubModule`; 04 never mentions it. Whichever way
   it goes, add a slice-04 section reconciling with 03 the way §22 reconciles with 01
   and 02.
9. **New scope in `03-access-entitlement-gate.md` step 7 through 9** - add the 403
   branch to the web taxonomy (`isForbiddenFailure` or equivalent, and an
   "ask an administrator" panel), so `00-OVERVIEW.md`'s 403 acceptance criterion has an
   owner on the web side. Also record 2.1.0's new `401 contract_version_mismatch` in
   03 §10's CLAUDE.md taxonomy block.
10. **`02-explicit-hub-config.md` §"Named oracle tests"** - keep a test asserting
    `loadHubAuthConfig` THROWS with `field === 'clientSecret'` on an incomplete bag, so
    the claim today's `rejects missing secret keys` makes is not dropped for two waves.
11. **`02-explicit-hub-config.md` and `04-sdk-210-flip.md` §14** - agree on whether
    `FXL_HUB_AUDIENCE=app.fxl-sales` may be committed to an example file.
12. **`02-explicit-hub-config.md` `files_modified`** - add `README.md`, or state
    explicitly that `README.md:45-46,58` is left stale until slice 04.
13. **`04-sdk-210-flip.md` §4.1 / §22.4** - instruct deleting slice 01's local
    `HubSessionStoreKind`, `HubSessionReadResult` and `HubSessionTransaction`
    declarations and importing the SDK's, which is what 01's plan says will happen.
14. **`02-explicit-hub-config.md`** - stub `FXL_HUB_CONFIG` blank in
    `apps/api/src/middleware/__tests__/app-auth.test.ts` too, since removing the
    blanket catch makes a module-level throw reachable at import time there.
15. **`04-sdk-210-flip.md` §11** - state that MIGRATION checklist item 12
    (`checkoutUrl` / `manageUrl` taking an Organization id) is a no-op because the repo
    has no production caller, so the audit trail is complete.
