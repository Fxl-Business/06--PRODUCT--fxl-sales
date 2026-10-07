import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import {
  CreateContactLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateContactLeadSchema,
  UpdateLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createContactLead,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateContactLead,
  updateLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
/** A full-edition non-admin, exactly as the FXL tests build one. */
function sellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false };
}
/** A leads-edition non-admin, exactly as `leadScope` builds one. */
function leadsSellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false, name: null, hasSellerRole: true, edition: 'leads' };
}
function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}
const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

describe('sales operations leads: the unassigned pool and claim-on-write', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /** The same service functions over a connection where RLS hides nothing. */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_luc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDb = drizzle(adminDbClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Defensive: nothing here should write a ledger row.
      await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  async function vendedor(orgId: string, displayName: string, account: string, leads = false) {
    const person = await createPerson(
      db,
      orgId,
      PersonSchema.parse(leads ? { displayName } : { displayName, isSeller: true }),
      leads ? { edition: 'leads' } : {},
    );
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${account}
      WHERE org_id = ${orgId} AND id = ${person.id}`;
    return person;
  }

  /** A full-edition org with the seeded etapas and two bound vendedores. */
  async function fullWorld(label: string) {
    const orgId = newOrg(label);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const pick = (kind: string, position?: number) =>
      stages.find((stage) => stage.kind === kind && (position === undefined || stage.position === position))!;
    const ana = await vendedor(orgId, 'Ana Martins', 'hub_ana');
    const bruno = await vendedor(orgId, 'Bruno Lima', 'hub_bruno');
    return {
      orgId,
      ana,
      bruno,
      open: pick('normal', 1),
      second: pick('normal', 2),
      conversion: pick('conversion'),
      lost: pick('lost'),
    };
  }

  /** A leads-edition org: two org-created etapas, two bound vendedores. */
  async function leadsWorld(label: string) {
    const orgId = newOrg(label);
    const stage = async (name: string) => {
      const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name }));
      if (created === 'duplicate') throw new Error(`duplicate stage ${name}`);
      return created;
    };
    const contato = await stage('Contato');
    const proposta = await stage('Proposta');
    const ana = await vendedor(orgId, 'Ana', 'hub_ana', true);
    const bruno = await vendedor(orgId, 'Bruno', 'hub_bruno', true);
    return { orgId, contato, proposta, ana, bruno };
  }

  /** A full-edition lead filed by an admin; `sellerPersonId` absent means unassigned. */
  async function fullLead(orgId: string, contactName: string, sellerPersonId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa Pool',
          estimatedValueBrl: 100000,
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        ADMIN_SCOPE,
      ),
    );
  }

  /** A leads-edition lead an admin filed naming no vendedor: unassigned. */
  async function poolContact(orgId: string, contactName: string) {
    return okLead(
      await createContactLead(db, orgId, CreateContactLeadSchema.parse({ contactName }), ADMIN_SCOPE),
    );
  }

  async function rowOf(leadId: string) {
    const [row] = await adminClient<
      Array<{
        seller_person_id: string | null;
        seller_name_snapshot: string;
        stage_id: string;
        position: number;
        contact_name: string;
        contact_phone: string | null;
        sale_id: string | null;
        updated_at: Date | null;
      }>
    >`SELECT seller_person_id, seller_name_snapshot, stage_id, "position", contact_name,
             contact_phone, sale_id, updated_at
      FROM sales_ops_leads WHERE id = ${leadId}`;
    return row!;
  }

  async function names(orgId: string, stageId: string, scope: LeadScope, limit?: string, cursor?: string) {
    const board = await listLeads(
      adminDb,
      orgId,
      ListLeadsQuerySchema.parse({ stageId, ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) }),
      scope,
    );
    if (!board.ok) throw new Error(`unexpected refusal: ${board.reason}`);
    return board;
  }

  /**
   * Vendedor A's claim, in flight: a transaction on the admin connection that
   * locks the lead row and writes A as its seller exactly as the service's claim
   * UPDATE does, then holds the lock (uncommitted) until released.
   */
  async function holdClaim(orgId: string, leadId: string, winner: { id: string; displayName: string }) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => {
      locked = resolve;
    });
    const done = adminClient.begin(async (sql) => {
      const [self] = await sql<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await sql`SELECT id FROM sales_ops_leads WHERE org_id = ${orgId} AND id = ${leadId} FOR UPDATE`;
      await sql`
        UPDATE sales_ops_leads
        SET seller_person_id = ${winner.id}, seller_name_snapshot = ${winner.displayName}, updated_at = now()
        WHERE org_id = ${orgId} AND id = ${leadId}`;
      locked(self!.pid);
      await released;
    });
    return { pid: await holderPid, release, done };
  }

  /**
   * Deterministic proof that the second claimant is parked on the held row lock
   * and not merely slow: some backend lists the holder among its blockers. Polled
   * on adminDbClient, because the holder occupies one of adminClient's two slots.
   */
  async function waitUntilBlockedBy(holderPid: number) {
    for (let i = 0; i < 500; i += 1) {
      const [row] = await adminDbClient<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))`;
      if (row!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the second claimant never blocked on the held row lock');
  }

  it('lists an active vendedor their own leads plus every unassigned lead, never a colleague lead, with total counting exactly that set', async () => {
    const w = await fullWorld('list');
    await fullLead(w.orgId, 'Ana propria', w.ana.id);
    await fullLead(w.orgId, 'Bruno proprio', w.bruno.id);
    const poolUm = await fullLead(w.orgId, 'Pool um');
    await fullLead(w.orgId, 'Pool dois');
    const poolSegunda = await fullLead(w.orgId, 'Pool segunda');
    okLead(
      await moveLead(
        db,
        w.orgId,
        poolSegunda.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );

    const anaBoard = await names(w.orgId, w.open.id, sellerScope('hub_ana'));
    expect(anaBoard.leads.map((lead) => lead.contactName)).toEqual(['Ana propria', 'Pool um', 'Pool dois']);
    expect(anaBoard.total).toBe(3);
    expect(anaBoard.leads.some((lead) => lead.sellerPersonId === w.bruno.id)).toBe(false);

    // The query param is ignored for a non-admin.
    const spoofed = await listLeads(
      adminDb,
      w.orgId,
      ListLeadsQuerySchema.parse({ stageId: w.open.id, sellerPersonId: w.bruno.id }),
      sellerScope('hub_ana'),
    );
    if (!spoofed.ok) throw new Error(`unexpected refusal: ${spoofed.reason}`);
    expect(spoofed.leads.map((lead) => lead.contactName)).toEqual(['Ana propria', 'Pool um', 'Pool dois']);

    const page1 = await names(w.orgId, w.open.id, sellerScope('hub_ana'), '2');
    expect(page1.leads.map((lead) => lead.contactName)).toEqual(['Ana propria', 'Pool um']);
    expect(page1.total).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await names(w.orgId, w.open.id, sellerScope('hub_ana'), '2', page1.nextCursor!);
    expect(page2.leads.map((lead) => lead.contactName)).toEqual(['Pool dois']);
    expect(page2.total).toBe(3);
    expect(page2.nextCursor).toBeNull();

    const brunoBoard = await names(w.orgId, w.open.id, sellerScope('hub_bruno'));
    expect(brunoBoard.leads.map((lead) => lead.contactName)).toEqual(['Bruno proprio', 'Pool um', 'Pool dois']);
    expect(brunoBoard.total).toBe(3);

    const secondBoard = await names(w.orgId, w.second.id, sellerScope('hub_ana'));
    expect(secondBoard.leads.map((lead) => lead.contactName)).toEqual(['Pool segunda']);
    expect(secondBoard.total).toBe(1);

    expect((await names(w.orgId, w.open.id, ADMIN_SCOPE)).total).toBe(4);
    // Reading claims nothing.
    expect((await rowOf(poolUm.id)).seller_person_id).toBeNull();
  });

  it("reads an own or unassigned lead and answers not_found for a colleague lead or another org's pool lead, over the admin connection", async () => {
    const w = await fullWorld('get');
    const own = await fullLead(w.orgId, 'Ana propria', w.ana.id);
    const other = await fullLead(w.orgId, 'Bruno proprio', w.bruno.id);
    const pool = await fullLead(w.orgId, 'Pool');
    const ana = sellerScope('hub_ana');

    const gotPool = await getLead(adminDb, w.orgId, pool.id, ana);
    expect(gotPool.ok && gotPool.lead.sellerPersonId).toBeNull();
    const gotOwn = await getLead(adminDb, w.orgId, own.id, ana);
    expect(gotOwn.ok && gotOwn.lead.sellerPersonId).toBe(w.ana.id);
    expect(await getLead(adminDb, w.orgId, other.id, ana)).toEqual(NOT_FOUND);

    // An `OR` that escaped its parentheses would reach every org's pool over this
    // connection, where RLS cannot cover for it.
    const b = await fullWorld('getb');
    const poolB = await fullLead(b.orgId, 'Pool B');
    expect(await getLead(adminDb, w.orgId, poolB.id, ana)).toEqual(NOT_FOUND);
    expect(
      await moveLead(adminDb, w.orgId, poolB.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ana),
    ).toEqual(NOT_FOUND);
    expect(
      await updateLead(adminDb, w.orgId, poolB.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ana),
    ).toEqual(NOT_FOUND);
    const row = await rowOf(poolB.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.contact_name).toBe('Pool B');
    expect(row.stage_id).toBe(b.open.id);
  });

  it('claims an unassigned lead for the vendedor who moves it, in the same write, with the server-side display name', async () => {
    const w = await fullWorld('move');
    const mover = await fullLead(w.orgId, 'Pool mover');
    const anchor = await fullLead(w.orgId, 'Pool ancora');
    const reorder = await fullLead(w.orgId, 'Pool reorder');

    const moved = okLead(
      await moveLead(
        db,
        w.orgId,
        mover.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        sellerScope('hub_ana'),
      ),
    );
    expect(moved).toMatchObject({
      stageId: w.second.id,
      sellerPersonId: w.ana.id,
      sellerNameSnapshot: 'Ana Martins',
    });
    const row = await rowOf(mover.id);
    expect(row.seller_person_id).toBe(w.ana.id);
    expect(row.seller_name_snapshot).toBe('Ana Martins');

    expect(await getLead(db, w.orgId, mover.id, sellerScope('hub_bruno'))).toEqual(NOT_FOUND);
    expect((await names(w.orgId, w.second.id, sellerScope('hub_bruno'))).total).toBe(0);

    // A same-stage reorder claims too and never moves stage_changed_at.
    const micros = async () => {
      const [r] = await adminClient<{ micros: string }[]>`
        SELECT (EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint AS micros
        FROM sales_ops_leads WHERE id = ${reorder.id}`;
      return BigInt(r!.micros);
    };
    const before = await micros();
    const reordered = okLead(
      await moveLead(
        db,
        w.orgId,
        reorder.id,
        MoveLeadSchema.parse({ stageId: w.open.id, position: 0 }),
        sellerScope('hub_ana'),
      ),
    );
    expect(reordered.sellerPersonId).toBe(w.ana.id);
    expect(await micros()).toBe(before);

    // A renumber writes position only, so it never claims a neighbour.
    expect((await rowOf(anchor.id)).seller_person_id).toBeNull();

    const [ledger] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log WHERE actor_org_id = ${w.orgId}`;
    expect(ledger!.n).toBe(0);
  });

  it("claims an unassigned lead on a full-edition PATCH whether sellerPersonId is absent, null or the caller's own id, and refuses another id with seller_scope writing nothing", async () => {
    const w = await fullWorld('patch');
    const [p1, p2, p3, p4] = [
      await fullLead(w.orgId, 'Pool 1'),
      await fullLead(w.orgId, 'Pool 2'),
      await fullLead(w.orgId, 'Pool 3'),
      await fullLead(w.orgId, 'Pool 4'),
    ] as [LeadView, LeadView, LeadView, LeadView];
    const ana = sellerScope('hub_ana');

    expect(
      okLead(await updateLead(db, w.orgId, p1.id, UpdateLeadSchema.parse({ contactName: 'Editado' }), ana)),
    ).toMatchObject({ contactName: 'Editado', sellerPersonId: w.ana.id, sellerNameSnapshot: 'Ana Martins' });
    expect(
      okLead(
        await updateLead(
          db,
          w.orgId,
          p2.id,
          UpdateLeadSchema.parse({ sellerPersonId: null, description: 'nota' }),
          ana,
        ),
      ).sellerPersonId,
    ).toBe(w.ana.id);
    expect(
      okLead(await updateLead(db, w.orgId, p3.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ana))
        .sellerPersonId,
    ).toBe(w.ana.id);

    expect(
      await updateLead(
        db,
        w.orgId,
        p4.id,
        UpdateLeadSchema.parse({ sellerPersonId: w.bruno.id, contactName: 'X' }),
        ana,
      ),
    ).toEqual({ ok: false, reason: 'seller_scope' });
    const row = await rowOf(p4.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.seller_name_snapshot).toBe('');
    expect(row.contact_name).toBe('Pool 4');
    expect(row.updated_at).toBeNull();

    // Today's rule on an OWNED lead is unchanged.
    for (const sellerPersonId of [null, w.bruno.id]) {
      expect(await updateLead(db, w.orgId, p1.id, UpdateLeadSchema.parse({ sellerPersonId }), ana)).toEqual({
        ok: false,
        reason: 'seller_scope',
      });
    }
    expect((await rowOf(p1.id)).seller_person_id).toBe(w.ana.id);
  });

  it('never claims through a refused write, including a throw after the UPDATE', async () => {
    const w = await fullWorld('refused');
    const pool = await fullLead(w.orgId, 'Pool');
    const ana = sellerScope('hub_ana');

    // Thrown by replaceLeadProducts AFTER the lead UPDATE, so only the
    // transaction rollback keeps the lead unclaimed.
    await expect(
      updateLead(
        db,
        w.orgId,
        pool.id,
        UpdateLeadSchema.parse({ contactName: 'Nunca', products: [{ productId: randomUUID() }] }),
        ana,
      ),
    ).rejects.toMatchObject({ code: 'product_not_found' });
    await expect(
      updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ clientId: randomUUID() }), ana),
    ).rejects.toMatchObject({ code: 'client_not_found' });
    await expect(
      moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: randomUUID(), position: 0 }), ana),
    ).rejects.toMatchObject({ code: 'stage_not_found' });
    await expect(
      moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.lost.id, position: 0 }), ana),
    ).rejects.toMatchObject({ code: 'lost_reason_required' });

    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.seller_name_snapshot).toBe('');
    expect(row.contact_name).toBe('Pool');
    expect(row.stage_id).toBe(w.open.id);
    expect(row.updated_at).toBeNull();
    const [products] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_lead_products WHERE lead_id = ${pool.id}`;
    expect(products!.n).toBe(0);
  });

  it('claims an unassigned lead on a leads-edition PATCH for absent, null, empty and own vendedor, refuses another id, and claims on move', async () => {
    const w = await leadsWorld('contact');
    const cs: LeadView[] = [];
    for (let i = 1; i <= 6; i += 1) cs.push(await poolContact(w.orgId, `Contato ${i}`));
    const [c1, c2, c3, c4, c5, c6] = cs as [LeadView, LeadView, LeadView, LeadView, LeadView, LeadView];
    const ana = leadsSellerScope('hub_ana');
    const patch = (id: string, body: Record<string, unknown>) =>
      updateContactLead(db, w.orgId, id, UpdateContactLeadSchema.parse(body), ana);

    expect(okLead(await patch(c1.id, { contactPhone: '(27) 99999-0000' }))).toMatchObject({
      contactPhone: '(27) 99999-0000',
      sellerPersonId: w.ana.id,
      sellerNameSnapshot: 'Ana',
    });
    expect(okLead(await patch(c2.id, { sellerPersonId: null, description: 'x' })).sellerPersonId).toBe(w.ana.id);
    expect(okLead(await patch(c3.id, { sellerPersonId: '' })).sellerPersonId).toBe(w.ana.id);
    expect(okLead(await patch(c4.id, { sellerPersonId: w.ana.id })).sellerPersonId).toBe(w.ana.id);

    expect(await patch(c5.id, { sellerPersonId: w.bruno.id, contactPhone: '1' })).toEqual({
      ok: false,
      reason: 'seller_scope',
    });
    const row = await rowOf(c5.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.contact_phone).toBeNull();
    expect(row.updated_at).toBeNull();

    expect(
      okLead(
        await moveLead(
          db,
          w.orgId,
          c6.id,
          MoveLeadSchema.parse({ stageId: w.proposta.id, position: 0 }),
          leadsSellerScope('hub_bruno'),
        ),
      ),
    ).toMatchObject({ stageId: w.proposta.id, sellerPersonId: w.bruno.id, sellerNameSnapshot: 'Bruno' });

    const board = await names(w.orgId, w.contato.id, ana);
    expect(board.leads.map((lead) => lead.contactName).sort()).toEqual([
      'Contato 1',
      'Contato 2',
      'Contato 3',
      'Contato 4',
      'Contato 5',
    ]);
    expect(board.total).toBe(5);
  });

  it('lets only the first of two vendedores claim on move: the second, blocked on the row lock, answers not_found and writes nothing', async () => {
    const w = await fullWorld('racemove');
    const pool = await fullLead(w.orgId, 'Pool corrida');
    const hold = await holdClaim(w.orgId, pool.id, w.ana);
    try {
      let settled = false;
      const second = moveLead(
        db,
        w.orgId,
        pool.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        sellerScope('hub_bruno'),
      ).finally(() => {
        settled = true;
      });
      // Ordering is deterministic, not timed: the holder's UPDATE has taken the
      // row lock before Bruno's request starts, Bruno's snapshot still sees the old
      // NULL seller so his FOR UPDATE must wait, pg_blocking_pids proves he waits
      // on exactly that holder, and READ COMMITTED's re-check after the commit is
      // what this test exists to pin.
      await waitUntilBlockedBy(hold.pid);
      expect(settled).toBe(false);
      hold.release();
      await hold.done;
      expect(await second).toEqual(NOT_FOUND);
    } finally {
      hold.release();
      await hold.done;
    }
    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBe(w.ana.id);
    expect(row.seller_name_snapshot).toBe('Ana Martins');
    expect(row.stage_id).toBe(w.open.id);
    expect(row.position).toBe(1);

    const winner = okLead(
      await moveLead(
        db,
        w.orgId,
        pool.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        sellerScope('hub_ana'),
      ),
    );
    expect(winner.stageId).toBe(w.second.id);
    expect(winner.sellerPersonId).toBe(w.ana.id);
  });

  it('lets only the first of two vendedores claim on edit: the second, blocked on the row lock, answers not_found and writes nothing', async () => {
    const w = await fullWorld('raceedit');
    const pool = await fullLead(w.orgId, 'Pool corrida');
    const hold = await holdClaim(w.orgId, pool.id, w.ana);
    try {
      let settled = false;
      const second = updateLead(
        db,
        w.orgId,
        pool.id,
        UpdateLeadSchema.parse({ contactName: 'Bruno editou' }),
        sellerScope('hub_bruno'),
      ).finally(() => {
        settled = true;
      });
      await waitUntilBlockedBy(hold.pid);
      expect(settled).toBe(false);
      hold.release();
      await hold.done;
      expect(await second).toEqual(NOT_FOUND);
    } finally {
      hold.release();
      await hold.done;
    }
    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBe(w.ana.id);
    expect(row.contact_name).toBe('Pool corrida');

    expect(
      await moveLead(
        db,
        w.orgId,
        pool.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        sellerScope('hub_bruno'),
      ),
    ).toEqual(NOT_FOUND);
    expect(await getLead(db, w.orgId, pool.id, sellerScope('hub_bruno'))).toEqual(NOT_FOUND);
  });

  it('never claims an unassigned lead for an admin who moves or edits it, and still assigns when the admin names a vendedor', async () => {
    const w = await fullWorld('admin');
    const pool = await fullLead(w.orgId, 'Pool');

    const moved = okLead(
      await moveLead(
        db,
        w.orgId,
        pool.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    expect(moved.sellerPersonId).toBeNull();
    expect(moved.sellerNameSnapshot).toBe('');
    expect((await rowOf(pool.id)).seller_person_id).toBeNull();

    const edited = okLead(
      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Admin editou' }), ADMIN_SCOPE),
    );
    expect(edited.sellerPersonId).toBeNull();
    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.seller_name_snapshot).toBe('');
    expect(row.contact_name).toBe('Admin editou');

    expect((await getLead(db, w.orgId, pool.id, sellerScope('hub_ana'))).ok).toBe(true);
    expect((await getLead(db, w.orgId, pool.id, sellerScope('hub_bruno'))).ok).toBe(true);

    const assigned = okLead(
      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ADMIN_SCOPE),
    );
    expect(assigned.sellerPersonId).toBe(w.ana.id);
    expect(assigned.sellerNameSnapshot).toBe('Ana Martins');
    expect(await getLead(db, w.orgId, pool.id, sellerScope('hub_bruno'))).toEqual(NOT_FOUND);
  });

  it("keeps a colleague's lead invisible and unwritable, and a converted unassigned lead read-only without claiming it", async () => {
    const w = await fullWorld('unchanged');
    const brunos = await fullLead(w.orgId, 'Bruno proprio', w.bruno.id);
    const pool = await fullLead(w.orgId, 'Pool convertido');
    const ana = sellerScope('hub_ana');

    expect(await getLead(db, w.orgId, brunos.id, ana)).toEqual(NOT_FOUND);
    expect(
      await moveLead(db, w.orgId, brunos.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ana),
    ).toEqual(NOT_FOUND);
    expect(
      await updateLead(db, w.orgId, brunos.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ana),
    ).toEqual(NOT_FOUND);
    const brunoRow = await rowOf(brunos.id);
    expect(brunoRow.seller_person_id).toBe(w.bruno.id);
    expect(brunoRow.contact_name).toBe('Bruno proprio');
    expect(brunoRow.stage_id).toBe(w.open.id);

    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${w.orgId}, 1, 'PROP-LUC-1', 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
              100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    expect(
      okLead(
        await moveLead(
          db,
          w.orgId,
          pool.id,
          MoveLeadSchema.parse({ stageId: w.conversion.id, position: 0, saleId: sale!.id }),
          ADMIN_SCOPE,
        ),
      ).sellerPersonId,
    ).toBeNull();

    expect((await getLead(db, w.orgId, pool.id, ana)).ok).toBe(true);
    const refused = { ok: false, reason: 'already_converted' };
    expect(
      await moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.open.id, position: 0 }), ana),
    ).toEqual(refused);
    expect(
      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Depois' }), ana),
    ).toEqual(refused);
    expect(
      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ana),
    ).toEqual(refused);
    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.seller_name_snapshot).toBe('');
  });

  it('keeps a non-admin who is not an active vendedor on exactly their own leads: no pool, no claim', async () => {
    const w = await fullWorld('notvendedor');
    const pool = await fullLead(w.orgId, 'Pool');
    await fullLead(w.orgId, 'Ana propria', w.ana.id);

    const finder = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Fabio Finder', isFinder: true }));
    if (typeof finder === 'string') throw new Error(`unexpected person outcome: ${finder}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = 'hub_fabio'
      WHERE org_id = ${w.orgId} AND id = ${finder.id}`;
    const fabio = sellerScope('hub_fabio');
    const fabioBoard = await names(w.orgId, w.open.id, fabio);
    expect(fabioBoard.leads).toEqual([]);
    expect(fabioBoard.total).toBe(0);
    expect(await getLead(db, w.orgId, pool.id, fabio)).toEqual(NOT_FOUND);
    expect(
      await moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), fabio),
    ).toEqual(NOT_FOUND);
    expect(await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'X' }), fabio)).toEqual(
      NOT_FOUND,
    );

    // Raw SQL on purpose: updatePerson with a status change appends audit_log rows.
    await adminClient`UPDATE sales_ops_people SET status = 'inactive' WHERE org_id = ${w.orgId} AND id = ${w.ana.id}`;
    const anaBoard = await names(w.orgId, w.open.id, sellerScope('hub_ana'));
    expect(anaBoard.leads.map((lead) => lead.contactName)).toEqual(['Ana propria']);
    expect(anaBoard.total).toBe(1);
    expect(
      await moveLead(
        db,
        w.orgId,
        pool.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        sellerScope('hub_ana'),
      ),
    ).toEqual(NOT_FOUND);

    const row = await rowOf(pool.id);
    expect(row.seller_person_id).toBeNull();
    expect(row.stage_id).toBe(w.open.id);
    expect(row.updated_at).toBeNull();
  });
});
