import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import {
  CreateLeadSchema,
  LeadStageSummaryQuerySchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createLead,
  listLeads,
  moveLead,
  summarizeLeadStages,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { deleteLead } from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';

// Org assertions are made over `adminDb` (where only the service's own org
// predicate scopes the read); seller assertions are load-bearing over either
// connection. This mirrors leads-seller-scope.test.ts.
const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
function sellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false };
}
function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}

type Row = { stageId: string; sellerPersonId: string | null; value: number };
type Totals = Record<string, { count: number; estimatedValueBrl: number }>;

describe('sales operations leads: per-stage summary', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /** The same service functions over a connection where RLS hides nothing. */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lss_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
      // deleteLead writes ledger rows. A tail delete of the hash-chained ledger
      // is safe only because the integration project runs with
      // `fileParallelism: false`, so no other file appends meanwhile.
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

  async function vendedor(orgId: string, displayName: string, account: string) {
    const person = await createPerson(db, orgId, PersonSchema.parse({ displayName, isSeller: true }));
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${account}
      WHERE org_id = ${orgId} AND id = ${person.id}`;
    return person;
  }

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

  async function fullLead(orgId: string, contactName: string, valueCents: number, sellerPersonId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa Soma',
          estimatedValueBrl: valueCents,
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        ADMIN_SCOPE,
      ),
    );
  }

  async function summary(
    orgId: string,
    scope: LeadScope,
    sellerPersonId?: string,
    conn: typeof db = adminDb,
  ) {
    const result = await summarizeLeadStages(
      conn,
      orgId,
      LeadStageSummaryQuerySchema.parse(sellerPersonId ? { sellerPersonId } : {}),
      scope,
    );
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
    return result.stages;
  }

  function byStage(stages: Array<{ stageId: string; count: number; estimatedValueBrl: number }>): Totals {
    return Object.fromEntries(
      stages.map((s) => [s.stageId, { count: s.count, estimatedValueBrl: s.estimatedValueBrl }]),
    );
  }

  /** Walks every page of one column, returning the first page's `total` and every value. */
  async function listAll(orgId: string, stageId: string, scope: LeadScope, sellerPersonId?: string) {
    const values: number[] = [];
    let total = 0;
    let cursor: string | undefined;
    for (let first = true; ; first = false) {
      const result = await listLeads(
        adminDb,
        orgId,
        ListLeadsQuerySchema.parse({
          stageId,
          limit: '200',
          ...(cursor ? { cursor } : {}),
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        scope,
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
      if (first) total = result.total;
      values.push(...result.leads.map((lead) => lead.estimatedValueBrl));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return { total, values };
  }

  function expectedTotals(rows: Row[], keep: (row: Row) => boolean): Totals {
    const out: Totals = {};
    for (const row of rows.filter(keep)) {
      const entry = (out[row.stageId] ??= { count: 0, estimatedValueBrl: 0 });
      entry.count += 1;
      entry.estimatedValueBrl += row.value;
    }
    return out;
  }

  async function insertSale(orgId: string, code: string) {
    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${orgId}, 1, ${code}, 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
              100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    return sale!.id;
  }

  /** Ana, Bruno and unassigned leads spread over `open` and `second`, with bookkeeping. */
  async function mixedLeads(w: Awaited<ReturnType<typeof fullWorld>>) {
    const rows: Row[] = [];
    const add = async (name: string, value: number, seller: string | undefined, stageId: string) => {
      const lead = await fullLead(w.orgId, name, value, seller);
      if (stageId !== w.open.id) {
        okLead(
          await moveLead(
            db,
            w.orgId,
            lead.id,
            MoveLeadSchema.parse({ stageId, position: 0 }),
            ADMIN_SCOPE,
          ),
        );
      }
      rows.push({ stageId, sellerPersonId: seller ?? null, value });
      return lead;
    };
    await add('A1', 1000, w.ana.id, w.open.id);
    await add('A2', 2000, w.ana.id, w.second.id);
    await add('B1', 4000, w.bruno.id, w.open.id);
    await add('B2', 8000, w.bruno.id, w.second.id);
    await add('U1', 16000, undefined, w.open.id);
    await add('U2', 32000, undefined, w.second.id);
    return rows;
  }

  it('admin: one entry per stage with a live lead, equal to the list total and the sum of every page, beyond the first page', async () => {
    const w = await fullWorld('all');
    const rows: Row[] = [];
    const sellers = [w.ana.id, w.bruno.id, undefined];
    let unassignedId = '';
    let brunoId = '';
    for (let i = 0; i < 55; i++) {
      const seller = sellers[i % 3];
      const value = 1000 + i;
      const lead = await fullLead(w.orgId, `Lead ${i}`, value, seller);
      rows.push({ stageId: w.open.id, sellerPersonId: seller ?? null, value });
      if (i === 2) unassignedId = lead.id;
      if (i === 1) brunoId = lead.id;
    }
    const saleId = await insertSale(w.orgId, 'PROP-LSS-1');
    okLead(
      await moveLead(
        db,
        w.orgId,
        unassignedId,
        MoveLeadSchema.parse({ stageId: w.conversion.id, position: 0, saleId }),
        ADMIN_SCOPE,
      ),
    );
    okLead(
      await moveLead(
        db,
        w.orgId,
        brunoId,
        MoveLeadSchema.parse({ stageId: w.lost.id, position: 0, reason: 'Sem orçamento' }),
        ADMIN_SCOPE,
      ),
    );
    rows.find((r) => r.value === 1002)!.stageId = w.conversion.id;
    rows.find((r) => r.value === 1001)!.stageId = w.lost.id;

    const stages = await summary(w.orgId, ADMIN_SCOPE);
    expect(byStage(stages)).toEqual(expectedTotals(rows, () => true));
    expect(Object.keys(byStage(stages))).toHaveLength(3);
    expect(byStage(stages)[w.second.id]).toBeUndefined();

    for (const stage of [w.open, w.second, w.conversion, w.lost]) {
      const listed = await listAll(w.orgId, stage.id, ADMIN_SCOPE);
      const entry = byStage(stages)[stage.id];
      if (listed.total === 0) {
        expect(entry).toBeUndefined();
      } else {
        expect(entry!.count).toBe(listed.total);
        expect(entry!.estimatedValueBrl).toBe(listed.values.reduce((a, b) => a + b, 0));
      }
    }

    const defaultPage = await listLeads(
      adminDb,
      w.orgId,
      ListLeadsQuerySchema.parse({ stageId: w.open.id }),
      ADMIN_SCOPE,
    );
    if (!defaultPage.ok) throw new Error('unexpected refusal');
    expect(defaultPage.leads).toHaveLength(50);
    expect(byStage(stages)[w.open.id]!.count).toBe(53);

    expect(byStage(await summary(w.orgId, ADMIN_SCOPE, undefined, db))).toEqual(byStage(stages));

    const ids = stages.map((s) => s.stageId);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const s of stages) {
      expect(typeof s.count).toBe('number');
      expect(Number.isInteger(s.count)).toBe(true);
      expect(typeof s.estimatedValueBrl).toBe('number');
      expect(Number.isInteger(s.estimatedValueBrl)).toBe(true);
    }
  });

  it('admin: ?sellerPersonId= narrows to that vendedor exactly as the list does', async () => {
    const w = await fullWorld('narrow');
    const rows = await mixedLeads(w);
    const stages = await summary(w.orgId, ADMIN_SCOPE, w.ana.id);
    expect(byStage(stages)).toEqual(expectedTotals(rows, (r) => r.sellerPersonId === w.ana.id));
    for (const stage of [w.open, w.second]) {
      const listed = await listAll(w.orgId, stage.id, ADMIN_SCOPE, w.ana.id);
      expect(byStage(stages)[stage.id]).toEqual({
        count: listed.total,
        estimatedValueBrl: listed.values.reduce((a, b) => a + b, 0),
      });
    }
    expect(await summary(w.orgId, ADMIN_SCOPE, randomUUID())).toEqual([]);
  });

  it('active vendedor: own plus the unassigned pool, never a colleague, and ?sellerPersonId= is ignored', async () => {
    const w = await fullWorld('vend');
    const rows = await mixedLeads(w);
    const ana = sellerScope('hub_ana');
    const stages = await summary(w.orgId, ana);
    expect(byStage(stages)).toEqual(
      expectedTotals(rows, (r) => r.sellerPersonId === w.ana.id || r.sellerPersonId === null),
    );
    for (const stage of [w.open, w.second]) {
      const listed = await listAll(w.orgId, stage.id, ana);
      expect(byStage(stages)[stage.id]).toEqual({
        count: listed.total,
        estimatedValueBrl: listed.values.reduce((a, b) => a + b, 0),
      });
    }
    // 4000 and 8000 are Bruno's alone; no total of the visible set can include them.
    expect(byStage(stages)[w.open.id]!.estimatedValueBrl).toBe(1000 + 16000);
    expect(byStage(stages)[w.second.id]!.estimatedValueBrl).toBe(2000 + 32000);
    expect(await summary(w.orgId, ana, w.bruno.id)).toEqual(stages);
  });

  it('a non-admin who is not an active vendedor gets his own leads only, never the pool', async () => {
    const w = await fullWorld('inactive');
    const rows = await mixedLeads(w);
    // Raw SQL: updatePerson with a status change writes ledger rows.
    await adminClient`
      UPDATE sales_ops_people SET status = 'inactive'
      WHERE org_id = ${w.orgId} AND id = ${w.ana.id}`;
    expect(byStage(await summary(w.orgId, sellerScope('hub_ana')))).toEqual(
      expectedTotals(rows, (r) => r.sellerPersonId === w.ana.id),
    );

    const finder = await createPerson(
      db,
      w.orgId,
      PersonSchema.parse({ displayName: 'Fabio Finder', isFinder: true }),
    );
    if (typeof finder === 'string') throw new Error(`unexpected person outcome: ${finder}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = 'hub_fabio'
      WHERE org_id = ${w.orgId} AND id = ${finder.id}`;
    expect(await summary(w.orgId, sellerScope('hub_fabio'))).toEqual([]);
    expect(await summary(w.orgId, sellerScope('hub_fabio'), w.bruno.id)).toEqual([]);
  });

  it('soft-deleted leads leave the count and the value, and an emptied stage leaves the summary', async () => {
    const w = await fullWorld('trash');
    await fullLead(w.orgId, 'Ana own', 1000, w.ana.id);
    const pool = await fullLead(w.orgId, 'Pool', 2000);
    await fullLead(w.orgId, 'Bruno own', 4000, w.bruno.id);
    const moved = await fullLead(w.orgId, 'Ana second', 8000, w.ana.id);
    okLead(
      await moveLead(
        db,
        w.orgId,
        moved.id,
        MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    const actor = { userId: 'hub_admin', name: 'Admin' };
    await deleteLead(db, w.orgId, pool.id, ADMIN_SCOPE, actor);
    await deleteLead(db, w.orgId, moved.id, ADMIN_SCOPE, actor);
    for (const id of [pool.id, moved.id]) {
      const [row] = await adminClient<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM sales_ops_leads WHERE id = ${id}`;
      expect(row!.deleted_at).not.toBeNull();
    }

    const admin = byStage(await summary(w.orgId, ADMIN_SCOPE));
    expect(admin[w.open.id]).toEqual({ count: 2, estimatedValueBrl: 5000 });
    expect(admin[w.second.id]).toBeUndefined();
    const ana = byStage(await summary(w.orgId, sellerScope('hub_ana')));
    expect(ana[w.open.id]).toEqual({ count: 1, estimatedValueBrl: 1000 });
    expect(ana[w.second.id]).toBeUndefined();
    expect((await listAll(w.orgId, w.open.id, ADMIN_SCOPE)).total).toBe(2);
  });

  it('the org predicate scopes the summary over the admin connection where RLS hides nothing', async () => {
    const a = await fullWorld('orga');
    const b = await fullWorld('orgb');
    await fullLead(a.orgId, 'A1', 1111, a.ana.id);
    await fullLead(a.orgId, 'A2', 2222);
    await fullLead(b.orgId, 'B1', 333, b.bruno.id);
    const sa = byStage(await summary(a.orgId, ADMIN_SCOPE));
    const sb = byStage(await summary(b.orgId, ADMIN_SCOPE));
    expect(sa).toEqual({ [a.open.id]: { count: 2, estimatedValueBrl: 3333 } });
    expect(sb).toEqual({ [b.open.id]: { count: 1, estimatedValueBrl: 333 } });
    const aStages = [a.open.id, a.second.id, a.conversion.id, a.lost.id];
    expect(Object.keys(sa).every((k) => aStages.includes(k))).toBe(true);
    expect(Object.keys(sa).some((k) => k in sb)).toBe(false);
  });

  it('an org with no leads, and an org with no etapas, answer []', async () => {
    const w = await fullWorld('empty');
    expect(await summary(w.orgId, ADMIN_SCOPE)).toEqual([]);
    expect(await summary(w.orgId, sellerScope('hub_ana'))).toEqual([]);
    expect(await summary(newOrg('bare'), ADMIN_SCOPE)).toEqual([]);
  });

  it('a caller with no mapped pessoa is refused exactly like the list', async () => {
    const w = await fullWorld('unmapped');
    const refused = { ok: false, reason: 'seller_person_unmapped' };
    expect(await summarizeLeadStages(db, w.orgId, {}, sellerScope('hub_nobody'))).toEqual(refused);
    expect(
      await listLeads(
        db,
        w.orgId,
        ListLeadsQuerySchema.parse({ stageId: randomUUID() }),
        sellerScope('hub_nobody'),
      ),
    ).toEqual(refused);
  });

  it('a stage total above the int4 range is an exact JS number', async () => {
    const w = await fullWorld('big');
    for (let i = 0; i < 3; i++) await fullLead(w.orgId, `Big ${i}`, 2_000_000_000);
    const entry = byStage(await summary(w.orgId, ADMIN_SCOPE, undefined, db))[w.open.id]!;
    expect(entry).toEqual({ count: 3, estimatedValueBrl: 6_000_000_000 });
    expect(typeof entry.estimatedValueBrl).toBe('number');
    expect(Number.isSafeInteger(entry.estimatedValueBrl)).toBe(true);
  });
});
