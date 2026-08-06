# Verify report - archive hiding and the 30-day purge (Gate 2)

Branch: `feat/archive-hiding-and-purge` (1 docs commit `ea0738e` + uncommitted code)
Auditor: independent VERIFY sub-agent (did not write this code)
Date: 2026-08-06
Verdict: **PASS**

This change deletes production data on a schedule, so the audit went past reading the diff: every
destructive guard was mutated and observed to turn a test RED, and the migration was replayed from
0019 on a throwaway database.

---

## 1. Command runs

Each run once, never a watching mode.

| Command | Result |
| --- | --- |
| `pnpm run lint` | **exit 0** - `apps/api` and `apps/web` eslint Done, no warnings |
| `pnpm run type-check` | **exit 0** - shared-types, shared-utils, api, web all Done |
| `pnpm test` | **exit 0** - shared-utils 80/80, api 364/364, web 590/590 (88 files) |
| `pnpm --filter @fxl-sales/api test:integration` | **exit 0** - 24 files, 158 tests; `test/rls/cadastro-purge.test.ts` 8 tests, 305 ms |
| `pnpm run build` | **exit 0** - api tsc + web vite `built in 1.71s` |

Re-run of `pnpm test` and `test:integration` AFTER every mutation was reverted: identical green
(590/590 and 158/158), which is the proof the tree was left exactly as found.

Integration ran against the local Docker DB only. `apps/api/test/rls/setup-env.ts` hard-overrides
`DATABASE_URL`, and the purge suite additionally asserts `localhost:5006` in `assertLocalDb()` before
it opens a connection. Nothing in this audit touched `apps/api/.env`'s staging URL; the one ad-hoc
database created (`fxl_verify0020`) was on `localhost:5006` and has been dropped.

---

## 2. THE PURGE CANNOT DESTROY HISTORY (priority 1)

### 2.1 Observed behaviour, live

`test/rls/cadastro-purge.test.ts` drives the real `purgeArchivedCadastros` against the local DB.
Observed on the restored tree:

- **Produto on a sale item** - `sales_ops_sale_items.product_id` (NO ACTION) blocks. Row survives,
  `status` still `archived`, counted `skipped`, **zero** `cadastro.purged` ledger rows for it.
- **Pessoa as a sale's seller and as a `sale_professional`** - `sales_ops_sales.seller_person_id` and
  `sales_ops_sale_professionals.person_id` (both NO ACTION) block. Row survives as `inactive`,
  `skipped`, no ledger entry.
- **Função on a `sale_professional`** - `sales_ops_sale_professionals.funcao_id` (RESTRICT) blocks.
  Survives `archived`, `skipped`, no ledger entry.
- The blocking proposta itself is untouched (`sale_items` count still 1), and `verifyChain` over the
  whole ledger returns `{valid: true, brokenAt: null}` after all purge traffic.

The "no ledger entry" assertion is the rollback proof: `writeAuditEntry` runs BEFORE the DELETE, so a
23503 aborts a transaction that already contains the entry. A leaked entry means the write escaped
the transaction.

### 2.2 Mutations - every destructive guard turned RED

Each mutation applied to the working tree, the purge oracle run, then reverted.

| # | Mutation | Result |
| --- | --- | --- |
| M1a | FK path swallows 23503 as success: `return 'skipped'` -> `return 'purged'` | **RED** - `never deletes a referenced cadastro`: `expected 0 to be greater than or equal to 1` (skipped count collapsed) |
| M1b | Atomicity: `writeAuditEntry(tx, …)` -> `writeAuditEntry(db, …)` (pooled) | **RED (2 tests)** - a skipped purge left a ledger entry, and org B's history grew a `cadastro.purged` it never earned. `tsc --noEmit` still exits 0 with the mutation in place, confirming the hazard is invisible to the compiler (`writeAuditEntry`'s first parameter is `any` by design). |
| M2 | `eq(salesOpsFuncoes.isSystem, false)` deleted from the função scan | **RED** - `never purges a system função`: `expected null to be 'archived'` (the app role was deleted) |
| M3 | 30-day predicate dropped (`archived_at < now() - 30d` -> `archived_at is not null`) | **RED (2 tests)** - `never touches a cadastro archived inside the retention window` and the backfill test both: `expected null to be 'archived'` |
| M4 | `actorOrgId: locked.orgId` -> `actorOrgId: null` | **RED (2 tests)** - `actor_org_id` no longer the purged row's org, and the org-scoped history read returns `[]` where it must return 1 |
| M6 | Restore stops clearing the stamp: `{archivedAt: null}` -> `{}` | **RED** - `stamps archived_at … clears it on restore` |
| M5 | Org predicate stripped from all four `remove()` DELETEs and from the `FOR UPDATE` re-check (8 replacements) | **GREEN** - see note below |

**M5 note, and why it is not a gap.** Each candidate is deleted by its own primary key, carrying the
`orgId` the scan read from that very row, so the `org_id` clause can never change *which* row is
removed - it is defence-in-depth against a future non-PK targeting, not a live guard. The property
that actually matters (org B's identically named, identically aged archived área survives while org
A's is deleted, and each ledger entry lands under its own org) is asserted directly and does go red
under M4. Reported for completeness, not as an unguarded destructive path.

Web-side mutations, same method:

| # | Mutation | Result |
| --- | --- | --- |
| M7 | `restoreStateFor` stops withdrawing restore from the entity's earlier archive row (`row.verb === 'purge' \|\| purged.has(...)` -> `row.verb === 'purge'`) | **RED (2 tests)** |
| M8 | The hiding rule leaks into a referencing record: `PessoasView` filters a person's função chips by `status === 'active'` | **RED** - `still renders the chip of an archived função a listed pessoa carries` |

---

## 3. No new cascade (priority 2)

`git diff master` adds **zero** `ON DELETE CASCADE` / `onDelete: 'cascade'` to any schema or SQL. The
only matches on added lines are prose in `nexo/plans/…/00-OVERVIEW.md` and comments in
`purge-service.ts`. `apps/api/src/db/schema.ts` gains four nullable `archived_at` columns and nothing
else; no FK definition is touched.

Verified against the live database rather than the schema file - every FK whose parent is one of the
four cadastro tables, with its `confdeltype`:

```
sales_ops_products.area_id            -> sales_ops_areas      a  NO ACTION   blocks
sales_ops_sale_items.area_id          -> sales_ops_areas      a  NO ACTION   blocks
sales_ops_person_funcoes.funcao_id    -> sales_ops_funcoes    r  RESTRICT    blocks
sales_ops_product_funcao_costs.funcao -> sales_ops_funcoes    r  RESTRICT    blocks
sales_ops_sale_professionals.funcao   -> sales_ops_funcoes    r  RESTRICT    blocks
sales_ops_person_funcoes.person_id    -> sales_ops_people     c  CASCADE     own assignments
sales_ops_sale_professionals.person   -> sales_ops_people     a  NO ACTION   blocks
sales_ops_sales.finder_person_id      -> sales_ops_people     a  NO ACTION   blocks
sales_ops_sales.seller_person_id      -> sales_ops_people     a  NO ACTION   blocks
sales_ops_product_funcao_costs.prod   -> sales_ops_products   c  CASCADE     own cost rows
sales_ops_sale_items.product_id       -> sales_ops_products   a  NO ACTION   blocks
```

Identical to the table in the plan overview, character for character. The two `c` edges are the
item's own configuration and are exercised deliberately by the oracle (the purged pessoa's
`person_funcoes` count is asserted to be 0 afterwards).

---

## 4. Atomicity (priority 3)

Covered by M1b above: the ledger write must take the transaction handle. Passing the pooled `db`
type-checks cleanly (exit 0) and commits on a second connection, and the oracle catches it in two
independent places. The lock order is also correct - the cadastro row is taken `FOR UPDATE` before
`writeAuditEntry` takes the ledger tail's `FOR UPDATE`, matching every other cadastro write, so a
purge cannot deadlock against an operator archiving the same row.

---

## 5. Migration 0020 (priority 4)

Additive and nullable: four `ALTER TABLE … ADD COLUMN "archived_at" timestamp with time zone`, no
`NOT NULL`, no default, no index, no constraint. Journal entry `idx: 20`, `version: "7"`; snapshot
chain intact (`0020_snapshot.json.prevId === 0019_snapshot.json.id`).

**Applies cleanly on top of 0019 - proven, not assumed.** The local DB already had 0020 applied, so a
throwaway database `fxl_verify0020` was created on `localhost:5006`, migrated with a journal trimmed
at 0019, seeded with pre-0020 rows (an archived + an active row in each of the four tables, plus an
`archived` *system* função), and then migrated with the real folder. Result: 21 migrations applied,
no error, and

```
 t       | name      | status   | stamped
---------+-----------+----------+---------
 area    | Arquivada | archived | t
 area    | Ativa     | active   | f
 funcao  | ArqF      | archived | t
 funcao  | AtvF      | active   | f
 funcao  | VendArq   | archived | t
 person  | Ativo     | active   | f
 person  | Inativo   | inactive | t
 product | ProdArq   | archived | t
 product | ProdAtv   | active   | f
```

- **Cannot mark a non-archived row**: every `active` row came back unstamped. The predicate is
  `status = 'archived'` (`'inactive'` for pessoa) on each of the four UPDATEs, matching each table's
  own spelling.
- **Idempotent**: replaying the four UPDATEs reported `UPDATE 0` four times and an md5 over every
  `(name, archived_at)` pair was byte-identical before and after. The `AND archived_at IS NULL` guard
  on every statement is what makes that true, and it is also what makes a re-run unable to restart a
  window that is already ticking.

**The `set_config('app.fxl_admin', 'true', true)` guard is GENUINELY NEEDED, not cargo-culted.**
Two things had to hold and both were tested:

1. *It reaches the UPDATEs.* `set_config(..., is_local => true)` is transaction-scoped, so it is
   worthless if the runner commits per statement. `apps/api/src/db/migration-runner.ts` runs every
   statement of one migration inside a single `BEGIN … COMMIT` on one reserved connection
   (`runCheckedTransaction`), so the setting covers all four UPDATEs. Confirmed by reading the loop.
2. *It changes the outcome.* All four tables are `FORCE ROW LEVEL SECURITY` with an
   `…_admin_context` policy `current_setting('app.fxl_admin', true) = 'true'`. On the scratch DB,
   `sales_ops_areas` was handed to a `NOSUPERUSER` owner and the backfill run twice:

   ```
   SET ROLE mig_owner; BEGIN; UPDATE … WHERE status='archived' AND archived_at IS NULL;  -> UPDATE 0
   SET ROLE mig_owner; BEGIN; SELECT set_config('app.fxl_admin','true',true); UPDATE …   -> UPDATE 1
   ```

   Without the guard the backfill silently matches nothing. It is inert in this repo's local
   topology only because the tables are owned by `postgres`, which is a superuser and bypasses FORCE
   RLS - exactly the condition that does not hold on a managed Coolify database. Same shape and same
   reason as the 0012 system-função seed.

One nuance worth recording: the backfill *does* stamp an `archived` system função if one somehow
exists (the `VendArq` row above), because it deliberately carries no `is_system` clause. That is
harmless and the file says so - the purge filters `is_system` a second time, and M2 proves that
filter is load-bearing.

---

## 6. Org scoping (priority 5)

- The scan is cross-tenant by design (it runs on `getAdminDb()` with no JWT, like the hold
  promotion); every DELETE is scoped by `(org_id, id)` and every candidate carries the `orgId` read
  from its own row.
- `actorOrgId: locked.orgId` - never null, never a request-supplied value. M4 proves the assertion is
  real: nulling it makes the entry invisible to the org-scoped history read, which is precisely the
  silent-hiding failure this point was checking for.
- `purges one org without ever touching another` asserts the positive and the negative: org A's área
  is gone with exactly one `cadastro.purged` under org A, and org B's identically named, identically
  aged, referenced área is still `archived` with no purge entry under org B at all.

---

## 7. The hiding did not break references (priority 6)

All three verified by running the tests, not by reading the list change.

- **Archived produto still names its sale item.** `cadastro-archive.test.tsx` Block E is unchanged by
  this diff and still passes: the wizard's item picker offers `FXL Finance` and not `FXL Legado`,
  while the edit path renders the trigger as `FXL Legado (arquivado)` off `productNameSnapshot`.
- **Archived função still shows on a person who carries it.** New test
  `still renders the chip of an archived função a listed pessoa carries`. M8 (filtering the chips by
  status) turns it RED, so the guard is real and not incidental.
- **Archived função still shows on a profissional cost row.** `product-service-dialog.test.tsx`
  asserts the row reads `Redator (arquivada)` and that the same archived função stays offered in that
  row's own picker. Untouched by this diff, still green - `funcaoLabel` in `SalesOpsApp.tsx:2669` is
  the single source of that `(arquivada)` suffix.

The API still returns archived rows in `bootstrap`; the filtering is purely at the four list
components, which is why history restore can still find the row it is about to reactivate.

---

## 8. Existing tests not weakened (priority 7)

Every previously-passing assertion that archived rows ARE listed was **inverted**, not deleted, and
each file gained coverage:

| File | `it(` master -> branch | `expect(` master -> branch |
| --- | --- | --- |
| `areas-view.test.tsx` | 7 -> 8 | 21 -> 24 |
| `cadastro-archive.test.tsx` | 21 -> 25 | 65 -> 85 |
| `cadastro-history.test.tsx` | 16 -> 21 | 57 -> 77 |
| `pessoas-funcoes-view.test.tsx` | 15 -> 18 | 87 -> 96 |
| `produtos-servicos-view.test.tsx` | 13 -> 15 | 38 -> 47 |

Line-by-line:

- `areas-view`: `toContain('Ativa' / 'FXL Visual' / 'Arquivada')` -> `not.toContain(...)`, plus a new
  `tbody tr` count of 1 and a new "every área archived -> empty panel" test.
- `pessoas-funcoes-view`: `toContain('Ativo' / 'Inativo')` -> `not.toContain(...)`; the função table's
  cell index moved 3 -> 2 because the `Status` column is gone, so the count assertions still assert
  the same numbers on the same column.
- `cadastro-archive`: the old `restores without any confirmation` test was replaced by five tests -
  one per cadastro asserting the archived row is absent AND its restore control is absent, plus a
  sweep asserting zero `^(Restaurar|Reativar) ` aria-labels across all four lists. The only assertion
  genuinely lost is the `type="button"` check on the restore button, which no longer exists.
- `cadastro-history`: the action-set assertion was extended, not relaxed, and a whole Block E was
  added for the purged entity.
- `produtos-servicos-view`: additive only, including the segment-count regression (counts filtered,
  not just rows).

---

## 9. Restore affordances (priority 8)

- `grep` for `Restaurar` / `Reativar` / `ArchiveRestore` in `apps/web/src/sales-ops/SalesOpsApp.tsx`
  returns only the unrelated wizard control `Restaurar padrão`. `restoreVerb` is gone from the
  `cadastroArchive` copy table, and `CadastroArchiveButton` has no archived branch at all.
- In `Histórico de arquivamentos`, a purged entity renders `Excluído definitivamente` (muted, same
  shape as `Já restaurado`) on both the purge row and the entity's earlier archive row, and the purge
  badge uses the `Perdida` palette. `restoreStateFor` returns `{state: 'purged'}` even when a stale
  bootstrap still holds the row, which is right - the PATCH would 404.

---

## 10. CLAUDE.md compliance (priority 9)

| Rule | Result |
| --- | --- |
| No DELETE verb on `salesOpsRouter` | Clean - `grep '\.delete('` on `domains/sales-ops/routes.ts` returns nothing. The purge is a `node-cron` task on the existing single scheduler, not a route, and it has no admin trigger endpoint. |
| No em dash in new code | Clean - zero U+2014 in any added line of `apps/api/src`, `apps/web/src`, or the four untracked source files. |
| No CHANGELOG / generated-file hand-edits | Clean - no CHANGELOG in the diff. `_journal.json` and `0020_snapshot.json` are drizzle-kit output, consistent with the SQL. |
| No native `select` / `option` / `datalist` | Clean - no such element added. |
| Mutations via `useAppMutation` | Clean - every sales-ops mutation still routes through `apps/web/src/sales-ops/hooks.ts`, which this diff does not touch. |
| Archived rows stay resolvable on referencing records | Verified in section 7. |

---

## 11. Non-blocking observations

Neither affects the verdict; both are recorded so they are not lost.

1. **pt-BR copy regression in the pessoa archive confirmation.** `SalesOpsApp.tsx:529` now reads
   `"…mas continua nas propostas que já a utiliza."` - the subject `propostas` is plural, so it must
   be `utilizam`, which is what master said and what the other four entries in the same table still
   say (lines 509 and 519). Introduced by this diff, user-facing, one word. No test pins the string,
   so fixing it is free.
2. **The remaining count columns now count rows the operator cannot see.** `AreasView`'s
   `Nº produtos` counts every produto with that `areaId`, and `FuncoesView`'s `Nº pessoas` counts
   every person carrying the função, both including archived/inactive ones. An área whose produtos
   were all archived reads `Nº produtos 3` above a produtos list showing none. Defensible as-is - it
   is the honest answer to "what still references this", and it is exactly what will block the área's
   own purge - but if the intent is "what you can see", both counts want the same
   `status === 'active'` filter the tables now apply.

---

## Verdict

**PASS.** All five commands green on the restored tree. Every destructive-path mutation (23503
swallowed as success, ledger write off the transaction, `is_system` guard removed, 30-day predicate
removed, `actor_org_id` nulled, restore no longer clearing the stamp) turned a test RED, with the
single documented exception of the org predicate on a primary-key DELETE, which cannot change the
outcome. References still resolve on every record that carries an archived cadastro. Migration 0020
is additive, nullable, chains from 0019, backfills idempotently, cannot stamp an active row, and its
RLS guard was proven necessary by experiment. No audit point failed.

Working tree restored byte-for-byte: `git status --porcelain` identical to the pre-audit snapshot, no
stray files, scratch database and role dropped, no process left running.
