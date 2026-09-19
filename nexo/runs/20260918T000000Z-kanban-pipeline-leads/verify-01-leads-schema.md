# Verify report - slice 01-leads-schema

**Verdict: PASS**

Worktree `.worktrees/20260918T000000Z-kanban-pipeline-leads/01-leads-schema`, branch
`feat/20260918-01-leads-schema`, one commit `501fabf` ahead of `master`.
Diff under review: `git diff master...HEAD`.

I did not read the context pack, the exec notes or any `agents/exec-*.result.json`.

---

## 1. Named oracles, real output

```
$ pnpm --filter @fxl-sales/api exec sh -c \
    'VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts test/rls/leads-rls.test.ts'

 RUN  v3.2.7 .../apps/api
 ✓ test/rls/leads-rls.test.ts (6 tests) 221ms
 ✓ test/rls/leads-schema-migration.test.ts (12 tests) 145ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
```

## 2. The rest of the slice gate

```
$ pnpm --filter @fxl-sales/api test:integration
 Test Files  27 passed (27)
      Tests  187 passed (187)

$ pnpm --filter @fxl-sales/api test
 Test Files  46 passed (46)
      Tests  478 passed (478)

$ pnpm run lint
 apps/api lint: Done
 apps/web lint: Done

$ pnpm run type-check
 packages/shared-types, packages/shared-utils, apps/api, apps/web: Done

$ pnpm test          # root, incl. the tracked-file guards
 packages/shared-utils  80 passed
 apps/api              478 passed (46 files)
 apps/web              784 passed (56 files)
 scripts guards: ok 7..10 (local-database-guard fixture negatives)
```

`pnpm run build:packages` was run first as an environment step.
Every run was `vitest run`; no watcher was started and nothing is left running.

---

## 3. Binding contract, checked against the SHIPPED SQL and schema

| claim | verdict | evidence |
|---|---|---|
| `kind` allows exactly `'normal' \| 'conversion' \| 'lost'` | PASS | live DB: `sales_ops_lead_stages_kind_check = CHECK ((kind = ANY (ARRAY['normal'::text, 'conversion'::text, 'lost'::text])))` |
| the literal `'converted'` is not a stage kind | PASS (with a note) | no `'converted'` kind anywhere. The string occurs only as prose denying it (`There is no 'converted' kind`, `schema.ts:910`; test comment at `leads-schema-migration.test.ts:309`), plus the PRE-EXISTING, unrelated legacy `referral_events.status` comment at `schema.ts:235`, which is not in the diff. Read strictly as "no shipped file contains the byte sequence" this is a miss; read as the rule it encodes, it holds. Not a defect. |
| no `slug` column on `sales_ops_lead_stages` | PASS | `grep -i slug` over `schema.ts` lead block, `0022_sales_ops_leads.sql`, `leads/` and both tests: zero hits in the lead tables. The only `slug` hits are the pre-existing `sales_ops_funcoes` / `apps` / `products` ones. |
| `sales_ops_lead_stages_org_name_idx` is a REAL unique index on `(org_id, name)` | PASS | live DB: `CREATE UNIQUE INDEX sales_ops_lead_stages_org_name_idx ON public.sales_ops_lead_stages USING btree (org_id, name)` |
| three new tables carry FORCE RLS + both org policies | PASS | fresh-DB probe: all three `relrowsecurity=true, relforcerowsecurity=true`; six policies present (`*_tenant_isolation`, `*_admin_context` for each table) |
| `ensureLeadStagesForOrg` is idempotent | PASS | `ensureLeadStagesForOrg seeds a brand-new org exactly once and is safe to call again` asserts the second call returns the SAME ids and the admin-side `count(*)` is still 4; proved live by mutation 5 below. |
| exactly ONE migration added; `_journal.json` gains exactly one entry | PASS | `git diff master...HEAD --name-only -- apps/api/drizzle/` = the new SQL, `0022_snapshot.json`, `_journal.json`. The journal diff is a pure 7-line append (`idx:22, tag:"0022_sales_ops_leads"`), no existing line touched, no older snapshot rewritten. |

Also confirmed structurally: the partial `(org_id, kind)` unique index has the right predicate
(`WHERE (kind <> 'normal'::text)`), `sales_ops_leads_org_sale_idx` is PARTIAL
(`WHERE (sale_id IS NOT NULL)`), the biconditional is
`CHECK (((kind <> 'normal'::text) = is_system))`, and the six FK delete rules are exactly one
cascade and five restricts:

```
sales_ops_lead_products_org_lead_fk    confdeltype = c   (the one cascade)
sales_ops_lead_products_org_product_fk confdeltype = r
sales_ops_leads_org_client_fk          confdeltype = r
sales_ops_leads_org_sale_fk            confdeltype = r
sales_ops_leads_org_seller_fk          confdeltype = r
sales_ops_leads_org_stage_fk           confdeltype = r
```

No `CREATE ROLE`, `ALTER ROLE` or `GRANT` statement in `0022_sales_ops_leads.sql` (the only match
for `grant` is the header comment saying there must not be one).

---

## 4. The decisive check - migration ordering on a FRESH database

A brand-new database `fxl_leads_verify_tmp` was created on the local Docker Postgres (port 5006),
the REAL `runDatabaseMigrations({ migrationsFolder: './drizzle' })` was driven against it from
migration 0000 through 0022, then the database was dropped.

```
created fresh database fxl_leads_verify_tmp
MIGRATION RUNNER: completed end to end on an EMPTY database
TABLES/RLS: [{"relname":"sales_ops_lead_products","relrowsecurity":true,"relforcerowsecurity":true},
             {"relname":"sales_ops_lead_stages","relrowsecurity":true,"relforcerowsecurity":true},
             {"relname":"sales_ops_leads","relrowsecurity":true,"relforcerowsecurity":true}]
POLICIES: 6 (sales_ops_lead_products_admin_context, sales_ops_lead_products_tenant_isolation,
             sales_ops_lead_stages_admin_context,   sales_ops_lead_stages_tenant_isolation,
             sales_ops_leads_admin_context,         sales_ops_leads_tenant_isolation)
SEEDED STAGES on empty db (0 orgs in the registry -> 0 rows): 0
dropped fxl_leads_verify_tmp
```

The statement ORDER in 0022 is therefore proven, not assumed: the three composite-FK target indexes
on the existing tables are created before the six `ADD CONSTRAINT ... FOREIGN KEY` statements that
need them, and the `SELECT set_config('app.fxl_admin', 'true', true)` precedes the seed, which would
otherwise match zero rows under FORCE RLS.
The throwaway database was dropped; `select datname from pg_database where datname like '%verify_tmp%'`
returns nothing.

---

## 5. Adversarial / non-vacuity - seven mutations, seven named reds

Each mutation was applied, the oracles re-run, and the mutation reverted immediately.

| # | mutation | named test that went RED | result |
|---|---|---|---|
| 1 | `ALTER TABLE sales_ops_lead_stages DROP CONSTRAINT sales_ops_lead_stages_system_kind_check` | `leads schema migration 0022 > rejects a stage whose kind and is_system disagree` | 1 failed / 17 passed |
| 2 | `DROP INDEX sales_ops_lead_stages_org_name_idx` | `refuses a second stage with the same name in one org and allows that name in another org` AND `is idempotent when the backfill statements are replayed` | 2 failed / 16 passed |
| 3 | `NO FORCE ROW LEVEL SECURITY` on all three lead tables | `forces row level security on all three lead tables and carries both org policies` | 1 failed / 17 passed |
| 4 | `DROP INDEX sales_ops_lead_stages_org_kind_idx` (the partial one) | `allows exactly one conversion stage and one lost stage per org, and any number of normal ones` | 1 failed / 17 passed |
| 5 | `stages-seed.ts`: neutralize the `if (existing.length > 0) return existing;` early return | `ensureLeadStagesForOrg never re-inserts a stage the org has renamed or archived` | 1 failed / 5 passed |
| 6 | `stages-seed.ts`: delete `.where(eq(salesOpsLeadStages.orgId, orgId))` from the read | `scopes the stage read by orgId even when RLS is not doing the scoping` | 1 failed / 5 passed |
| 7 | `DROP POLICY sales_ops_leads_tenant_isolation ON sales_ops_leads` | `raw RLS blocks cross-org reads ... and WITH CHECK blocks smuggled inserts` AND `forces row level security on all three lead tables and carries both org policies` | 2 failed / 16 passed |

Mutation 5 is the one that proves the idempotency contract is live: without the early return a
renamed `Novo` gets re-inserted underneath the org.
Mutation 6 is the one that proves the explicit org filter is load-bearing over the
`app.fxl_admin` connection, where the admin policy makes every org's rows visible.

**Restoration.** Every DB object was recreated and re-verified afterwards:
all three tables back to `force=true`, six policies present, both unique indexes back, both CHECK
constraints back. Both `stages-seed.ts` mutations were reverted with `git checkout -- <file>`.
The full integration suite was re-run after restoration and is `27 files / 187 tests passed`.
`git status --porcelain` is EMPTY.

An early attempt at mutation 1 failed to apply (a shell quoting error turned the `psql` invocation
into `command not found`), so its green run proved nothing; it was redone correctly and is the run
reported above. Recording it so the table is not read as more evidence than it is.

---

## 6. `must_not_break`, checked independently

- **`SALE_TRANSITIONS` byte-unchanged.** It lives in `apps/api/src/domains/sales-ops/service.ts`.
  That file's entire diff is three lines at 1300-1306: a two-line comment plus the word `export` in
  front of `async function withTenant`. The transitions table is untouched.
- **`EXPECTED_MATRIX` byte-unchanged.** It lives in
  `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts`, which is not in the diff.
- **No DELETE verb in `salesOpsRouter`.** `apps/api/src/domains/sales-ops/routes.ts` is not in the
  diff at all, and `grep '\.delete('` over it returns nothing.
- **Nothing lead-related reaches `/bootstrap`, `getSalesOpsSummary` or `computeSaleFinancials`.**
  `getSalesOpsSnapshot`, `getSalesOpsSummary`, `buildSaleLedger` and `purge-service.ts` are all
  untouched (service.ts's only edit is the `export` word; the other files are not in the diff).
  `packages/shared-utils/src/sale-financials.ts` is not in the diff and contains no `lead` reference.
- **Every new query filters by org.** `stages-seed.ts` has exactly one read, `selectStages`, and it
  carries `.where(eq(salesOpsLeadStages.orgId, orgId))`; the single insert writes `orgId` on every
  row. Both run inside `withTenant`. Mutation 6 proves the filter is tested.
- **No existing table's columns, constraints or policies change.** 0022 touches existing tables only
  by adding the three `(org_id, id)` unique indexes on clients, products and sales, each unique by
  construction since `id` is already the primary key.
- **`_journal.json`** keeps every existing entry byte-identical; 0022 is appended (entry 23, idx 22),
  never inserted.
- **The legacy `leads` table** (`export const leads`) is untouched.

## 7. Files touched vs `files_modified`

The diff touches exactly eight paths, and all eight are in the plan's `files_modified` list:

```
apps/api/drizzle/0022_sales_ops_leads.sql
apps/api/drizzle/meta/0022_snapshot.json
apps/api/drizzle/meta/_journal.json
apps/api/src/db/schema.ts
apps/api/src/domains/sales-ops/leads/stages-seed.ts
apps/api/src/domains/sales-ops/service.ts
apps/api/test/rls/leads-rls.test.ts
apps/api/test/rls/leads-schema-migration.test.ts
```

Nothing outside the list was touched.

---

## 8. Non-blocking notes (no action required for this slice)

1. **Misplaced comment in `schema.ts`.** In `salesOpsLeadStages` the line
   `// pt-BR display label shown on the board and in Cadastros.` sits above `orgId` rather than
   above `name`, which is the column it describes. Cosmetic only.
2. **`'converted'` as a byte sequence** still appears in the tree, but only in prose that denies it
   is a kind and in a pre-existing unrelated legacy comment. See the table in section 3.

---

## Verdict

**PASS.** The acceptance criterion holds end to end on a genuinely fresh database, every binding
contract item was checked against the shipped SQL rather than against the plan's prose, all seven
adversarial mutations produced a named red test, every mutation was restored and the tree is clean,
and nothing in `must_not_break` moved.
