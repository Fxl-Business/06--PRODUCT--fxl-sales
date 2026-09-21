---
id: 07-docs-reconciliation
milestone: v4.1.0
status: todo
depends_on: ["04-dev-seed", "05-isolation-guard", "06-make-targets"]
files_modified:
  - CLAUDE.md
  - nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md
  - nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md
  - nexo/ROADMAP.md
  - scripts/__tests__/dev-identity-docs-reconciliation.test.mjs
  - package.json
acceptance: "given the development identity mode has landed, when the tree is read for what it claims about itself, then CLAUDE.md describes the mode, its four-layer production isolation and the guard that enforces it; the ONE-gate sentence is qualified in place rather than deleted and states that the production path still has exactly one gate; no file anywhere in the tree still forbids a runtime development-identity path without saying it was superseded; and a guard test in `pnpm run test` fails if any of that stops being true while `packages/auth-fake` exists"
goal: "Leave the documentation TRUE after the code made it false, and make the reconciliation irremovable by a test rather than by care"
must_not_break:
  - "the pathspec exemption that lets CLAUDE.md and nexo/ name retired things: `scripts/no-legacy-env-names.mjs` and `scripts/no-legacy-auth.mjs` keep `:(exclude)nexo` and `:(exclude)CLAUDE.md` byte-unchanged, and no file this slice writes outside those two paths may spell a banned literal"
  - "every existing CLAUDE.md sentence: this slice APPENDS and QUALIFIES, and deletes nothing except where this plan names the exact line"
  - "the parked slice's historical record: its frontmatter, its `goal`, its `acceptance`, its `rules` and the body of section `### 1. No `createDevHubClient`, ever` stay byte-unchanged, and the supersession is ADDED around them"
  - "the shipped code: this slice edits no source, no Makefile target and no `.env` example, and the only non-documentation files it touches are one new guard test and the one line of `package.json` that runs it"
  - "the three existing `scripts/__tests__` entries in the root `test` script, which are appended to and never rewritten"
  - "PLAN-CHECK ADDITION: slice 05's two root `package.json` edits. Its `scripts/__tests__/auth-fake-isolation.test.mjs` entry stays in the `test` list and this slice appends AFTER it, and the `&& node scripts/assert-web-bundle-clean.mjs` tail on the `build` script is left exactly as slice 05 wrote it."
  - "PLAN-CHECK ADDITION: slice 04's two `CLAUDE.md` edits, both inside `## Local database guard`. The bullet must still name THREE guarded entrypoints including `apps/api/scripts/seed-dev.ts`, and the `# pass` sentence must still carry the numbers slice 04 MEASURED. This slice appends elsewhere in the file and reverts neither; verify both are present before committing."
rules:
  - "no em dash and no en dash on any added line, in any file"
  - "one full sentence per line in every markdown file this slice writes"
  - "every flag name, file path, export name, make target and test title written into CLAUDE.md must be verifiable with `git grep` against the LANDED tree before the commit; where the landed name differs from the name this plan predicts, the LANDED name wins and the sentence is rewritten around it"
  - "no sentence may be copied from an acceptance criterion that planning superseded; write from the decision and say the criterion was superseded"
  - "do not add CLAUDE.md or `nexo/` to any guard's pathspec, and do not remove either exclusion"
  - "the new guard test must not contain the retired env-name literals or the removed auth provider name, because `scripts/` is inside both gates"
verifier_focus: "that every clause added to CLAUDE.md is TRUE against the shipped code clause by clause, that the ONE-gate claim was qualified rather than deleted and still reads as true for production, that no file in the tree still carries an unqualified prohibition against a runtime development-identity path, and that the new guard test fails when the supersession note is removed"
---

# 07 - docs-reconciliation

## What this slice is, in one paragraph

Slices 01 to 06 made a written prohibition false.
`nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` says, in four places, that this repository has no runtime development-identity path and must never acquire one, naming `createDevHubClient` and the `development-not-a-signature` signature as the hazard.
It is `status: parked`, which means a future agent reads it as a live instruction rather than as history.
`CLAUDE.md` meanwhile says "There is deliberately exactly ONE gate", which is still true for production and is no longer the whole truth for a developer machine.
This slice is the one that makes the tree stop contradicting itself: it writes the account of the development identity mode into `CLAUDE.md`, qualifies the ONE-gate sentence in place, supersedes the parked prohibition where the prohibition lives, records the decision as an ADR, files what this feature opened on the roadmap, and adds one guard test so that none of the above can be quietly undone while the code it describes is still in the tree.
It writes no source code.

## Why the reconciliation is done in THREE places and not one

This was a real choice and the alternatives were weighed rather than skipped.

**Amending only `CLAUDE.md`** was rejected.
The prohibition lives in the parked plan, and that is the file an agent opens when it picks the parked work back up.
A correction filed somewhere else leaves the instruction standing at its point of use, which is exactly the failure mode `nexo/knowledge/decisions/2026-09-19-documentation-that-is-law-is-code.md` names: a false law does not fail a build, it gets FOLLOWED.

**Amending only the parked plan** was rejected too.
`CLAUDE.md` is the file every agent and every human reads before touching anything in this repository, and a development mode that replaces the API's auth middleware is not something it may be silent about.
It also already carries the ONE-gate sentence, so leaving it untouched would leave a live false-in-scope claim in the most-read file in the tree.

**An ADR alone** was rejected for both reasons at once, and ADRs here are the record of WHY rather than the statement of WHAT.

So all three, with distinct jobs and no duplication of substance.
The parked plan gets a dated supersession note that voids exactly the prohibition and nothing else.
`CLAUDE.md` gets the operating account of the mode and the qualification of the ONE-gate sentence.
The ADR gets the reasoning, the rejected alternatives, and the superseded acceptance criterion.
Each of the latter two names the parked plan by path, so the three are reachable from one another.

## Step 1 - verify the names before writing a word

Every prose sentence below predicts a name.
The names come from the mirrored design in `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance` and from this feature's own overview, and slices 01 to 06 may have landed different ones.
Run this FIRST, from the worktree root, and write down what it answers:

```
git grep -n 'SALES_AUTH_FAKE' -- apps packages scripts Makefile
git grep -n 'VITE_AUTH_FAKE' -- apps
ls packages/auth-fake/package.json apps/api/src/auth/ apps/web/src/dev/ apps/api/scripts/
grep -n 'fake' Makefile
grep -n 'scripts/__tests__' package.json
git grep -n 'describe(\|  it(' -- scripts/__tests__/auth-fake-isolation.test.mjs
git grep -rn 'ROADMAP' -- nexo/plans/feature-20260921-dev-fake-identity-switch
```

The CANONICAL names, fixed by the plan-check pass of 2026-09-21 and no longer predictions, are: the API flag `SALES_AUTH_FAKE`, the web flag `VITE_AUTH_FAKE`, the workspace package `packages/auth-fake`, the API boot selector `apps/api/src/auth/select.ts`, the web seam `apps/web/src/dev/install-dev-identity.ts` with its registry and switcher beside it, the seed `apps/api/scripts/seed-dev.ts`, the guard `scripts/__tests__/auth-fake-isolation.test.mjs`, and the make targets `dev-fake`, `back-fake`, `front-fake`, `db-seed` and `dev-fake-setup`.
Where the landed tree disagrees, the landed tree wins and the sentence is rewritten to it.
A CLAUDE.md sentence naming a symbol that `git grep` cannot find is a defect of the same class this slice exists to remove, so no predicted name may survive into the commit unverified.

The last command collects the handoff that slice 06 was asked to write about which `CLAUDE.md` env blocks need the new flags.
Slice 06 deliberately does not touch `CLAUDE.md`; this slice does, in Step 3.
If slice 06 left no handoff paragraph, Step 3's instruction below is complete on its own and no further decision is needed.

## Step 2 - CLAUDE.md gains the section

Insert ONE new top-level section, titled `## Development identity mode`, immediately AFTER the `## Auth Model` section and immediately BEFORE `## Tenancy`.
It goes there because it is an auth statement and because a reader who has just finished the gate and taxonomy bullets is exactly the reader who must not be surprised by it later.

Write the following, adjusted only for the name verification of Step 1.
It matches the file's voice on purpose: it argues, it names the failure each rule prevents, and it names the oracle.

```markdown
## Development identity mode

- There is a DEVELOPMENT identity mode, added 2026-09-21, and its whole purpose is that this product can be developed and reviewed with NO Hub listening anywhere.
  Before it, a Hub outage or a Hub contract change stopped every screen behind authentication, which is a coupling problem rather than an auth problem: the ability to work on Sales was bound to a live, contract-stable instance of another application.
  Its second purpose is reach: a role-gated screen can only be reviewed by an operator holding that role, and the mode lets one developer adopt each identity in turn instead of holding six Hub accounts.
- It is OFF unless asked for, and asking for it is two flags: `SALES_AUTH_FAKE` on the API and `VITE_AUTH_FAKE` on the web, both documented as COMMENTED lines in every shipped `.env` example and enabled by nothing that a fresh clone copies.
  With both absent the repository behaves EXACTLY as it did before the mode existed, which is the claim the feature is measured on rather than a hope: the request path gains no branch, `requireHubAuth` is still constructed the same way with `allowWithoutAccess` at its default of `false`, and the 401/402/403/503 taxonomy above is byte-identical.
  `make dev-fake` sets both and runs the pair; `make back-fake` and `make front-fake` set one each.
- The substitution happens ONCE, at BOOT, and REPLACES the Hub middleware rather than standing beside it.
  That is the design decision the rest of this section defends, and the alternative, a per-request branch reading the flag, is what it exists to forbid: a branch inside the request path ships inside the production artifact and is one truthy environment variable away from authenticating anyone, whereas a boot-time replacement means a given process has exactly ONE gate in either mode and never two.
  It is also why the ONE-gate rule in `## Auth Model` is not weakened by this mode: two gates would mean one live and one unreachable with a green suite over the dead one, and this mode creates no second gate.
- The defence is STRUCTURAL first and assertive second, in four layers, because an environment flag guarding an in-tree code path does not meet the bar for something that can authenticate a person.
  ONE, `packages/auth-fake` is a devDependency of both apps and never a dependency, so the production install and the production image do not contain it at all; the failure mode in production is a loud module-resolution crash at boot, never a silent fake identity.
  TWO, every access to it is a DYNAMIC import, because a static import, INCLUDING a type-only one the compiler erases, pulls the package into the build graph and defeats layer one; that is also why the API selector declares the shape it needs structurally instead of importing the type.
  THREE, the web half sits behind `import.meta.env.DEV`, which `vite build` statically replaces with `false`, so the switcher and its roster are eliminated from the production bundle as dead code rather than merely hidden.
  FOUR, the API REFUSES TO BOOT, with a named message, when the flag is set while `NODE_ENV=production`, so the operator who sets it on the wrong machine gets a sentence instead of a module-resolution stack trace.
  Layer four is the belt and layers one to three are the braces; deleting layer four alone leaves production safe and leaves the operator uninformed, which is why it is last in this list and not first.
- `scripts/__tests__/auth-fake-isolation.test.mjs` is what makes the four layers IRREMOVABLE, and it runs inside `pnpm run test`.
  It asserts the dependency classification, that no shipped source imports the package statically, that the package is reached only from the sanctioned boot-time selectors, and that the flag in production is refused.
  It proves itself against mutated fixture trees and demands a non-zero exit, in the mould of `scripts/__tests__/local-database-guard.test.mjs`, because a guard that cannot fail is a guard that reports green without having looked.
- The roles travel the REAL translation path in BOTH halves, and this is the property that makes the mode worth having rather than a screenshot tool.
  The package emits CLAIMS in the Hub's own shape; the web passes them through `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` and then through `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts`, exactly as a real token does.
  NOTHING hands a ready-made profile to the app and nothing writes `profile.roles` directly.
  A fixture that wrote the profile would make the mode agree with the app by construction and would prove nothing about the visibility rule it is used to review.
- ONE acceptance criterion was SUPERSEDED during planning rather than implemented, and it is recorded here rather than left to be discovered.
  The request asked the roster for an `admin-only` identity seeing `tatico` plus `operacional` plus `cadastros` and NO `meus-dados`.
  No such identity exists, because `getRolesFromHubClaims` has three outcomes and every admin-bearing one returns `['admin', 'seller', 'finder']`, so `getVisibleWorkspaces` always adds `meus-dados`.
  Producing it would have meant changing `getRolesFromHubClaims`, which is a PRODUCTION behaviour change and is precisely what this feature promised not to do.
  The roster therefore carries THREE identities that reach the full-access set through the three DIFFERENT claim shapes `getRolesFromHubClaims` really has, workspace `owner`, workspace `admin` and `productRoles: ['admin']`, each seeing all four paineis, and the gap is filed in `nexo/ROADMAP.md` rather than faked.
- The browser seam is `requestHubAccessToken` in `apps/web/src/auth/refresh.ts` and NOT `HubClient.getToken()`, and that follows from a rule this file already states: the browser reads `/auth/refresh` itself and never through the client.
  Substituting the client, which is what the vendor recipe does, would deliver no token at all here, because the token path is the hand-rolled fetch.
  Anyone porting this mode from another FXL product will reach for the client seam first; that is the seam this repository does not have.
- The mode runs against the LOCAL Postgres and nothing else, under the `## Local database guard` rules unchanged.
  `apps/api/scripts/seed-dev.ts` is deterministic and idempotent and creates the `org_id` values the roster names, each with its `vendedor` and `finder` system funcoes and with pessoas attached, so `meus-dados` and `cadastros` open with rows instead of empty states.
  Tenancy is untouched: every query still filters on `eq(table.orgId, c.get('orgId'))`, the active org of a fake identity is an `org_id` that the seed created, and nothing on the fake path reads `user_id`, `org_id`, `account_id` or `workspace_id` out of a request body.
- A SENTENCE ALREADY IN THIS FILE IS FALSE, and this feature found it rather than caused it, so it is recorded here rather than quietly fixed.
  `## Sales Ops Routing` states, of the visibility rule, that "team-only sees the three team workspaces and no `meus-dados`".
  No token this product accepts can put an operator in that state, for the reason in the bullet above: every admin-bearing branch of `getRolesFromHubClaims` returns `['admin', 'seller', 'finder']`, so `getVisibleWorkspaces` always adds `meus-dados`.
  `getVisibleWorkspaces` itself is correct and is not the defect: it really would return the three team painéis alone for the role set `['admin']`, and that role set is simply unreachable.
  So either `claims.ts` is wrong or that sentence is, and deciding which is a PRODUCT question about whether a workspace owner who is neither vendedor nor finder should see `meus-dados`.
  This feature deliberately did not answer it, because answering it changes a production claim reader, and the question is filed for the human in the run's `AUDIT.md` and on `nexo/ROADMAP.md`.
  The sentence is left standing with this note beside it rather than edited, because editing it would pick the answer by accident.
- This mode makes a written prohibition FALSE, and the prohibition is superseded where it lives rather than deleted.
  `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` is `status: parked` and forbids a runtime development-identity path in four places, on the grounds that it would be a production hazard.
  That reasoning was RIGHT for what it judged, which was wiring a fake client into the SHIPPED request path during an auth migration with no structural isolation behind it.
  It is void for what actually landed, which is a boot-time replacement that is absent from the production artifact by construction, refuses to boot in production, and is pinned by a guard that proves itself.
  The parked file carries a dated supersession note saying exactly that, and `nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md` carries the reasoning.
  `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs` fails if that note is removed while `packages/auth-fake` is still in the tree, so the repository can never again ship a prohibition against something it does.
```

Three constraints on that block.

The name `SALES_AUTH_FAKE` is a NEW name and belongs to no guard's retired list, so nothing about writing it needs an exemption.
`CLAUDE.md` is outside the pathspec of `scripts/no-legacy-env-names.mjs` and of `scripts/no-legacy-auth.mjs` so that it can be the prose record of names those guards ban; that exemption is for the names already recorded there and this slice neither relies on it nor touches it.
Do not, while editing this file, disturb the three sentences that depend on it: the `sales.core` record, the session-sealer rename record and the post-login redirect rename record all stay byte-unchanged.

## Step 3 - CLAUDE.md, the ONE-gate sentence and the two env blocks

### 3a - qualify the ONE-gate bullet

In `## Auth Model`, find the bullet beginning `- There is deliberately exactly ONE gate.`
Change NOT ONE character of it or of its continuation line about `requiredModule`.
APPEND these three lines to the same bullet, at the same indentation as the `requiredModule` line:

```markdown
  That sentence is TRUE and is now written with its scope out loud: in PRODUCTION, and in any run that does not set `SALES_AUTH_FAKE`, `requireHubAuth` is the one and only access gate and the request path holds no branch that could become a second one.
  The development identity mode added on 2026-09-21 does NOT stand a second gate beside it: it REPLACES the middleware at BOOT, once, so a process has exactly one gate in either mode, which is the same invariant this bullet has always asserted rather than an exception to it.
  What keeps that from being merely a promise is in `## Development identity mode`: the replacement is absent from the production artifact by construction, and the API refuses to boot if the flag is set under `NODE_ENV=production`.
```

The qualification is written this way on purpose.
Deleting the original claim would destroy the record of WHY the four bridge helpers were removed, which is the sentence's real payload.
Weakening it to "there is usually one gate" would license the second gate it exists to forbid.
Naming the scope keeps the claim absolute inside its scope, which is the same move this file already makes for the `secureCookies` inversion and for the `402` taxonomy.

### 3b - the env blocks

In `## Environments`, under `Required API vars`, append to the fenced `dotenv` block, after the `PUBLIC_LINK_BASE_URL` line, with one blank line before it:

```dotenv
# Development identity mode. COMMENTED here and commented in every .env example:
# absent means the ordinary Hub path, which is what a copied block must
# reproduce. Set it through `make dev-fake` rather than by hand. The API refuses
# to boot with it set while NODE_ENV=production.
# SALES_AUTH_FAKE=1
```

PLAN-CHECK RULING, 2026-09-21: a COMMENTED line, not an active blank `SALES_AUTH_FAKE=`.
Slice 06 reasons at length that an active blank line is worse than a commented one even when blank,
because the next person to edit the file sees a slot and fills it, and it ships that shape into all
four `.env` examples with an oracle reading its exact text.
This block is copyable prose that a human copies wholesale into the same files, so it must carry the
same shape or the two disagree the moment anyone copies it.

Under `Required web vars`, append to that fenced block:

```dotenv
# Development identity mode. COMMENTED, for the same reason. The whole web half
# is behind import.meta.env.DEV, so a production build eliminates it.
# VITE_AUTH_FAKE=1
```

The API block's own prose warns that a human copies it wholesale, so the new line must be COMMENTED and must read as meaning "off".
A populated `SALES_AUTH_FAKE=1` there would hand every fresh clone a fake identity and would make the copied block describe a configuration nobody asked for.
If slice 06's handoff paragraph names a third variable, add it to whichever of the two blocks it belongs to, blank, with a one-line comment in the same shape; if it names none, these two blocks are the whole of this step.

## Step 4 - supersede the parked prohibition, in place

Edit `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md`.

Leave the frontmatter BYTE-UNCHANGED, `status: parked` included.
That is deliberate.
The repository already has a whole-file `status: SUPERSEDED by ...` precedent, and it is the wrong instrument here: only the PROHIBITION is void, while the slice's actual subject, adopting the Hub testing package as a devDependency for claim fixtures, is neither built nor invalidated and must stay parked and pickable.
Rewriting `goal`, `acceptance` or `rules` would also falsify the historical record of what was decided in August, which this repository does not do to its own evidence.

Insert, immediately after the closing `---` of the frontmatter and immediately BEFORE the line `# 05 - dev-identity-fixtures`, with one blank line on each side:

```markdown
> **SUPERSEDED IN PART - 2026-09-21 - the prohibition only.**
> This slice's ban on a runtime development-identity path is VOID as of `feature-20260921-dev-fake-identity-switch`, which built one.
> Four statements in this file assert that ban and are now history rather than instruction: the frontmatter `goal` ("with no runtime identity path"), the frontmatter `acceptance`, the rule "no runtime development-identity path and no stubbed signature verification", and the section "### 1. No `createDevHubClient`, ever".
> They are left standing, unedited, because they are the record of what was decided in August and why.
> What changed is not the risk assessment but the isolation.
> The ban judged a fake wired into the SHIPPED request path during an auth migration, with nothing but a flag between it and production, and for that it was right.
> What landed instead is a BOOT-TIME replacement of the middleware behind four independent layers: a devDependency-only workspace package that is absent from the production install, dynamic imports only so no static import can pull it into the build graph, an `import.meta.env.DEV` fence that `vite build` eliminates on the web side, and an API that refuses to boot with the flag set under `NODE_ENV=production`.
> `scripts/__tests__/auth-fake-isolation.test.mjs` proves all four and proves itself against mutated fixtures.
> Everything ELSE in this file is untouched and still parked: adopting `@fxl-business/hub-sdk-testing` as a devDependency for Hub-shaped claim fixtures remains unbuilt and remains a good idea.
> Read `CLAUDE.md`'s `## Development identity mode` section for what exists today, and `nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md` for the reasoning.
```

Then, inside the body, insert ONE line immediately after the heading `### 1. No `createDevHubClient`, ever` and before its first paragraph:

```markdown
> Superseded 2026-09-21. See the note at the top of this file. The paragraph below is left exactly as written.
```

That second pointer is not redundant.
A reader who lands on this file through a `git grep` for `createDevHubClient` lands on the heading, not on the top of the file, and the whole point of the exercise is that the prohibition never again reads as live at its point of use.

## Step 5 - the ADR

An ADR IS warranted, and the test for that here is not novelty but reach: this decision binds every future auth change in the repository and was arrived at by rejecting named alternatives, which is exactly what the sixteen files already in `nexo/knowledge/decisions/` record.

Write `nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md`, following the shape of `2026-08-28-organization-escape-is-web-only.md`: an H1 stating the decision as a sentence, then `**Date:**` and `**Surfaced by:**` lines, then prose sections.

Title: `The development identity adapter is chosen at boot, and production is protected structurally rather than by a flag`.
`**Date:** 2026-09-21`.
`**Surfaced by:** `feature-20260921-dev-fake-identity-switch``.

It must contain, and must not exceed by much:

1. **Context.** Development and review were blocked on a live Hub; a role-gated screen is unreachable without an account holding that role; the request asked for the design already proven in FXL Finance.
2. **Decision, part one: boot-time replacement, never a request-path branch.** With the argument in Step 2's third bullet, stated once here and not repeated.
3. **Decision, part two: the four layers, and why a flag alone is not a bar.** Name what each layer prevents, and say plainly that layers one to three make the fake ABSENT from the production artifact while layer four only makes the failure legible.
4. **Rejected: a fake Hub server.** Reproducing the redirect and BFF protocol buys a thing this repository does not own and would be discarded when the protocol moves; the local database guard's own history shows what a second, remote-capable door costs.
5. **Rejected: a flag-guarded in-tree branch.** It ships in the production artifact, which is the whole objection.
6. **Superseded: the parked prohibition.** Name `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` by path, say what it forbade, say why it was right then, and say exactly what changed. Say that it was amended in place rather than deleted.
7. **Superseded: the `admin-only` acceptance criterion.** Record the `getRolesFromHubClaims` finding in full, and say explicitly that the alternative was a production behaviour change that the same request forbade. Cite `nexo/knowledge/decisions/2026-09-19-documentation-that-is-law-is-code.md`'s rule that documentation is written from the DECISION and must say the criterion was superseded.
8. **Consequences, including the honest cost.** A fake is not the Hub, so this mode can never prove the Hub adapter works; that is covered by the real Hub-integrated local run and by staging, not by daily development. Say so, because the sibling repository learned it the expensive way.

The sibling repository's `2026-08-17-identity-port-and-local-dev-environment.md` in FXL Finance is worth reading as a MODEL of shape and is not to be copied.
Two of its decisions are not this repository's: it owns a full identity PORT with an anti-corruption layer over 31 domain folders, and it pins its own Hub token contract version.
Sales has neither, adapts at one middleware instead, and gets its contract pin from the exact SDK pin already recorded in `CLAUDE.md`.
State that difference in one sentence in the Context section so a future reader does not import the sibling's conclusions wholesale.

## Step 6 - the roadmap

`nexo/ROADMAP.md` carries nothing this feature CLOSES.
Check and confirm rather than assume: `chore: real .env.dev.example flow - local DATABASE_URL should not point at staging by default` is adjacent and is NOT closed by this feature, because the development identity mode changes nothing about `DATABASE_URL`, and marking it DONE would be a false entry of exactly the class this slice exists to remove.
Do not touch it.

Append to the `## Backlog` section, one line per intent, in the file's existing voice:

1. `feat:` a roster identity that reaches `['admin']` alone. Record that `getRolesFromHubClaims` cannot currently produce it, that the request asked for it, and that producing it means changing a production claim reader, so it needs a decision about whether admin should imply the sales product roles at all rather than a roster edit. Name the file and the function. Record IN THE SAME ENTRY that `CLAUDE.md`'s `## Sales Ops Routing` sentence "team-only sees the three team workspaces and no `meus-dados`" describes that same unreachable state, so whichever way the decision goes, one of the two files changes.
2. `chore:` replication of this mode into the other Hub-integrated FXL products, noting that the seam differs per product and naming this repository's own difference, that the browser token path is `requestHubAccessToken` rather than `HubClient.getToken()`, so a port that substitutes the client alone delivers no token here.

Then append one line for each item that slices 01 to 06 explicitly asked to file on the roadmap.
Find them mechanically: `git grep -n 'ROADMAP' -- nexo/plans/feature-20260921-dev-fake-identity-switch nexo/runs/20260921T141216Z-dev-fake-identity-switch`.
If a slice named no such item, that part of this step is empty and the two entries above are the whole of it.

## Step 7 - the guard, and what it can honestly assert

Documentation is hard to test and most tests of it are hollow.
Say plainly what each oracle here is.

The honest oracle for "is the new CLAUDE.md section TRUE" is a HUMAN or a verify agent reading it clause by clause against the shipped code, at the granularity the slice-07 re-verify of the Kanban feature used.
No test can assert that, and pretending otherwise is the failure `nexo/knowledge/decisions/2026-09-16-a-check-that-reports-green-without-having-looked.md` names.
It is listed under `verifier_focus` above, not disguised as an assertion.

What IS mechanically assertable is one real invariant, and this slice asserts exactly it:

> The tree must never simultaneously DO a thing and FORBID it without saying the prohibition was superseded.

Write `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`, a `node --test` file in the style of the three already in that directory.

Structure it as a PURE classifier plus its callers, so the positive control is real:

- Export-free module scope holds `reconciliationViolations({ modeExists, planText, claudeText })` returning a `string[]`, with no I/O inside it.
- `modeExists` is true when the development identity package manifest is present in the tree; compute it in the test body with `existsSync` against `packages/auth-fake/package.json`, adjusted to the landed path from Step 1.
- When `modeExists` is false the classifier returns `[]` unconditionally, because a tree that does not do the thing is free to forbid it. That branch is what keeps the guard honest rather than merely loud.
- When `modeExists` is true the classifier returns one line per failure, for these three:
  - `planText` does not contain the exact sentinel `SUPERSEDED IN PART - 2026-09-21 - the prohibition only.`
  - `planText`'s index of that sentinel is not LESS than its index of the first occurrence of `No \`createDevHubClient\`, ever`, which is what pins the note ABOVE the prohibition rather than buried under it.
  - `claudeText` does not contain the heading `## Development identity mode`.

Four tests:

- **D1** `passes against the tree as shipped` reads the two real files and asserts `reconciliationViolations` returns `[]`.
- **D2** `flags a tree that still forbids what it does` passes `modeExists: true` with a `planText` holding the prohibition heading and no sentinel, and asserts a non-empty result naming the plan file.
- **D3** `flags a supersession note that sits below the prohibition it supersedes` passes a `planText` with the two strings in the wrong ORDER, and asserts a non-empty result. This is the case a plain substring check passes and the one that actually goes wrong in practice, because a note appended at the end of a long file is a note nobody reaches.
- **D4** `says nothing about a tree that has no development identity mode` passes `modeExists: false` with both inputs empty and asserts `[]`. Without it the guard would fail on any branch that reverts the feature, which would make reverting the feature require editing a guard, and a guard that punishes its own removal is a guard nobody trusts.

D2, D3 and D4 are the positive controls, which `nexo/knowledge/decisions/2026-09-19-a-guard-test-must-carry-its-own-positive-control.md` requires and which D1 alone cannot supply.

Then add the file to the root `test` script in `package.json`, APPENDING to the existing `node --test` file list and rewriting nothing else on that line.
Preserve the three entries already there in their current order.
If slice 05 already appended `scripts/__tests__/auth-fake-isolation.test.mjs` to that list, this slice adds a second path after it and leaves slice 05's entry alone.

The new test file lives under `scripts/`, which is INSIDE the pathspec of both `scripts/no-legacy-auth.mjs` and `scripts/no-legacy-env-names.mjs`.
It must therefore contain neither the removed auth provider's name nor any of the three retired environment variable names.
Nothing in the design above needs one; this is stated so that an executor does not paste a retired name into a comment and fail a gate two commits later.

## Oracles for this slice

- **D1** `passes against the tree as shipped`, in `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`.
- **D2** `flags a tree that still forbids what it does`, same file.
- **D3** `flags a supersession note that sits below the prohibition it supersedes`, same file.
- **D4** `says nothing about a tree that has no development identity mode`, same file.
- The whole of `pnpm run test`, `pnpm run lint`, `pnpm run type-check` and `pnpm run build` staying green, which for a documentation slice is a statement that this slice changed no behaviour rather than evidence that the prose is true.
- Clause-by-clause human or verify-agent reading of the added `CLAUDE.md` section and of the qualified ONE-gate bullet against the shipped code. This is named as the oracle it is, and it is not automatable.

## Verifier notes

- Read every clause of `## Development identity mode` against the landed code, one at a time, and reject any sentence whose named symbol, path, flag, make target or test title `git grep` cannot find.
- Confirm the bullet `- There is deliberately exactly ONE gate.` and its `requiredModule` continuation are BYTE-UNCHANGED, and that the three appended lines say the production claim is still absolute rather than weakening it.
- Confirm the parked plan's frontmatter, `goal`, `acceptance`, `rules` and the body of `### 1. No `createDevHubClient`, ever` are BYTE-UNCHANGED, and that the supersession note sits ABOVE the `# 05` heading.
- Confirm `git grep -n 'createDevHubClient'` returns hits only inside `nexo/`, and that every `nexo/` hit is either the parked plan carrying its two supersession pointers or this feature's own plans.
- Confirm `scripts/no-legacy-env-names.mjs` and `scripts/no-legacy-auth.mjs` still carry `:(exclude)nexo` and `:(exclude)CLAUDE.md`, byte-unchanged.
- Confirm `SALES_AUTH_FAKE` and `VITE_AUTH_FAKE` appear in the two CLAUDE.md env blocks as BLANK or COMMENTED lines and NEVER with an enabling value, and that every shipped `.env` example carries them commented only, which is what slice 06's `env-example-contract.test.ts` describe asserts.
- Confirm the root `test` script still names `scripts/__tests__/no-legacy-auth.test.mjs`, `scripts/__tests__/no-legacy-env-names.test.mjs` and `scripts/__tests__/local-database-guard.test.mjs`, in that order, with the new path appended.
- Delete the supersession sentinel from the parked plan, run the new test, and confirm it goes RED; restore it. A guard nobody has seen fail is a guard nobody has tested.
- Confirm `nexo/ROADMAP.md`'s `chore: real .env.dev.example flow` entry was NOT marked DONE.
- Confirm no added line in any file contains an em dash or an en dash.
- Confirm no file outside `nexo/` and `CLAUDE.md` gained a retired environment variable name or the removed auth provider's name.
