# Plan check round 3 - feature-20260827-hub-sdk-210-access-model

Confirmation pass after the two round-2 fix agents. I did not write these plans.
Verified against the plan text, the tree at HEAD `84ac2a3`, and the unpacked 2.1.0 tarball.
Rounds 1 and 2 are not re-litigated here.

**VERDICT: PASS.** `execution_ready: true`. Wave 1 can start.

All eight round-2 edits are APPLIED. The blocking one is not merely applied, it is applied
correctly: I re-derived the panel change against the real file, the real tarball signature and
the repo's own lint and tsconfig, and it holds. No round-1 or round-2 fix regressed, no new
cross-slice contradiction appeared, and both fix agents' carried concerns resolve in the plans'
favour.

---

## 1. The eight round-2 edits

| # | Edit | Verdict | Evidence |
|---|---|---|---|
| 1 | **BLOCKING.** 04 section 11 must own `checkoutUrl`'s new arity | **APPLIED** | `04` section 11, the paragraph now headed "MIGRATION checklist item 12 is NOT a no-op. It has a production caller, and this slice owns it." Five numbered sub-steps, plus declared test edits. Detail in section 2 below. |
| 2 | 04 section 18 must rewrite the access-gate `CLAUDE.md` bullets | **APPLIED** | `04` section 18, the "The ACCESS-GATE block slice 03 wrote" bullet with three sub-bullets: `classifyHubAccess is the single authority` becomes the SDK's `requireHubAuth` with `allowWithoutAccess` defaulting to `false`; the one-wave-bridge bullet is DELETED outright with its `requiredModule` sentence carried; the `MinimalHubAuthContext` bullet is re-pointed at 7.2. |
| 3 | 04 section 17, `app-auth.test.ts`: 23.3's deletions and the unused imports | **APPLIED** | `04` section 17, three new bullets. The "keeps its titles" rule is scoped to SURVIVING blocks; the deletion bullet names both describes and points at 23.3, closing the cross-reference; the import bullet cites `tsconfig.base.json:11` `noUnusedLocals: true` (verified), names `import { Hono } from 'hono'`, the four removed `../app-auth.js` exports and `MinimalHubAuthContext`, and instructs a grep rather than trusting the list. |
| 4 | 04 section 17: spell the first test's override | **APPLIED** | `hubAuthContext({ accountId: 'hub-account-1' })`, with the reasoning that the fixture default does not move and the assertion is not edited. Verified against the real file: `app-auth.test.ts:22-26` asserts `userId: 'hub-account-1'`, `orgId: 'org_existing_1'`, and `org_existing_1` is already the fixture's `workspaceId` default (`04` section 7.4, `:746`), so nothing else needs overriding. |
| 5 | 03 step 7 and the does-not-do list: correct "still sends `missing_entitlement`" | **APPLIED** | `03:751-770` now states "this slice's own commit 1 already flips the wire body to `no_org_access`" and gives the D2 ownership as the real reason for leaving the prose. `03:1249-1255` carries the same correction. |
| 6 | 03 step 10a: date the one-wave `CLAUDE.md` disagreement | **APPLIED** | `03:1121-1131`, a titled paragraph "A ONE-WAVE INTERNAL DISAGREEMENT INSIDE `CLAUDE.md`, DATED HERE RATHER THAN DISCOVERED", naming slice 04 section 23.6 as the closer and forbidding a fix in this slice. |
| 7 | 02 section 2: the `coreModuleFromAudience` comment must not spell `product.` | **APPLIED** | `02:213-220`, with the escape argument (`product\.` in the regex source does not match the guard's substring search) and a safe example comment. |
| 8 | 05 section 1a: `devAuthContext` has no importer | **APPLIED** | Dropped. `05:222-234` is a titled paragraph arguing the drop; the six-member D7 requirement is re-pointed at `hubAuthContext`; `05:548` adds a `git grep devAuthContext` must-return-nothing bullet. |

---

## 2. The blocking fix, verified against the real files

**The argument is right.** Tarball `dist/client.d.ts:170` reads
`checkoutUrl(organizationId: string, sku?: string)` and `:172` reads
`manageUrl(organizationId: string)`; I read both off the tarball myself. The plan passes
`active.id` from the `useOrganizations()` seam the panel destructures at `:68`, which is the
Organization the panel NAMES on screen, so the link now matches the sentence above it.

**The chosen shape holds, point by point.**

- `const activeId = active?.id ?? null` above the effect. `Organization.id` is a `string`, so
  `activeId` is `string | null`, and the `activeId === null` early return narrows it to `string`
  at the `.checkoutUrl(activeId)` call. Type-checks.
- The `failed` case is PURE DERIVATION at the existing `checkout` computation (`:78-79`), not a
  `setResolved` in the effect body. That is what keeps `react-hooks/set-state-in-effect`
  satisfied, and it is the same reason the file's own comment at `:71-76` already gives for the
  attempt-stamping design. No new state member is invented.
- No branch renders an unresolved anchor. `CheckoutState.href` exists only on `ready`
  (`:35-38`), and the `failed` branch at `:258-269` renders copy plus a `Tentar novamente`
  button and no `<a>`. `checkoutUrl('')` is explicitly banned. The docstring's rule at `:63-65`
  is honoured.
- Dep array `[activeId, attempt, client]`. `exhaustive-deps` is satisfied: the body reads
  exactly those three plus the stable `setResolved`. The primitive rather than the object is
  argued correctly, and the file's own comment forbids the ref-guard alternative.
- `apps/web/eslint.config.js` adds no `consistent-return`, so the early return is clean; the
  branch returning `undefined` while the other returns a destructor is assignable to
  `EffectCallback`.

**The declared test edits are real against the file.** I read
`missing-entitlement-panel.test.tsx`: `:26` and `:66` are the untyped seam stubs, `:323` is
`resolves the Hub checkout href through client.checkoutUrl` with
`toHaveBeenCalledTimes(1)`, `orgAtiva.id` really is `'org-active'`, and `checkoutAnchor()` and
`sectionText()` exist as the plan uses them. The two existing `active: null` tests
(`names the active Organization from the name claim...`, `says the Organization could not be
identified...`) assert only on naming copy and never read `[data-hub-checkout]`, so they pass
unchanged under the new `failed` derivation. The file is in `files_modified` and section 24's
"does NOT touch" list now says so explicitly and records why the earlier sweep missed it.

**`react.test.tsx:212` and `:2062`.** Both real, both `'sales.core'`, both inside
`hands back the Hub client so a later slice can build the checkout link`, whose surrounding
setup really does mint `profileToken('Alpha', undefined, 'workspace-alpha')`. The plan changes
the literal in both places to `'workspace-alpha'` and changes no title and no assertion shape.
Correct, and it is a silent-wrong-argument fix rather than a red.

**`manageUrl` is genuinely uncalled in production code.** My own
`git grep -n manageUrl -- apps packages` returns exactly four lines: the three
`satisfies HubClient` mocks and one `mockResolvedValue` at `react.test.tsx:445`. No component
builds a billing link. That half really is a no-op.

**No other consumer breaks.** `git grep checkoutUrl` also hits
`entitlement-dead-end.test.tsx`, `routing.test.tsx` and `shell-organization-switcher.test.tsx`.
All three stub `@/auth/react` through an untyped `vi.mock` factory, so the added argument is not
a compile break; and the first two supply a NON-NULL `active` (`organizations[0]` and
`primaryOrganization`), so the new `failed` derivation never fires there. The third never
renders the panel. Nothing goes red.

---

## 3. The two carried concerns, adjudicated

**Concern 1, slice 04 section 11's mock arithmetic. NOT STALE. The plan is right and the fix
agent's concern is wrong.** All three `satisfies HubClient` mocks at HEAD declare exactly SIX
members - `login`, `getToken`, `setActive`, `logout`, `checkoutUrl`, `manageUrl`
(`react.test.tsx:15-22`, `session-journey.test.tsx:38-46`,
`session-loss-keeps-route.test.tsx:14-22`). None declares `getTokenResult`; the agent misread.
2.1.0's `HubClient` has ten members, which I counted off `dist/client.d.ts:149-172`. Six plus
four is right, section 11's block lists all ten correctly, and section 24's re-confirmation
paragraph names the same six. Nothing to fix, and an executor following it literally lands
correct.

**Concern 2, slice 03 versus slice 04 on the 402 body. THEY AGREE.** Cross-read: `03` step 7
now says "slice 03 flips the BODY, slice 04 deletes the local gate that emits it and corrects
every literal describing it, which is slice 04's section 23.6"; `04` section 23.5 says "Slice 03
already moved the literal deliberately so that this slice changes no contract when it deletes
the local gate", and 23.6 owns the sweep with an explicit ADDITIVE-not-a-rewrite paragraph for
the two files shared with slice 03. Same division, stated from both ends. No conflict.

One residual, recorded and not a required edit: `03`'s "Facts this plan is built on" item 7
(`:154-156`) still carries the pre-edit narration, "corrected by SLICE 04 ... when the API body
actually changes to `no_org_access`. Doing it here would leave the tree documenting a code the
API still sends." That is the same wrong reason edit 5 removed from step 7, in a third place the
fix agent did not sweep. It prescribes the IDENTICAL action as the corrected text, so no
executor is misled into a wrong edit and no slice turns red. Carry it.

---

## 4. Green at every merge

Slices 01, 02 and 03 land on `1.3.1`; only 04 bumps.

- **01 - GREEN.** Untouched by round 2. Round 2's clearance stands.
- **02 - GREEN.** Edit 7 is the only change and it strictly REMOVES a self-inflicted red: it
  stops the plan from instructing a comment that would trip this slice's own test 24 source
  guard.
- **03 - GREEN.** Edits 5 and 6 are prose corrections inside the plan; no step, test, title or
  assertion moved. The three redden-paths round 2 traced are unchanged, and I re-confirmed the
  pre-implementation red narration at `03:208` against the live
  `app-auth.ts:172`, which does still emit `missing_entitlement`.
- **04 - GREEN.** The one thing that made it RED in round 2 is closed and closed correctly; see
  section 2. Nothing else in the round-2 edits adds work that could redden: edits 2, 3 and 4 are
  a doctrine rewrite, a deletion-plus-unused-import instruction that PREVENTS a `noUnusedLocals`
  type-check failure, and a call-site override that prevents an executor editing an assertion.
- **05 - GREEN.** Edit 8 removes an exported symbol from a NEW file before it is ever written,
  and adds a grep bullet. The `hubAuthContext` handoff with slice 04 section 7.4 is unchanged on
  both sides, and 05's "THE ROSTER FOLLOWS THE FIXTURE" rule (`:195-196`) still names
  `user_existing_1` / `org_existing_1`, which is exactly what 04 section 17 now pins.

I can name no test that goes red.

---

## 5. Regressions, weakening, security, house rules

- **No round-1 or round-2 fix undone.** Spot-checked the load-bearing ones: `04` section 2.0's
  four "does NOT" rules are verbatim intact; `04` section 7.5 still owns the three `HubSdkConfig`
  breaks; `04:400` still deletes slice 01's three local types; `03:1181` and `04:63-64` still
  carry the identically narrowed `':!*__tests__*'` gate; `02` still declares `README.md` with
  section 7; `02`'s test 18a survives; `03` step 10b still carries `02`'s fenced block; `05`'s
  per-identity `label` / `exercises` prose survives on all ten identities.
- **No new cross-slice contradiction.** 03/04 on `require-token.ts` and
  `entitlement-dead-end.test.tsx`: 23.6's ADDITIVE paragraph is intact and 03 step 7 still says
  `isEntitlementFailure` keeps its body and docstring verbatim. 03/04 on the `CLAUDE.md` one-wave
  disagreement: now stated from both ends and dated. 04/05 on the fixture and the id defaults:
  both point at the same authority and now spell the same literals.
- **No weakening.** The only test changes the round-2 edits add are STRENGTHENINGS: a
  `toHaveBeenCalledWith('org-active')` on an existing checkout test, and one new test asserting
  `checkoutUrl` is never called when no Organization is active - which is the single assertion
  that forbids a future `checkoutUrl('')`.
- **Nothing fails open.** The panel change is a client-side link construction; it cannot widen
  access. The `failed` branch is the fail-closed answer.
- **No credential.** New literals in the round-2 edits are `'org-active'` and
  `'workspace-alpha'`, both existing test ids. D4's `app.fxl-sales` in example files is not a
  finding.
- **Dashes.** `grep` for U+2014 and U+2013 over all six plan files returns nothing.
- **`--no-verify`.** Two occurrences, both prohibitions, both in `04`.
- **fxl-hub.** Not read, not written, not referenced as a path.

---

## VERDICT

**PASS.** No required edits. `blocking_count: 0`.

One thing to carry into execution, not to fix: `03`'s "Facts" item 7 repeats the narration edit
5 corrected in step 7. The action it prescribes is identical, so it is prose drift, not a
defect. Wave 1 is clear to start.
