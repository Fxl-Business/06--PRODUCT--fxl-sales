# Plan check round 2 - feature-20260827-hub-sdk-210-access-model

Adversarial re-review of the plan SET after the four replanners applied
`plan-check-round1.md`'s fifteen required edits plus the D10 staleness correction.
I did not write any of these plans.

Verified against the unpacked 2.1.0 and 2.1.0-testing tarballs, the installed 1.3.1
tarball, and the working tree at HEAD `84ac2a3`.

**VERDICT: PASS WITH REQUIRED EDITS.** All fifteen round-1 edits are APPLIED, and D1
through D10 are honoured. The set is materially better than round 1: the config
architecture no longer reverts, there is exactly one access gate after slice 04, the
403 has a web owner, wave 1's declared files are disjoint, and slice 05 now type-checks
against the real `HubAuthContext` and `DevIdentity`.

One BLOCKING defect survives, and it is a D10 staleness miss inside the very section
that claims to have re-verified against HEAD. Slice 04 asserts that MIGRATION checklist
item 12 is a no-op with "no production caller". That was true at `e59f870`. It is false
at `84ac2a3`: `apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105` calls
`client.checkoutUrl()` with no arguments, and 2.1.0 declares
`checkoutUrl(organizationId: string, sku?: string)`. Slice 04 lands RED on
`pnpm --filter @fxl-sales/web type-check` as written.

---

## 1. THE FIFTEEN ROUND-1 REQUIRED EDITS, ONE AT A TIME

Verified against the plan text, not against a plan's claim that it applied one.

| # | Edit | Verdict | Where |
|---|---|---|---|
| 1 | 04 must not revert 02's config architecture | **APPLIED** | `04` section 2.0 states the four "does NOT" rules verbatim (no blanket catch, no `EnvLike`, no raw `process.env`, `HubAuthConfig` kept) and section 2.1 reduces the change to one import line. Section 17's `auth-provider.test.ts` entry lists tests 19 through 25 and says slice 04 changes NOTHING in that file. |
| 2 | 04 must own `hubSdkConfig` | **APPLIED** | `04` section 7.5, new. Deletes the `HubSdkConfig` import at `:1`, the `hubSdkConfig` local at `:85-92`, the `getHubSdkConfig` export at `:149-151`, re-points `:159`, `:198`, `:218`, and changes `:154-156` to `requireHubAuth(hubAuthConfig)` with no options. It also greps for other readers and names the two test files, both already declared. |
| 3 | 05 rewritten against `HubAuthContext` | **APPLIED** | `05` section 1a's `devAuthContext` returns all six members with a per-member sourcing table; the "no assignability question left to discover" paragraph explicitly retires the `MinimalHubAuthContext` hedge. |
| 4 | 05's roster literals need `label` and `exercises` | **APPLIED** | `05` sections 1a and 1c. All seven API and all three web identities carry both, and each `exercises` value names a real `DevDenyBranch` member. |
| 5 | 03's `sales.core` grep gate | **APPLIED** | `03` Verification narrows to `':!*__tests__*'`, step 1a's `modules` doc comment no longer carries the literal, and `04` precondition 4 is narrowed identically. I ran the narrowed gate against HEAD and against what 03 instructs writing; see section 3 (D6) below. |
| 6 | Move 02's `hub-session-store.ts:27` edit | **APPLIED** | `01` has a new "Adopted from slice 02" subsection; `02` section 5 says the file is no longer declared and must not be touched. The two `files_modified` lists are disjoint. |
| 7 | One wave-1 `CLAUDE.md` owner | **APPLIED** | `01` Doctrine opens "This slice is the SOLE owner of `CLAUDE.md` in wave 1, confirmed"; `02` section 6 drops it and hands a fenced verbatim block to `03` step 10b, which carries both the Auth Model bullet and the Environments edits. |
| 8 | Decide the gate question once | **APPLIED** | D2 honoured on both sides. `03` has a titled "This slice's API gate is a DELIBERATE ONE-WAVE BRIDGE" section; `04` has a new section 23 with 23.1 through 23.6. |
| 9 | 403 web owner and `contract_version_mismatch` | **APPLIED** | `03` steps 7, 8a-8d, 9a-9c add `isForbiddenFailure`, `forbidden-copy.ts`, `ForbiddenPanel.tsx`, the four-arm chain, the second host, and the `[data-forbidden]` mutation oracle. `03` step 10a records `401 contract_version_mismatch`. |
| 10 | Keep the strict-loader throw claim in 02 | **APPLIED** | `02` named oracle 18a, `refuses an incomplete Hub configuration from the strict loader and names the client secret field`, with the explicit argument for why 18 alone is not a replacement. |
| 11 | Agree on `app.fxl-sales` in example files | **APPLIED** | D4 honoured. `02` "Env example files" writes it out and records the decision; `04` sections 14.1, 14.3 and 14.4 write it out too and the "do not invent `app.fxl-sales` here" instruction is gone. |
| 12 | 02 declares `README.md` | **APPLIED** | `02` `files_modified` line 19 plus a new section 7 covering `:45-46`, `:58` and the `:61-62` prose, with `:7` and `:24` explicitly deferred to slice 04 and recorded as known staleness. `04` section 18 anticipates the handoff. |
| 13 | 04 deletes slice 01's three local types | **APPLIED** | `04` section 4.1's "Delete slice 01's three local type declarations" block, with the SDK line references. Section 22.3 step 4 is corrected to slice 01's three property assertions and explicitly forbids inventing a `toBeInstanceOf`. |
| 14 | Stub `FXL_HUB_CONFIG` blank in `app-auth.test.ts` | **APPLIED** | `02`, CHANGED `app-auth.test.ts` section, with the module-scope-throw reasoning spelled out. |
| 15 | Say checklist item 12 is a no-op | **APPLIED as an instruction, WRONG as a fact** | `04` section 11 carries the sentence. See finding B1: the claim it makes is false at HEAD, so applying this edit installed a defect rather than closing one. |

---

## 2. BLOCKING FINDING

### B1 - `checkoutUrl` HAS a production caller at HEAD, and slice 04 lands RED on it

**Where.** `04-sdk-210-flip.md` section 11, the paragraph headed
"**MIGRATION checklist item 12 is a NO-OP here, and this sentence is its whole audit
trail.**", and section 24's "Unchanged and re-confirmed at HEAD" bullet about the three
`satisfies HubClient` mocks.

**What is wrong.** Read off the two tarballs:

```
1.3.1  dist/client.d.ts:51   checkoutUrl(sku?: string): Promise<string>;
1.3.1  dist/client.d.ts:53   manageUrl(): Promise<string>;
2.1.0  dist/client.d.ts:170  checkoutUrl(organizationId: string, sku?: string): Promise<string>;
2.1.0  dist/client.d.ts:172  manageUrl(organizationId: string): Promise<string>;
```

`organizationId` is REQUIRED and FIRST. Read off the tree at `84ac2a3`:

```
apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105        .checkoutUrl()
```

That is a zero-argument call inside a `useEffect` in a shipped component, added by the
`feature-20260828-organization-context-escape` run - the exact run D10 exists to account
for. Under 2.1.0 it is `TS2554: Expected 1-2 arguments, but got 0`.

**Concretely what breaks.** `pnpm --filter @fxl-sales/web type-check` fails at slice 04
step 12, and `pnpm run type-check` and `pnpm run build` fail with it. Slice 04's own
section 21 definition of done requires all three green. No step in the plan instructs
fixing it, and section 11 actively tells the executor there is nothing to do here.

**It is not a mechanical rename either.** MIGRATION.md section 14 says: "A link that did
not name one would land the user on their Primary Organization, which is not necessarily
the one they were looking at when they clicked." That is precisely this panel's failure
mode: `MissingEntitlementPanel` NAMES the active Organization on screen and then, today,
sends the operator to checkout for their PRIMARY one. So the correct argument is
`active.id` from the `useOrganizations()` seam the panel already destructures at line 68 -
and `active` is nullable by that seam's own documented contract, so the plan must also say
what the panel does when `active` is `null`. The honest answer is the existing
`CheckoutState` `failed` branch (never an anchor with an unresolved or empty destination,
which the panel's own docstring already forbids), not `checkoutUrl('')`.

**Blast radius the plan must also own.**
- `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` is NOT in slice
  04's `files_modified`, and section 24 explicitly clears it. Its checkout tests assert
  `toHaveBeenCalledTimes` only, so they probably survive an added argument, but a new
  `active === null` branch is a new case and the file must at minimum be re-read. Decide
  and declare, do not leave it to discovery.
- `apps/web/src/auth/__tests__/react.test.tsx:212` calls `client.checkoutUrl('sales.core')`
  and `:2062` asserts `toHaveBeenCalledWith('sales.core')`. Both still COMPILE and still
  PASS under 2.1.0, because a single string argument is now a positionally valid
  `organizationId`. So this is not a red, but it silently becomes a test that documents a
  module id being passed where an Organization id belongs. Slice 04 already declares that
  file; say what happens to those two lines.
- `manageUrl` has no production caller. That half really is a no-op.

**Required edit.** Delete the "NO-OP" paragraph from section 11 and replace it with a
step that owns `MissingEntitlementPanel.tsx:105`, its null-`active` branch, the two
`react.test.tsx` lines, and a declared re-read of `missing-entitlement-panel.test.tsx`.

---

## 3. DECISIONS D1 THROUGH D10

**D1 - boot failure, not 503. HONOURED.**
`04` section 2.0 forbids the blanket `try/catch`, the `EnvLike` parameter, handing raw
`process.env` to `loadHubConfig`, and deleting `HubAuthConfig`, each by name. Section 3.2's
`createHubBff` call spells `resolveHubRedirectUri(hubEnv)` where `hubEnv = hubEnvBag(env)`,
not `process.env`. Section 3.3 says "do not change them back to reading `process.env`".
`00-OVERVIEW.md`'s three refuse-to-boot criteria are therefore reachable, because
`tryLoadHubAuthConfig` still lets `hubConfigPresence` and `loadHubAuthConfig` throw.
Slice 02's tests 19 through 25 survive slice 04 unedited, and section 17 says so by name
with test 20 singled out. The one legitimate later change - slice 03 deleting `coreModule`
so the type becomes `HubConfig & {healthToken}` - is recorded identically in `02`, `03` and
`04`. I verified against the tarball that `loadHubConfig(env: Record<string, string | undefined>)`
takes exactly the bag shape `hubEnvBag` produces (`dist/config-CxunTdjI.d.ts:67`), so
handing it the twelve-key superset is correct.

**D2 - one access gate, the SDK's. HONOURED.**
`03` labels the local gate "a DELIBERATE ONE-WAVE BRIDGE" in those words, in a titled
section, and repeats it in the `CLAUDE.md` block. `04` section 23.2 deletes
`hasHubOrgAccess`, `hasHubModule`, `requireHubModule`, `classifyHubAccess`,
`HubAccessVerdict` and the 402 branch, keeps the `!hubAuth` 401 and the legacy assignment,
and forbids passing `allowWithoutAccess` even as `false`. Section 23.4's wiring pin states
plainly what it can and cannot prove: "It proves the WIRING ... It does NOT prove that a
402 comes back, because the real `requireHubAuth` calls `discover()` over HTTP ... A wiring
pin is the honest CEILING for an offline test here." That is exactly the honesty D2 asked
for. Verified against `dist/server.d.ts:85-113`: `RequireHubAuthOptions` has four members
and no `audience`, and the taxonomy table carries the 402 `no_org_access` row and
"All fail closed".

**D3 - 403 has a web owner. HONOURED.** See edit 9 above.

**D4 - `app.fxl-sales` may be committed. HONOURED, and the two plans now agree.**

**D5 - `files_modified` disjoint in wave 1. CONFIRMED INDEPENDENTLY.**
`01` = `{apps/api/src/auth/hub-session-store.ts, .../__tests__/hub-session-store.test.ts,
.../__tests__/hub-login-scope.test.ts, CLAUDE.md}`.
`02` = `{apps/api/src/config/hub-config.ts, .../config/auth-provider.ts, two config tests,
apps/api/src/env.ts, apps/api/src/middleware/app-auth.ts, three middleware tests,
apps/api/src/auth/session-crypto.ts, apps/api/.env.example, apps/api/.env.dev.example,
README.md}`. Intersection is empty. I do not disagree.
I also checked the file sets are COMPLETE for the rename: `git grep -l
"FXL_HUB_PUBLISHABLE_KEY\|FXL_HUB_SECRET_KEY"` over the API side returns exactly the files
these two slices declare between them, plus `packages/shared-types/src/env.ts`, which
carries only the `VITE_` names and is correctly slice 04's.

**D6 - slice 03 passes its own gate. REASONED THROUGH, PASSES.**
The gate is `git grep -n -i "sales\.core" -- apps packages scripts ':!*__tests__*'`.
Against HEAD it already prints nothing (the eight current hits are all under `__tests__`,
including two in `apps/web/src/auth/__tests__/react.test.tsx` that nobody had noticed and
that the un-narrowed gate would also have caught). After slice 03 the only new occurrences
are step 5a's `modules: ['sales.core', 'sales', 'core']` in `app-auth.test.ts` and step
5b's `modules: ['sales.core']` in `app-auth-access-gate.test.ts`, both under `__tests__`.
Step 1a's `modules` doc comment now says "CLAUDE.md's Auth Model section records which
module string that was" with no literal, and step 10a's prose is in `CLAUDE.md`, outside
the pathspec. The second gate,
`git grep -n "coreModule\|hasHubCoreEntitlement\|coreModuleFromAudience" -- apps packages scripts`,
is NOT narrowed and does not need to be: the six current source hits and the one test hit
(`auth-provider.test.ts:14`) are all deleted by steps 1b, 2 and 3. Slice 04's precondition
4 carries the identical narrowing. The gate passes.

**D7 - slice 05 complete against the real types. HONOURED, and the roster is valid.**
I hand-checked the roster against the shipped `assertDevRoster` and `devRosterCoverage` in
`dist/index.js`. `REQUIRED_DEV_DENY_BRANCHES` is `['access', 'no_org_access',
'missing_role', 'super_admin']` (`dist/index.js:2-7`), and the API roster reaches all four:
`access` from identity 1, `no_org_access` from identity 6 (live, since `org_no_access`
carries no `mintRefusal`), `missing_role` from any identity with no `productRoles`, and
`super_admin` from identity 3. So **T1** passes. `assertDevRoster`'s eight rules are all
satisfied, including the `modules` must be empty when `access` is false rule on identity 6
and the shared-`accountId`-across-identities case, which `assertDevRoster` permits (it
only uniques `id`). `devAuthContext`'s six members map exactly as `dist/server.js:221`
builds them. **T5**'s `iss: 'https://hub.invalid'` matches `DEV_TOKEN_ISSUER`.

**D8 - slice 04 owns every remaining `app-auth.ts` compile break. HONOURED.** Section 7.5
plus section 4.1's three-type deletion plus the corrected 22.3 step 4.

**D9 - the smaller edits. ALL APPLIED**, including the two vacuity items: section 3.2 now
carries an inline comment tying the `insecureCookies` spread to section 16.2's key-absence
assertion and back again, and section 16.7's formatting-string oracle is REPLACED by a test
that lints two in-memory sources through the real flat config, with an explicit
"DROP the test entirely and say so" fallback rather than a regression to the string match.

**D10 - reconcile against HEAD. HONOURED EVERYWHERE EXCEPT B1.**
`03`'s "Facts this plan is built on" item 7 marks the whole 402 web half ALREADY DONE and
drops `apps/web/src/lib/api-client.ts` from `files_modified`; step 6 is retained as a
cross-reference titled "is ALREADY DONE", exactly as D10 requires. `04` section 24 lists
six shipped symbols it must not create and tabulates seven corrected line references. I
spot-checked four of them against the tree and all four were right. The one class D10
named that section 24 did not sweep is a SIGNATURE change in a shipped web call site,
which is B1.

---

## 4. GREEN AT EVERY MERGE

Slices 01, 02 and 03 land on `1.3.1`; only 04 bumps.

### Slice 01 - GREEN

Unchanged in substance from round 1, which cleared it. The two edits it took are inert:
adopting the `:27` comment line is a comment inside a header block it was already
rewriting, and oracle 7 now enumerates its three property assertions and states it writes
no `toBeInstanceOf`, which adds no claim. `get()` survives, so the fifteen existing
`handle.get()` tests and the RLS integration tests stay green. The wave-1 merge conflict
that round 1 found is gone.

### Slice 02 - GREEN

The two things that made round 1 call it fragile are both closed. The `hub-session-store.ts`
conflict is gone (D5). The dropped claim is restored by test 18a. Test 14's `NODE_ENV`
source guard and test 24's `product.` source guard both hold: I checked that the widened
strip slice 02 writes is spelled `/^(?:app|product)\./`, whose source text contains
`product\.` and NOT the literal `product.`, so a substring guard does not trip on it.

One nit, N1: slice 02 also instructs "Add a one line comment saying slice 03 deletes it
along with the module gate" next to `coreModuleFromAudience`. If that comment happens to
spell `product.` prose, test 24 goes red on the plan's own instruction. Say "write the
comment without the literal `product.`" and the risk is zero.

### Slice 03 - GREEN

I traced the three ways this could redden and none does.

- The API 402 body changes to `no_org_access` in slice 03's commit 1. No existing test
  asserts the API's wire body: the nine web occurrences of `missing_entitlement` are all
  self-contained fixtures and titles, and there is no API test on the current 402 branch
  at all. So nothing goes red.
- `requireAdmin` really answers 403 (`apps/api/src/middleware/require-admin.ts:17`), so
  step 5b's `answers 403 for a role the route requires` and its 200 mirror both hold.
- `MiddlewareHandler` is already imported in `app-auth.ts:3`, so `requireHubModule`'s
  return type needs no new import.

Two nits, both internal contradictions the replan introduced rather than defects in the
work:

- **N2.** Step 7 says "the API still sends that code until slice 04 flips it", and the
  "What this slice deliberately does not do" list says the body change "happens in slice
  04". Both are false: step 1b's `NO_ORG_ACCESS` constant and step 5b's `toEqual` assertion
  and commit 1's own breaking-change footer all flip the body in THIS slice. The ACTION is
  the same either way (leave the web docblock alone; slice 04 corrects it), and slice 04
  section 23.5 gets the sequence right, so no executor is misled into a wrong edit. But the
  sentence is wrong and should say "this slice sends `no_org_access` from now on; the web
  prose is corrected in slice 04 so that the two waves are each internally consistent".
- **N3.** After slice 03, `CLAUDE.md` says `no_org_access` in the Auth Model taxonomy block
  and `missing_entitlement` in the Organization context section, in the same file, with the
  Auth Model block claiming the taxonomy is "exact and EXHAUSTIVE". Slice 04 fixes the
  second under 23.6. One wave of self-contradiction in the doctrine file is acceptable if
  it is recorded; it currently is not. One sentence in step 10a.

### Slice 04 - **RED, on B1**

`apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105` fails `tsc`. Everything else I
checked lands green:

- Section 7.5 closes the three `HubSdkConfig` breaks round 1 found.
- Section 11's ten-member mock block matches 2.1.0's `HubClient` exactly (I counted the
  ten members off `dist/client.d.ts:147-173`).
- Section 4.1's `get()` deletion is a pure deletion, because slice 01 implemented `get()`
  as a projection.
- Section 22.3's memory-branch retarget keeps slice 01's three property assertions valid,
  because 2.1.0's `InMemoryHubSessionStore` declares `readonly kind: 'ephemeral'` itself.
- The `hono` arithmetic is right: the 2.1.0 tarball's peer is `{"hono": ">=4.12.28"}`, so
  the override does not move.
- The testing package's peer really is an EXACT `{"@fxl-business/hub-sdk": "2.1.0"}`, which
  justifies the exact pin in section 1.1.
- Both tarballs ship `main: ./dist/index.cjs` with `files: ["dist", ...]`, so the 1.3.0
  packaging trap does not recur.

One further green risk, N4, small enough that a competent executor closes it in seconds
but which the plan should still name: `tsconfig.base.json` sets `"noUnusedLocals": true`.
Slice 03 adds `import { Hono } from 'hono';` to `app-auth.test.ts` solely for the
`requireHubModule` probe, and slice 04 section 23.3 deletes both new describes from that
file. The leftover `Hono` import, and any now-unused `MinimalHubAuthContext` import,
fail `type-check`. Section 17's entry for `app-auth.test.ts` should say so.

N5, cross-reference that does not resolve: section 23.3 says the `classifyHubAccess` and
`requireHubModule` describes are deleted "see section 17's entry for that file", but
section 17's entry for `app-auth.test.ts` says only "Whatever slice 03 left in place of the
two `hasHubCoreEntitlement` tests keeps its titles and only moves onto the fixture", which
reads as the opposite instruction. Make 17 point at 23.3.

N6, and this is the one I would most like fixed because it is doctrine: slice 03 writes a
`CLAUDE.md` bullet saying "`classifyHubAccess` in `apps/api/src/middleware/app-auth.ts` is
the single authority, allows only on `access === true`, and fails CLOSED". Slice 04 deletes
that function and section 18's `CLAUDE.md` list does not include rewriting the bullet, nor
does 23.6's table. After wave 3 the house doctrine names a function that does not exist.
Add the access-gate block to section 18's list: it becomes "the SDK's `requireHubAuth`
is the single authority, called with the loaded config and no options, and
`allowWithoutAccess` defaults to false".

N7, minor: slice 04's `hubAuthContext()` defaults `accountId` to `user_existing_1`, while
today's `maps Hub account and workspace ids into the Hono auth context` asserts
`userId: 'hub-account-1'`. Section 17 says every one of the six tests "keeps its title and
its assertion and only changes how the input is built, using the overrides", which forces
the executor to write `hubAuthContext({ accountId: 'hub-account-1' })` or to change the
default. Both work and slice 05 accommodates either ("THE ROSTER FOLLOWS THE FIXTURE"), so
this is not a red, but section 17 should spell the override on that first test the way it
spells `{ isSuperAdmin: true }` on the others.

### Slice 05 - GREEN

Given slice 04 lands as corrected. The roster validates, T1 through T8 are reachable, the
fixture re-point keeps `hubAuthContext`'s signature byte-compatible so its three consumers
do not move, and `routes.test.ts` / `history-route.test.ts` are correctly excluded from
`files_modified` and from the work. The emitted `apps/api/dist/auth/__tests__/dev-roster.js`
artifact is recorded and accepted against the real `apps/api/tsconfig.json`, which is what
round 1 asked for.

N8, cosmetic: `05` section 1a exports `devAuthContext`, but after the D7 rewrite nothing
imports it - `hubAuthContext` calls `devHubClaims` directly in section 2a, and the four
oracles use `devHubClaims`, `assertDevRoster` and `missingDevDenyBranches`. It is an
exported symbol so no lint rule fires, but it is dead. Either give T-something a use for it
or drop it and keep D7's six-member requirement satisfied by `hubAuthContext` alone.

---

## 5. NEW CONTRADICTIONS INTRODUCED BY THE REPLAN

Four agents edited four files in parallel. I looked specifically at the seams the brief
named.

**03 and 04 on the 402 body literal.** They AGREE on the outcome and disagree on the
narration. Both end with `no_org_access` on the wire and both leave the web prose
correction to slice 04. `04` section 23.5 traces the literal correctly through three
states. `03`'s step 7 and its does-not-do list narrate it wrongly. That is N2, a nit.

**03 and 04 on `require-token.ts` and `entitlement-dead-end.test.tsx`.** `04`'s edits are
genuinely ADDITIVE and say so: 23.6 carries a paragraph headed "**These two files are
shared with slice 03 and the edits here are ADDITIVE, not a rewrite**", instructing the
executor to read the post-03 file, keep the 403 branch and its test, and change only the
listed `missing_entitlement` literals. It even pre-empts the wrong move ("If a 403 docblock
also names a code, leave it alone"). And `03` step 7 says `isEntitlementFailure` "keeps its
current body and its current docstring verbatim". No conflict.

**04 and 05 on `hub-auth-context-fixture.ts`.** Resolved and documented on both sides. `04`
section 7.4 carries a "Handoff to slice 05, stated on both sides" paragraph and forbids the
orphan outcome; `05` section 2a declares the file, keeps `HubAuthOverrides`,
`FIXTURE_AUDIENCE` and the signature, and explicitly names the round-1 finding it is
closing. `05` also correctly refuses to touch `routes.test.ts` and `history-route.test.ts`.
No conflict.

**04 and 05 on identity id defaults.** Slice 05's concern 1 is real and is N7 above. It is
a one-line clarification in slice 04 section 17, not a contradiction: both plans point at
the same authority (the fixture), so they cannot end up disagreeing.

**02 and 03 on the carried `CLAUDE.md` block.** `02` section 6 puts the wording in a fenced,
clearly labelled block introduced by "Slice 03 carries the following two items VERBATIM";
`03` step 10b instructs taking it verbatim from that plan file and supplies a fallback
wording if it is absent. `03` also carries `02`'s Environments-table and dotenv edits, which
is correct because `02` declares no `CLAUDE.md` at all. The two texts I compared say the
same things. No conflict.

**One seam nobody owns cleanly**, and it is only a nit: `03` step 10a's Auth Model taxonomy
block and `04` section 18's `CLAUDE.md` list. `04` lists seven paragraphs to update and the
access-gate block slice 03 just wrote is not among them. That is N6.

---

## 6. ADJUDICATING THE REPLANNERS' OWN CONCERNS

**replan-01-02, five concerns.**
1. README `:58` handoff - REAL and ALREADY CLOSED. `04` section 18 says "Slice 02 has
   already emptied the committed `pk_fxl-sales_VzQ9-...` value on the API side and left the
   web line's variable NAME for this slice to rename, so expect the literal to be gone
   before you arrive; if it is still there, delete it here". Acceptable as recorded.
2. README `:7` and `:24` stale for two waves - acceptable as recorded; both plans say so and
   `04` owns them.
3. Test 24's guard does not trip on README prose - correct; I confirmed the pathspec is
   three source modules, not a repo-wide grep. Acceptable.
4. Where 02's `CLAUDE.md` block physically lives - RESOLVED. It is a fenced labelled block
   and `03` step 10b points at it. Acceptable.
5. Slice 01's `:27` line should land in commit 2, not the docs commit - correct, and slice
   01's sequence already puts "the file header comment" in commit 2. Acceptable.

**replan-03, four concerns.**
1. The web steps were stale and were reconciled - a CORRECTION the orchestrator did not ask
   for, and the right one. D10 endorses it after the fact. Acceptable.
2. Fact 2's "slice 04 changes no web contract" is API-true and web-stale - this is N2.
   Nit, fix the sentence.
3. and 4. Slice 02's labelled block, and whether 02 re-declares `CLAUDE.md` - both resolved
   in 02's favour and consistent across the two files. Acceptable.

**replan-04, five concerns.**
1. Deleting `app-auth-access-gate.test.ts` with a replacement file rather than outright -
   the replanner is RIGHT and its objection should stand. Three of the five surviving claims
   (`401 when the token is missing or invalid`, `401 missing_hub_context`, and the tenancy
   half of the allow case) have no other home. Acceptable, and the replacement file is
   correctly declared.
2. The 402 literal changes in 03 not 04 - correct, and section 23.5 says so. This is N2 seen
   from the other side. Acceptable.
3. Loading the real flat ESLint config inside vitest is unproven - acceptable, because the
   plan gives an explicit drop-rather-than-weaken fallback and forbids regressing to the
   string match. That is the right shape for an unproven oracle.
4. `files_modified` overlaps slice 05 on four paths - acceptable. Waves 3 and 4 are serial,
   and the handoff is documented on both sides.
5. Slice 03 writes a `describe` block whose whole life is one wave - acceptable, and argued
   at length in `03` (it is the only place in the set where this repo produces a 403 from its
   own code, and it is deleted under D2's name-every-claim rule).

**replan-05, four concerns.**
1. Identity 1's ids versus slice 04's defaults versus today's assertion - REAL, and it is
   N7. Fix it in slice 04 section 17, not in slice 05, exactly as slice 05 says.
2. `jti` can disagree with an overridden `sub` - acceptable as recorded. Nothing asserts on
   `jti` and inventing a second encoding would reintroduce the hand-rolling.
3. Roster identities 2, 4, 5 and 7 add nothing to REQUIRED coverage - acceptable. Identity 7
   is NOT padding: `verified-account` / `verified-org` are the ids `routes.test.ts` and
   `history-route.test.ts` assert on. 2, 4 and 5 document the variants `HubAuthOverrides`
   expresses. I would not cut them, but I would not defend them hard either.
4. Slice 04 was being edited concurrently, so re-read section 7.4 before executing - REAL
   and now discharged: I compared them and they agree.

---

## 7. WEAKENING

**The one file deletion is argued correctly and I accept it.** `04` section 23.3 splits
`app-auth-access-gate.test.ts`'s eight `it` blocks into three that die and five that move.
I checked each of the three against the code being deleted:
`answers 402 payment_required with no_org_access when entitlements.access is false`,
`answers 402 rather than allowing when the claim set has no access key` and
`answers 402 for a workspace that still carries the deleted core module but no access` are
all assertions about `classifyHubAccess`'s treatment of a claim shape, driven through a
STUBBED `requireHubAuth`. Once `classifyHubAccess` is gone, the decision happens inside a
verified-token path this repo does not own and cannot reach offline. The claims genuinely
die with the code. The five that move are middleware glue plus `requireAdmin` plus the
tenancy pin, and they are carried verbatim into `app-auth-sdk-gate-wiring.test.ts`, which
is declared.

**The replacement wiring pin does not overclaim.** Section 23.4 requires a comment in the
file saying what it proves and what it does not, and forbids a title implying more. That
is the right standard and it is met.

**No other weakening.** `04` section 21 now names the ONE exception in full and argues it,
which is the honest form of the claim round 1 said was untrue. Section 16.7's replacement
is a strengthening. Section 11.1's added `getTokenResult` assertion is a strengthening.
Section 4.2's `{op: 'get'}` to `{op: 'read'}` rename is the same assertion. Slice 05's
escape hatch for `03`'s two non-expressible tests is retained and correct (`DevIdentity.access`
is a required `boolean`, verified at `dist/index.d.ts:71`). Slice 03's step 9b adds
assertions to existing tests without editing any.

The two non-vacuity oracles that must stay GREEN rather than go red are both explicitly
protected: `proves the rotation is genuinely lost without the wrapper, through the same
real SDK handler` and the origin-shim's `proves the guard is real by 403ing that same
request without the shim`. I re-confirmed both are still load-bearing on 2.1.0.

---

## 8. SECURITY

**Nothing fails OPEN in the request path.** Slice 03's gate is `=== true` with optional
chaining and a hand-run fail-open mutation probe. Slice 04 deletes it in favour of the
SDK's, whose own table says "All fail closed", and forbids passing `allowWithoutAccess`
even as `false` with the reason spelled out. The `!hubAuth` 401 guard survives as the
fail-closed answer to an SDK that calls `next()` without a context.

**The fail-SOFT regression round 1 found is gone.** D1 killed the reinstated blanket catch;
`04` section 2.0 forbids it by name and section 2.1 keeps `tryLoadHubAuthConfig`'s
three-line body with its "may THROW and is not caught" comment.

**The new 403 predicate fails toward honesty, not toward access.** `isForbiddenFailure` is
a pure classifier over an already-received response; keying it on status alone can only
change which panel renders, never whether a request is permitted. `03` argues the
asymmetry the same way `CLAUDE.md` already argues it for 402.

**No credential is written into a tracked file.** Every new literal is synthetic and
labelled: `pk_fxl-sales_development_unittestclientid`,
`sk_fxl-sales_production_boottestclientsecret`, `boot-test-health-token-not-a-real-secret`,
`hub-account-2`, `org_no_access`, `acct_web_1`. The committed
`pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2` literal leaves every tracked file by the
end of slice 04, and slice 02 turns its invalidity into an oracle (test 13). Both gitignored
`.env` files are explicitly not touched, with the operator actions reported instead.
`app.fxl-sales` in example files is D4-permitted and is not a finding.

`04` section 9.3 still forbids logging the health body, wiring `/auth/_health` into
`routes/health.ts`, or putting the token in `docker-compose.yml`; section 16.2 still asserts
on the raw response TEXT. Slice 05's guard script keeps its self-check.

---

## 9. HOUSE RULES

- **Em dash and en dash: CLEAN.** A grep for both characters over all six plan files returns
  nothing.
- **`--no-verify`: CLEAN.** Two occurrences, both prohibitions, both in `04`.
- **fxl-hub repository: NOT touched.** No plan reads or writes it. The only `fxl-hub`
  strings are the package specifier `@fxl-hub/hub-auth`, discussed as an unresolvable
  dependency of the OLD SDK.
- **No network call to the Hub is instructed.** Every SDK fact is read from the tarballs;
  02's test 7 proves offline-ness with a throwing `fetch` stub; 03 stubs `requireHubAuth`
  because the real one calls `discover()`; 04's supplementary assertions are `pnpm why` and
  `grep`; 04 section 23.4 says outright that the end-to-end proof "is not claimed by any
  test in this repo".

---

## VERDICT

**PASS WITH REQUIRED EDITS.**

The set is close. One defect blocks execution, and it is a signature change in a shipped
web call site that section 24's HEAD re-verification swept past because it was looking for
symbols rather than for arities. Everything else below is a nit that can be recorded and
carried, though N6 is doctrine and I would fix it in the same pass.

### Required edits

**BLOCKING (1)**

1. **`04-sdk-210-flip.md` section 11** - DELETE the "MIGRATION checklist item 12 is a NO-OP
   here" paragraph, which is false at HEAD, and replace it with a step that owns the
   signature change. 2.1.0 declares `checkoutUrl(organizationId: string, sku?: string)` and
   `manageUrl(organizationId: string)`; `apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105`
   calls `client.checkoutUrl()` with no arguments and fails `tsc`. The step must: pass
   `active.id` from the `useOrganizations()` seam the panel already destructures; say what
   the panel does when `active` is `null` (the existing `CheckoutState` `failed` branch,
   never an anchor with an empty destination); say what happens to
   `apps/web/src/auth/__tests__/react.test.tsx:212` and `:2062`, which still compile and
   pass while now passing a module id where an Organization id belongs; and declare
   `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` for a re-read,
   removing it from section 24's "does NOT touch" list. Note the behavioural gain, since it
   is the panel's own subject matter: MIGRATION.md section 14 says an unscoped link lands
   the operator on their PRIMARY Organization, which is exactly the wrong one for a panel
   that names the ACTIVE one on screen. `manageUrl` has no production caller and that half
   really is a no-op.

**NON-BLOCKING (6)**

2. **`04-sdk-210-flip.md` section 18** - add the access-gate block to the `CLAUDE.md` list.
   Slice 03 writes "`classifyHubAccess` ... is the single authority"; slice 04 deletes that
   function, so after wave 3 the doctrine file names code that does not exist. It becomes
   "the SDK's `requireHubAuth`, called with the loaded config and no options, with
   `allowWithoutAccess` defaulting to false".
3. **`04-sdk-210-flip.md` section 17**, `app-auth.test.ts` entry - state that section 23.3
   deletes the `classifyHubAccess` and `requireHubModule` describes, and that the now-unused
   `import { Hono } from 'hono'` (and any unused `MinimalHubAuthContext` import) must go with
   them, because `tsconfig.base.json` sets `"noUnusedLocals": true`. As written, section 17
   reads as the opposite instruction and section 23.3's cross-reference to it does not
   resolve.
4. **`04-sdk-210-flip.md` section 17**, same entry - spell the override on the first test:
   `hubAuthContext({ accountId: 'hub-account-1' })`, since that test asserts
   `userId: 'hub-account-1'` and the fixture defaults to `user_existing_1`. Slice 05 already
   states that its roster follows whatever slice 04 leaves, so either resolution works, but
   naming it removes the one place an executor could be tempted to edit an assertion.
5. **`03-access-entitlement-gate.md` step 7 and "What this slice deliberately does not do"**
   - correct the two sentences saying the API "still sends `missing_entitlement` until slice
   04". This slice sends `no_org_access` from its own commit 1. The instruction to leave the
   web prose alone is right and should stay; only the reason changes.
6. **`03-access-entitlement-gate.md` step 10a** - record that `CLAUDE.md`'s Organization
   context section will still read `missing_entitlement` for one wave while the Auth Model
   block reads `no_org_access`, and that slice 04 closes it under 23.6. The Auth Model block
   claims the taxonomy is "exact and EXHAUSTIVE", so the one-wave disagreement should be
   dated rather than discovered.
7. **`02-explicit-hub-config.md` section 2** - when instructing the one-line comment beside
   `coreModuleFromAudience`, say it must not contain the literal `product.`, since this
   slice's own test 24 greps `auth-provider.ts` for exactly that string. The widened regex
   `/^(?:app|product)\./` is safe (it spells `product\.`); a prose comment would not be.

**NIT, record and carry (1)**

8. **`05-dev-identity-fixtures.md` section 1a** - `devAuthContext` has no importer after the
   D7 rewrite, because section 2a's `hubAuthContext` calls `devHubClaims` directly and the
   four oracles do not use it. Either use it or drop it; D7's six-member requirement is
   satisfied by `hubAuthContext` either way.
