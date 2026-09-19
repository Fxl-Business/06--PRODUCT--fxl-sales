# Verify report - 02-api-stage-cadastro

- Worktree: `.worktrees/20260918T000000Z-kanban-pipeline-leads/02-api-stage-cadastro`
- Branch `feat/20260918-02-api-stage-cadastro`, one commit `76d6bed` ahead of `master`
- Verdict: **PASS**

## 1. Named oracles, real output

```
pnpm --filter @fxl-sales/api test \
  src/domains/sales-ops/__tests__/lead-stages-contract.test.ts \
  src/domains/sales-ops/__tests__/lead-stages-routes.test.ts \
  src/domains/sales-ops/__tests__/routes.test.ts --reporter=verbose

 Test Files  3 passed (3)
      Tests  77 passed (77)
```

Every named case from the plan is present and green, including
`has no DELETE route for lead stages`, `maps a system stage patch to 409 stage_is_system`,
`maps a duplicate stage name to 409 stage_name_taken`,
`never trusts orgId, kind or isSystem from a lead stage request body`,
and, in the pre-existing `routes.test.ts`, `has no DELETE route for people or funcoes`
plus the whole funções 409 block (`funcao_name_taken`, `funcao_slug_taken`,
`reserved_funcao_slug`, `funcao_is_system`).

```
pnpm --filter @fxl-sales/api test:integration test/rls/lead-stages-rls.test.ts --reporter=verbose

 ✓ lead stage CRUD stays tenant-scoped through the service layer 87ms
 ✓ createLeadStage reports duplicates per org but allows the same name in another org 9ms
 ✓ reports a duplicate name even when the probe loses the race 425ms
 ✓ createLeadStage appends after the highest position, archived rows included 38ms
 ✓ updateLeadStage refuses to rename or archive a system stage 18ms
 ✓ reorderLeadStages writes a total order in one transaction and refuses a partial set 23ms
 ✓ reorderLeadStages leaves every lead stage_changed_at untouched 20ms
 ✓ archiving a lead stage writes no audit_log row 12ms
 ✓ org A cannot read org B lead stages 9ms
 ✓ scopes every lead stage read by orgId even when RLS is not doing the scoping 25ms
 ✓ raw RLS blocks a cross-org lead stage read and WITH CHECK blocks a smuggled insert 33ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Docker Postgres on 5006 really answered; the migration NOTICEs and the per-test
millisecond timings are the evidence these are live database tests, not skips.

## 2. Full tiers

```
pnpm --filter @fxl-sales/api test          -> Test Files 48 passed (48) | Tests 506 passed (506)
pnpm --filter @fxl-sales/api test:integration -> Test Files 28 passed (28) | Tests 198 passed (198)
pnpm run lint       -> apps/api Done, apps/web Done (eslint, no findings)
pnpm run type-check -> shared-types Done, shared-utils Done, apps/api Done, apps/web Done
```

## 3. Binding contract, checked against shipped code

| Requirement | Result |
|---|---|
| `kind` is exactly `'normal' \| 'conversion' \| 'lost'` | Held. `apps/api/src/db/schema.ts:912` plus `check('sales_ops_lead_stages_kind_check', ... in ('normal','conversion','lost'))`. |
| The literal `'converted'` appears in no shipped file | Held for this domain. The only `'converted'` occurrences in `apps/api/src` are the unrelated legacy referral funnel (`domains/conversions/service.ts:262`, `schema.ts:235`, both pre-existing on `master`) and slice 01's comment at `schema.ts:910` asserting the kind does NOT exist. Nothing in `leads/` spells it. |
| No `slug`, `slugifyFuncao`, `'duplicate_slug'`, `stage_slug_taken` in the diff | Held. `grep -niE "slug\|duplicate_slug\|stage_slug_taken\|reserved_slug"` over `git diff master...HEAD` returns only prose comments saying they do not exist and two NEGATIVE assertions (`expect(parsed).not.toHaveProperty('slug')`). The single sentinel is `export type LeadStageDuplicate = 'duplicate'`. |
| Duplicate name -> `409 stage_name_taken`, genuinely index-backed | Held, and proved by mutation (see 4.1). `uniqueIndex('sales_ops_lead_stages_org_name_idx').on(t.orgId, t.name)` exists in `schema.ts`; `createLeadStage` absorbs the collision with `.onConflictDoNothing()` and re-probes; `updateLeadStage` catches the 23505 inside a SAVEPOINT via `mapLeadStageUniqueViolation` keyed on that exact index name. |
| System stage answers 409 the way `funcao_is_system` does | Held, shape-identical. `routes.ts:276` is `{ error: 'conflict', reason: 'funcao_is_system' }`; `stage-routes.ts` is `{ error: 'conflict', reason: 'stage_is_system' }`. Same status, same `error` literal, same `reason` key, no `code`, no `message`, no nesting. The routes test asserts the whole body with `toEqual`. |
| Router export is exactly `leadStagesRouter` from `leads/stage-routes.ts` | Held. |
| `routes.ts` gains exactly one import and one mount | Held. The diff on `routes.ts` is `+1 import`, `+3` mount lines (mount plus a two-line comment), nothing else. No existing import is reordered or reformatted. |
| `routes.ts` still compiles | Held (`type-check` green, `routes.test.ts` 77/77 green through the real mount). |
| No collision with a future `leadsRouter` | Held. `grep -rn "leadsRouter" apps/api/src/` finds the identifier NOWHERE in code, only inside two comment lines in `stage-routes.ts`. Slice 03 can bind `leadsRouter` freely, and the mount prefixes `'/'` (owning `/lead-stages...`) and `'/leads'` do not overlap. |

## 4. Adversarial / non-vacuity

Every mutation was applied to the shipped source, run, and reverted with
`git checkout --`. `git status --porcelain` was empty after each one and is empty now.

### 4.1 Delete the unique-violation handling - THE SHARPEST CHECK

Removed `.onConflictDoNothing()` from `createLeadStage`'s insert.

```
 × reports a duplicate name even when the probe loses the race 428ms
      Tests  1 failed | 10 passed (11)

Caused by: PostgresError: duplicate key value violates unique constraint
  "sales_ops_lead_stages_org_name_idx"
  code: '23505', constraint_name: 'sales_ops_lead_stages_org_name_idx'
```

**RED, and decisively so.** Two things this proves at once. First, the named test is
not vacuous. Second, the raw Postgres error names the real index, so the 409 is
genuinely backed by `sales_ops_lead_stages_org_name_idx` and not only by the probe.

Note which test did NOT go red: `createLeadStage reports duplicates per org but
allows the same name in another org` stayed green under this mutation, because the
pre-INSERT probe still catches an already-committed duplicate. That is exactly the
racy-probe-only failure mode the brief asked me to rule out, and the race test is the
only thing standing between the slice and it.

### 4.2 Judging the race test independently

`apps/api/test/rls/lead-stages-rls.test.ts:127-173`. I read it before running it, and
it is **genuinely decisive, not hopeful**. It does not sleep-and-pray for a race:

- A competing transaction on the admin connection INSERTs the colliding row and is
  then held open on a promise gate. The racing call starts only after a second gate
  confirms that insert has landed.
- Under READ COMMITTED the competitor's uncommitted row is invisible to
  `findLeadStageClash`, so the probe is FORCED to miss. The subsequent INSERT then
  blocks on the unique index until the competitor commits.
- The assertions are `expect(await racing).toBe('duplicate')` and
  `count(*) = 1` for that name in that org.

Without `.onConflictDoNothing()` the blocked INSERT resolves into a raw 23505 and the
promise rejects, which is precisely what I observed in 4.1. The test cannot pass with
the race protection removed. Planting a COMMITTED row instead would have been the
vacuous version, and the test's own comment says so and rejects it.

### 4.3 Remaining mutations

| # | Mutation | Named test that went RED | Result |
|---|---|---|---|
| 2 | Delete `eq(salesOpsLeadStages.orgId, orgId)` from `listLeadStages` | `scopes every lead stage read by orgId even when RLS is not doing the scoping` | RED (1 failed / 10 passed). `org A cannot read org B lead stages` stayed GREEN, confirming RLS would otherwise have hidden the defect and that the admin-connection test is the real oracle. |
| 3 | Make the reorder loop also `UPDATE sales_ops_leads SET stage_changed_at = now()` | `reorderLeadStages leaves every lead stage_changed_at untouched` | RED (1 failed / 10 passed). Sole oracle for acceptance 8, and it holds. |
| 4 | Remove the system-stage guard (`if (false && current.isSystem)`) | `updateLeadStage refuses to rename or archive a system stage` | RED (1 failed / 10 passed). |
| 5 | Add `leadStagesRouter.delete('/lead-stages/:id', ...)` | `has no DELETE route for lead stages` | RED (1 failed / 20 passed). This is the "archive-only constraint removed so a delete becomes possible" mutation. |
| 6 | Drop `requireAdmin` from `POST /lead-stages` | `refuses POST /lead-stages to a non-admin with 403 admin_role_required` | RED, all three `it.each` arms (3 failed / 18 passed). |
| 7 | Map `'is_system'` to `200` instead of 409 | `maps a system stage patch to 409 stage_is_system` | RED (1 failed / 20 passed). |
| 8 | Drift the duplicate reason to `stage_slug_taken` | `maps a duplicate stage name to 409 stage_name_taken` | RED (1 failed / 20 passed). The whole-body `toEqual` is what makes the funções `duplicate_slug` pair unable to sneak back in. |
| 9 | Read `orgId` from the body and spread the raw body into the service arg | `never trusts orgId, kind or isSystem from a lead stage request body` | RED (1 failed / 20 passed). The literal third argument (not `objectContaining`) is what makes it decisive. |
| 10 | Write an `audit_log` row inside `updateLeadStage` | `archiving a lead stage writes no audit_log row` | RED (1 failed / 10 passed). |
| 11 | Delete both `'set_mismatch'` guards from `reorderLeadStages` | `reorderLeadStages writes a total order in one transaction and refuses a partial set` | RED (2 failed / 9 passed). |
| 12 | Replace `max(position)` over all rows with `count(*)` over ACTIVE rows | `createLeadStage appends after the highest position, archived rows included` | RED (1 failed / 10 passed). This is the plan's named decisive mutation for that oracle. |

No oracle in this slice is vacuous.

## 5. must_not_break

| Item | Result |
|---|---|
| `SALE_TRANSITIONS` / `EXPECTED_MATRIX` byte-unchanged | Held. Neither identifier appears anywhere in `git diff master...HEAD`. |
| No DELETE verb on `salesOpsRouter` | Held. No `salesOpsRouter.delete` and no `leadStagesRouter.delete` exists. The `.delete(` hits under `domains/sales-ops/` are all pre-existing drizzle row deletes in `purge-service.ts`, `service.ts` and a test fixture cleanup, none of them HTTP verbs, none of them in the diff. `has no DELETE route for people or funcoes` is green. |
| Nothing written to `audit_log` from the leads code | Held. The only `audit` strings under `leads/` are four comment lines recording the decision. Proved live by oracle 10 above. |
| Nothing lead/stage-related in `/bootstrap`, `getSalesOpsSummary`, `computeSaleFinancials` | Held. `apps/api/src/domains/sales-ops/service.ts` and `packages/shared-utils/src/` are NOT in the diff, and `grep -rn "leadStage\|lead_stage\|LeadStage"` over both returns nothing. |
| Funções routes and their 409 taxonomy byte-unchanged | Held. The only change to `routes.ts` is the import plus the mount block; all six funções route tests are green. |
| Every new query filters by org | Held, read statement by statement in `stage-service.ts`: `findLeadStageClash`, `listLeadStages`, the `max(position)` select, the create INSERT (writes `orgId` literally), the `.for('update')` read in `updateLeadStage`, the nested UPDATE, the reorder `.for('update')` read, each reorder UPDATE, and the reorder re-read all carry `eq(salesOpsLeadStages.orgId, orgId)`. Proved non-decorative by mutation 2 over the `app.fxl_admin` connection, where RLS is not scoping. |
| No `org_id` / `user_id` / `person_id` read from a request body | Held. Every handler's only body read is `safeParse(await c.req.json().catch(() => ({})))`; `orgId` comes solely from `c.get('orgId')`, and the zod schemas declare no `orgId`, `kind`, `position`, `isSystem` or `archivedAt` key at all, so they are stripped. Pinned by the contract test's `Object.keys(parsed).sort()` equality and by routes test 9. |
| `apps/api/src/db/schema.ts` not edited here | Held, not in the diff. |

## 6. Files touched

`git diff master...HEAD --name-only` returns exactly the seven paths in the plan's
`files_modified`, no more:

```
apps/api/src/domains/sales-ops/__tests__/lead-stages-contract.test.ts
apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
apps/api/src/domains/sales-ops/leads/schemas.ts
apps/api/src/domains/sales-ops/leads/stage-routes.ts
apps/api/src/domains/sales-ops/leads/stage-service.ts
apps/api/src/domains/sales-ops/routes.ts
apps/api/test/rls/lead-stages-rls.test.ts
```

Nothing outside the plan.

## 7. Observations (non-blocking, not defects)

1. **`withTenant` is imported rather than re-declared.** The plan told the executor to
   write a local `withTenant` wrapper "because it is private in `service.ts`". That
   premise was stale: `apps/api/src/domains/sales-ops/service.ts:1305` already exports
   it on `master` (confirmed with `git show master:...`). The shipped code imports it,
   which leaves `service.ts` completely unedited and avoids a second copy of the
   tenant boundary. This is a deviation from the plan's letter and, in my judgement,
   strictly better than following it. The import direction is `leads/ -> service.ts`
   only, so there is no cycle.

2. **A narrow gap in the positioning oracle, worth recording for slice 03's author.**
   `createLeadStage appends after the highest position, archived rows included`
   archives the MIDDLE stage of three. I tried a weaker mutation than the plan's
   named one, `max(position)` restricted to ACTIVE rows, and it stayed GREEN
   (11 passed) because max-over-active is still 2 there. That mutation IS a real
   defect in the case the test's own title advertises: archive the HIGHEST-positioned
   stage, then create, and the new stage lands on the archived one's position. The
   plan's named mutation (count-based) is caught, so the oracle is not vacuous and
   this is not a FAIL, but the test would be strictly stronger if it archived the last
   stage rather than the middle one.

## 8. Hygiene

- No watcher was run; every suite was a run-once invocation.
- No process left running.
- Nothing committed, amended or staged.
- `git status --porcelain` in the slice worktree is empty; `HEAD` is still `76d6bed`.
