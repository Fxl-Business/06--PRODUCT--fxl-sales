---
feature: feature-20260828-organization-context-escape
milestone: v2.8.0
date: 2026-08-28
trunk: master
status: complete-at-trunk
---

# Run record - the Organization-context escape route

## The defect

An operator whose ACTIVE Hub Organization does not carry FXL Sales landed in a dead end with no way out from inside the app.
Every sales-ops API call answered `402 {error: 'payment_required', code: 'missing_entitlement'}` from `apps/api/src/middleware/app-auth.ts`, and the sales-ops shell rendered that as `A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.`
That copy is a lie in this case: the server answered perfectly and said exactly why, and it points the operator at a machine that is not the problem.
The shell's own account dropdown offered exactly one item, `Sair`, and the Organization switcher lived only in `HubUserControls`, which the sales-ops shell does not render because it draws its own chrome.
So the only escape was to sign out, and signing out re-mints a session anchored on the same primary Organization, which lands in the same dead end.

The `402` itself is CORRECT and was never the defect.
The Hub deliberately gives each Application its own Organization context, so switching Organization in the Hub web does not move Sales' session.
What was missing was an honest PRESENTATION of that verdict and an escape route out of it, and both of those are web concerns.

## Slices and waves

| Slice | Wave | Commit | Goal |
|---|---|---|---|
| `01-entitlement-classifier` | 1 | `c2e6c82` | `apiFetch` and `apiFetchBlob` preserve the response body `code`; `isEntitlementFailure` classifies the 402 and `isAuthFailure` stays false for it |
| `02-organization-seam` | 1 | `fe1a8f4` | The auth context surfaces the `workspaceId` claim and exposes one `useOrganizations()` seam; `HubUserControls` is refactored onto it and stops matching the active entry by name |
| `03-missing-entitlement-panel` | 2 | `23e507a`, `8cf3036` | `MissingEntitlementPanel` renders the honest PT-BR state: it names the active Organization, offers switch first and Hub checkout second, and handles the empty and single-entry preview cases |
| `04-shell-entitlement-branch` | 3 | `f03d34c` | `SalesOpsApp` routes a 402 to that panel, and the `Verifique o servidor local` copy becomes unreachable for it |
| `05-shell-organization-switcher` | 4 | `2a588e3` | The sales-ops account dropdown gains the Organization section beside `Sair` on the same seam, and the sidebar view-group chrome is renamed `Workspace` to `Painel` |

Every slice merged to `master` behind its own merge commit, serially, in wave order.
The diff is 12 files under `apps/`, 2121 insertions and 19 deletions, and every one of them is under `apps/web`.

## Plan check

The plan check ran before execution and returned PASS WITH REQUIRED EDITS.
It caught that slices 03, 04 and 05 had each been planned against a DIFFERENT assumed shape of `useOrganizations()`, and that slice 02 had since settled a fourth.
Two of those were hard stops rather than cosmetic drift: slice 04 rendered `<MissingEntitlementPanel />` with no props while slice 03 declared `onRetry` REQUIRED, which is a `type-check` failure at wave 3, and slice 05 coded against an `activeOrganizationId` field that slice 02 does not return, under slice 05's own rule that a differing shape STOPS the slice.
It also found two named oracles that were unsatisfiable against the real `orgLabel` and `Combobox` implementations, both asserting an id is absent from a primary label line that `orgLabel`'s id fallback puts it into.
All of those were fixed in the plans before wave 1 started, which is why the run records one replan and zero wave recoveries.

## What each Verify agent proved

Every slice was verified by a SEPARATE agent that did not write the code, and every slice passed Gate 2 on its first verify attempt.
Each verify ran the slice's named oracle, the full `apps/web` suite, `lint` and `type-check`, all run-once with no watcher, and then a mutation battery against the shipped code with each mutation applied alone and reverted before the next.
The mutation batteries are the real evidence here, because a green suite proves nothing about whether the suite would have noticed the defect coming back.

- **Slice 01** - 4 mutations, all RED. Deleting `code:` from `apiFetch`'s error construction and deleting it from `apiFetchBlob`'s each redded exactly ONE test, and they were DIFFERENT tests, which proves the two construction sites are independently covered rather than sharing one assertion a single fix would satisfy. Narrowing `isEntitlementFailure` to additionally require `code === 'missing_entitlement'` went red, and widening it to swallow a 401 went red, so the predicate is pinned from both directions. Web suite 724/724.
- **Slice 02** - 5 mutations, all RED. Reverting the picker's active entry to the original name match went red on the two-Organizations-named-Alpha fixture; returning `workspaces` unfiltered as `others` went red; deleting the `workspaceId` read from `profileFromToken` redded three tests; adding a SECOND `queryClient.clear()` inside a seam-level `setActive` wrapper went red on the exactly-once oracle; and the prescribed alternative of moving the provider's own flush before the `await` also went red, so both flush-ordering oracles are live. Web suite 735/735.
- **Slice 03** - 6 mutations, 5 RED and 1 GREEN. Rendering the picker at zero others, passing the label to `setActive` instead of the id, rendering the checkout anchor with an unresolved `href`, calling `onRetry` before awaiting the switch, and removing the active Organization's name from the copy all went red. The render-order swap stayed green, which is finding F1 below. Web suite 753/753.
- **Slice 04** - 5 mutations, all RED. Deleting the entitlement branch, moving it LAST behind a generic `isError` arm so it is unreachable, keying both arms on `isAuthFailure`, widening the first condition to `bootstrapQuery.isError` alone, and replacing the panel with an empty fragment all went red. The empty-fragment mutation is the decisive one: it proves the 402 case cannot pass by rendering nothing. The oracle drives the real `apiFetch` error path with `../api`, `@/lib/api-client` and `../hooks` deliberately unmocked, so it proves the status survives into the `ApiError` the shell classifies rather than only pinning a ternary. Web suite 758/758.
- **Slice 05** - 6 mutations, 5 RED and 1 GREEN. Deleting the section from the dropdown redded 8 of the 12 oracle tests, which is the reported defect reproduced exactly. Passing the label to `setActive`, guarding on `organizations.length <= 1` instead of `others.length === 0`, offering the active Organization as its own switch target, and reverting the visible `Painel` eyebrow all went red. Reverting only the two `aria-label` strings stayed green, which is finding F2 below. Web suite 770/770.

Slice 05's verify also proved the part B scope fence by occurrence count on both sides of the diff: `SalesOpsWorkspace`, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute`, `buildSalesOpsPath`, `workspaceVisuals`, `availableWorkspaces` and `activeWorkspaceMeta` are all identical between `master` and the slice head, `navigation.ts` is byte-unchanged, and no route literal moved.
The single delta is `SalesOpsWorkspace` going from 4 occurrences to 5, from a new explanatory comment rather than a code reference.

## Deferred findings

Both were found by a Verify agent, both were recorded rather than silently fixed, and both are oracle-coverage gaps rather than defects in shipped behaviour.

**F1 - slice 03, the ordering clause is unpinned.**
The acceptance criterion states that the switch block must render BEFORE the Hub checkout block, because switching is free and instant while checkout costs money.
The shipped component gets it right, but physically moving the checkout `div` above the switch block leaves all 18 tests passing.
Every assertion is either scoped inside one block or reads `section().textContent` with `toContain` on individual fragments, never on their sequence.
The cheap closing oracle is one line: assert `sectionText().indexOf(COPY.switchHeading) < sectionText().indexOf(COPY.checkoutHeading)` on the two-or-more-others fixture.
Deferred because the code under test is correct and the gap is in coverage only.

**F2 - slice 05, two `aria-label`-only renames are unpinned.**
The visible `Workspace` to `Painel` renames are pinned, by both a presence assertion on the new string and a `not.toContain('Workspace')` on the sidebar `textContent`.
`textContent` does not see an attribute, so the collapsed-sidebar trigger's `aria-label={\`Painel: ...\`}` and the view-group scrim's `aria-label="Fechar painéis"` can be reverted alone with the whole 770-test suite still green.
Deferred because the shipped code has them renamed correctly, no user-visible text is affected, and `routing.test.tsx`'s `button[title="Trocar painel"]` selector plus the eyebrow assertion already fail on any realistic wholesale revert.

Slice 04's verify also recorded a non-finding observation worth keeping: `isEntitlementFailure` keys on `status === 402` alone and never reads the `code` discriminator, which is safe while 402 is the API's only entitlement verdict and is the place a second 402 code would land silently on this panel.
That is a deliberate design decision and is captured in `nexo/knowledge/decisions/2026-08-28-organization-escape-is-web-only.md`.

## Execution shape - serial, not worktree-parallel

Execution ran SERIAL rather than worktree-parallel, one slice at a time on a short-lived branch merged into `master` before the next started.

Two independent reasons forced it.
`nexo-wave-exec.sh` hardcodes `main` as the trunk while this repository's trunk is `master`, so the helper's branch and merge steps target a ref that does not exist here.
And a `git worktree` in a pnpm workspace carries no `node_modules`, because pnpm links them into the primary checkout rather than materializing them per tree, so a per-slice `vitest` / `eslint` / `tsc` run cannot execute inside one at all - which would move verification out of the slice and defeat the point of Gate 2 being per-slice.

Gate 2 was NOT weakened by this.
Every slice still got its own separate Verify agent that did not write the code, ran the full command set run-once, and ran a mutation battery.
What serial execution cost was wall-clock time, not evidence.

## Mutation testing at the feature boundary

This repository has NO configured mutation-testing tooling: there is no Stryker configuration, no mutation script in any `package.json`, and no runner to invoke.
So the feature-level mutation pass prescribed by the Nexo contract could not be run as such.

The per-slice mutation batteries stood in for it, and they are recorded above: 4 + 5 + 6 + 5 + 6 = 26 mutations across the five slices, each applied alone against the shipped code and reverted before the next.
24 went RED.
The 2 that stayed GREEN are exactly findings F1 and F2, both recorded rather than papered over.
Every mutation targeted a clause of its slice's acceptance criterion rather than an arbitrary line, which is the property that makes this a usable substitute rather than a coverage number.

Standing up real mutation tooling for `apps/web` is a separate piece of work and is not attempted here.

## The `waves.sh` inline-array quirk

Found during planning, before wave 1, and worth recording because it fails SILENTLY.

The wave planner reads each slice plan's `depends_on` frontmatter.
When `depends_on` is written as a YAML BLOCK LIST rather than an inline array, the parser does not see the dependency edges at all, and it collapses every slice into a SINGLE wave with no overlap warning of any kind.
There is no error, no exit code, and no diagnostic line - the wave table simply comes back with everything at wave 1 and reads as a legitimately parallel plan.

Here that would have scheduled slices 04 and 05 CONCURRENTLY, and both of them modify `apps/web/src/sales-ops/SalesOpsApp.tsx`.
Under worktree-parallel execution that is two agents building the same file from the same base, with the second merge either conflicting or, worse, resolving cleanly onto a shell whose `isError` chain the other slice had just rewritten.
The quirk was caught by reading the produced wave table against the slice table rather than by any tool, so the rule is: always eyeball the wave assignment against the declared `depends_on`, and write `depends_on` as an inline array.

## Feature-boundary gate

All run once, from a clean tree on `master`, after every slice merged.

| Check | Result |
|---|---|
| `pnpm test` | **1265 passed** - 80 shared-utils + 415 api + 770 web |
| `pnpm run lint` | exit 0 |
| `pnpm run type-check` | exit 0 |
| `pnpm run build` | exit 0, a real build |

No `--no-verify` anywhere in the run.
No em dash and no en dash in any slice diff; every verify checked this by code point over the whole diff rather than by eye.

## Where this run stops

At `master`, and deliberately.
Gate 3 is the human-approved release cut and is never automatic, so this run does not tag, does not promote, and does not push beyond trunk.
The milestone is `v2.8.0`, and promotion to `staging` and `production` is a separate human decision.

Two things stay explicitly out of scope and remain so.
There is no `?organization=` deep link, because hub-sdk 1.3.x drops the parameter; it belongs to the parked SDK 2.1.0 migration run.
There is no API change of any kind, and the 402's status, body and placement are byte-unchanged.
