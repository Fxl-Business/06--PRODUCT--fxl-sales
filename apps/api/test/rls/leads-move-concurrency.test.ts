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
