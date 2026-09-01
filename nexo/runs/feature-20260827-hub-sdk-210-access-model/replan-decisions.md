# Replan decisions - feature-20260827-hub-sdk-210-access-model

Written by the orchestrator on 2026-09-01, consuming replan unit 1 of 3.

`plan-check.md` returned PASS WITH REQUIRED EDITS with fifteen edits. Several of them
are not edits at all: they are questions the checker correctly refused to answer on the
plans' behalf, because two plans held opposite positions and only one owner can settle
it. This file settles them ONCE. Every replanner treats this file as binding and
`plan-check.md` as the evidence behind it.

The decomposition, the wave order and `depends_on` are NOT reopened. The checker
approved them and this replan changes only slice CONTENT.

---

## D1 - a bad Hub configuration is a BOOT FAILURE, not a 503. Slice 02 wins.

Settles plan-check edit 1 and finding C1, the largest defect in the set.

`00-OVERVIEW.md` carries three acceptance criteria that only a throw can satisfy:
"the API refuses to boot and names the offenders", "the API refuses to boot, offline",
and the `product.` audience case. Slice 04's `tryLoadHubAuthConfig` catch-to-null turns
all three into a running API that answers 503 to everything, which is exactly the
"plausible-looking fallback" the SDK's own `assertBootConfiguration` docstring says the
2.x release exists to remove.

Therefore:

- Slice 02's architecture SURVIVES slice 04 intact: `hubEnvBag`, `hubConfigPresence`,
  `HUB_DISCRETE_ENV_VARS`, `HubEnvSource`, `HubAuthConfig = HubConfig & {coreModule,
  healthToken}` and above all the absence of any blanket `try/catch` in
  `auth-provider.ts`.
- Slice 04 delegates ONLY THE PARSER to the SDK. It replaces 02's vendored copy of
  `loadHubConfig` with the real one and keeps every one of 02's own gates around it.
- Slice 04 does NOT reinstate `tryLoadHubAuthConfig`'s catch, does NOT take `EnvLike`
  again, does NOT delete `HubAuthConfig`, and does NOT hand `process.env` to
  `loadHubConfig`. Raw `process.env` stays out of that file.
- Consequently 02's named tests 19, 20, 21, 22, 23, 24 and 25 all SURVIVE slice 04
  unchanged. Slice 04 must not list them as edits. Test 20,
  `refuses to boot on a product. audience rather than answering 503`, is the oracle
  that fails if anyone reinstates the catch, and it must still be able to fail.
- 02's CLAIM about `coreModule` is the one part that does move: slice 03 deletes
  `coreModule` from `HubAuthConfig`, so after 03 the type is
  `HubConfig & {healthToken}`. That is 03's edit, already planned, and it is not a
  reversion of 02.

`hubConfigPresence` still THROWS on ambiguity at module scope, so D9 below is required.

## D2 - after slice 04 the API keeps ONE access gate, and it is the SDK's.

Settles plan-check edit 8 and finding U1(b).

Verified against the 2.1.0 tarball, `dist/server.d.ts:95-113`: `requireHubAuth` answers
`402 payment_required / no_org_access` for "no Effective Access, without
allowWithoutAccess", and `allowWithoutAccess` defaults to false. `appAuthMiddleware`
invokes `requireHubAuth` as its outer handler and only reaches its own body through the
`next` callback, so once the SDK gate fires the repo's local gate at
`apps/api/src/middleware/app-auth.ts:171` is UNREACHABLE. Two gates is not
belt-and-braces here, it is one live gate and one dead one with a green test suite over
the dead one.

Therefore:

- Slice 03 owns the 402 LOCALLY, exactly as planned. That is a deliberate one-wave
  bridge that keeps master green on 1.3.1, which exports no access gate at all. Slice
  03's plan must SAY it is a bridge, in those words, the same way slice 02 says its
  vendored `loadHubConfig` is one.
- Slice 04 DELETES the bridge: `hasHubOrgAccess`, `hasHubModule`, `requireHubModule`,
  `classifyHubAccess` and the 402 branch inside `appAuthMiddleware` all go, and
  `appAuthMiddleware` keeps only its `!hubAuth` 401 guard and the legacy-context
  assignment. Slice 04 gains a section reconciling with 03 the way its section 22
  reconciles with 01 and 02.
- Slice 04 also DELETES `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`,
  under 04's own stated rule for deleting a test file: name every claim the file made
  and say where it goes or why it dies with the code. The claims about
  `classifyHubAccess` die with the function. The claim "a workspace without access
  gets 402" does NOT die: it becomes a WIRING pin, and slice 04 must write it, asserting
  that `requireHubAuth` is called with the loaded config and with options that do not
  set `allowWithoutAccess`. The existing suite already stubs `requireHubAuth` because
  the real one calls `discover()` over HTTP, so a wiring pin is the honest ceiling for
  an offline test and the plan must say so rather than implying more.
- The response BODY changes from `{error: 'payment_required', code: 'missing_entitlement'}`
  to the SDK's `{error: 'payment_required', code: 'no_org_access'}`. This is SAFE for
  the web and slice 04 must state why: `isEntitlementFailure` in
  `apps/web/src/lib/require-token.ts` keys on `status === 402` ALONE and deliberately
  never reads the code, and `CLAUDE.md` pins that with
  `isEntitlementFailure is true for a 402 that carries no code at all`. No web
  predicate changes.
- But the STALE `missing_entitlement` literals do become wrong, and slice 04 owns
  correcting them so the tree does not document a code the API stopped sending:
  `apps/web/src/lib/api-client.ts:22`, `apps/web/src/lib/require-token.ts:54`,
  `apps/web/src/sales-ops/MissingEntitlementPanel.tsx:14,41`,
  `apps/web/src/sales-ops/SalesOpsApp.tsx:1819`, the fixtures and titles in
  `apps/web/src/lib/__tests__/api-client-token-guard.test.ts` and
  `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`, and the
  `402 {error: 'payment_required', code: 'missing_entitlement'}` line in `CLAUDE.md`'s
  Organization context section. These are fixture and comment edits only. No `it(...)`
  title may lose a claim, no assertion may loosen, and the test that proves a 402 with
  NO code at all is still an entitlement failure must survive verbatim, because it is
  what makes this body change safe in the first place.

## D3 - the 403 branch gets a web owner, and it is slice 03.

Settles plan-check edit 9 and finding U1(a).

2.1.0 answers `403 forbidden / missing_module` and `403 forbidden / missing_role`.
`00-OVERVIEW.md` accepts on the 403 existing. Today a 403 falls into the generic
"A API de vendas nao respondeu corretamente" panel, which is the same misdiagnosis the
402 work removed one release ago.

Slice 03 owns the whole taxonomy, so it owns this:

- Add `isForbiddenFailure` beside `isEntitlementFailure` in
  `apps/web/src/lib/require-token.ts`, keyed on `status === 403` alone, for the same
  asymmetry reason the 402 predicate is keyed on status alone: a 403 whose body does not
  parse must still not be reported as a server outage. Same strictness otherwise, no
  `>= 400`, strict `===`, null and undefined handled.
- Add a PT-BR panel telling the operator to ask an administrator for the missing
  permission. It names no module and no role, because a 403 body is not something this
  app can render trustworthily.
- Extend the `SalesOpsApp` `isError` classification chain to
  `isEntitlementFailure`, then `isForbiddenFailure`, then `isAuthFailure`, then generic,
  and extend `entitlement-dead-end.test.tsx` to five cases so the generic
  "Verifique o servidor local" copy is proven unreachable for a 403 too. The decisive
  mutation stays the same shape: replacing the panel with an empty fragment must go red
  on a data marker.
- 03 is the only slice in wave 2, so this growth creates no merge hazard.

Also record `401 contract_version_mismatch` in 03's `CLAUDE.md` taxonomy block. It is
benign, a 401 reaches the login screen which is correct, but 03 claims the taxonomy is
recorded exhaustively and it would be wrong the day 04 lands.

## D4 - `app.fxl-sales` MAY be committed to an example file. Slice 02 wins.

Settles plan-check edit 11 and finding C6.

The Audience is a public identifier, not a credential. It is derivable from the clientId
slug, so committing it discloses nothing the committed clientId would not. Shipping the
example with the field blank makes the example non-working and pushes every operator
into guessing the one value the boot check exists to validate.

So: `FXL_HUB_AUDIENCE=app.fxl-sales` in `apps/api/.env.example` and
`apps/api/.env.dev.example`, `"audience":"app.fxl-sales"` in the JSON-form comment, and
`VITE_FXL_HUB_AUDIENCE=app.fxl-sales` in the two web example files when slice 04 reaches
them. Slice 04's "do not invent `app.fxl-sales` here" instruction is REVERSED by this
decision and must be deleted from the plan rather than left contradicting it.

This decision covers EXAMPLE files only. It does not license writing any Hub-issued
CREDENTIAL into a tracked file, and the two gitignored `.env` files are still not
touched by any slice.

## D5 - wave 1 has exactly one `CLAUDE.md` owner, and it is slice 01.

Settles plan-check edits 6 and 7 and finding W1.

Two slices in one wave declaring one file is a structural merge conflict, and the flow's
whole parallel-build safety rests on "non-overlapping files ⇒ no conflict". Naming
disjoint anchor regions is not enough, because both edits append into the same bulleted
Auth Model list.

- Slice 01 keeps `CLAUDE.md` in `files_modified` and is the ONLY wave-1 slice that
  touches it.
- Slice 02 DROPS `CLAUDE.md` from `files_modified` entirely. Its documentation bullet
  about explicit Hub configuration moves into SLICE 03's `CLAUDE.md` section, one wave
  later, where 03 is the sole slice in its wave. Slice 02's plan states that its docs
  land in wave 2 and why, so a reader of a wave-1-only tree is not left thinking the
  omission was an oversight.
- Slice 02 also DROPS `apps/api/src/auth/hub-session-store.ts`. Its single one-line
  edit there, the `FXL_HUB_SECRET_KEY` to `FXL_HUB_CLIENT_SECRET` comment at line 27,
  moves into SLICE 01, which already rewrites that exact header block and already
  declares the file. Slice 01's plan notes that slice 02 renames the variable itself in
  this same wave, so the comment is correct by the end of wave 1.

After this, wave 1's declared files are disjoint. The `CLAUDE.md` owner per wave is
01, then 03, then 04, then 05.

## D6 - slice 03 must pass its own grep gate.

Settles plan-check edit 5.

03 fails its own `git grep -n -i "sales\.core" -- apps packages scripts` gate in three
places it writes itself, and that failure also trips slice 04's precondition 4, which
would make 04 stop per its own instruction.

- The two TEST occurrences are GOOD oracles, the defect inverted, and they stay
  verbatim.
- The doc comment in `apps/api/src/middleware/app-auth.ts` moves OUT of source. Say the
  same thing without the literal, or say it in `CLAUDE.md`, which is outside the gate's
  pathspec.
- Both 03's gate and 04's precondition 4 become
  `git grep -n -i "sales\.core" -- apps packages scripts ':!*__tests__*'`
  and must print nothing.

## D7 - slice 05 codes against `HubAuthContext`, complete, and adopts slice 04's fixture.

Settles plan-check edits 3 and 4 and findings C2, C3 and C4.

Read off the 2.1.0 tarball, `dist/index.d.ts:118-126`, `HubAuthContext` has six required
members: `accountId`, `workspaceId`, `entitlements`, `roles`, `aud`, `claims`. Read off
the testing tarball, `dist/index.d.ts:54-99`, `DevIdentity` requires `id`, `label`,
`exercises`, `accountId`, `activeOrganizationId`, `access`, `modules`, `organizations`;
`label` and `exercises` are NOT optional.

- Every `MinimalHubAuthContext` reference in slice 05 becomes `HubAuthContext`. The
  symbol does not exist after slice 04.
- `devAuthContext` returns all six members, not three.
- All seven API roster identities and all three web roster identities carry `label` and
  `exercises`.
- Slice 05 does NOT create a competing fixture module. It RE-POINTS slice 04's
  `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` at `devHubClaims`, which is
  what slice 04's own comment says will happen, and it DECLARES that file in
  `files_modified`. Slice 04's fixture must not be created and then orphaned one wave
  later.
- Slice 05 states that `apps/api/dist/auth/__tests__/dev-roster.js` is emitted into the
  build output carrying an import of a devDependency absent from a production install,
  that nothing reaches it, and that the inert artifact is accepted. A reviewer should
  not have to discover this.
- Slice 05 keeps its escape hatch: 03's `denies a claim set with no access key at all`
  and `denies a non-boolean access claim rather than coercing it` are NOT expressible
  through `DevIdentity`, whose `access` is a required boolean, so those tests are left
  alone. An unswapped test beats a weakened one.

## D8 - slice 04 owns every remaining compile break in `app-auth.ts`.

Settles plan-check edits 2 and 13 and findings C7, C8 and U3.

- Delete the `import type { HubSdkConfig }` at `apps/api/src/middleware/app-auth.ts:1`.
  `HubSdkConfig` does not exist in 2.1.0.
- Delete the `hubSdkConfig` local at `:85-92` and the `getHubSdkConfig` export at
  `:149-151`, and re-point every reader at the loaded `HubConfig`.
- `requireHubAuth(hubSdkConfig, {audience: hubAuthConfig.audience})` at `:153-155`
  becomes `requireHubAuth(hubConfig)`. The `audience` option is REMOVED in 2.x, and the
  SDK's own docblock says why: an override would be a second source of truth for the one
  value that must match what the Hub minted.
- Delete slice 01's local `HubSessionStoreKind`, `HubSessionReadResult` and
  `HubSessionTransaction` declarations and import the SDK's, which is what slice 01's
  plan already says slice 04 will do. Otherwise the tree carries two definitions of
  `HubSessionReadResult` and slice 01's stated end state is never reached.
- Fix section 22.3 step 4: slice 01 writes no `toBeInstanceOf(EphemeralHubSessionStore)`
  assertion. It asserts `frozenStore(db).kind === 'persistent'`, the envelope
  `kind === 'memory'` and `store.kind === 'ephemeral'`. Name what is actually there.

## D9 - the smaller required edits, assigned.

- Edit 10, slice 02: KEEP a test asserting `loadHubAuthConfig` THROWS with
  `field === 'clientSecret'` on an incomplete bag. Today's `rejects missing secret keys`
  proves the STRICT loader refuses; `tryLoadHubAuthConfig` returning null is a strictly
  weaker claim and leaves the gap open for two waves.
- Edit 12, slice 02: ADD `README.md` to `files_modified`. `README.md:45-46,58` document
  variables the API stops reading in wave 1, and the committed publishable-key literal
  lives there too. Nothing else in waves 1 to 3 touches the file, so there is no merge
  hazard.
- Edit 14, slice 02: stub `FXL_HUB_CONFIG` blank in
  `apps/api/src/middleware/__tests__/app-auth.test.ts` as well. D1 keeps
  `hubConfigPresence` throwing at module scope, so on a developer machine whose
  `apps/api/.env` carries `FXL_HUB_CONFIG` beside the discrete variables that file would
  crash at import.
- Edit 15, slice 04: state that MIGRATION checklist item 12, the Organization id on
  `checkoutUrl` and `manageUrl`, is a NO-OP here. The only callers are three
  `satisfies HubClient` mocks that take their signature from `HubClient[...]`, so the
  change flows for free. Say it once so the audit trail is complete.
- Finding U4, slice 04: state in one sentence WHY `loadHubBrowserConfig` is hand-rolled
  rather than using the SDK's `loadHubPublicConfig` and `toPublicConfig`, namely that the
  SDK reads `FXL_HUB_*` and the browser has `VITE_FXL_HUB_*`. An unexplained divergence
  is what a later reader reverts.
- Vacuity, slice 04: tie section 3.2's spread form
  `...(isHubDevelopment ? {insecureCookies: true} : {})` to section 16.2's
  `expect('insecureCookies' in (bffOptions ?? {})).toBe(false)` explicitly, in both
  places. Simplifying the spread to `insecureCookies: isHubDevelopment` makes the key
  present-and-false and reddens the test, and it would read as a test bug.
- Vacuity, slice 04: section 16.7's `the app-level token reader is still named getToken`
  is a string match on formatting, not on behaviour. Either strengthen it to assert the
  lint rule actually fires on a violating source string, or drop it. Do not keep it as
  written.
- House rule, slice 04: the SDK's own shipped `.d.ts` contains an em dash. Sections 5.2
  and 6.2 instruct re-quoting SDK line numbers, which is where it could slip into a repo
  file. No added line may carry an em dash or an en dash.

---

## Out of scope for this replan

- The decomposition, the wave assignment and `depends_on` are unchanged.
- No new slice is created. `total_slices` stays at 5.
- No promotion. This run stops at `master`. The Hub in production still runs the OLD
  access model, so shipping this before the Hub's own deploy would refuse the audience,
  reject an unknown client and read the gate as false. Staging and production are not
  touched by this run under any outcome.

---

## D10 - the whole plan set is STALE against v2.8.0. Added mid-replan, 2026-09-01.

Slice 03's replanner found this on its own and it is not confined to slice 03.

The plan set was written and parked at `e59f870` on 2026-08-27. The
`feature-20260828-organization-context-escape` run then landed an entire feature on
`master` between `e59f870` and today's head `84ac2a3`, and it touched the exact web
surface slices 03 and 04 plan to edit:

```
CLAUDE.md                                              +44
apps/web/src/auth/react.tsx                           +177
apps/web/src/auth/__tests__/react.test.tsx            +296
apps/web/src/lib/api-client.ts                         +10
apps/web/src/lib/require-token.ts                      +25
apps/web/src/lib/__tests__/api-client-token-guard.test.ts +66
apps/web/src/sales-ops/SalesOpsApp.tsx                +188
apps/web/src/sales-ops/MissingEntitlementPanel.tsx    +310  (new)
apps/web/src/sales-ops/missing-entitlement-copy.ts     +41  (new)
apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx      +214 (new)
apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx +399 (new)
apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx +392 (new)
apps/web/src/sales-ops/__tests__/routing.test.tsx      +22
```

So `ApiError.code`, `isEntitlementFailure`, `MissingEntitlementPanel`, the
`useOrganizations` seam and `entitlement-dead-end.test.tsx` ALL EXIST NOW. Any plan step
that instructs CREATING one of them would produce a duplicate declaration, and any step
that reasons about the shape of `react.tsx`, `SalesOpsApp.tsx` or `require-token.ts` may
be reasoning about a file that no longer looks like that.

The rule for every slice, and for the re-check:

- Any step describing web auth or web error classification MUST be re-read against the
  tree at `84ac2a3` before it is trusted. Do not trust the plan's own quoted line
  numbers or quoted code for the thirteen files above.
- A step whose work is already shipped is marked ALREADY DONE and kept as a
  cross-reference, not deleted silently and not executed twice.
- Slice 03's replanner already applied this to its steps 6 through 9, retiring
  `isOrgAccessFailure` and the `NO_ORG_ACCESS` copy in favour of what shipped, and
  dropping `apps/web/src/lib/api-client.ts` from its `files_modified`. That correction
  is CONFIRMED by the orchestrator, having verified the symbols exist in the tree.
- Slice 04 is the other exposed slice: it declares `apps/web/src/auth/react.tsx`,
  `apps/web/src/auth/__tests__/react.test.tsx`, `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`
  and `CLAUDE.md`, all of which moved.

This is now a first-class question for the re-check, on the same footing as the fifteen
original required edits.
