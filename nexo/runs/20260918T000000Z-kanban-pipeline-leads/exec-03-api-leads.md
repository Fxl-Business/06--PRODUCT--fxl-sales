# exec 03-api-leads

Branch `feat/20260918-03-api-leads`, commit `6cc830b`
`feat(leads): add the lead entity API with server-side seller scoping (slice 03)`.

Status: **PASS**. Every command below really ran green in front of me on the committed tree.

## What shipped

- `apps/api/drizzle/0023_lead_seller_identity.sql` plus `meta/_journal.json` and
  `meta/0023_snapshot.json`: `sales_ops_people.hub_account_id text` and the PARTIAL unique index
  `sales_ops_people_org_hub_account_idx` on `(org_id, hub_account_id) WHERE hub_account_id IS NOT NULL`.
  NO foreign key, so trap 2 does not apply; proved anyway against a brand-new database (below).
- `apps/api/src/db/schema.ts`: the column and the index, with the reason recorded on the column.
- `apps/api/src/domains/sales-ops/service.ts`: `hubAccountId` on `PersonFieldsSchema`, plus the
  WIRING in `createPerson` and `updatePerson` (see the deviation section - the plan was wrong about
  this and the shipped code wins).
- `apps/api/src/domains/sales-ops/leads/with-tenant.ts`: the one door from `leads/` into
  `withTenant`; `stage-service.ts` and `stages-seed.ts` now import through it.
- `leads/lead-schemas.ts`, `leads/lead-service.ts`, `leads/lead-routes.ts`.
- `routes.ts`: one import and one mount, `salesOpsRouter.route('/leads', leadsRouter)`, beside
  slice 02's `route('/', leadStagesRouter)`. Two identifiers, no alias.
- Oracles: `leads/__tests__/lead-contract.test.ts` (10), `leads/__tests__/lead-routes.test.ts` (10),
  `test/rls/leads-seller-scope.test.ts` (17), `test/rls/leads-no-financial-impact.test.ts` (1).
- `nexo/ROADMAP.md`: the `hubAccountId` web-control gap, as the plan's §3.1 instructs.

## Where the plan and the SHIPPED CODE disagreed, and the shipped code won

1. **`withTenant` was already exported.** Slice 01/02 shipped it exported with a comment saying why,
   and `stage-service.ts` already imported it from `../service.js`. So §1.1 step 1 was a no-op. I
   still created `leads/with-tenant.ts` and routed both `stage-service.ts` AND `stages-seed.ts`
   through it, because the stated reason ("nothing under `leads/` reaches into the 2800-line service
   file directly") applies to both. `stages-seed.ts` is a one-line import change and is NOT in my
   plan's `files_modified`; recorded here rather than left to be discovered.
2. **`createPerson` / `updatePerson` do NOT spread `data`.** The plan's §1.2 says they do and that
   "no further change is needed there". They do not: `createPerson` lists `displayName`, `status`,
   `orgId`, `contactEmail` explicitly, and `updatePerson` builds a conditional `set`. Adding only
   the zod key would have made `PATCH /people/:id {"hubAccountId":"..."}` answer `200` with an
   unchanged row - the exact `PATCH /clients/:id {"status":"archived"}` silent-no-op trap
   `CLAUDE.md` records, and it would have killed the admin repair path the AUDIT decision depends
   on. So both writers gained an explicit CONDITIONAL spread. Conditional and not unconditional in
   `updatePerson`, deliberately: every shipped PATCH from the Pessoa dialog omits the key, and an
   unconditional write (the shape `contactEmail` uses one line above) would clear the claim on every
   ordinary person edit. Sending `null` still clears it, which is the admin repair path.
3. **Slice 01's seeded stage positions start at 1**, as the orchestrator warned. `createLead` reads
   the first active `kind='normal'` stage by `(position, name)` and never assumes 0, and the
   integration tests select stages by `kind` and `position` rather than by array index.
4. **Migration numbering**: 01+02 shipped one migration, `0022`, so this slice is `0023` exactly as
   the plan predicted.

## Two decisions the plan left open, taken and recorded

1. **`renumberStage`'s one statement needs BOTH casts.** The plan sketched
   `unnest(${sql.raw('$ids')}::uuid[], ...)`, which is pseudo-code. I used a `VALUES` list built with
   `sql.join`, which is one statement and needs no array binding. The first run failed with
   `operator does not exist: integer = text`: a bare `VALUES` row gives its parameters no type, so
   Postgres infers `text` and cannot resolve the comparison against the integer `position` column.
   Both `::uuid` and `::int` are therefore load-bearing, and the comment in the file says so.
2. **The lead product read order is the SNAPSHOT, not `created_at`.** The plan specifies no order.
   My first version ordered by `(created_at, id)` and the test went red intermittently-looking but
   deterministically-wrong: a full-set replacement writes every child row in ONE `INSERT`, so all of
   them share one `now()` and the tiebreaker is a random uuid - the same unchanged lead reads back
   in two different orders. The child table has no position column (slice 01 owns the schema and
   gave it none, exactly as `person_funcoes` has none), so the honest reading is that this is a SET
   with a deterministic display order rather than a list whose order the operator authored. Ordered
   by `(product_name_snapshot, id)`, with the reason in the source and in the test.

## Contract points, each with where it is pinned

- `kind` is `'normal' | 'conversion' | 'lost'`. No `'converted'` anywhere; the service reads
  `destination.kind` against those three literals only.
- Move wire body is exactly `{stageId, position, reason?, saleId?}` under `.strict()`. Pinned by
  `accepts the move body and nothing else`, which also asserts `{toStageId, toIndex}` is REFUSED, so
  slice 04's translation cannot be skipped silently.
- `ListLeadsQuerySchema` requires `stageId`. Pinned twice: `requires stageId and caps limit at
  LEADS_MAX_LIMIT` and the route test's `requires stageId on the list`.
- `lost` without a reason is `400 {error:'validation_error',reason:'lost_reason_required',itemIndex:-1}`,
  asserted with `toEqual` on the whole parsed body, and proved at the database to write NOTHING
  (`stage_id`, `position` and `lost_reason` all unchanged after the throw).
- `stage_changed_at` by KEY OMISSION. THREE independent oracles: a source read asserting the literal
  `...(stageChanged ? { stageChangedAt: new Date() } : {}),` AND the absence of
  `stageChangedAt: stageChanged ?`; a database assertion that a same-column reorder leaves the raw
  `Date` `toEqual` its pre-image (with the pushed-down card asserted to have really moved, so the
  test is not vacuous); and the inverse, that a real stage change advances it while an ordinary
  `updateLead` does not.
- Seller scoping inside `withTenant`. `resolveLeadScopePredicate` returns a DISCRIMINATED UNION and
  fails CLOSED, so an unresolvable caller is `seller_person_unmapped` and never "no predicate". The
  decisive oracle is `ignores a sellerPersonId query parameter for a non-admin caller`: an
  implementation that merely VALIDATES the query parameter passes a "403 on mismatch" test and fails
  this one. The vendedor is resolved through `sales_ops_person_funcoes` against the `vendedor` system
  função; the source read asserts `is_seller` / `isSeller` (and the other two mirrors) appear
  NOWHERE in `lead-service.ts`.
- Org predicate always FIRST, proved where RLS cannot cover for it: every org assertion runs over the
  `app.fxl_admin` connection, where the admin policy exposes every org. That is
  `sale-professional-funcoes.test.ts`'s lesson applied rather than copied, and the file's header says
  which connection falsifies which claim and why the seller predicate needs the ordinary one.
- Leads never travel on `/bootstrap`, and no lead value moves a financial number:
  `leads-no-financial-impact.test.ts` seeds a `won` sale through the REAL `createSale` +
  `transitionSale`, snapshots `getSalesOpsSummary`, `getSalesOpsSnapshot` and the sale's own columns,
  creates three leads (one moved to `lost`) each at `estimatedValueBrl: 9_900_000`, asserts the three
  leads really exist so the comparison is not vacuous, then `toEqual` over the WHOLE objects. A field
  list is exactly what a future `leads:` key would slip past.
- No ledger write anywhere: source read plus a real `count(*) FROM audit_log` across a move, an edit
  and a move into `lost`.
- No venda and no cliente on create: source read (`salesOpsClients` is not imported at all - the
  empresa is probed with raw SQL for exactly that reason) plus row-count and `max(sequence)` probes.
- No DELETE verb: `app.request(path, {method:'DELETE'})` is 404 on all three lead paths.
- `SALE_TRANSITIONS` / `EXPECTED_MATRIX` untouched; `sale-transitions.test.ts` 14/14 green.

## Non-vacuity checks I actually ran

- `lead-contract.test.ts` went RED first for the right reason (`Failed to load url ../lead-schemas.js`),
  then RED on three real assertions before the implementation matched them.
- `lead-routes.test.ts` was mutated in place: `not_found` mapped to 403, and `isAdmin` hardcoded
  `true`. Exactly the two intended tests went red (2 failed, 8 passed); file restored.
- `leads-seller-scope.test.ts` caught two real defects during development (the missing `::int` cast
  and the non-deterministic product order), so it is not a rubber stamp.

## Fresh-database migration proof (trap 2)

My migration adds NO foreign key, so the drizzle-kit ordering defect cannot apply. I proved it
anyway with a throwaway script run against a database created and dropped in-run, driving the REAL
`runDatabaseMigrations` over `./drizzle` from empty:

```
APPLIED: {"backendPid":34914}
COLUMN: [{"column_name":"hub_account_id","data_type":"text","is_nullable":"YES"}]
INDEX:  [{"indexdef":"CREATE UNIQUE INDEX sales_ops_people_org_hub_account_idx ON public.sales_ops_people USING btree (org_id, hub_account_id) WHERE (hub_account_id IS NOT NULL)"}]
FRESH DATABASE MIGRATION PROOF OK
```

The script lived in `apps/api/` only for that run and was deleted; nothing of it is committed.

Trap 3 is respected: the migration header quotes none of the forbidden literals, and
`single-role-db-contract.test.ts` is green.

## Commands, and their REAL output

```
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
  Test Files  1 passed (1)        Tests  10 passed (10)
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
  Test Files  1 passed (1)        Tests  10 passed (10)
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/sale-transitions.test.ts
  Test Files  1 passed (1)        Tests  14 passed (14)
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/routes.test.ts
  Test Files  1 passed (1)        Tests  49 passed (49)
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
  Test Files  1 passed (1)        Tests  21 passed (21)
pnpm --filter @fxl-sales/api test:integration test/rls/leads-seller-scope.test.ts \
    test/rls/leads-no-financial-impact.test.ts test/rls/lead-stages-rls.test.ts \
    test/rls/sale-professional-funcoes.test.ts
  Test Files  4 passed (4)        Tests  45 passed (45)

pnpm --filter @fxl-sales/api test:integration
  Test Files  30 passed (30)      Tests  216 passed (216)
pnpm --filter @fxl-sales/api test
  Test Files  50 passed (50)      Tests  526 passed (526)
pnpm run lint
  apps/api lint: Done   apps/web lint: Done
pnpm run type-check
  apps/api type-check: Done   apps/web type-check: Done
```

Every one is a run-once invocation. No watcher was started and no process is left running.

## Left for later slices, as planned

- `CLAUDE.md`'s leads-domain section (acceptance 24) belongs to whichever slice lands last; writing
  half of it here would guarantee two slices editing the same prose.
- Everything in `apps/web` (04-08), including the conversion flow, which drives
  `POST /sales` -> 201 -> `POST /leads/:id/move {stageId, position, saleId}`.
- A web control for `hubAccountId`, filed in `nexo/ROADMAP.md`.

## For the verifier

`verifier_focus` maps onto: the key-omission source assertion plus the byte-identical reorder test;
the seller predicate living in `resolveLeadScopePredicate` INSIDE `withTenant` (the route only builds
the scope object, and `requireAdmin` is deliberately not mounted); the `adminDb` connection on every
org assertion; and the whole-object `toEqual` on `getSalesOpsSnapshot` / `getSalesOpsSummary`.

One oracle weakness recorded rather than hidden: `keeps an unassigned lead out of every seller's
board` proves the `IS NOT DISTINCT FROM` mutation is caught, but the conversion test's `sale_not_found`
arm seeds its org-B venda with raw SQL rather than through `createSale`, because `createSale` would
pull in an área, a produto and a whole second fixture for a row whose only interesting property is
its `org_id`.
