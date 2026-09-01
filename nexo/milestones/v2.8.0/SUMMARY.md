# v2.8.0 - the organization context escape route

Tag: `v2.8.0` at `0f048ad`
Cut: 2026-09-01
Flow: `/nexo-ship`
Chain: `master == staging == production == 0f048ad`

Web-only release: no database migration, no `apps/api` source change, no config change.
Rollback is a pure code revert, which is the same property that made `v2.7.2` safe to promote straight through.

This tag closes a longer gap than its 18 production-facing commits suggest.
The tag range `v2.7.2..v2.8.0` is 53 commits, because 35 of them reached `production` on 2026-08-28 through a direct push that deliberately skipped `staging` to stop an active incident, and were never tagged.
`v2.8.0` is the first tag that covers them, and this ship is also the resync that put `staging` back in the chain.

## What shipped to production in this cut

### An operator on the wrong Organization is told the truth

A Hub Organization and a Sales workspace once shared one word on screen, and that collision produced a dead end nobody could leave.
The Hub gives each Application its own Organization context, so switching Organization in the Hub web does not move Sales' session, and an operator whose active Organization does not carry FXL Sales gets `402 {error: 'payment_required', code: 'missing_entitlement'}` on every sales-ops call.

That `402` was always correct.
What was wrong was that the shell rendered it as `A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.`, blaming a machine that had answered perfectly and said exactly why, and that the account dropdown offered only `Sair`, whose re-login lands on the same Organization and therefore in the same dead end.

`MissingEntitlementPanel` is the honest state.
It names the currently active Organization, offers switching to another of the account's Organizations, then a Hub checkout link for the active one, in that order.
Switch comes before checkout because switching is free and instant while checkout costs money, and offering the expensive escape first would sell an entitlement to an operator who already holds one next door.

### The 402 is classifiable at all

`ApiError` gained the response body's `code`, and `isEntitlementFailure` keys on `status === 402` alone.
It deliberately does not also require `code === 'missing_entitlement'`: `apiFetch` builds its error from `await res.json().catch(() => ({}))`, so a 402 whose body does not parse carries no code, and requiring the code would classify exactly that response as not an entitlement failure and route it straight back onto the copy this work exists to remove.
The two failure modes are asymmetric.
Keying on the code fails closed onto that lie; keying on the status fails open onto a panel that names the Organization and offers a switch.

The shell's chain is `isEntitlementFailure`, then `isAuthFailure`, then generic.
The entitlement branch is first not because `isAuthFailure` is true for a 402 today, but so the branch stays reachable if that predicate is ever widened.

### One `useOrganizations` seam, and the active Organization matched by id

The seam is a thin projection of `setActive` plus the token's `workspaces` claim: no state, no request, no timer, and no reimplementation of `setActive`, which is handed through by reference so the app keeps exactly one copy of its four-statement critical section.

It also fixed a pre-existing defect.
`HubUserControls` marked the active entry by NAME, which cannot disambiguate two Organizations both called `Alpha`, yields nothing when the name claim is absent, and misses entirely whenever the active Organization sits outside the capped `workspaces` preview.
The match is now on the `workspaceId` claim, the same claim `apps/api/src/middleware/app-auth.ts` maps to `orgId`.
The name match survives only as the documented fallback for a token carrying no `workspaceId`.

### The switcher reaches the shell's own chrome

The sales-ops shell draws its own chrome and never renders `HubUserControls`, so the account dropdown got its own Organization section above the `Sair` group, driven by the same seam.
Its render guard is `others.length === 0` and not `organizations.length > 1`, because the one-entry-preview-that-is-not-the-active-Organization case is the whole point: the account has somewhere to go, and the arithmetic guard hides it.

The sidebar view-group chrome was renamed from `Workspace` to `Painel` to un-collide the word.
The fence is hard: five display strings moved and `navigation.ts` is byte-unchanged, because the URL remains the single source of truth for the active Sales workspace and renaming the type or the segment would rewrite every stored link an operator holds.

## Key decisions

- **No API change.** The active Organization and the account's Organizations are already in the access token, so touching the 402 body was rejected as out of scope and unnecessary.
- **`?organization=` deep linking was not built.** It is not available on `@fxl-business/hub-sdk` 1.3.x, which drops the parameter, so a switch is always an in-app `setActive` call until the parked 2.1.0 migration lands.
- **The panel takes no `onRetry`.** `setActive` already runs `queryClient.clear()`, which destroys the query so its observer re-subscribes at `status: 'pending'` and the shell renders the skeleton, whereas a `refetch()` would leave the query at `status: 'error'` and keep the panel on screen still naming the Organization the operator just left.
- This closes the need for the manual access grant made in the Hub admin to unblock use.

## The plan-check earned its keep

Slices 03, 04 and 05 had been planned in parallel against three different assumed shapes of the `useOrganizations` seam, and the adversarial plan-check judged 04 and 05 RED before a line was written: 05 coded against an `activeOrganizationId` that slice 02 does not return, and 04 rendered the panel with no props against a then-required `onRetry`.
One replan applied its eight required edits, and there were zero wave recoveries.

Evidence is 26 mutations across five slices, 24 RED.
The two that stayed GREEN were reported rather than buried.
Slice 03's switch-before-checkout render order was closed on the branch with a dedicated ordering test proven RED under the swap.
Slice 05's two `aria-label`-only renames are a genuine test-coverage gap on shipped-correct code, because `textContent` does not see an attribute, and are filed in `ROADMAP.md`.

## Release-verify

Run by a separate Verify agent on the exact release commit `0f048ad`, nothing modified:

| check | exit | result |
| --- | --- | --- |
| `pnpm run lint` | 0 | 0 errors, 0 warnings |
| `pnpm run type-check` | 0 | no diagnostics, 4 projects |
| `pnpm test` | 0 | 1265 tests / 99 files, 0 failed, 0 skipped |
| `pnpm run build` | 0 | api `tsc && tsc-alias`, web vite build |

Breakdown: `shared-utils` 80, `apps/api` 415, `apps/web` 770.
The post-test guards `no-legacy-auth.mjs` and `build-contract.mjs` both passed.
Security review of `e59f870..0f048ad` returned no findings: no secrets, no tenant-scoping change since the server diff is empty, and `isEntitlementFailure` grants no data, route or capability while the API's 402 gate remains the authority.

**Integration tests did NOT run**, and that is recorded rather than glossed.
The local Docker test DB `06--product--fxl-sales-db-1` had been `Exited (0)` for two weeks and port 5006 was closed, so the suite was deliberately not run rather than allowed to fall through to the staging database that `apps/api/.env` points `DATABASE_URL` at.
The gap is real but narrow: the release diff contains zero server, schema and migration changes, so it holds nothing the RLS suite would exercise.

## Note on the staging validate pause

It bought no signal, by topology rather than by shortcut.
Vercel builds `apps/web` from the `production` branch only, so the `staging` push produced no web deployment to test, and the API diff is empty so any API redeploy is a no-op.
The `staging` push was a branch-state resync closing the 2026-08-28 hotfix gap.
The evidence backing Gate 3b was the release-verify plus the absence of any migration, API or config change.
This is the same reasoning recorded for `v2.7.2`.

## Open, filed in `nexo/ROADMAP.md`

- The two `aria-label`-only renames from slice 05 are unpinned by any test.
- The `@fxl-business/hub-sdk` 2.1.0 migration is still PARKED with a red plan-check, carrying fifteen required edits and no migration code written.
- `nexo-wave-exec.sh` hardcodes a `main` trunk while this repo's trunk is `master`, and a pnpm worktree has no `node_modules`, so waves ran serial rather than worktree-parallel. Gate 2 was not weakened.
- `scripts/version.sh` computes against its own script directory's repo, so it must be pointed at the target repo to be used from a skill install.
- Mutation tooling is still not configured at the feature boundary; per-slice batteries stand in.
