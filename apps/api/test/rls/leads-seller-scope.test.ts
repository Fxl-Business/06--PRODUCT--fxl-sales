/**
 * The lead entity's service layer, against the real database.
 *
 * Written in the style of `sale-professional-funcoes.test.ts`, and its lesson is
 * applied HONESTLY rather than copied. That file's warning is that a
 * cross-tenant assertion made only over the ordinary app connection passes even
 * with `eq(table.orgId, orgId)` deleted, because RLS satisfies it. That applies
 * to the ORG predicate, so every org assertion here is made over `adminDb`,
 * where the `*_admin_context` policy exposes every org and RLS can hide nothing.
 *
 * The SELLER predicate is a different animal: no RLS policy has ever filtered by
 * `seller_person_id`, so a seller assertion is already load-bearing over the
 * ordinary connection. Both are asserted, each over the connection that can
 * actually falsify it.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import {
  AreaSchema,
  ClientSchema,
  PersonSchema,
  ProductSchema,
  createArea,
  createClient,
  createPerson,
  createProduct,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };

function sellerScope(userId: string, email: string | null = null): LeadScope {
  return { userId, email, isAdmin: false };
}

describe('sales operations leads: seller scope, movement and isolation', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /** The same service functions over a connection where RLS hides nothing. */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lsc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
      // FK order: lead products, then leads (which reference stages, clientes,
      // pessoas and vendas), then everything they pointed at.
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

  /**
   * A pessoa carrying the `vendedor` SYSTEM função. `isSeller: true` is the
   * compat path that SEEDS that função for an org that does not have it yet; the
   * lead service still resolves the vendedor through `sales_ops_person_funcoes`
   * and never reads the mirror column the flag also happens to set.
   */
  async function seedSeller(orgId: string, displayName: string, contactEmail?: string) {
    const person = await createPerson(
      db,
      orgId,
      PersonSchema.parse({
        displayName,
        isSeller: true,
        ...(contactEmail ? { contactEmail } : {}),
      }),
    );
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    return person;
  }

  async function bindHubAccount(orgId: string, personId: string, hubAccountId: string) {
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${hubAccountId}
      WHERE org_id = ${orgId} AND id = ${personId}`;
  }

  async function stagesFor(orgId: string) {
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const open = stages.find((stage) => stage.kind === 'normal' && stage.position === 1)!;
    const second = stages.find((stage) => stage.kind === 'normal' && stage.position === 2)!;
    const conversion = stages.find((stage) => stage.kind === 'conversion')!;
    const lost = stages.find((stage) => stage.kind === 'lost')!;
    return { stages, open, second, conversion, lost };
  }

  function leadPayload(overrides: Record<string, unknown> = {}) {
    return CreateLeadSchema.parse({
      contactName: 'Contato Um',
      clientName: 'Empresa Um',
      estimatedValueBrl: 250000,
      ...overrides,
    });
  }

  async function expectOk(promise: Promise<{ ok: boolean }>) {
    const result = (await promise) as { ok: boolean; reason?: string };
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
    return result as never;
  }

  it('serves a seller only their own leads, over the admin connection where RLS hides nothing', async () => {
    const orgId = newOrg('scope');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    const bruno = await seedSeller(orgId, 'Bruno Lima');
    await bindHubAccount(orgId, ana.id, 'hub_ana');
    await bindHubAccount(orgId, bruno.id, 'hub_bruno');

    await createLead(adminDb, orgId, leadPayload({ sellerPersonId: ana.id }), ADMIN_SCOPE);
    await createLead(adminDb, orgId, leadPayload({ sellerPersonId: bruno.id }), ADMIN_SCOPE);

    // Over adminDb the admin policy exposes EVERY org's rows, so the only things
    // scoping this read are the service's own org predicate and seller predicate.
    const anaBoard = await listLeads(
      adminDb,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      sellerScope('hub_ana'),
    );
    if (!anaBoard.ok) throw new Error(`unexpected refusal: ${anaBoard.reason}`);
    expect(anaBoard.leads).toHaveLength(1);
    expect(anaBoard.leads[0]!.sellerPersonId).toBe(ana.id);
    expect(anaBoard.total).toBe(1);
  });

  // The decisive one. An implementation that merely VALIDATES ?sellerPersonId=
  // passes a "403 on mismatch" test and fails this: for a non-admin the query
  // parameter is never read at all.
  it('ignores a sellerPersonId query parameter for a non-admin caller', async () => {
    const orgId = newOrg('queryparam');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    const bruno = await seedSeller(orgId, 'Bruno Lima');
    await bindHubAccount(orgId, ana.id, 'hub_ana');

    await createLead(db, orgId, leadPayload({ sellerPersonId: ana.id }), ADMIN_SCOPE);
    await createLead(db, orgId, leadPayload({ sellerPersonId: bruno.id }), ADMIN_SCOPE);

    const result = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id, sellerPersonId: bruno.id }),
      sellerScope('hub_ana'),
    );
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
    expect(result.leads.map((lead) => lead.sellerPersonId)).toEqual([ana.id]);
  });

  it('serves an admin every lead in the org and honours the optional seller filter', async () => {
    const orgId = newOrg('adminboard');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    const bruno = await seedSeller(orgId, 'Bruno Lima');
    await createLead(db, orgId, leadPayload({ sellerPersonId: ana.id }), ADMIN_SCOPE);
    await createLead(db, orgId, leadPayload({ sellerPersonId: bruno.id }), ADMIN_SCOPE);

    const all = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      ADMIN_SCOPE,
    );
    if (!all.ok) throw new Error(`unexpected refusal: ${all.reason}`);
    expect(all.leads).toHaveLength(2);
    expect(all.total).toBe(2);

    const filtered = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id, sellerPersonId: bruno.id }),
      ADMIN_SCOPE,
    );
    if (!filtered.ok) throw new Error(`unexpected refusal: ${filtered.reason}`);
    expect(filtered.leads.map((lead) => lead.sellerPersonId)).toEqual([bruno.id]);
  });

  // The fail-OPEN mutation: resolveLeadScopePredicate degrading into "no
  // predicate" for a caller it cannot resolve. That single change turns this
  // whole slice into a cross-seller data leak.
  it('refuses a caller with no mapped pessoa with seller_person_unmapped and returns no rows', async () => {
    const orgId = newOrg('unmapped');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    await createLead(db, orgId, leadPayload({ sellerPersonId: ana.id }), ADMIN_SCOPE);

    const stranger = sellerScope('hub_stranger', 'ninguem@example.test');
    const listed = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      stranger,
    );
    expect(listed).toEqual({ ok: false, reason: 'seller_person_unmapped' });
    expect('leads' in listed).toBe(false);

    const created = await createLead(db, orgId, leadPayload(), stranger);
    expect(created).toEqual({ ok: false, reason: 'seller_person_unmapped' });
  });

  it('binds hub_account_id once from the verified token e-mail and never to a second pessoa', async () => {
    const orgId = newOrg('selfclaim');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins', 'Ana@Example.Test');
    // The stored address is padded here, past the zod e-mail rule, precisely so
    // the `lower(btrim(...))` in the claim is load-bearing rather than incidental.
    await adminClient`
      UPDATE sales_ops_people SET contact_email = ' Ana@Example.Test '
      WHERE id = ${ana.id}`;
    await createLead(db, orgId, leadPayload({ sellerPersonId: ana.id }), ADMIN_SCOPE);

    // Case and surrounding whitespace do not matter: both sides are lowered and
    // trimmed. One claim, of the caller's OWN row.
    const claimed = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      sellerScope('hub_ana', 'ana@example.test'),
    );
    if (!claimed.ok) throw new Error(`unexpected refusal: ${claimed.reason}`);
    expect(claimed.leads.map((lead) => lead.sellerPersonId)).toEqual([ana.id]);

    const [bound] = await adminClient<{ hub_account_id: string | null }[]>`
      SELECT hub_account_id FROM sales_ops_people WHERE id = ${ana.id}`;
    expect(bound!.hub_account_id).toBe('hub_ana');

    // A SECOND account presenting the same e-mail cannot re-bind the row, because
    // the claim requires hub_account_id IS NULL. It is refused, not re-pointed.
    const second = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      sellerScope('hub_impostor', 'ana@example.test'),
    );
    expect(second).toEqual({ ok: false, reason: 'seller_person_unmapped' });
    const [still] = await adminClient<{ hub_account_id: string | null }[]>`
      SELECT hub_account_id FROM sales_ops_people WHERE id = ${ana.id}`;
    expect(still!.hub_account_id).toBe('hub_ana');

    // TWO candidates sharing one e-mail is a refusal and never a pick.
    const orgTwo = newOrg('selfclaimdup');
    await stagesFor(orgTwo);
    await seedSeller(orgTwo, 'Carla Um', 'carla@example.test');
    await seedSeller(orgTwo, 'Carla Dois', 'carla@example.test');
    const ambiguous = await createLead(db, orgTwo, leadPayload(), sellerScope('hub_carla', 'carla@example.test'));
    expect(ambiguous).toEqual({ ok: false, reason: 'seller_person_unmapped' });
    const claimedRows = await adminClient<{ id: string }[]>`
      SELECT id FROM sales_ops_people WHERE org_id = ${orgTwo} AND hub_account_id IS NOT NULL`;
    expect(claimedRows).toHaveLength(0);
  });

  it("never returns another org's lead, over the admin connection", async () => {
    const orgA = newOrg('crossa');
    const orgB = newOrg('crossb');
    const stagesA = await stagesFor(orgA);
    const stagesB = await stagesFor(orgB);

    const leadB = await expectOk(
      createLead(adminDb, orgB, leadPayload({ contactName: 'Somente B' }), ADMIN_SCOPE),
    );
    const idB = (leadB as unknown as { lead: { id: string } }).lead.id;

    // adminDb sees every org at the database level, so a deleted org predicate
    // would leak here and RLS could not cover for it.
    expect(await getLead(adminDb, orgA, idB, ADMIN_SCOPE)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await moveLead(
        adminDb,
        orgA,
        idB,
        MoveLeadSchema.parse({ stageId: stagesA.second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await updateLead(
        adminDb,
        orgA,
        idB,
        UpdateLeadSchema.parse({ contactName: 'hijack' }),
        ADMIN_SCOPE,
      ),
    ).toEqual({ ok: false, reason: 'not_found' });

    const listedA = await listLeads(
      adminDb,
      orgA,
      ListLeadsQuerySchema.parse({ stageId: stagesB.open.id }),
      ADMIN_SCOPE,
    );
    if (!listedA.ok) throw new Error(`unexpected refusal: ${listedA.reason}`);
    expect(listedA.leads).toEqual([]);
  });

  // THE headline mutation: `stageChangedAt: new Date()` written unconditionally,
  // or `stageChanged ? now : current.stageChangedAt`, which round-trips through
  // the app and loses microseconds. Asserted on the raw database value.
  it('stage_changed_at is byte-identical after a reorder inside the same stage', async () => {
    const orgId = newOrg('reorder');
    const { open } = await stagesFor(orgId);
    const first = await expectOk(
      createLead(db, orgId, leadPayload({ contactName: 'Primeiro' }), ADMIN_SCOPE),
    );
    const second = await expectOk(
      createLead(db, orgId, leadPayload({ contactName: 'Segundo' }), ADMIN_SCOPE),
    );
    const firstId = (first as unknown as { lead: { id: string } }).lead.id;
    const secondId = (second as unknown as { lead: { id: string } }).lead.id;

    const readStamp = async (id: string) => {
      const [row] = await adminClient<{ stage_changed_at: Date }[]>`
        SELECT stage_changed_at FROM sales_ops_leads WHERE id = ${id}`;
      return row!.stage_changed_at;
    };
    const before = await readStamp(secondId);

    await expectOk(
      moveLead(
        db,
        orgId,
        secondId,
        MoveLeadSchema.parse({ stageId: open.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );

    expect(await readStamp(secondId)).toEqual(before);
    const [reordered] = await adminClient<{ id: string; position: number }[]>`
      SELECT id, "position" FROM sales_ops_leads
      WHERE org_id = ${orgId} ORDER BY "position" ASC`;
    expect(reordered!.id).toBe(secondId);
    // And the card that was pushed down really moved, so the reorder happened.
    const [, pushed] = await adminClient<{ id: string; position: number }[]>`
      SELECT id, "position" FROM sales_ops_leads
      WHERE org_id = ${orgId} ORDER BY "position" ASC`;
    expect(pushed!.id).toBe(firstId);
  });

  it('stage_changed_at advances when and only when stage_id actually changes', async () => {
    const orgId = newOrg('stagechange');
    const { open, second } = await stagesFor(orgId);
    const created = await expectOk(createLead(db, orgId, leadPayload(), ADMIN_SCOPE));
    const id = (created as unknown as { lead: { id: string } }).lead.id;

    const readStamp = async () => {
      const [row] = await adminClient<{ stage_changed_at: Date }[]>`
        SELECT stage_changed_at FROM sales_ops_leads WHERE id = ${id}`;
      return row!.stage_changed_at;
    };
    const atCreate = await readStamp();

    await expectOk(
      moveLead(
        db,
        orgId,
        id,
        MoveLeadSchema.parse({ stageId: second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    const afterMove = await readStamp();
    expect(afterMove.getTime()).toBeGreaterThan(atCreate.getTime());

    // An ordinary edit never touches it either.
    await expectOk(
      updateLead(
        db,
        orgId,
        id,
        UpdateLeadSchema.parse({ contactName: 'Outro Contato', estimatedValueBrl: 999 }),
        ADMIN_SCOPE,
      ),
    );
    expect(await readStamp()).toEqual(afterMove);

    // Back to the first column: it advances again.
    await expectOk(
      moveLead(db, orgId, id, MoveLeadSchema.parse({ stageId: open.id, position: 0 }), ADMIN_SCOPE),
    );
    expect((await readStamp()).getTime()).toBeGreaterThan(afterMove.getTime());
  });

  it('a move into the lost stage without a reason throws lost_reason_required and writes nothing', async () => {
    const orgId = newOrg('lost');
    const { open, lost } = await stagesFor(orgId);
    const created = await expectOk(createLead(db, orgId, leadPayload(), ADMIN_SCOPE));
    const id = (created as unknown as { lead: { id: string } }).lead.id;

    await expect(
      moveLead(db, orgId, id, MoveLeadSchema.parse({ stageId: lost.id, position: 0 }), ADMIN_SCOPE),
    ).rejects.toThrow(LeadInputError);

    const [row] = await adminClient<
      { stage_id: string; position: number; lost_reason: string | null }[]
    >`SELECT stage_id, "position", lost_reason FROM sales_ops_leads WHERE id = ${id}`;
    expect(row!.stage_id).toBe(open.id);
    expect(row!.position).toBe(1);
    expect(row!.lost_reason).toBeNull();

    // With a reason it goes through, and the reason is persisted.
    await expectOk(
      moveLead(
        db,
        orgId,
        id,
        MoveLeadSchema.parse({ stageId: lost.id, position: 0, reason: 'preço fora do orçamento' }),
        ADMIN_SCOPE,
      ),
    );
    const [moved] = await adminClient<{ stage_id: string; lost_reason: string | null }[]>`
      SELECT stage_id, lost_reason FROM sales_ops_leads WHERE id = ${id}`;
    expect(moved!.stage_id).toBe(lost.id);
    expect(moved!.lost_reason).toBe('preço fora do orçamento');
  });

  it('a move into the conversion stage requires a saleId that resolves in-org', async () => {
    const orgA = newOrg('conva');
    const orgB = newOrg('convb');
    const stagesA = await stagesFor(orgA);
    await stagesFor(orgB);

    const created = await expectOk(createLead(adminDb, orgA, leadPayload(), ADMIN_SCOPE));
    const id = (created as unknown as { lead: { id: string } }).lead.id;

    await expect(
      moveLead(
        adminDb,
        orgA,
        id,
        MoveLeadSchema.parse({ stageId: stagesA.conversion.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'sale_required_for_conversion' });

    // A venda seeded in org B, aimed at a lead in org A. Over adminDb the admin
    // policy exposes org B's row, so the ONLY thing refusing it is the service's
    // own org predicate on the sale lookup.
    const [saleB] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${orgB}, 1, 'PROP-B-1', 'Empresa B', 'Vendedor B', 'pix', 'cash', now(),
              100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;

    await expect(
      moveLead(
        adminDb,
        orgA,
        id,
        MoveLeadSchema.parse({
          stageId: stagesA.conversion.id,
          position: 0,
          saleId: saleB!.id,
        }),
        ADMIN_SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'sale_not_found' });

    // A saleId aimed at any OTHER stage is refused too, so sale_id and "is in the
    // conversion column" can never diverge.
    await expect(
      moveLead(
        adminDb,
        orgA,
        id,
        MoveLeadSchema.parse({ stageId: stagesA.second.id, position: 0, saleId: saleB!.id }),
        ADMIN_SCOPE,
      ),
    ).rejects.toMatchObject({ code: 'sale_not_allowed' });

    const [saleA] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${orgA}, 1, 'PROP-A-1', 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
              100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    const converted = await expectOk(
      moveLead(
        adminDb,
        orgA,
        id,
        MoveLeadSchema.parse({
          stageId: stagesA.conversion.id,
          position: 0,
          saleId: saleA!.id,
        }),
        ADMIN_SCOPE,
      ),
    );
    expect((converted as unknown as { lead: { saleId: string } }).lead.saleId).toBe(saleA!.id);

    // The read-only final column, on the SERVER: a converted card can never be
    // dragged anywhere, in or out, and can never be edited.
    expect(
      await moveLead(
        adminDb,
        orgA,
        id,
        MoveLeadSchema.parse({ stageId: stagesA.open.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    ).toEqual({ ok: false, reason: 'already_converted' });
    expect(
      await updateLead(
        adminDb,
        orgA,
        id,
        UpdateLeadSchema.parse({ contactName: 'Depois' }),
        ADMIN_SCOPE,
      ),
    ).toEqual({ ok: false, reason: 'already_converted' });
  });

  // Acceptance 1. Creating a lead is not a commercial event.
  it('creating a lead writes no sales_ops_sales row and consumes no sequence', async () => {
    const orgId = newOrg('nosale');
    await stagesFor(orgId);
    const countSales = async () => {
      const [row] = await adminClient<{ count: string; max: number | null }[]>`
        SELECT count(*)::text AS count, max(sequence) AS max FROM sales_ops_sales`;
      return row!;
    };
    const before = await countSales();
    await expectOk(createLead(db, orgId, leadPayload(), ADMIN_SCOPE));
    await expectOk(createLead(db, orgId, leadPayload({ contactName: 'Dois' }), ADMIN_SCOPE));
    expect(await countSales()).toEqual(before);
  });

  // Acceptance 12. The cliente is resolved or created at CONVERSION time.
  it('creating a lead writes no sales_ops_clients row', async () => {
    const orgId = newOrg('noclient');
    await stagesFor(orgId);
    const countClients = async () => {
      const [row] = await adminClient<{ count: string }[]>`
        SELECT count(*)::text AS count FROM sales_ops_clients`;
      return row!.count;
    };
    const before = await countClients();
    const created = await expectOk(
      createLead(db, orgId, leadPayload({ clientName: 'Empresa Sem Cadastro' }), ADMIN_SCOPE),
    );
    expect(await countClients()).toBe(before);
    expect(
      (created as unknown as { lead: { clientId: string | null; clientNameSnapshot: string } }).lead,
    ).toMatchObject({ clientId: null, clientNameSnapshot: 'Empresa Sem Cadastro' });
  });

  // Acceptance 19. The ledger is hash-chained, queues behind a global tail lock
  // and is never purged; a card move is high-frequency noise.
  it('moving a lead writes no audit_log row', async () => {
    const orgId = newOrg('noledger');
    const { second, lost } = await stagesFor(orgId);
    const created = await expectOk(createLead(db, orgId, leadPayload(), ADMIN_SCOPE));
    const id = (created as unknown as { lead: { id: string } }).lead.id;

    const countEntries = async () => {
      const [row] = await adminClient<{ count: string }[]>`
        SELECT count(*)::text AS count FROM audit_log`;
      return row!.count;
    };
    const before = await countEntries();
    await expectOk(
      moveLead(
        db,
        orgId,
        id,
        MoveLeadSchema.parse({ stageId: second.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    await expectOk(
      updateLead(db, orgId, id, UpdateLeadSchema.parse({ contactName: 'Editado' }), ADMIN_SCOPE),
    );
    await expectOk(
      moveLead(
        db,
        orgId,
        id,
        MoveLeadSchema.parse({ stageId: lost.id, position: 0, reason: 'sem fit' }),
        ADMIN_SCOPE,
      ),
    );
    expect(await countEntries()).toBe(before);
  });

  it('replaces the lead product set wholesale and keeps the snapshot server-authoritative', async () => {
    const orgId = newOrg('products');
    await stagesFor(orgId);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'FXL Custom', areaId: area.id }),
    );

    const created = await expectOk(
      createLead(
        db,
        orgId,
        leadPayload({
          products: [
            { productId: product.id, productName: 'NAO USAR' },
            { productName: 'Algo avulso' },
          ],
        }),
        ADMIN_SCOPE,
      ),
    );
    const lead = (created as unknown as { lead: { id: string; products: unknown[] } }).lead;
    // A body-supplied productName on a row that RESOLVES is discarded. The read
    // order is the SNAPSHOT: one replacement writes every row in a single INSERT
    // under one `now()`, so ordering by created_at would leave a random uuid as
    // the tiebreaker and the same unchanged lead could read back in two orders.
    expect(lead.products).toEqual([
      { productId: null, productNameSnapshot: 'Algo avulso' },
      { productId: product.id, productNameSnapshot: 'FXL Custom' },
    ]);

    // A full-set REPLACEMENT, never a merge.
    const replaced = await expectOk(
      updateLead(
        db,
        orgId,
        lead.id,
        UpdateLeadSchema.parse({ products: [{ productName: 'Somente este' }] }),
        ADMIN_SCOPE,
      ),
    );
    expect((replaced as unknown as { lead: { products: unknown[] } }).lead.products).toEqual([
      { productId: null, productNameSnapshot: 'Somente este' },
    ]);

    // An absent key leaves the child rows alone; [] clears them.
    const untouched = await expectOk(
      updateLead(db, orgId, lead.id, UpdateLeadSchema.parse({ contactName: 'X' }), ADMIN_SCOPE),
    );
    expect((untouched as unknown as { lead: { products: unknown[] } }).lead.products).toHaveLength(
      1,
    );
    const cleared = await expectOk(
      updateLead(db, orgId, lead.id, UpdateLeadSchema.parse({ products: [] }), ADMIN_SCOPE),
    );
    expect((cleared as unknown as { lead: { products: unknown[] } }).lead.products).toEqual([]);
  });

  it('writes client_name_snapshot and seller_name_snapshot from the cadastro rows, never from the body', async () => {
    const orgId = newOrg('snapshots');
    await stagesFor(orgId);
    const client = await createClient(db, orgId, ClientSchema.parse({ name: 'Empresa Cadastrada' }));
    const ana = await seedSeller(orgId, 'Ana Martins');

    const created = await expectOk(
      createLead(
        db,
        orgId,
        leadPayload({
          clientId: client.id,
          clientName: 'NAO USAR',
          sellerPersonId: ana.id,
        }),
        ADMIN_SCOPE,
      ),
    );
    const [row] = await adminClient<
      { client_name_snapshot: string; seller_name_snapshot: string }[]
    >`SELECT client_name_snapshot, seller_name_snapshot FROM sales_ops_leads
      WHERE id = ${(created as unknown as { lead: { id: string } }).lead.id}`;
    expect(row!.client_name_snapshot).toBe('Empresa Cadastrada');
    expect(row!.seller_name_snapshot).toBe('Ana Martins');

    // A pessoa who is not a vendedor is refused, and through person_funcoes -
    // never through the deprecated mirror column.
    const designer = await createPerson(
      db,
      orgId,
      PersonSchema.parse({ displayName: 'Dora Designer', isCollaborator: true }),
    );
    if (typeof designer === 'string') throw new Error(`unexpected person outcome: ${designer}`);
    await expect(
      createLead(db, orgId, leadPayload({ sellerPersonId: designer.id }), ADMIN_SCOPE),
    ).rejects.toMatchObject({ code: 'seller_not_a_vendedor' });
    await expect(
      createLead(db, orgId, leadPayload({ sellerPersonId: randomUUID() }), ADMIN_SCOPE),
    ).rejects.toMatchObject({ code: 'seller_not_found' });
  });

  // A seller predicate written as IS NOT DISTINCT FROM would show every seller
  // every unassigned lead.
  it("keeps an unassigned lead out of every seller's board and on the admin's", async () => {
    const orgId = newOrg('unassigned');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    await bindHubAccount(orgId, ana.id, 'hub_ana');
    await expectOk(createLead(db, orgId, leadPayload({ contactName: 'Sem dono' }), ADMIN_SCOPE));

    const anaBoard = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      sellerScope('hub_ana'),
    );
    if (!anaBoard.ok) throw new Error(`unexpected refusal: ${anaBoard.reason}`);
    expect(anaBoard.leads).toEqual([]);
    expect(anaBoard.total).toBe(0);

    const adminBoard = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      ADMIN_SCOPE,
    );
    if (!adminBoard.ok) throw new Error(`unexpected refusal: ${adminBoard.reason}`);
    expect(adminBoard.leads).toHaveLength(1);

    // And a seller may not file an UNASSIGNED lead either.
    expect(await createLead(db, orgId, leadPayload(), sellerScope('hub_ana'))).toEqual({
      ok: false,
      reason: 'seller_scope',
    });
  });

  it('paginates one column by the (position, id) keyset', async () => {
    const orgId = newOrg('cursor');
    const { open } = await stagesFor(orgId);
    for (const name of ['Um', 'Dois', 'Tres']) {
      await expectOk(createLead(db, orgId, leadPayload({ contactName: name }), ADMIN_SCOPE));
    }

    const first = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id, limit: '2' }),
      ADMIN_SCOPE,
    );
    if (!first.ok) throw new Error(`unexpected refusal: ${first.reason}`);
    expect(first.leads.map((lead) => lead.contactName)).toEqual(['Um', 'Dois']);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBe(`${first.leads[1]!.position}:${first.leads[1]!.id}`);

    const second = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id, limit: '2', cursor: first.nextCursor! }),
      ADMIN_SCOPE,
    );
    if (!second.ok) throw new Error(`unexpected refusal: ${second.reason}`);
    expect(second.leads.map((lead) => lead.contactName)).toEqual(['Tres']);
    expect(second.nextCursor).toBeNull();
    // `total` is the column's size and is deliberately independent of the cursor.
    expect(second.total).toBe(3);
  });
});
