/**
 * Acceptance 17, in a file of its own because it is its own claim: no lead value
 * enters `getSalesOpsSummary`, the dashboard or any persisted sale number, and
 * leads never travel on `/bootstrap`.
 *
 * The assertions are `toEqual` over the WHOLE object and never a hand-picked
 * field list. A field list is exactly what a future `leads:` key on the snapshot
 * would slip past, and the snapshot IS the `/bootstrap` payload.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { CreateLeadSchema, MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  createLead,
  moveLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import {
  AreaSchema,
  CreateSaleSchema,
  PersonSchema,
  ProductSchema,
  createArea,
  createPerson,
  createProduct,
  createSale,
  getSalesOpsSnapshot,
  getSalesOpsSummary,
  transitionSale,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };

describe('leads move no existing financial number', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('creating leads moves no number in getSalesOpsSummary, leaves the snapshot deep-equal and changes no persisted sale column', async () => {
    const orgId = `org_lnfi_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);

    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'FXL Custom', areaId: area.id }),
    );
    const seller = await createPerson(
      db,
      orgId,
      PersonSchema.parse({ displayName: 'Ana Martins', isSeller: true }),
    );
    if (typeof seller === 'string') throw new Error(`unexpected person outcome: ${seller}`);

    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente Proposta',
        sellerPersonId: seller.id,
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-07-29',
        sellerCommissionPct: 15,
        finderCommissionPct: 3,
        taxPct: 6,
        items: [
          { productId: product.id, productName: 'FXL Custom', quantity: 1, unitBrl: 400000 },
        ],
        professionals: [],
        installments: [{ dueDate: '2026-08-01', amountBrl: 400000, method: 'pix' }],
      }),
    );
    const won = await transitionSale(db, orgId, created.sale.id, 'won');
    if (!won.ok) throw new Error('expected the sale to reach won');

    const stages = await ensureLeadStagesForOrg(db, orgId);
    const lost = stages.find((stage) => stage.kind === 'lost')!;

    const saleColumns = async () => {
      const [row] = await adminClient`
        SELECT total_brl, recurring_brl, net_margin_brl, net_margin_pct, seller_commission_pct,
               finder_commission_pct, tax_pct, other_costs_brl, status, sequence, code
        FROM sales_ops_sales WHERE id = ${created.sale.id}`;
      return row;
    };

    const before = {
      summary: await getSalesOpsSummary(db, orgId),
      snapshot: await getSalesOpsSnapshot(db, orgId),
      sale: await saleColumns(),
    };

    for (const contactName of ['Lead Um', 'Lead Dois', 'Lead Tres']) {
      const lead = await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa em negociação',
          estimatedValueBrl: 9_900_000,
          description: 'Um valor grande de propósito: se ele entrasse em algum número, apareceria.',
          sellerPersonId: seller.id,
          products: [{ productId: product.id }, { productName: 'Algo avulso' }],
        }),
        ADMIN_SCOPE,
      );
      if (!lead.ok) throw new Error(`unexpected refusal: ${lead.reason}`);
      if (contactName === 'Lead Tres') {
        const moved = await moveLead(
          db,
          orgId,
          lead.lead.id,
          MoveLeadSchema.parse({ stageId: lost.id, position: 0, reason: 'sem orçamento' }),
          ADMIN_SCOPE,
        );
        if (!moved.ok) throw new Error(`unexpected refusal: ${moved.reason}`);
      }
    }

    // The leads really exist, so the three assertions below are not vacuous.
    const [{ count }] = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_leads WHERE org_id = ${orgId}`;
    expect(count).toBe('3');

    expect(await getSalesOpsSummary(db, orgId)).toEqual(before.summary);
    // Deep-equal over the WHOLE snapshot: this is the /bootstrap payload, and a
    // `leads:` key appearing on it is exactly what a field list would miss.
    expect(await getSalesOpsSnapshot(db, orgId)).toEqual(before.snapshot);
    expect(await saleColumns()).toEqual(before.sale);
  });
});
