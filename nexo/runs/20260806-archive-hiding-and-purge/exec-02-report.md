# exec-02 - purge unreferenced archived cadastros

Slice: `02-purge-unreferenced-archived`
Branch: `feat/archive-hiding-and-purge` (no switch, no merge, no commit, no push)
Status: **PASS**

## What was built

An archived produto, pessoa, função or área now carries an `archived_at` stamp, and a third nightly cron task hard-deletes the ones that are past a 30-day window and that nothing references.
The database is the arbiter of "nothing references it": the job attempts the DELETE and reads Postgres's answer, treating `23503` as "still referenced, skip".
Every deletion appends a `cadastro.purged` entry to the hash-chained ledger, in the same transaction as the delete, carrying the entity label snapshot - which after the delete is the only thing left that can name what was removed.

Scope stayed inside `apps/api/**`. No file under `apps/web/**` and no line of `CLAUDE.md` was touched.

## File by file

### `apps/api/drizzle/0020_cadastro_archived_at.sql` + `meta/` (new)

Generated with `drizzle-kit generate --name=cadastro_archived_at`; `_journal.json` and `0020_snapshot.json` are the generator's output, unedited.
Highest migration on disk was verified to be 0019 before numbering.

The generator wrote the four `ADD COLUMN archived_at timestamptz` statements.
Appended by hand, after them:

- `SELECT set_config('app.fxl_admin', 'true', true)` - all four tables are under FORCE ROW LEVEL SECURITY, so in a deployment whose migration role is the table owner rather than a superuser the backfill would match **zero rows** without it. Same shape and same reason as the system-função seed in 0012.
- Four idempotent `UPDATE ... SET archived_at = now() WHERE status = <archived> AND archived_at IS NULL` statements (pessoa on `'inactive'`, the other three on `'archived'`).

The backfill gives the existing archived backlog a **fresh** 30-day window starting at deploy.
Both alternatives are recorded in the file: leaving the column NULL makes those rows unpurgeable forever, which silently turns the feature off for exactly the backlog it was asked for; backdating from `updated_at` purges a years-old archived cadastro on the first nightly run after deploy.

### `apps/api/src/db/schema.ts`

`archivedAt: timestamp('archived_at', { withTimezone: true })` on `salesOpsProducts`, `salesOpsAreas`, `salesOpsFuncoes`, `salesOpsPeople`.
The full contract is documented once, on `sales_ops_areas`; the other three point at it.
No other column, index, check or FK changed, and **no `ON DELETE CASCADE` was added anywhere** - the existing FK rules are the safety mechanism.

### `apps/api/src/domains/audit/service.ts`

- `AuditActionSchema` grew by one member, `cadastro.purged`, appended after the existing seven.
- `CADASTRO_LIFECYCLE_ACTIONS` grew to three, with the actor contract written into its doc comment: `actor_user_id` is the reserved `'system'` sentinel (already the conversion ingest's convention), `actor_org_id` is the purged row's **own** org and never null, and the label snapshot is the history's only remaining source for the name.
- The comment also records that `CADASTRO_HISTORY_ACTIONS` in `apps/web/src/sales-ops/cadastro-history.ts` is the array that actually filters the request, so the new action stays invisible in the UI until slice 03 adds it there. That file was deliberately not touched.
- `writeAuditEntry`, `computeEntryHash`, `canonicalJson` and `verifyChain` are untouched.

### `apps/api/src/domains/sales-ops/service.ts`

- New private `archivedAtPatch(before, after, archived)`, which **delegates to the existing `cadastroLifecycleEvent`** rather than classifying the transition a second time. It returns `{ archivedAt: new Date() }` on archive, `{ archivedAt: null }` on restore, and `{}` otherwise.
  Reusing that classifier is what makes a full-row re-save (the produto and pessoa dialogs both submit `status` on every save) unable to restart the purge window, for free and by construction.
- One spread added to each of the four update statements in `updateProduct`, `updatePerson`, `updateFuncao`, `updateArea`. Nothing else in those functions moved: the `FOR UPDATE` reads, the savepoint in `updateFuncao`, and the `auditCadastroLifecycle` calls are byte-identical.

### `apps/api/src/domains/sales-ops/purge-service.ts` (new, ~300 lines)

The purge lives in its own module, the same separation `audit/history-service.ts` has from `audit/service.ts`, because it is the one cross-tenant destructive path in the codebase and deserves its own header rather than being line 2807 of a 2806-line service.

- `ARCHIVED_CADASTRO_RETENTION_DAYS = 30` - a constant, not a setting.
- Four `PurgeSpec`s run in the order **produto → pessoa → função → área**. That order is load-bearing: a produto's delete cascades its `product_funcao_costs` and a pessoa's cascades its `person_funcoes`, both RESTRICT references onto a função, and `products.area_id` blocks an área. One run therefore collects a produto and the área under it instead of needing one night per level.
- The função spec filters `is_system = false`. Unreachable through the app (the API refuses to archive a system função at all), which is exactly why it is there.
- `purgeCandidate` runs **one transaction per row**: re-select the row `FOR UPDATE` through the *same* eligibility predicate (so an operator's restore between the scan and the delete wins, and the scan and re-check cannot disagree), then `writeAuditEntry(tx, …)`, then the DELETE scoped by `(org_id, id)`.
- `23503` on the `cause` chain → `skipped`, transaction rolled back, row untouched. Anything else → `failed`, rolled back, logged with its entity and org. Nothing is swallowed into the skip bucket.
- Org scoping is the explicit `org_id` predicate on every DELETE, **not** RLS: the admin-context policy admits every row by design, so RLS provides no isolation on this connection and the comment says so.

### `apps/api/src/jobs/nightly-job.ts`

- Third task registered at `'30 3 * * *'`, in its own `try`/`catch`, stopped in `stopNightlyJob()` alongside the other two. It runs last of the three because it is the only destructive one.
- `runArchivedCadastroPurge()` exported beside `runHoldPromotion` / `runHubSessionCleanup`, delegating to `purgeArchivedCadastros(getAdminDb())`.
- Its doc comment records why the integration oracle does **not** call it: it would inherit whatever `DATABASE_URL` is configured, and `apps/api/.env`'s points at staging.

## Tests

### `apps/api/test/rls/cadastro-purge.test.ts` (new, 8 tests)

Written first, run red (`purgeArchivedCadastros is not a function`), then green.

1. `archived_at` is stamped on archive, unchanged by a rename, and cleared on restore - across all four cadastros, pessoa on its own `inactive` spelling.
2. An unreferenced archived cadastro past the window is deleted; the pessoa's own função assignments go with it; a `cadastro.purged` entry exists per entity with `actor_user_id = 'system'`, `actor_org_id = <org>`, `before_jsonb = {status}` and `after_jsonb = {status: 'purged', label, actorLabel: 'Sistema'}`; the preceding `cadastro.archived` entry survives.
3. A referenced one (produto + área on a sale item, pessoa as `seller_person_id`, pessoa + função on a `sale_professional`) is **not** deleted, is still archived, is counted as `skipped`, and leaves **zero** ledger entries.
4. A row archived at exactly `retention - 1` days is untouched, and an active row (no stamp at all) can never be selected.
5. A system função seeded raw as archived-and-400-days-old is never purged.
6. Two orgs with identically named, identically aged archived áreas: only the unreferenced one disappears, its entry lands under its own `actor_org_id`, and the other org's history shows no purge at all.
7. The migration's own backfill statements, replayed from the `.sql` file on disk, stamp legacy archived/inactive rows, leave active rows unstamped, and leave the backfilled rows unpurgeable today.
8. `verifyChain` over the whole ledger is valid after all of it.

Safety: the file refuses to run unless both `TEST_DATABASE_URL` and `ADMIN_DATABASE_URL` resolve to `localhost:5006` (`assertLocalDb`), and it drives `purgeArchivedCadastros` with an explicit local connection rather than the env-resolved job entry point.
Its `afterAll` deletes **every** hash-bearing `audit_log` row rather than only its own orgs: the purge is cross-tenant, so an org-scoped delete could punch a hole mid-chain and fail `verifyChain` in every later file.

### `apps/api/src/jobs/__tests__/nightly-job.test.ts` (new, 2 tests)

`node-cron` and every dependency mocked. Asserts the three schedules are `['0 3 * * *', '15 3 * * *', '30 3 * * *']` on one scheduler, that `stopNightlyJob()` stops all three, and that a throwing purge is contained by its own `catch` (the handler resolves, and the error is logged).

### Mutation checks (the tests actually discriminate)

| Mutation | Result |
|---|---|
| `writeAuditEntry(db, …)` instead of `writeAuditEntry(tx, …)` | **caught** - `a skipped purge left a ledger entry - writeAuditEntry was handed 'db' instead of the transaction handle: expected [ … ] to have a length of +0 but got 1` (2 failed, 5 passed) |
| `eq(salesOpsFuncoes.isSystem, false)` deleted | **caught** - `never purges a system função` failed (1 failed, 6 passed) |

Both files were restored byte-for-byte afterwards (`diff` clean).

Note on the trap: the ordinary rollback probe is not needed here and a DEFERRABLE trigger was not required, because the purge's *own* semantics produce the discriminating failure - the audit entry is written BEFORE the DELETE, so the foreign-key violation aborts a transaction that already contains it. That is exactly the "failure after the write" the brief asks for, and the mutation table above proves it discriminates.

## Verification

All run once, no watch mode.

```
$ pnpm --filter @fxl-sales/api test
 Test Files  37 passed (37)
      Tests  364 passed (364)

$ pnpm --filter @fxl-sales/api test:integration
 Test Files  24 passed (24)
      Tests  158 passed (158)

$ pnpm --filter @fxl-sales/api lint
> eslint src/          (no output, exit 0)

$ pnpm run type-check
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

## Database safety

- The migration reached the local Docker DB only, through the integration suite's `globalSetup` (`TEST_MIGRATE_DATABASE_URL`). Verified afterwards against `localhost:5006`: the four `archived_at` columns exist as nullable `timestamp with time zone`, and the latest applied migration timestamp is `1786030700588`, which is 0020's journal entry.
- `drizzle-kit generate` does not open a connection, and `db:migrate` was never run.
- Staging was never connected to: nothing in this slice reads `env.DATABASE_URL`, the integration suite hard-overrides it, and the oracle asserts the host before doing anything destructive.
- No process was left running; the two throwaway verification scripts were one-shot `node` runs.

## Known gaps / handoff to slice 03

- The web panel still filters on two actions, so a `cadastro.purged` entry is written but not requested by the UI yet. `CADASTRO_HISTORY_ACTIONS` in `apps/web/src/sales-ops/cadastro-history.ts` needs the third literal, `normalizeHistoryVerb` needs a `purge` verb, and `restoreStateFor` already returns `{state: 'none'}` for a non-archive verb - so an unknown-verb purge row renders read-only today rather than offering an unreachable `Restaurar`.
- `CLAUDE.md`'s "Arquivamento e histórico" section opens with **"There is still NO delete and no DELETE verb"**, which is now half true and needs the capture step to say so precisely: there is still no DELETE verb and no operator-triggered delete, but a scheduled system job does hard-delete. The same section's claim that a `DEFERRABLE INITIALLY DEFERRED` trigger is "the only assertion that catches" the `db`-instead-of-`tx` trap also deserves the purge's counter-example - there, the FK violation lands after the ledger write, so an ordinary skip is already the discriminating case (mutation-verified above).
- No index was added on `(status, archived_at)`. The four cadastro tables are small per org and the scan runs once a night; add one if a tenant's catalog ever makes it matter.
