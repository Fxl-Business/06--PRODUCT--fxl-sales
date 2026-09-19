# Exec notes - 02-api-stage-cadastro

Branch `feat/20260918-02-api-stage-cadastro`, commit `76d6bed`.
Status: PASS.

## What shipped

Exactly the seven paths in the plan's `files_modified`, nothing else.

- `apps/api/src/domains/sales-ops/leads/schemas.ts` (new) - imports only zod.
- `apps/api/src/domains/sales-ops/leads/stage-service.ts` (new).
- `apps/api/src/domains/sales-ops/leads/stage-routes.ts` (new), exporting `leadStagesRouter`.
- `apps/api/src/domains/sales-ops/routes.ts` - one import line, one mount line plus a two-line
  comment above it. Nothing else in the file moved; the funções block and its 409 taxonomy are
  byte-unchanged, and `routes.test.ts` (49 tests, `has no DELETE route for people or funcoes`
  included) stays green.
- `apps/api/src/domains/sales-ops/__tests__/lead-stages-contract.test.ts` (new, 7 tests).
- `apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts` (new, 21 cases).
- `apps/api/test/rls/lead-stages-rls.test.ts` (new, 11 tests).

`apps/api/src/domains/sales-ops/service.ts` was NOT edited. `apps/api/src/db/schema.ts` was NOT
edited. `SALE_TRANSITIONS` / `EXPECTED_MATRIX` untouched. Nothing about lead stages reaches
`/bootstrap`, `getSalesOpsSummary` or `computeSaleFinancials`. No DELETE verb anywhere. No
`audit_log` write from anywhere in `leads/`.

## Where the SHIPPED slice 01 differs from the plan, and 01 wins

1. **`withTenant` is EXPORTED from `service.ts`.** The plan (§2) told me to declare a local
   `withTenant` inside `stage-service.ts`, citing `commissions/service.ts` as precedent and saying
   the one in `service.ts` is private. It is not: slice 01 shipped it exported at
   `service.ts:1305` with the comment "Exported so the leads module can open the SAME tenant-scoped
   transaction; there must be exactly one implementation of setTenantContext-then-run", and 01's own
   `leads/stages-seed.ts` already imports it from there.
   I therefore import it, exactly as `stages-seed.ts` does. Writing a second copy would have
   contradicted a comment 01 shipped in the same wave and would have put two
   `setTenantContext`-then-run implementations in the tree.
   Everything the plan asked for behaviourally is intact: every service call still runs inside a
   tenant-scoped transaction, and every statement still carries its own
   `eq(salesOpsLeadStages.orgId, orgId)`.

2. **`archivedAtPatch` really is private in `service.ts`**, so the three-line local equivalent the
   plan asked for is in `stage-service.ts` as specified, with the comment pointing at
   `sales_ops_areas.archived_at`.

3. **Seed positions start at 1, not 0.** `LEAD_STAGE_SEEDS` writes positions 1..4. Nothing in this
   slice depends on the origin: `createLeadStage` appends at `max(position) + 1` and
   `reorderLeadStages` rewrites a 0-based total order, so the first reorder normalizes the seed.
   The position test creates its stages in an unseeded org and therefore asserts `[0, 1, 2]`.

4. **01 DID ship RLS on `sales_ops_lead_stages`** (`ENABLE` + `FORCE ROW LEVEL SECURITY`, plus
   `sales_ops_lead_stages_tenant_isolation` and `sales_ops_lead_stages_admin_context`, migration
   `0022_sales_ops_leads.sql:96-104`), so the plan's conditional test 10 IS written.

Everything else in the plan matched the shipped schema: three kinds, no `slug` column, the four
indexes and the two CHECKs exactly as §"Inherited contract" describes.

## The one test I had to rewrite to stop it being vacuous

The plan's test 2b (`reports a duplicate name even when the probe loses the race`) suggests
"create the row first and then call `createLeadStage` with the same name". Written that way it is
**vacuous** for the property it names: a committed colliding row is caught by `findLeadStageClash`
before the INSERT ever runs, so the test passes with `.onConflictDoNothing()` deleted.

I made the race deterministic instead. A competing transaction on the ADMIN connection inserts the
colliding row and is then HELD OPEN behind a promise gate. Under READ COMMITTED its uncommitted row
is invisible to the probe, so the probe genuinely misses and the INSERT blocks on the unique index
until the competitor commits. Two gates are needed, not one: the racing call must not start until
the competitor's INSERT has actually executed, or the racing call simply commits first and there is
no race at all (that was the first failure I saw, with the 23505 landing on the competitor).

## Mutation testing actually run (not assumed)

Each mutation was applied to the real implementation, the named test was run, and the file was
restored from a backup before the next one. `git diff --stat` was clean afterwards.

| mutation | named test | result |
| --- | --- | --- |
| delete `.onConflictDoNothing()` from `createLeadStage` | `reports a duplicate name even when the probe loses the race` | RED (`duplicate key value violates unique constraint`) |
| delete `eq(salesOpsLeadStages.orgId, orgId)` from `listLeadStages` | `scopes every lead stage read by orgId even when RLS is not doing the scoping` | RED |
| add a `update sales_ops_leads set stage_changed_at = now()` inside the reorder loop | `reorderLeadStages leaves every lead stage_changed_at untouched` | RED |

The route-level decisive assertions are in place as specified: every 403 case also asserts the
service mock was NEVER called, `never trusts orgId, kind or isSystem` uses a LITERAL third argument
(`toHaveBeenCalledWith(mockedDb, 'verified-org', { name, status })`, not `objectContaining`), and
both 409 tests use `toEqual` on the WHOLE body, which is what says there is no second conflict
reason on this surface.

## No slug, three kinds - verified by grep

```
git grep -nE "slug|duplicate_slug|stage_slug_taken|converted" -- apps/api/src/domains/sales-ops/leads apps/api/test/rls/lead-stages-rls.test.ts
```
returns exactly three hits, and all three are PROSE saying the thing does not exist:
`schemas.ts:12` and `:14`, and `stage-service.ts:14` ("there is no 'duplicate_slug' and no
'reserved_slug'"). No `slug` key, no slugifier, no `duplicate_slug` sentinel and no
`stage_slug_taken` reason is reachable as code. `lead-stages-contract.test.ts` adds two more
mentions, both of them assertions that a parsed payload does NOT carry a `slug` key. There is no
`'converted'` anywhere.

## Commands actually run, with their real output

```
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/lead-stages-contract.test.ts \
  src/domains/sales-ops/__tests__/lead-stages-routes.test.ts \
  src/domains/sales-ops/__tests__/routes.test.ts
  -> Test Files 3 passed (3) | Tests 77 passed (77)
     lead-stages-contract 7, lead-stages-routes 21, routes 49

pnpm --filter @fxl-sales/api test:integration test/rls/lead-stages-rls.test.ts
  -> Test Files 1 passed (1) | Tests 11 passed (11)

pnpm --filter @fxl-sales/api test:integration
  -> Test Files 28 passed (28) | Tests 198 passed (198)

pnpm --filter @fxl-sales/api test
  -> Test Files 48 passed (48) | Tests 506 passed (506)

pnpm run lint
  -> apps/api Done, apps/web Done (eslint covers src/ only, so test/rls is not linted; that is
     the repo's existing scope, not a change made here)

pnpm run type-check
  -> shared-types Done, shared-utils Done, apps/api Done, apps/web Done
```

RED-first evidence: both unit test files were written and run BEFORE any implementation file
existed, and failed with `Cannot find module '../leads/stage-routes.js'` /
`'../leads/schemas.js'`.

## Left for the verifier

- `test/rls/**` is outside `eslint src/`, so the new RLS file is type-checked but not linted. That
  is pre-existing repo scope; `funcoes-rls.test.ts` is in the same position.
- No process was left running. `pnpm run build:packages` was run once on entry (armadilha 1) and is
  environment setup, not a slice change.
