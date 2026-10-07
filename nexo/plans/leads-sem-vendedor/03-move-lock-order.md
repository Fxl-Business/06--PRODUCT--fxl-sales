---
id: 03-move-lock-order
milestone: v4.4.0
status: done
depends_on: [01-api-claim]
files_modified: [apps/api/src/domains/sales-ops/leads/lead-service.ts, apps/api/test/rls/leads-move-concurrency.test.ts]
oracle: [apps/api/test/rls/leads-move-concurrency.test.ts]
acceptance: ["AC1: two vendedores moving two different pool leads out of the same column into the same destination at the same time both succeed (no 40P01, no rejection), each lead is claimed by its mover, lands at the index it was sent to, and both columns end dense 1..N", "AC2: two vendedores reordering two different cards inside one column at the same time both succeed, the column ends dense 1..N in the order the two moves were serialized, and stage_changed_at of both cards is byte-identical to before", "AC3: two vendedores moving the SAME pool lead at the same time: the first claims and moves it, the second waits and then answers not_found, writing nothing (slice 01 AC5 still holds under the board lock)", "AC4: two creates into the first column at the same time get distinct consecutive positions (no shared position, column dense 1..N)", "AC5: a transaction that files a lead through createLead on its own tx (the import executor shape, a released SAVEPOINT) holds the board until it commits; a concurrent move out of that column waits for it and both columns end dense", "AC6: the lock order lives in ONE private function lockLeadBoard (pg_advisory_xact_lock keyed by a namespace and the org), called by insertLead and moveLead right after the scope gate and before any lead row is read for update; applyLeadUpdate, getLead and listLeads take no board lock; no export, schema or migration changes", "AC7: every existing lead and import integration suite and the leads unit suite pass unchanged"]
---

# 03 API: one board lock, taken before any card

Scope: the pre-existing deadlock slice 01 flagged in its Risks (`01-api-claim.md` ~L732), plus the concurrent-create duplicate position, which has the same root.
Server only.
No migration, no schema change, no route change, no web change, no new export.

## Builds on slice 01 (merged)

Slice 01 is already merged into this run's branch (`c6289bd`, merge `94cc43e` of `7884a82`).
`apps/api/src/domains/sales-ops/leads/lead-service.ts` therefore already has, and this slice keeps byte-for-byte:

- `resolveLeadScopePredicate` returning `LeadScopeGate` with `canClaimUnassigned`, `findActiveVendedor`, `sellerGate`.
- `leadSellerCondition`, `leadIdentityConditions(orgId, id, gate)`, `claimantFor(gate, current)`.
- `moveLead` in this exact order: gate, `if (!gate.ok) return`, identity `SELECT ... FOR UPDATE` with `leadIdentityConditions(orgId, id, gate)`, `not_found`, `already_converted`, destination read (active only, `stage_not_found`), `lost_reason_required`, conversion sale checks (`sale_required_for_conversion` / `sale_not_found` / `sale_not_allowed`), the claim (`claimantFor` + `resolveSellerPersonId`), `stageChanged`, the single UPDATE (with the `...(stageChanged ? { stageChangedAt: new Date() } : {}),` line and the `...(claimed ? {...} : {})` spread), `renumberStage(destination)`, `renumberStage(source)` when the stage changed, `readLeadView`.
- `insertLead`: gate, seller scope check, `resolveSellerPersonId`, `resolveClientName`, first active normal stage, `COALESCE(MAX(position), 0) + 1`, INSERT, `replaceLeadProducts`, `readLeadView`.
- `applyLeadUpdate`: gate, identity `FOR UPDATE`, `already_converted`, claim, one UPDATE, products. It never writes `stage_id` or `position`.

If the executor's base differs from this, stop and re-read the file; every step below anchors on these shapes.

## The defect, reproduced (not hypothesised)

Root cause: the writers of a lead's `stage_id` and `position` are not serialized per board, and the locks they do take are taken in an order that differs between writers.

1. Move vs move (the deadlock).
   `moveLead` locks its OWN card first (identity `SELECT ... FOR UPDATE`), then `renumberStage` locks the whole destination column and then the whole source column, each in `(position, id)` order.
   Two vendedores moving two different cards out of `Novo` into `Em negociação`: Ana holds her card and the destination column and needs every card of the source column, including Bruno's; Bruno holds his card and waits for the destination column Ana holds.
   Postgres detects the cycle after `deadlock_timeout` (1s) and aborts one with SQLSTATE `40P01`, which the route answers as HTTP 500.
   Two reorders inside one column deadlock the same way (each holds its own card, each needs the other's in the renumber).
2. Create vs create (the duplicate position).
   `insertLead` reads `MAX(position) + 1` of the first column with no lock; two concurrent creates both read N and both insert N+1.
   `position` is deliberately not unique (`schema.ts`), so nothing raises; the column silently carries a duplicate.
   It is a real user-visible defect: the API orders a column by `(position, id)` and the web (`apps/web/src/sales-ops/leads/calculations.ts`) breaks ties by `createdAt`, so with a duplicate the two disagree on the order and a drop index computed on the board can land one slot off.
3. Import vs move.
   The import executor runs `createLead` / `moveLead` on its own transaction (each service call is a SAVEPOINT that is released, the outer transaction stays open until the whole import commits).
   Its moves lock whole columns exactly like a vendedor's, so an import and a vendedor dragging in the same columns can deadlock the same way, and an import filing into `Novo` while a vendedor drags a card out of `Novo` leaves a gap (the vendedor renumbers without the uncommitted import row, which then commits at MAX+1).

Proof (run by the planner on this worktree at HEAD `c6289bd`, i.e. WITH slice 01, before any change of this slice): the oracle below, written verbatim to `apps/api/test/rls/`, gave `4 failed | 1 passed`, identically on three consecutive runs:

- case 1 (cross-column pair): `the write was rejected: 40P01` (Bruno's move aborted ~1.0s after the release, Ana's committed);
- case 2 (same-column reorder pair): `the write was rejected: 40P01`;
- case 3 (claim race on one lead): passed (it is the AC5 guard, green before and after);
- case 4 (two creates): column `[Existente 1, Primeiro 2, Segundo 2]`;
- case 5 (import-shaped transaction): column `[Antigo 2 1, Importado 3]` (a gap).

With the exact code of Steps 1-5 below (applied to an untracked copy of `lead-service.ts` and wired in through a throwaway vitest alias, so no tracked file was touched): `5 passed` on five consecutive runs, and the regression set (8 files, 94 tests: `leads-seller-scope`, `leads-unassigned-claim`, `leads-edition`, `leads-no-financial-impact`, `leads-rls`, `lead-stages-rls`, `executor.integration`, `import-routes.integration`) all passed.
Mutation check: moving the `lockLeadBoard` call in `moveLead` to AFTER the identity `FOR UPDATE` turns cases 1 and 2 red again with `40P01`, so the oracle pins the ORDER, not just the presence of a lock.
ESLint (`--max-warnings=0`) and both `tsc` projects were clean on the patched code and the oracle.
All throwaway files were removed and the test orgs were cleaned by `afterAll` (verified zero leftover rows, zero open transactions).

## Design

One transaction-scoped advisory lock per org, `pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(orgId))`, taken by every writer of `stage_id` / `position` right after its scope gate and BEFORE it reads or locks any lead row.
The lock order rule then has one spelling, in one private function, `lockLeadBoard`.

Why this is deadlock-free: every board writer acquires the board lock before any lead row lock, so two board writers can never hold lead rows while waiting for each other (the second one waits on the board lock holding no lead row).
A board writer may still wait on ONE card a concurrent PATCH (`applyLeadUpdate`) has locked, but a PATCH holds only that card, never asks for the board and never waits on anything a board writer holds, so no cycle can close.
The scope gate runs BEFORE the board lock on purpose: the gate can take people-row locks (the e-mail self-claim UPDATE) and wait on unique-index conflicts (the leads-edition auto-provision and its funções seed, which can conflict with an import's uncommitted funções seed). If the gate ran under the board lock, a provisioning vendedor could hold the board while waiting on an import's transaction that in turn waits for the board.
The self-claim UPDATE of `hub_account_id` takes `FOR NO KEY UPDATE` (the `sales_ops_people_org_hub_account_idx` unique index is PARTIAL, so it is not a key Postgres considers for FK lock modes), which never conflicts with the `FOR KEY SHARE` a lead write's foreign-key check takes on the pessoa row; so a board holder never waits on a gate-held lock.

Alternatives, rejected:

- (b) Bounded retry on `40P01`. Every collision still costs a full `deadlock_timeout` (1s) of latency before the retry, the whole `withTenant` must be re-run from outside the aborted transaction (the gate's side effects re-run), the outcome stays nondeterministic under sustained contention (several vendedores working one 114-card column is exactly sustained contention), and inside the import executor's SAVEPOINTs a deadlock victim cannot be retried locally at all. It treats the symptom and keeps the bad lock order.
- (a) Lock the two `sales_ops_lead_stages` rows (`FOR UPDATE` / `FOR NO KEY UPDATE`) in sorted id order. `reorderLeadStages` locks every active stage `FOR UPDATE` in POSITION order, so a stage reorder and a lead move would acquire the same rows in different orders: a new deadlock. `FOR UPDATE` on a stage row also conflicts with the `FOR KEY SHARE` of every lead INSERT's FK check. An advisory key that nothing else in the system ever takes has no such interaction.
- (a') Per-(org, stage) advisory locks in sorted order. The source stage is only known after reading the card, so the move would read it unlocked, lock `{source, destination}` sorted, re-read the card and, when a concurrent move already took it elsewhere, need a THIRD lock out of sorted order (transaction-scoped advisory locks cannot be released early), reintroducing the cycle it exists to prevent, or a refusal the web does not know. All that buys parallelism between moves in disjoint column pairs of ONE org's board, which is one sales team dragging cards by hand: each move holds the lock for a few milliseconds.
- (c) Lock both columns' rows in one global `id` order before the card. Rows entering a column after the lock statement's snapshot are not covered, the card itself must still be re-checked, and the result depends on EvalPlanQual details of a multi-row `stage_id IN (...)` predicate. Far more subtle than one lock.
- A per-org parent ROW lock (the precedent elsewhere is "lock the sale first"). No per-org row exists for every org (the leads edition has no `sales_ops_settings` row), and inventing one is a migration.

Properties relied on (all verified in the planner run):

- Transaction scope: COMMIT or ROLLBACK releases the lock and nothing else can, so a refused write (`{ ok: false }` commits; a thrown `LeadInputError` rolls back) never leaks it.
- SAVEPOINT transfer: acquired inside a nested drizzle transaction (a SAVEPOINT), the lock passes to the parent when the savepoint is released, so the import transaction holds the board from its first `createLead` until it commits (case 5). Re-acquiring it in the same transaction (every later `createLead` / `moveLead` of the import) is granted at once.
- Key space: the two-`int4` form lives in a different advisory key space (`objsubid = 2`) from the single-`bigint` migration lock `pg_try_advisory_lock(hashtext('fxl-sales:database-migrations'))` in `migration-runner.ts`, so the two can never collide. An org hash collision only makes two orgs' boards share one queue.
- `hashtext` is the repo's existing precedent (migration-runner.ts). It is not guaranteed stable across Postgres MAJOR versions, which is irrelevant for a lock no one persists (every backend of one cluster runs one version).
- The app role may call it: `pg_advisory_xact_lock` is executable by PUBLIC; the oracle runs it as the non-superuser `fxl_sales_test` role.
- READ COMMITTED: after the board lock is granted, every following statement takes a fresh snapshot that contains the previous holder's commit (Postgres makes a transaction visible before it releases its locks). This is what makes the claim race's loser see the winner's claim (case 3) and what makes every renumber see every committed move.

Out of scope, by decision:

- `applyLeadUpdate` takes no board lock: it never writes `stage_id` or `position`, locks exactly one card, and so cannot form a cycle (above). Adding the lock would serialize every edit behind every drag for nothing.
- `getLead` / `listLeads` stay lock-free reads.
- Lead-stage writes (`stage-service.ts`) are untouched: they lock only stage rows, which the board lock never touches.

## Step-by-step implementation

All changes are in `apps/api/src/domains/sales-ops/leads/lead-service.ts`.
Keep the file's comment style: comments explain WHY.
Never use the em dash character; use a plain dash.
Do not write the words `auditLog`, `getAdminDb`, `isSeller`, `salesOpsClients` or `computeSaleFinancials` anywhere in this file, comments included: `lead-contract.test.ts` greps the source for them.

### Step 0. Red first

Write `apps/api/test/rls/leads-move-concurrency.test.ts` exactly as given in "The oracle" below, then run it (command in "Run commands") BEFORE touching the service.
Expected: `Tests 4 failed | 1 passed (5)`; cases 1 and 2 fail with `the write was rejected: 40P01`, case 4 with a duplicate position (`['Segundo', 2]`), case 5 with a gap (`['Importado', 3]`), case 3 passes.
Any other red pattern means the base differs from what this plan was proven on: stop and report.

### Step 1. `lockLeadBoard`

Insert this function between the `InsertLeadOptions` type and `async function insertLead(` (keep one blank line on each side).
`sql` and `Db` are already imported / declared in the file; add no import.

```ts
/**
 * The org's lead board lock: the ONE place the lock order of a board write is
 * decided.
 *
 * Every transaction that writes a lead's `stage_id` or `position` (`moveLead`,
 * `insertLead`) takes it right after its scope gate and BEFORE it reads or locks
 * any lead row. Without it two writers sharing a column lock rows in opposite
 * orders: a move locks its own card first and then the whole destination and
 * source columns, so two vendedores dragging two cards out of one column each
 * held their own card while waiting for the other's, and Postgres aborted one
 * with 40P01, an HTTP 500. A create read MAX(position) with no lock at all, so
 * two creates could share a position. One lock per org, held to the end of the
 * writer's transaction, serializes them all. A holder may still wait on a card a
 * concurrent PATCH has locked, but a PATCH never asks for the board, so no
 * cycle can close.
 *
 * Why an advisory lock, and why per ORG:
 *  - Locking the two stage rows instead would collide with `reorderLeadStages`,
 *    which locks every active stage FOR UPDATE in position order, and with the
 *    foreign-key check of every lead INSERT. A key nothing else ever takes
 *    cannot.
 *  - Per stage would need the source stage before the card is read, a re-check
 *    after locking, and an out-of-order second lock whenever a concurrent move
 *    won in between. A board is one team dragging cards by hand: per org costs
 *    nothing measurable and leaves no order to get wrong.
 *
 * Transaction scoped (`_xact_`): COMMIT or ROLLBACK releases it and nothing else
 * can, so no path leaks it. Taken inside a SAVEPOINT (the import executor runs
 * these services on its own transaction) it passes to the parent when the
 * savepoint is released, so an import holds the board until it commits. The two
 * int4 keys are a namespace and the org; an org hash collision only makes two
 * boards share one queue.
 */
async function lockLeadBoard(tx: Db, orgId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(${orgId}))`,
  );
}
```

Keep it private (no `export`): the oracle asserts outcomes and never names the lock, so nothing outside this file needs it.

### Step 2. `insertLead` takes the board right after its gate

In `insertLead`, directly after `if (!gate.ok) return { ok: false, reason: gate.reason } as const;` and before the `// A seller may only file their OWN leads ...` comment, add:

```ts
    // Before MAX(position) below: a second create must wait for this one's row.
    await lockLeadBoard(tx, orgId);
```

It covers `createLead` and `createContactLead` (both go through `insertLead`) and, through them, the import executor.

### Step 3. `moveLead` takes the board right after its gate, before the card

In `moveLead`, directly after `if (!gate.ok) return { ok: false, reason: gate.reason } as const;` and before `const [current] = await tx`, add:

```ts
    // Before the card's row lock, never after it: see lockLeadBoard.
    await lockLeadBoard(tx, orgId);
```

Nothing else in `moveLead` changes: the identity `FOR UPDATE`, every validation, the claim, the UPDATE (the `stageChanged` line stays byte-identical, `lead-contract.test.ts` matches it) and both `renumberStage` calls stay as they are.
The identity `FOR UPDATE` stays: it is the claim race guard against a concurrent PATCH (which takes no board lock) and still answers `not_found` for a card that left the caller's scope.

### Step 4. `renumberStage` docblock (comment only)

Replace the second paragraph of the `renumberStage` docblock, i.e.

```ts
 * `FOR UPDATE` over the whole column, always in (position, id) order, is what
 * makes two concurrent drags of the same column serialize at Postgres rather
 * than interleave into duplicate positions.
```

with

```ts
 * Every caller holds the board lock (`lockLeadBoard`), and THAT is what
 * serializes two drags: no other writer of a position can touch this column until
 * the caller's transaction ends, so the read below already sees every committed
 * move. The `FOR UPDATE` is no longer the guard. It stays because it is harmless:
 * it can only wait on a card a concurrent PATCH holds, and a PATCH never asks for
 * the board, so the wait cannot close a cycle.
```

The code of `renumberStage` does not change (keeping `.for('update')` is deliberate: removing it would change lock behaviour for no gain and widen this slice).

### Step 5. `claimantFor` docblock (comment only)

The race guard for a MOVE is now the board lock, not the card's row lock, so the paragraph is stale for moves.
Replace

```ts
 * The race guard is the `SELECT ... FOR UPDATE` that produced `current`: a
 * second vendedor reaching the same unassigned lead blocks on the row lock, and
 * READ COMMITTED re-checks its WHERE against the committed row once the first
 * commits. `seller = A` matches neither `seller = B` nor `IS NULL`, so the second
 * reads no row and answers not_found. Never raise these transactions to
 * REPEATABLE READ: the loser would then fail with 40001 (a 500) instead.
```

with

```ts
 * The race guard is the `SELECT ... FOR UPDATE` that produced `current`. A
 * second vendedor's PATCH on the same unassigned lead blocks on that row lock, and
 * READ COMMITTED re-checks its WHERE against the committed row once the first
 * commits. A second MOVE already waited on the board lock (`lockLeadBoard`)
 * before its identity read, so that read is a fresh statement that sees the
 * committed claim. Either way `seller = A` matches neither `seller = B` nor
 * `IS NULL`, so the second reads no row and answers not_found. Never raise these
 * transactions to REPEATABLE READ: the loser would then fail with 40001 (a 500)
 * instead.
```

### Not changed, on purpose

- `applyLeadUpdate`, `getLead`, `listLeads`, `resolveLeadScopePredicate`, every export and every result type.
- `apps/api/src/domains/import/executor.ts`: it inherits the lock through `createLead` / `moveLead` (case 5 proves the SAVEPOINT transfer). Writing its own lock would be a second spelling of the rule.
- `apps/api/src/domains/sales-ops/leads/stage-service.ts`, `schema.ts`, migrations: the fix needs no schema; `git diff --stat -- apps/api/drizzle apps/api/src/db` must be empty.
- The existing integration tests, including slice 01's race tests 7 and 8 (their raw holder takes no board lock, so Bruno takes the free board lock and then blocks on the held row exactly as before; verified green).

## The oracle: `apps/api/test/rls/leads-move-concurrency.test.ts` (new)

Write it verbatim (this exact text was proven red on `c6289bd` and green with Steps 1-5).
The harness mirrors `leads-seller-scope.test.ts` / `leads-unassigned-claim.test.ts` (same three clients, same `testDatabaseUrls`, an `org_lmc_` org prefix, `afterAll` deletes by org in FK order).
Mechanism: an outside transaction (`holdRow`) holds ONE row lock that parks the first writer at a precise point inside its own transaction; `blockedBehind(pid)` polls `pg_blocking_pids` to prove the second writer is waiting on the first; only then is the outside lock released.
Everything is keyed on backend pids and per-test orgs, so another suite running against the same local database cannot satisfy or perturb a wait.

```ts
/**
 * Concurrent writes to one org's lead board, against the real database.
 *
 * The Construbom pool (leads-sem-vendedor) puts ~114 unassigned leads in the
 * first column and several vendedores drag cards out of it at the same time.
 * Before the board lock, `moveLead` locked its own card first and then the whole
 * destination and source columns, so two moves sharing a column each held one
 * card while waiting for the other's: Postgres aborted one with 40P01, which the
 * API answered as a 500. A create read MAX(position) with no lock at all, so two
 * creates could share a position.
 *
 * Every case forces the dangerous interleaving deterministically instead of
 * hoping for it: an outside transaction holds ONE row lock that parks the first
 * writer at a precise point inside its own transaction, `pg_blocking_pids` proves
 * the second writer is waiting on the first, and only then is the outside lock
 * released. The tests never name the fix: they assert outcomes (no rejection,
 * dense 1..N columns, each card where it was sent), so they hold for any correct
 * lock order and fail for the old one.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { CreateLeadSchema, MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createLead,
  moveLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson, withTenant } from '../../src/domains/sales-ops/service.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
/** A full-edition non-admin, exactly as the FXL tests build one. */
function sellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false };
}
function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}

/**
 * A service call's outcome with a rejection kept as DATA, so an assertion on two
 * concurrent writers prints the SQLSTATE (40P01) instead of failing on whichever
 * promise rejected first.
 */
type Outcome = { resolved: WriteLeadResult } | { rejected: string };
function outcomeOf(promise: Promise<WriteLeadResult>): Promise<Outcome> {
  return promise.then(
    (resolved) => ({ resolved }),
    (error: { code?: string; cause?: { code?: string }; message?: string }) => ({
      rejected: error?.code ?? error?.cause?.code ?? String(error?.message ?? error),
    }),
  );
}
function resolvedLead(outcome: Outcome): LeadView {
  if ('rejected' in outcome) throw new Error(`the write was rejected: ${outcome.rejected}`);
  return okLead(outcome.resolved);
}

describe('sales operations leads: concurrent board writes never deadlock and keep columns dense', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lmc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  async function vendedor(orgId: string, displayName: string, account: string) {
    const person = await createPerson(db, orgId, PersonSchema.parse({ displayName, isSeller: true }));
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${account}
      WHERE org_id = ${orgId} AND id = ${person.id}`;
    return person;
  }

  /** A full-edition org with the seeded etapas and two bound vendedores. */
  async function world(label: string) {
    const orgId = newOrg(label);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const normal = (position: number) =>
      stages.find((stage) => stage.kind === 'normal' && stage.position === position)!;
    const ana = await vendedor(orgId, 'Ana Martins', 'hub_ana');
    const bruno = await vendedor(orgId, 'Bruno Lima', 'hub_bruno');
    return { orgId, ana, bruno, novo: normal(1), negociacao: normal(2) };
  }

  /** An admin-filed lead, appended to the first column; no `sellerPersonId` means the pool. */
  async function lead(orgId: string, contactName: string, sellerPersonId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa',
          estimatedValueBrl: 100000,
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        ADMIN_SCOPE,
      ),
    );
  }

  function move(orgId: string, leadId: string, stageId: string, position: number, scope: LeadScope) {
    return moveLead(db, orgId, leadId, MoveLeadSchema.parse({ stageId, position }), scope);
  }

  /** One column as [contactName, position] pairs, in board order, read where RLS hides nothing. */
  async function column(orgId: string, stageId: string) {
    const rows = await adminClient<Array<{ contact_name: string; position: number }>>`
      SELECT contact_name, "position" FROM sales_ops_leads
      WHERE org_id = ${orgId} AND stage_id = ${stageId}
      ORDER BY "position", id`;
    return rows.map((row) => [row.contact_name, row.position]);
  }

  async function rowOf(leadId: string) {
    const [row] = await adminClient<
      Array<{ seller_person_id: string | null; stage_id: string; position: number; stage_changed_us: string }>
    >`SELECT seller_person_id, stage_id, "position",
             (EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint::text AS stage_changed_us
      FROM sales_ops_leads WHERE id = ${leadId}`;
    return row!;
  }

  /**
   * An outside transaction that locks ONE row FOR UPDATE and holds it until
   * released. It is never part of the system under test: it only parks the first
   * writer at a known point (a card its renumber must lock next, or the vendedor
   * row a lead INSERT's foreign-key check must share-lock).
   */
  async function holdRow(table: 'sales_ops_leads' | 'sales_ops_people', orgId: string, id: string) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => {
      locked = resolve;
    });
    const done = adminClient.begin(async (tx) => {
      const [self] = await tx<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT 1 FROM ${tx(table)} WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`;
      locked(self!.pid);
      await released;
    });
    return { pid: await holderPid, release, done };
  }

  /**
   * The backend parked behind `pid`, polled on adminDbClient (the holder occupies
   * one of adminClient's two slots). Keyed on the pid, so another suite running
   * against the same database cannot satisfy it. Returns null as soon as
   * `settled()` turns true, which is how a writer that never waited is told apart
   * from one that waits.
   */
  async function blockedBehind(pid: number, settled: () => boolean = () => false): Promise<number | null> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const [row] = await adminDbClient<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid)) LIMIT 1`;
      if (row) return row.pid;
      if (settled()) return null;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no backend ever waited behind ${pid}`);
  }

  it('moves two pool leads out of one column into another for two vendedores at once: both claim and land, no deadlock, both columns dense', async () => {
    const w = await world('cross');
    const poolAna = await lead(w.orgId, 'Pool Ana');
    const parked = await lead(w.orgId, 'Trava');
    const poolBruno = await lead(w.orgId, 'Pool Bruno');
    const earlier = await lead(w.orgId, 'Ja negociando');
    okLead(await move(w.orgId, earlier.id, w.negociacao.id, 0, ADMIN_SCOPE));
    expect(await column(w.orgId, w.novo.id)).toEqual([['Pool Ana', 1], ['Trava', 2], ['Pool Bruno', 3]]);
    const before = await rowOf(poolAna.id);

    // Ana's move is parked on `Trava`, the first card its source-column renumber
    // locks after the destination column; Bruno's card sits after it, still free.
    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
    let outcomes: Outcome[];
    try {
      const first = outcomeOf(move(w.orgId, poolAna.id, w.negociacao.id, 0, sellerScope('hub_ana')));
      const firstPid = (await blockedBehind(hold.pid))!;
      const second = outcomeOf(move(w.orgId, poolBruno.id, w.negociacao.id, 0, sellerScope('hub_bruno')));
      // Bruno now waits on Ana's transaction. Under the old lock order he already
      // holds his own card, which Ana's renumber needs next: the cycle.
      await blockedBehind(firstPid);
      hold.release();
      await hold.done;
      outcomes = await Promise.all([first, second]);
    } finally {
      hold.release();
      await hold.done;
    }

    const [anaMoved, brunoMoved] = outcomes.map(resolvedLead);
    expect(anaMoved).toMatchObject({ stageId: w.negociacao.id, sellerPersonId: w.ana.id });
    expect(brunoMoved).toMatchObject({ stageId: w.negociacao.id, sellerPersonId: w.bruno.id });
    expect(await column(w.orgId, w.novo.id)).toEqual([['Trava', 1]]);
    expect(await column(w.orgId, w.negociacao.id)).toEqual([
      ['Pool Bruno', 1],
      ['Pool Ana', 2],
      ['Ja negociando', 3],
    ]);
    // A stage change still stamps stage_changed_at.
    expect(BigInt((await rowOf(poolAna.id)).stage_changed_us)).toBeGreaterThan(BigInt(before.stage_changed_us));
  });

  it('reorders two cards of one column for two vendedores at once: no deadlock, dense column, stage_changed_at untouched', async () => {
    const w = await world('reorder');
    const anas = await lead(w.orgId, 'Ana A', w.ana.id);
    const parked = await lead(w.orgId, 'Trava');
    await lead(w.orgId, 'Meio');
    const brunos = await lead(w.orgId, 'Bruno D', w.bruno.id);
    const anaBefore = await rowOf(anas.id);
    const brunoBefore = await rowOf(brunos.id);

    // Ana's reorder is parked on `Trava`, right after her own card in the
    // column's (position, id) lock order; Bruno's card is last and still free.
    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
    let outcomes: Outcome[];
    try {
      const first = outcomeOf(move(w.orgId, anas.id, w.novo.id, 3, sellerScope('hub_ana')));
      const firstPid = (await blockedBehind(hold.pid))!;
      const second = outcomeOf(move(w.orgId, brunos.id, w.novo.id, 0, sellerScope('hub_bruno')));
      await blockedBehind(firstPid);
      hold.release();
      await hold.done;
      outcomes = await Promise.all([first, second]);
    } finally {
      hold.release();
      await hold.done;
    }

    const [anaMoved, brunoMoved] = outcomes.map(resolvedLead);
    expect(anaMoved).toMatchObject({ stageId: w.novo.id, sellerPersonId: w.ana.id });
    expect(brunoMoved).toMatchObject({ stageId: w.novo.id, sellerPersonId: w.bruno.id });
    // Applied in the order the board lock granted them: Ana to the end, then Bruno to the top.
    expect(await column(w.orgId, w.novo.id)).toEqual([
      ['Bruno D', 1],
      ['Trava', 2],
      ['Meio', 3],
      ['Ana A', 4],
    ]);
    expect((await rowOf(anas.id)).stage_changed_us).toBe(anaBefore.stage_changed_us);
    expect((await rowOf(brunos.id)).stage_changed_us).toBe(brunoBefore.stage_changed_us);
  });

  it('still lets only the first of two vendedores moving one pool lead claim it: the second waits, then answers not_found and writes nothing', async () => {
    const w = await world('claimrace');
    const pool = await lead(w.orgId, 'Pool disputado');
    const parked = await lead(w.orgId, 'Trava');

    // Ana's move has claimed the card (uncommitted) and is parked renumbering the
    // source column, on `Trava`.
    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
    let outcomes: Outcome[];
    try {
      const first = outcomeOf(move(w.orgId, pool.id, w.negociacao.id, 0, sellerScope('hub_ana')));
      const firstPid = (await blockedBehind(hold.pid))!;
      const second = outcomeOf(move(w.orgId, pool.id, w.negociacao.id, 0, sellerScope('hub_bruno')));
      await blockedBehind(firstPid);
      hold.release();
      await hold.done;
      outcomes = await Promise.all([first, second]);
    } finally {
      hold.release();
      await hold.done;
    }

    expect(resolvedLead(outcomes[0]!)).toMatchObject({ stageId: w.negociacao.id, sellerPersonId: w.ana.id });
    expect(outcomes[1]).toEqual({ resolved: { ok: false, reason: 'not_found' } });
    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBe(w.ana.id);
    expect(row.stage_id).toBe(w.negociacao.id);
    expect(await column(w.orgId, w.novo.id)).toEqual([['Trava', 1]]);
    expect(await column(w.orgId, w.negociacao.id)).toEqual([['Pool disputado', 1]]);
  });

  it('files two leads into the first column at once without sharing a position', async () => {
    const w = await world('create');
    await lead(w.orgId, 'Existente');

    // The first create is parked inside its INSERT: the vendedor foreign-key
    // check must share-lock Ana's pessoa row, which the holder has locked. Its
    // MAX(position) + 1 is already computed and its row already written,
    // uncommitted.
    const hold = await holdRow('sales_ops_people', w.orgId, w.ana.id);
    let outcomes: Outcome[];
    try {
      const first = outcomeOf(
        createLead(
          db,
          w.orgId,
          CreateLeadSchema.parse({ contactName: 'Primeiro', clientName: 'Empresa', sellerPersonId: w.ana.id }),
          ADMIN_SCOPE,
        ),
      );
      const firstPid = (await blockedBehind(hold.pid))!;
      let secondSettled = false;
      const second = outcomeOf(
        createLead(db, w.orgId, CreateLeadSchema.parse({ contactName: 'Segundo', clientName: 'Empresa' }), ADMIN_SCOPE),
      ).finally(() => {
        secondSettled = true;
      });
      // Release only once the second create has either finished (it never waited
      // for the first) or is parked behind the first. Either way it has made its
      // decision about the column before the first commits.
      await blockedBehind(firstPid, () => secondSettled);
      hold.release();
      await hold.done;
      outcomes = await Promise.all([first, second]);
    } finally {
      hold.release();
      await hold.done;
    }

    outcomes.forEach(resolvedLead);
    expect(await column(w.orgId, w.novo.id)).toEqual([
      ['Existente', 1],
      ['Primeiro', 2],
      ['Segundo', 3],
    ]);
  });

  it('holds the board for a whole import-shaped transaction: a vendedor move waits for it and both columns stay dense', async () => {
    const w = await world('import');
    const anas = await lead(w.orgId, 'Antigo 1', w.ana.id);
    await lead(w.orgId, 'Antigo 2');

    // Exactly the import executor's shape: the service runs on the caller's own
    // transaction, so its tenant scope is a SAVEPOINT that is released long
    // before the outer transaction commits.
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: (pid: number) => void;
    const importPid = new Promise<number>((resolve) => {
      started = resolve;
    });
    const importing = withTenant(db, w.orgId, async (tx) => {
      okLead(
        await createLead(tx, w.orgId, CreateLeadSchema.parse({ contactName: 'Importado', clientName: 'Empresa' }), ADMIN_SCOPE),
      );
      const [self] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
      started(self!.pid);
      await released;
    });

    let outcome: Outcome;
    try {
      const pid = await importPid;
      let moveSettled = false;
      const moving = outcomeOf(move(w.orgId, anas.id, w.negociacao.id, 0, sellerScope('hub_ana'))).finally(() => {
        moveSettled = true;
      });
      await blockedBehind(pid, () => moveSettled);
      release();
      await importing;
      outcome = await moving;
    } finally {
      release();
      await importing.catch(() => undefined);
    }

    expect(resolvedLead(outcome)).toMatchObject({ stageId: w.negociacao.id, sellerPersonId: w.ana.id });
    expect(await column(w.orgId, w.novo.id)).toEqual([
      ['Antigo 2', 1],
      ['Importado', 2],
    ]);
    expect(await column(w.orgId, w.negociacao.id)).toEqual([['Antigo 1', 1]]);
  });
});
```

### What each case pins

| case | AC | parks the first writer on | old code | new code |
| --- | --- | --- | --- | --- |
| 1 cross-column pool pair | AC1 | `Trava`, inside Ana's source renumber (Ana holds her card + the destination column) | Bruno holds his card, waits on the destination column; release closes the cycle: `40P01` | Bruno waits on the board; both commit; `Novo [Trava 1]`, `Em negociação [Pool Bruno 1, Pool Ana 2, Ja negociando 3]`, both claimed |
| 2 same-column reorder pair | AC2 | `Trava`, right after Ana's own card in the column's lock order | `40P01` | dense `[Bruno D 1, Trava 2, Meio 3, Ana A 4]`, both `stage_changed_at` byte-identical |
| 3 claim race, one pool lead | AC3 | `Trava`, after Ana's claim UPDATE | Bruno blocks on the card, EvalPlanQual re-check: `not_found` | Bruno blocks on the board, fresh identity read sees the claim: `not_found` |
| 4 two creates | AC4 | Ana's pessoa row (the INSERT's FK `KEY SHARE` check), after MAX was read | second create finishes first with the same position: `[Existente 1, Primeiro 2, Segundo 2]` | second waits on the board: `[Existente 1, Primeiro 2, Segundo 3]` |
| 5 import-shaped transaction | AC5 | the open outer transaction after a released SAVEPOINT | the move never waits, renumbers without the uncommitted row: `[Antigo 2 1, Importado 3]` | the move waits for the import's commit: `[Antigo 2 1, Importado 2]` |

Case 3 is green before and after by design: it is the guard that moving the wait point from the card to the board keeps slice 01's AC5.
Each red case on the old code takes about `deadlock_timeout` (1s) for 1 and 2; all cases finish well inside the 30s integration timeout.
Every hold is released in a `finally` (and `release()` twice is harmless), so a failed assertion never leaves an open transaction that would hang `afterAll`.

## Run commands

From the worktree root (never the main checkout):

```bash
# once per worktree (already done in 00-run): node_modules, built packages, the API .env
pnpm install --frozen-lockfile
cp /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api/.env apps/api/.env   # read-only copy; git-ignored
pnpm run build:packages
# local Docker Postgres must accept connections on 5006: pg_isready -h localhost -p 5006

# Step 0, red first (expect: Tests 4 failed | 1 passed (5), cases 1-2 '40P01')
pnpm --filter @fxl-sales/api test:integration test/rls/leads-move-concurrency.test.ts

# after Steps 1-5 (expect: 5 passed)
pnpm --filter @fxl-sales/api test:integration test/rls/leads-move-concurrency.test.ts

# integration regression set (must stay green, unchanged)
pnpm --filter @fxl-sales/api test:integration test/rls/leads-unassigned-claim.test.ts test/rls/leads-seller-scope.test.ts test/rls/leads-edition.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/leads-rls.test.ts test/rls/lead-stages-rls.test.ts src/domains/import/__tests__/executor.integration.test.ts src/domains/import/__tests__/import-routes.integration.test.ts

# unit set (lead-contract.test.ts reads lead-service.ts source)
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__ src/domains/import/__tests__

# lint on changed files (the package lint script covers src/ and scripts/ only, so name the test file)
pnpm --filter @fxl-sales/api exec eslint --max-warnings=0 src/domains/sales-ops/leads/lead-service.ts test/rls/leads-move-concurrency.test.ts

# type-check (tsconfig.test.json roots test/**, so the new file is checked)
pnpm --filter @fxl-sales/api type-check

# no schema or migration change
git diff --stat -- apps/api/drizzle apps/api/src/db
```

`test:integration` is `VITEST_INTEGRATION=1 vitest run` (run once, never watch); pass files positionally.
Integration files run serially (`fileParallelism: false`).

## Risks

- Serialization cost: every create and move of ONE org now waits for the previous one's commit. A move transaction is a handful of statements plus one renumber UPDATE over a column (~114 cards for Construbom), so a few milliseconds; human-paced drags never notice. Different orgs never wait on each other (except on a 32-bit hash collision, which only shares a queue).
- An import holds the board for its whole transaction (case 5), so vendedores' moves and creates in that org wait until the import commits (seconds for a large file). This is the intended trade: today the same import already locks every card of every column it moves into, and can deadlock with a vendedor instead of making them wait. Imports are admin-only and rare. There is no `statement_timeout` / `lock_timeout` on the app connections (`db/client.ts`), so a wait never turns into an error.
- Lock count: an import re-acquires the board once per `createLead` / `moveLead` (up to 2 x 5000 for the row cap); Postgres grants a held lock immediately and only bumps a local counter. Negligible.
- Connection poolers: a transaction-scoped advisory lock is safe under transaction pooling (a session-level one would not be). Nothing here uses session-level locks.
- REPEATABLE READ would break case 3 (the loser's snapshot predates the winner's commit, so its `FOR UPDATE` would raise 40001). `withTenant` sets no isolation level; `claimantFor`'s docblock already forbids raising it.
- Future writers: any new code path that writes `sales_ops_leads.stage_id` or `position` (a bulk move, a stage-archive reshuffle, a seed run at request time) must call `lockLeadBoard` right after its gate and before any lead row lock. The docblock states it; Capture should add the rule to `CLAUDE.md` (below). Writers that touch only other columns (PATCH) must NOT take it.
- Shared local test DB: another agent may run integration suites at the same time. Every wait in the oracle is keyed on a backend pid of this test, and every row on a fresh org, so a concurrent run cannot satisfy or perturb it.
- `apps/api/scripts/seed-dev.ts` writes leads directly; it runs alone against local Postgres, never concurrently with requests, so it needs no lock.

## Capture notes (for the scribe; not part of this slice's diff)

Suggested `CLAUDE.md` line under "Kanban de leads":
"Every writer of a lead's `stage_id` or `position` (`moveLead`, `insertLead`) takes `lockLeadBoard` (a per-org `pg_advisory_xact_lock`) right after its scope gate and before any lead row lock; never lock a card first. A PATCH never takes it. Oracle: `leads-move-concurrency.test.ts`."
Suggested `nexo/knowledge/reference/kanban-de-leads.md` entry: the incident (two vendedores dragging two cards out of one column deadlocked with `40P01`; concurrent creates shared a position), the rejected alternatives (retry on `40P01`, stage row locks vs `reorderLeadStages`, per-stage advisory locks), and that the import executor inherits the lock through the released SAVEPOINT.
