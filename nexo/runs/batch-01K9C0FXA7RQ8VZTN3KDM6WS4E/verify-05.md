# Verify report - slice 05 `pessoas-funcoes-api`

Branch `feat/05-pessoas-funcoes-api`, one commit `866d6ca` on `master` (`d93fce1`).
Gate 2 (machine gate). Verdict: **FAIL** on three real correctness defects.

This is a strong slice.
The migration is expand-only and replays cleanly, the tenancy story is genuinely defended rather than merely asserted, the composite foreign keys are load-bearing, the `is_system` CHECK holds on every raw SQL path I could find, and the backfill is correct and idempotent for every legacy case.
It fails on error-path robustness, not on design: two unhandled unique-violation races that surface as HTTP 500 where a 409 or a success is correct, plus one unflagged behavioural regression on a pre-existing endpoint.

## 1. Gates

All four run on the pristine branch tree, exit codes recorded directly.

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | pass |
| `pnpm run type-check` | 0 | pass |
| `CI=true pnpm test` | 0 | pass |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | pass |

Totals against the stated branch-point baseline:

| Project | Baseline | Now | Delta |
| --- | --- | --- | --- |
| api unit | 23 files / 215 tests | 24 / 248 | +1 / +33 |
| api integration | 13 files / 47 tests | 15 / 68 | +2 / +21 |
| web | 28 / 181 | 28 / 181 | unchanged |
| shared-utils | 1 / 17 | 1 / 17 | unchanged |

Totals only rose. Nothing was removed.

`apps/api/test/rls/setup-env.ts` is **not** in the diff and its protection is intact: it still does
`process.env.DATABASE_URL = appUrl` as a hard assignment (not `??=`), with `appUrl` resolving from
`TEST_DATABASE_URL` first. The app connects as the non-superuser `fxl_sales_test`; migrations run as
`postgres`. The suite therefore cannot fall back to the staging DB that `.env`'s `DATABASE_URL` points at.

## 2. Migration replays from scratch - yes

I did not trust the already-applied state. I dropped both new tables `CASCADE`, dropped
`sales_ops_people_org_id_id_idx`, and deleted the 0012 row from `drizzle.__drizzle_migrations`,
confirming 0 rows and 0 relations remained. I then let the integration `global-setup` replay it.

After the replay the catalog is **byte-identical** to the pre-drop capture (`diff` clean across
`pg_constraint`, `pg_indexes`, `pg_class`, `pg_policies`):

- Both composite foreign keys, exactly as intended:
  - `FOREIGN KEY (org_id, funcao_id) REFERENCES sales_ops_funcoes(org_id, id) ON DELETE RESTRICT`
  - `FOREIGN KEY (org_id, person_id) REFERENCES sales_ops_people(org_id, id) ON DELETE CASCADE`
- The check constraint: `CHECK (((NOT is_system) OR (slug = ANY (ARRAY['vendedor'::text, 'finder'::text]))))`
- All five new indexes present, plus `sales_ops_people_org_id_id_idx`.
- RLS on both new tables: `relrowsecurity = t` **and** `relforcerowsecurity = t`.
- The full policy set: `*_tenant_isolation` and `*_admin_context` on both tables, `PERMISSIVE`/`ALL`,
  with both `USING` and `WITH CHECK`.

`pnpm --filter @fxl-sales/api db:generate` reports `No schema changes, nothing to migrate` - **no drift**
between `schema.ts` and the migration - and left no generated files behind (`git status` on `drizzle/` clean).

### Statement ordering - valid

Both composite FKs reference unique indexes, and both indexes are created before them:
`sales_ops_funcoes_org_id_id_idx` (line 23) and `sales_ops_people_org_id_id_idx` (line 24) precede the
two `ADD CONSTRAINT` statements (lines 27-28).
The admin-context `set_config` (line 49) comes after the last `CREATE POLICY`, and all seed INSERTs come
after it.
Drizzle's `pg-core` dialect wraps a migration file in `session.transaction(...)`, so the transaction-local
`set_config('app.fxl_admin', 'true', true)` genuinely covers the seeds even if the migrating role is not a
superuser and `FORCE ROW LEVEL SECURITY` applies.

## 3. Tenancy

### Every new or modified query carries the explicit filter

All present, all inside `withTenant` (which is a real `db.transaction`):

| Function | Filter(s) |
| --- | --- |
| `attachPersonFuncoes` | `eq(salesOpsFuncoes.orgId, orgId)` in the join, `eq(salesOpsPersonFuncoes.orgId, orgId)` in the where |
| `resolvePersonFuncoes` (ids) | `eq(salesOpsFuncoes.orgId, orgId)` |
| `resolvePersonFuncoes` (slugs) | `eq(salesOpsFuncoes.orgId, orgId)` on the read, `orgId` on the insert, `eq(...orgId...)` on the race re-read |
| `replacePersonFuncoes` | `eq(salesOpsPersonFuncoes.orgId, orgId)` on the delete, `orgId` on the insert |
| `listPeople` | `eq(salesOpsPeople.orgId, orgId)` |
| `createPerson` | `orgId` on the insert |
| `updatePerson` | `and(eq(orgId), eq(id))` on both the select and the update |
| `listFuncoes` | `eq(salesOpsFuncoes.orgId, orgId)` |
| `getFuncao` | `and(eq(orgId), eq(id))` |
| `createFuncao` | `orgId` on the insert |
| `updateFuncao` | `and(eq(orgId), eq(id))` on both the select and the update |
| `findFuncaoClash` | `eq(orgId)` on both the name and slug probes |
| `getSalesOpsSnapshot` | `eq(salesOpsFuncoes.orgId, orgId)` and `eq(salesOpsPersonFuncoes.orgId, orgId)` |

No endpoint accepts an org, account, user or workspace id from a request body. `orgId` always comes from
`c.get('orgId')`. `FuncaoSchema` has no `slug`/`isSystem`/`orgId` keys, so Zod strips them; the shipped
`routes.test.ts` asserts this with a payload that deliberately smuggles
`orgId: 'body-org-must-not-be-used'`, `workspaceId`, `slug: 'vendedor'` and `isSystem: true`, and asserts
the service is called with `{ name, status }` only. `createFuncao` also hard-codes `isSystem: false`.

### The implementer's anti-RLS-masking claim - verified

The claim is that driving the service over an `app.fxl_admin` connection (where the admin policy exposes
every org) isolates the explicit filter from the policies. I verified it by deleting filters and confirming
Red each time:

| # | Mutant | Result |
| --- | --- | --- |
| 1 | `listFuncoes`: drop `.where(eq(orgId))` | **Red** - 1 failed |
| 2 | `resolvePersonFuncoes` ids path: drop `eq(orgId)` | **Red** - 1 failed |
| 3 | `updateFuncao`: drop `orgId` from **both** the select and the update | **Red** - 1 failed |
| 4 | `updatePerson`: drop `orgId` from **both** the select and the update | **Red** - 1 failed |
| 5 | `attachPersonFuncoes`: drop both `orgId` filters | **survived - equivalent mutant** |

In every Red case the single failing test was
`scopes every funções and pessoas read by orgId even when RLS is not doing the scoping` - exactly the test
written to make that claim. The claim holds.

Mutant 5 is an **equivalent mutant**, not a hole. `attachPersonFuncoes` restricts on
`inArray(salesOpsPersonFuncoes.personId, people.map(id))`, where `people` is already org-filtered and person
ids are globally unique UUIDs; the composite `(org_id, person_id)` FK guarantees an assignment row's `org_id`
equals its person's `org_id`, and the composite `(org_id, funcao_id)` FK guarantees the joined função is in
the same org. Those two filters are redundant belt-and-braces. They are still present in the shipped code as
`CLAUDE.md` requires. Not a defect.

Note that mutants 3 and 4 needed **both** filters removed: each of the paired select/update filters
independently defends the other, so a single-filter deletion is also equivalent. That is defence in depth,
not a gap.

### Composite FKs are load-bearing - yes

I replaced `sales_ops_person_funcoes_org_funcao_fk` with a single-column
`FOREIGN KEY (funcao_id) REFERENCES sales_ops_funcoes(id)`. The cross-org insert (org A's person + org B's
função) then **succeeded**, and the test caught it:

```
× a cross-org assignment is rejected by the composite foreign key even in the admin context
AssertionError: promise resolved "[]" instead of rejecting
```

Composite FK restored and verified via `pg_constraint`; no orphan rows were left (checked and 0 deleted).

### Raw RLS

The shipped suite provisions a real `NOSUPERUSER NOBYPASSRLS` role and proves cross-org invisibility,
`WITH CHECK` refusal of a smuggled `org_id`, and that nothing is readable with no org context set. Sound.

## 4. Anti-gaming - clean

`git diff master..feat/05-pessoas-funcoes-api -- '*test*'` contains **zero removed lines**. No `.only`,
`.skip`, `.todo`, `xit` or `xdescribe` was added anywhere in the diff.

The `routes.test.ts` change (+245) is purely additive: four new `vi.fn()` mocks, four `vi.mock` wirings,
two new fixtures, four new `beforeEach` defaults, and two new `describe` blocks appended after the existing
area-routes block. No existing assertion, fixture or `beforeEach` line was modified or relaxed. The
pre-existing `personPayload`/`personResult` fixtures still carry `isSeller`/`isFinder`/`isCollaborator`
unchanged.

The `.refine()` for "at least one role" was removed from `PersonSchema`, but it was **replaced**, not
dropped: the rule moved into `planPersonFuncoes` and is covered by three new contract tests plus two new
integration tests. No pre-existing test asserted the old refine message.

## 5. Backward compatibility - one regression found

Good:

- All three booleans still exist on `sales_ops_people`, still `NOT NULL DEFAULT false`, still returned by the
  API in the same shape. The response is purely **additive** (`funcoes`, `funcaoIds` on each person; new
  top-level `funcoes` and `personFuncoes` on the snapshot). `apps/web` type-checks and its 181 tests pass
  untouched.
- The mirrors are genuinely derived. `deriveBooleanMirrors` is computed from the resolved función set on every
  write path, and `replacePersonFuncoes` is a full set replacement inside the same transaction, so there is
  exactly one write path.
- `is_collaborator` is correctly `funcoes.some((f) => !f.isSystem)`, and the seeded `prestador` función is
  `is_system = false` (verified in the DB after a real replay), so a pessoa tagged only "Desenvolvedor"
  becomes selectable as a prestador. That matches the spec.
- Every pre-existing FK still resolves: I confirmed `salesOpsSales.sellerPersonId`, `.finderPersonId` and
  `salesOpsSaleProfessionals.personId` all survive a migration replay with real rows attached (the shipped
  `leaves the legacy boolean columns and every sales person FK intact` test, which I watched pass against a
  genuinely re-created schema).

### Mirror drift - could not be induced through the service

I wrote a probe that recomputes what each mirror *should* be from the join table and compares after every
step. All of these stayed consistent:

create with all three legacy booleans; `createFuncao` (unrelated); partial `{isSeller: true}` patch;
all-booleans-false patch; `{funcaoIds + contradicting booleans}` (ids correctly win); renaming the attached
dynamic função; archiving the attached dynamic função; a `displayName`/`status`-only patch; and after both
rejected writes (`funcaoIds: []` and an unknown uuid), which left the row byte-identical.

I also confirmed the transaction boundary: an aborted transaction that had already written new mirrors and
deleted the old assignments left **nothing** behind, because `withTenant` is a real `db.transaction`.

Concurrency is also sound: `updatePerson` takes the `sales_ops_people` row lock (the `UPDATE`) *before*
`replacePersonFuncoes` runs, so two concurrent writers serialize and the last committer wins wholly. Eight
rounds of three concurrent conflicting `funcaoIds` writes produced zero errors and zero inconsistent mirrors.

### DEFECT 3 - `PATCH /people/:id` no longer clears `contactEmail`

`updatePerson` changed from an unconditional `contactEmail: data.contactEmail || null` to a conditional
`...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail || null } : {})`.

The shipped, untouched web Pessoa dialog builds `contactEmail: contactEmail.trim() || undefined` and sends it
through `JSON.stringify`, which **drops the key entirely** when the field is blank. So:

- on `master`: key absent, `undefined || null` -> `null` -> e-mail **cleared**;
- on this branch: key absent -> skipped -> e-mail **retained**.

Reproduced end-to-end against the real service using the exact wire body the dialog produces
(`'contactEmail' in wireBody === false`):

```
AFTER BLANKING THE E-MAIL, STORED VALUE = "old@example.com"   // branch
AFTER BLANKING THE E-MAIL, STORED VALUE = null                // master semantics restored
```

I isolated it to that single line by temporarily restoring master's `.set()` and watching the probe flip to
green, then reverting.

Judgement: the new conditional spread is arguably the *more* correct PATCH semantics in the abstract - the old
code would wipe an e-mail on a `{status}`-only patch. But this is an unflagged, untested behaviour change to a
pre-existing endpoint that removes the only way the shipped UI can clear a pessoa's e-mail, and slice 09 is not
scoped to fix it. The acceptance criterion requires every pre-existing endpoint to "still resolve unchanged".
It does not. Real defect, lower severity than the two below.

## 6. `is_system` protection - solid, including raw SQL

Through the API: `updateFuncao` returns `'is_system'` -> 409 `funcao_is_system` for any `name` or `status`
change on a system função, and there is no DELETE verb anywhere. `createFuncao` and `updateFuncao` both refuse
any name that slugifies onto a reserved key (`'Vendedor'`, `'vendedor'`, `'Finder'`).

Through raw SQL, I tested three paths beyond the shipped INSERT test - all correctly rejected by
`sales_ops_funcoes_system_slug_check`:

1. `UPDATE ... SET is_system = true WHERE slug = 'desenvolvedor'` -> rejected.
2. `UPDATE ... SET slug = 'vendedor-senior' WHERE slug = 'vendedor'` (renaming a system slug away) -> rejected.
3. `INSERT ... ('P.O.', 'p-o', true)` -> rejected.

Two residual raw-SQL gaps, both acceptable and by design: raw SQL can still change a system função's `name`
(the CHECK constrains `slug`, which is the load-bearing machine key, and the API blocks the rename), and raw
SQL can `DELETE` a system función when it has no assignments (the API exposes no DELETE, and the
`ON DELETE RESTRICT` FK blocks it whenever it is assigned - I confirmed that rejection).

## 7. Backfill - correct for every case, and idempotent

I seeded six legacy people in a fresh org **before** replaying the migration, then let `global-setup` apply
the real 0012 DDL and backfill:

| Legacy row | Funções after backfill | Mirrors | Verdict |
| --- | --- | --- | --- |
| seller only | `vendedor` | `t/f/f` | correct |
| finder only | `finder` | `f/t/f` | correct |
| **seller AND finder** | `finder,vendedor` | `t/t/f` | **ONE pessoa, TWO funções** |
| collaborator only | `prestador` | `f/f/t` | correct |
| all three | `finder,prestador,vendedor` | `t/t/t` | correct |
| none | (none) | `f/f/f` | correct - empty set is the matching set |

6 pessoas, 8 assignments, exactly as arithmetic predicts. No duplication. `prestador` seeded `is_system = false`.
The three system funções are seeded once per org from the union of `sales_ops_people`, `sales_ops_settings` and
`sales_ops_sales`, which correctly covers an org that has a proposta but no settings row.

Idempotency: every seed INSERT carries `ON CONFLICT (...) DO NOTHING` (the shipped contract test asserts this
structurally for all five), and the shipped integration test replays the backfill three times and asserts the
función and assignment sets are unchanged. I also replayed it many times incidentally across my mutant runs
with no duplication.

## 8. Scope discipline - clean

- `apps/web/**` **untouched**. The diff touches 10 files, all under `apps/api/`.
- The affiliate `sellers` and `finders` tables and their routes are untouched. `schema.ts` has only three
  hunks: the `foreignKey` import, `salesOpsPeople`, and the two new tables inserted after `salesOpsAreas`.
- No change to the propostas status machine, payables/receivables materialization, or the `"N/M"` / `"MN/M"`
  label conventions. `service.ts` hunks are confined to the imports, `PersonFieldsSchema`, the new función
  schemas after `AreaSchema`, the people/función service block, and two additive lines in
  `getSalesOpsSnapshot`. `routes.ts` hunks are the imports, the two people handlers, and the new `/funcoes`
  block after `/areas`.
- No auth-model change; no `AppRole`/`navigation.ts` change; legacy route trees untouched.
- **No new DELETE verb** anywhere (`grep` finds none, and a new test asserts `DELETE /people/:id` and
  `DELETE /funcoes/:id` both 404).
- Migration is expand-only; the contract test asserts no `DROP TABLE|COLUMN|POLICY|CONSTRAINT`.

## 9. Correctness review

Clean: transaction boundaries (real `db.transaction`, proven to roll back mirrors and assignments together);
the concurrent-person-write race (row lock taken before the join writes); no N+1 (`attachPersonFuncoes` is one
grouped query for all people); indexing (`WHERE org_id = ?` is served by the leading column of the unique
indexes on both new tables - no sequential scan on the bootstrap path); Zod (`funcaoIds: z.array(z.string().uuid())`,
so a malformed id is a 400 at the boundary and never reaches Postgres as invalid uuid syntax); no `as any`,
no `: any`, no `@ts-ignore`, no swallowed error (the only two `.catch(() => ({}))` are the standard
malformed-JSON-body guards matching the existing handlers); one non-null assertion added, on a
`.returning()` result that cannot be empty.

Commit hygiene: one commit, Conventional Commit subject `feat(sales-ops): ...`, no co-author trailer, no AI
attribution, no em dash in any added line or in the message.

Two real defects follow. Both are the same root cause class: a unique-violation that is not handled and
escapes as an unhandled rejection, which the Hono handler turns into an HTTP 500.

### DEFECT 1 - `createFuncao` TOCTOU returns 500 where 409 is designed

`findFuncaoClash` does two `SELECT`s and then `createFuncao` does a **plain `INSERT` with no conflict
handling**. Between the check and the insert, a concurrent writer can land the same name. The unique index
correctly protects the data, but the `23505` is unhandled.

Measured: three concurrent `createFuncao` calls with the same name across 30 fresh orgs produced
**60 unhandled errors out of 90 calls**:

```
CREATEFUNCAO REJECTED {"causeCode":"23505",
  "causeConstraint":"sales_ops_funcoes_org_slug_idx",
  "causeMessage":"duplicate key value violates unique constraint \"sales_ops_funcoes_org_slug_idx\""}
CREATEFUNCAO_UNHANDLED_ERRORS 60 of 90 calls across 30 fresh orgs
```

`routes.ts` has the correct 409 mapping (`funcao_name_taken` / `funcao_slug_taken`) but it is only reachable on
the non-concurrent path. This is not an exotic race: an admin double-clicking Save on the new-função form is an
ordinary way to hit it, and the user sees a 500 instead of the designed 409. `updateFuncao` has the identical
pattern (`findFuncaoClash` then a plain `UPDATE`), so two concurrent renames to the same name land the same way
on `sales_ops_funcoes_org_name_idx`.

### DEFECT 2 - the on-demand legacy seed's `ON CONFLICT` arbiter misses the name index

`resolvePersonFuncoes` seeds the legacy slugs with:

```ts
.onConflictDoNothing({ target: [salesOpsFuncoes.orgId, salesOpsFuncoes.slug] })
```

That arbiter covers only `sales_ops_funcoes_org_slug_idx`. There is a **second** unique index,
`sales_ops_funcoes_org_name_idx` on `(org_id, name)`, and a concurrent seed of the same row violates **both**.
When Postgres reports the name index, the arbiter does not apply and `23505` is raised. The code's own
"a concurrent writer won the race; re-read the winner" fallback exists precisely for this race but is
unreachable, because the error never returns a row - it throws.

Measured: five concurrent `createPerson` calls in a brand-new org, over 30 fresh orgs, failed on roughly 10-15%
of attempts:

```
REJECTED cause: {"causeCode":"23505",
  "causeConstraint":"sales_ops_funcoes_org_name_idx",
  "causeMessage":"duplicate key value violates unique constraint \"sales_ops_funcoes_org_name_idx\""}
```

Causality confirmed: widening the arbiter to a bare `.onConflictDoNothing()` (all unique indexes) eliminated
every failure across 30 fresh orgs. I then reverted that diagnostic.

Impact: a spurious HTTP 500 on `POST`/`PATCH /people` and a rolled-back person create. No corruption - the
funções still end up 1 each and the losing person row is simply not created. But it strikes exactly the
scenario deviation 2 was written to protect (an org provisioned after 0012), on that org's very first
concurrent person writes.

## Judgement on the two self-reported deviations

**Deviation 1 - `createFuncao` returning both `'duplicate'` and `'duplicate_slug'`: accept.** The plan
documented two distinct 409 reasons, so two sentinels is the honest encoding of the plan's own intent rather
than a widening of it. The two rules are genuinely distinct and separately observable: `Designer` twice is a
name clash, whereas `DESIGNER` or `Designer.` is a *different* display name colliding on the derived machine
key. Collapsing them would force the API to guess which rule the user hit. `routes.ts` maps them to
`funcao_name_taken` and `funcao_slug_taken`, both 409, and both are tested at the service and route layer.
This is a documentation-level deviation with no contract risk.

**Deviation 2 - ensuring all three legacy slugs on demand rather than only `prestador`: reasoning is correct,
accept the reasoning, but the implementation carries Defect 2.** The reasoning is sound and I verified its
premise: 0012 seeds only orgs present in `sales_ops_people`/`sales_ops_settings`/`sales_ops_sales` at migration
time, so a newly provisioned org genuinely has no `vendedor`/`finder`, and an `{isSeller: true}` write would
otherwise fail. Ensuring all three is the right call. Request and response shapes are genuinely unchanged: the
legacy booleans are still accepted (now `.optional()`, which only widens what parses), the response is purely
additive, and the shipped web build - which always sends all three booleans together and disables Save when all
three are false - cannot observe the one semantic change I found in the boolean path (an all-false patch is now
a 200 no-op where it used to be a 400). Slices 07, 09 and 12 can be written against this contract safely. The
deviation itself is fine; the concurrency hole in how it is implemented is Defect 2.

## Verdict

**FAIL.**

All four gates pass, the migration replays cleanly with no drift, tenancy is genuinely proven, the composite
FKs are load-bearing, the mirrors cannot be made to drift through the service, `is_system` is protected at the
DB level including the raw UPDATE paths, the backfill is correct and idempotent, no test was weakened, and
scope is tight. But three real defects block the merge:

1. `createFuncao` (and `updateFuncao`) TOCTOU -> HTTP 500 instead of the designed 409 on an ordinary
   double-submit; 60/90 concurrent calls affected.
2. The on-demand legacy seed's `ON CONFLICT` arbiter misses `(org_id, name)` -> HTTP 500 on concurrent first
   person writes in a newly provisioned org.
3. `PATCH /people/:id` silently stopped clearing `contactEmail`, breaking the only way the shipped Pessoa
   dialog can clear an e-mail - a behavioural regression on a pre-existing endpoint with no test pinning
   either behaviour.

Defects 1 and 2 share one root cause and one shape of fix (handle the unique violation, or make the arbiter
cover every unique index that the row can collide on, and map it to the existing 409). Defect 3 is a one-line
decision that needs an explicit choice plus a test.

## Style notes (not FAIL reasons)

- `getFuncao` is exported and mocked in `routes.test.ts` but no route calls it; presumably staged for slice
  07/09. Harmless.
- `PATCH /funcoes/:id` with an empty body on a system função falls past the `is_system` guard and bumps
  `updatedAt` on a no-op. Cosmetic.
- Assigning an **archived** função is still permitted (`resolvePersonFuncoes` does not filter on `status`).
  Defensible - archived funções must keep backing historical assignments - but worth an explicit decision in
  slice 09.
- If an org renames its `Prestador` función, a later legacy `{isCollaborator: true}` write creates a second
  `Prestador`. Consistent, just slightly surprising; the legacy path is temporary anyway.
- Migration 0012 issues no `GRANT`. The local test DB works via `ALTER DEFAULT PRIVILEGES`
  (`pg_default_acl`), and 0011 has the same shape, so this is pre-existing and out of scope - but worth
  confirming for the Coolify staging/prod roles.

## Restoration and cleanup

Confirmed before finishing:

- Every mutated source file is **byte-identical** to the branch. `git hash-object` on `service.ts`,
  `schema.ts`, `routes.ts` and `0012_sales_ops_funcoes.sql` matches the pre-probe capture exactly
  (`service.ts` = `d3276e7e17cc98e7be9aebaa011db1d7b03c8015`).
- `git diff HEAD` is empty. `git status --porcelain` shows only the two untracked entries that were present
  when I started (`.vscode/` and the exec agent's own result file). Nothing added, nothing staged, no commit,
  no amend, no merge, no push.
- All four throwaway probe test files under `apps/api/test/rls/` were deleted.
- The database is in a working state: the single-column FK downgrade was reverted to the composite FK and
  verified via `pg_constraint`; the 0012 migration and journal row are back; the catalog `diff`s clean against
  the pre-drop capture; all probe fixture orgs were deleted; and one orphaned `rls_probe_*` role left by a
  failed mutant run was dropped (0 remain).
- Final confirmation run on the pristine tree: `lint=0 type-check=0 test=0 integration=0`,
  api 24/248, web 28/181, shared-utils 1/17, integration 15/68.
