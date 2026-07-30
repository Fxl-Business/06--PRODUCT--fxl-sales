/**
 * Slice 12 (proposta-overrides) integration coverage.
 *
 * Exercises the REAL createSale / transitionSale service functions against the
 * local test DB through the non-superuser app role, so RLS is genuinely enforced,
 * plus an ADMIN-context connection used deliberately to prove each new
 * `eq(table.orgId, orgId)` filter is load-bearing: under the admin policy every
 * org is visible, so a missing filter can no longer hide behind row security. A
 * cross-tenant test driven only over the app connection would pass with the
 * filter deleted, which is worse than no test at all.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  CreateSaleSchema,
  FuncaoSchema,
  PersonSchema,
  ProductSchema,
  SaleInputError,
  createArea,
  createFuncao,
  createPerson,
  createProduct,
  createSale,
  transitionSale,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

describe('proposta profissionais: funcao binding, party tenancy and won payables', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * The same service functions over a session carrying app.fxl_admin = 'true'.
   * The admin policy exposes every org, so RLS cannot silently satisfy a tenancy
   * assertion made through this handle.
   */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDb = drizzle(adminClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Order matters: the composite `restrict` FKs from the professional rows and
      // the cost rows to sales_ops_funcoes block the teardown if funções go first.
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      // People go AFTER every table that references person_id (sales, professionals,
      // person_funcoes) and BEFORE funções, which person_funcoes holds by `restrict`.
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  function newOrg(label: string): string {
    const orgId = `org_spf_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function seedFuncao(orgId: string, name: string) {
    const funcao = await createFuncao(db, orgId, FuncaoSchema.parse({ name }));
    if (typeof funcao === 'string') throw new Error(`unexpected funcao outcome: ${funcao}`);
    return funcao;
  }

  async function seedPerson(orgId: string, displayName: string, funcaoIds: string[]) {
    const person = await createPerson(db, orgId, PersonSchema.parse({ displayName, funcaoIds }));
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    return person;
  }

  async function seedOrg(label: string) {
    const orgId = newOrg(label);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: `Produto ${label}`, areaId: area.id }),
    );
    const developer = await seedFuncao(orgId, 'Desenvolvedor');
    const seller = await seedPerson(orgId, 'Ana Martins', [developer.id]);
    return { orgId, area, product, developer, seller };
  }

  function salePayload(
    fixture: { product: { id: string }; seller: { id: string } },
    overrides: Record<string, unknown> = {},
  ) {
    return CreateSaleSchema.parse({
      clientName: 'SegPro',
      sellerPersonId: fixture.seller.id,
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-14',
      sellerCommissionPct: 15,
      finderCommissionPct: 3,
      taxPct: 6,
      otherCostsBrl: 0,
      items: [
        { productId: fixture.product.id, productName: 'FXL Custom', quantity: 1, unitBrl: 400000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-07-14', amountBrl: 400000, method: 'pix' }],
      ...overrides,
    });
  }

  async function countSales(orgId: string): Promise<number> {
    // Through the ADMIN connection: if createSale had written a row despite the
    // rejection, an app-role read filtered by RLS could still report zero.
    const rows = await adminDb
      .select()
      .from(schema.salesOpsSales)
      .where(eq(schema.salesOpsSales.orgId, orgId));
    return rows.length;
  }

  it('rejects a professional funcaoId from another org with funcao_not_found and writes nothing', async () => {
    const orgA = await seedOrg('xfuncao_a');
    const orgB = await seedOrg('xfuncao_b');

    const attempt = createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana Martins',
            funcaoId: orgB.developer.id,
            costBrl: 100000,
          },
        ],
      }),
    );

    await expect(attempt).rejects.toBeInstanceOf(SaleInputError);
    await expect(attempt).rejects.toMatchObject({ code: 'funcao_not_found', itemIndex: 0 });
    expect(await countSales(orgA.orgId)).toBe(0);

    // Positive control: the identical call with orgA's OWN função succeeds and
    // persists exactly one sale, so the rejection above is the cross-org check and
    // not a broken fixture.
    const ok = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana Martins',
            funcaoId: orgA.developer.id,
            costBrl: 100000,
          },
        ],
      }),
    );
    expect(ok.sale.id).toBeTruthy();
    expect(await countSales(orgA.orgId)).toBe(1);
  });

  /*
    THE tests that make the three above mean something.

    Driven over `adminDb`, whose session carries app.fxl_admin = 'true', so the
    admin policy exposes every org and row security can no longer stand in for the
    service's explicit `eq(table.orgId, orgId)` filters. Verified by deleting each
    filter in turn: over the APP connection all eleven tests still passed, and over
    this connection each deletion turns the matching assertion Red - `funcao_id`
    into a raw 23503 from the composite foreign key, `person_id` into an accepted
    cross-org WRITE, because sales_ops_people is referenced by a single-column FK
    that does not consult the RLS predicate at all.
  */
  it('rejects a cross-org funcaoId even when row security cannot hide the miss (admin context)', async () => {
    const orgA = await seedOrg('admin_funcao_a');
    const orgB = await seedOrg('admin_funcao_b');

    const attempt = createSale(
      adminDb,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana',
            funcaoId: orgB.developer.id,
            costBrl: 1000,
          },
        ],
      }),
    );

    await expect(attempt).rejects.toBeInstanceOf(SaleInputError);
    await expect(attempt).rejects.toMatchObject({ code: 'funcao_not_found', itemIndex: 0 });
    expect(await countSales(orgA.orgId)).toBe(0);

    // Positive control: the same admin-context call with orgA's own função writes.
    await createSale(
      adminDb,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana',
            funcaoId: orgA.developer.id,
            costBrl: 1000,
          },
        ],
      }),
    );
    expect(await countSales(orgA.orgId)).toBe(1);
  });

  it('rejects a cross-org personId even when row security cannot hide the miss (admin context)', async () => {
    const orgA = await seedOrg('admin_person_a');
    const orgB = await seedOrg('admin_person_b');

    await expect(
      createSale(
        adminDb,
        orgA.orgId,
        salePayload(orgA, {
          professionals: [
            {
              personId: orgB.seller.id,
              personName: 'Intruso',
              funcaoId: orgA.developer.id,
              costBrl: 1000,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'person_not_found', itemIndex: 0 });

    await expect(
      createSale(adminDb, orgA.orgId, salePayload({ ...orgA, seller: orgB.seller })),
    ).rejects.toMatchObject({ code: 'seller_not_found', itemIndex: -1 });

    await expect(
      createSale(
        adminDb,
        orgA.orgId,
        salePayload(orgA, { finderPersonId: orgB.seller.id, finderName: 'Intruso' }),
      ),
    ).rejects.toMatchObject({ code: 'finder_not_found', itemIndex: -1 });

    expect(await countSales(orgA.orgId)).toBe(0);

    // Positive control: orgA's own pessoa in all three slots writes exactly one sale.
    await createSale(
      adminDb,
      orgA.orgId,
      salePayload(orgA, {
        finderPersonId: orgA.seller.id,
        finderName: 'Ana Martins',
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana',
            funcaoId: orgA.developer.id,
            costBrl: 1000,
          },
        ],
      }),
    );
    expect(await countSales(orgA.orgId)).toBe(1);
  });

  it('rejects a professional personId from another org with person_not_found', async () => {
    const orgA = await seedOrg('xperson_a');
    const orgB = await seedOrg('xperson_b');

    const attempt = createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana',
            funcaoId: orgA.developer.id,
            costBrl: 1000,
          },
          {
            personId: orgB.seller.id,
            personName: 'Intruso',
            funcaoId: orgA.developer.id,
            costBrl: 1000,
          },
        ],
      }),
    );

    await expect(attempt).rejects.toMatchObject({ code: 'person_not_found', itemIndex: 1 });
    expect(await countSales(orgA.orgId)).toBe(0);
  });

  it('rejects a sellerPersonId and a finderPersonId from another org at index -1', async () => {
    const orgA = await seedOrg('xparty_a');
    const orgB = await seedOrg('xparty_b');

    await expect(
      createSale(db, orgA.orgId, salePayload({ ...orgA, seller: orgB.seller })),
    ).rejects.toMatchObject({ code: 'seller_not_found', itemIndex: -1 });

    await expect(
      createSale(
        db,
        orgA.orgId,
        salePayload(orgA, { finderPersonId: orgB.seller.id, finderName: 'Intruso' }),
      ),
    ).rejects.toMatchObject({ code: 'finder_not_found', itemIndex: -1 });

    expect(await countSales(orgA.orgId)).toBe(0);

    // Positive control: orgA's own pessoa in both slots writes a sale.
    await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, { finderPersonId: orgA.seller.id, finderName: 'Ana Martins' }),
    );
    expect(await countSales(orgA.orgId)).toBe(1);
  });

  it('persists funcao_id with a server-derived funcao_name_snapshot mirrored into role', async () => {
    const orgA = await seedOrg('snapshot');

    const created = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            // Both labels disagree with the cadastro on purpose.
            personName: 'Nome forjado',
            funcaoId: orgA.developer.id,
            role: 'Função forjada',
            costBrl: 100000,
          },
        ],
      }),
    );

    const rows = await adminDb
      .select()
      .from(schema.salesOpsSaleProfessionals)
      .where(
        and(
          eq(schema.salesOpsSaleProfessionals.orgId, orgA.orgId),
          eq(schema.salesOpsSaleProfessionals.saleId, created.sale.id),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.funcaoId).toBe(orgA.developer.id);
    expect(rows[0]?.funcaoNameSnapshot).toBe('Desenvolvedor');
    expect(rows[0]?.role).toBe('Desenvolvedor');
    expect(rows[0]?.personNameSnapshot).toBe('Ana Martins');
    expect(rows[0]?.costBrl).toBe(100000);
  });

  it('keeps a legacy free-text role row with a null funcao_id', async () => {
    const orgA = await seedOrg('legacy_role');

    const created = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [{ personName: 'Prestador avulso', role: 'Operacional', costBrl: 50000 }],
      }),
    );

    const [row] = await adminDb
      .select()
      .from(schema.salesOpsSaleProfessionals)
      .where(eq(schema.salesOpsSaleProfessionals.saleId, created.sale.id));

    expect(row?.funcaoId).toBeNull();
    expect(row?.funcaoNameSnapshot).toBe('Operacional');
    expect(row?.role).toBe('Operacional');
    expect(row?.personId).toBeNull();
    expect(row?.personNameSnapshot).toBe('Prestador avulso');
  });

  it('the composite foreign key rejects a cross-org funcao_id even in the admin context', async () => {
    const orgA = await seedOrg('fk_a');
    const orgB = await seedOrg('fk_b');
    const created = await createSale(db, orgA.orgId, salePayload(orgA));

    // Raw insert, admin session, service filters entirely bypassed. Only the
    // constraint can reject this, which is the point of asserting it here.
    await expect(
      adminClient`
        INSERT INTO sales_ops_sale_professionals
          (org_id, sale_id, person_id, person_name_snapshot, funcao_id, funcao_name_snapshot, role, cost_brl)
        VALUES (${orgA.orgId}, ${created.sale.id}, NULL, 'X', ${orgB.developer.id}, 'X', 'X', 1000)
      `,
    ).rejects.toMatchObject({ code: '23503' });

    // Positive control: the same raw insert with orgA's own função is accepted, so
    // the rejection is the org pairing and not the statement being malformed.
    await adminClient`
      INSERT INTO sales_ops_sale_professionals
        (org_id, sale_id, person_id, person_name_snapshot, funcao_id, funcao_name_snapshot, role, cost_brl)
      VALUES (${orgA.orgId}, ${created.sale.id}, NULL, 'X', ${orgA.developer.id}, 'X', 'X', 1000)
    `;
  });

  it('a null funcao_id passes the composite foreign key', async () => {
    const orgA = await seedOrg('fk_null');
    const created = await createSale(db, orgA.orgId, salePayload(orgA));

    // MATCH SIMPLE skips the lookup whenever any referencing column is NULL, which
    // is exactly what every backfilled legacy row relies on.
    await adminClient`
      INSERT INTO sales_ops_sale_professionals
        (org_id, sale_id, person_id, person_name_snapshot, funcao_id, funcao_name_snapshot, role, cost_brl)
      VALUES (${orgA.orgId}, ${created.sale.id}, NULL, 'X', NULL, 'Operacional', 'Operacional', 1000)
    `;

    const rows = await adminDb
      .select()
      .from(schema.salesOpsSaleProfessionals)
      .where(eq(schema.salesOpsSaleProfessionals.saleId, created.sale.id));
    expect(rows.filter((row) => row.funcaoId === null)).toHaveLength(1);
  });

  it('the shipped backfill maps a legacy role to a matching org funcao case-insensitively and leaves an unmatched role null', async () => {
    const orgA = await seedOrg('backfill');
    const created = await createSale(db, orgA.orgId, salePayload(orgA));

    // Two legacy-shaped rows written raw: the columns the migration backfills are
    // reset to their pre-migration values so replaying the shipped SQL has work to do.
    const [matched] = await adminClient`
      INSERT INTO sales_ops_sale_professionals
        (org_id, sale_id, person_id, person_name_snapshot, funcao_id, funcao_name_snapshot, role, cost_brl)
      VALUES (${orgA.orgId}, ${created.sale.id}, NULL, 'Legado A', NULL, '', '  dESENVOLVEDOR  ', 1000)
      RETURNING id
    `;
    const [unmatched] = await adminClient`
      INSERT INTO sales_ops_sale_professionals
        (org_id, sale_id, person_id, person_name_snapshot, funcao_id, funcao_name_snapshot, role, cost_brl)
      VALUES (${orgA.orgId}, ${created.sale.id}, NULL, 'Legado B', NULL, '', 'Cargo Inexistente', 1000)
      RETURNING id
    `;

    const migrationFile = fs
      .readdirSync(DRIZZLE_DIR)
      .find((file) => /_sale_professional_funcoes\.sql$/.test(file));
    if (!migrationFile) throw new Error('sale professional funcoes migration not found');
    const statements = fs
      .readFileSync(path.join(DRIZZLE_DIR, migrationFile), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const backfillStartIndex = statements.findIndex((statement) =>
      statement.includes("set_config('app.fxl_admin'"),
    );
    if (backfillStartIndex === -1) throw new Error('backfill statements not found');

    await adminClient.begin(async (tx) => {
      for (const statement of statements.slice(backfillStartIndex)) {
        await tx.unsafe(statement);
      }
    });

    const rows = await adminDb
      .select()
      .from(schema.salesOpsSaleProfessionals)
      .where(eq(schema.salesOpsSaleProfessionals.saleId, created.sale.id));
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(matched!.id)?.funcaoId).toBe(orgA.developer.id);
    expect(byId.get(matched!.id)?.funcaoNameSnapshot).toBe('  dESENVOLVEDOR  ');
    // No função is invented from historical free text.
    expect(byId.get(unmatched!.id)?.funcaoId).toBeNull();
    expect(byId.get(unmatched!.id)?.funcaoNameSnapshot).toBe('Cargo Inexistente');
  });

  it('professional_cost payables at won equal the overridden per-row costs', async () => {
    const orgA = await seedOrg('payables_prof');
    const tester = await seedFuncao(orgA.orgId, 'Testador');

    const created = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana Martins',
            funcaoId: orgA.developer.id,
            costBrl: 100000,
          },
          { personName: 'Carla Souza', funcaoId: tester.id, costBrl: 30000 },
        ],
      }),
    );

    const transition = await transitionSale(db, orgA.orgId, created.sale.id, 'won');
    expect(transition.ok).toBe(true);

    const payables = await adminDb
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.saleId, created.sale.id));
    const professionalPayables = payables.filter((row) => row.kind === 'professional_cost');

    expect(professionalPayables).toHaveLength(2);
    expect(professionalPayables.map((row) => row.amountBrl).sort((a, b) => a - b)).toEqual([
      30000, 100000,
    ]);
    // One-shot at the won date, never linked to a receivable.
    expect(professionalPayables.every((row) => row.receivableId === null)).toBe(true);
    expect(professionalPayables.map((row) => row.beneficiaryName).sort()).toEqual([
      'Ana Martins',
      'Carla Souza',
    ]);
  });

  it('overridden seller, finder and tax percentages drive the per-receivable payables at won', async () => {
    const orgA = await seedOrg('payables_pct');

    const created = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        sellerCommissionPct: 15,
        finderCommissionPct: 3.5,
        taxPct: 6,
        finderPersonId: orgA.seller.id,
        finderName: 'Ana Martins',
        installments: [
          { dueDate: '2026-07-14', amountBrl: 666667, method: 'pix' },
          { dueDate: '2026-08-14', amountBrl: 666667, method: 'pix' },
          { dueDate: '2026-09-14', amountBrl: 666666, method: 'pix' },
        ],
        items: [
          { productId: orgA.product.id, productName: 'FXL Custom', quantity: 2, unitBrl: 1000000 },
        ],
      }),
    );

    // The persisted ledger and the payables must agree on Σ floor per row.
    expect(created.sale.sellerCommissionBrl).toBe(299999);
    expect(created.sale.finderCommissionBrl).toBe(69999);
    expect(created.sale.taxBrl).toBe(119999);

    const transition = await transitionSale(db, orgA.orgId, created.sale.id, 'won');
    expect(transition.ok).toBe(true);

    const receivables = await adminDb
      .select()
      .from(schema.salesOpsReceivables)
      .where(eq(schema.salesOpsReceivables.saleId, created.sale.id));
    const payables = await adminDb
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.saleId, created.sale.id));
    const amountByReceivable = new Map(receivables.map((row) => [row.id, row.amountBrl]));

    const sellerPayables = payables.filter((row) => row.kind === 'seller_commission');
    expect(sellerPayables).toHaveLength(3);
    for (const row of sellerPayables) {
      expect(row.receivableId).not.toBeNull();
      expect(row.amountBrl).toBe(
        Math.floor((amountByReceivable.get(row.receivableId!)! * 15) / 100),
      );
    }
    expect(sellerPayables.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(299999);
    expect(
      payables
        .filter((row) => row.kind === 'finder_commission')
        .reduce((sum, row) => sum + row.amountBrl, 0),
    ).toBe(69999);
    expect(
      payables.filter((row) => row.kind === 'tax').reduce((sum, row) => sum + row.amountBrl, 0),
    ).toBe(119999);
  });

  it('reverting a won proposta voids the overridden professional_cost payables but never a paid one', async () => {
    const orgA = await seedOrg('revert');

    const created = await createSale(
      db,
      orgA.orgId,
      salePayload(orgA, {
        professionals: [
          {
            personId: orgA.seller.id,
            personName: 'Ana Martins',
            funcaoId: orgA.developer.id,
            costBrl: 100000,
          },
          { personName: 'Carla Souza', funcaoId: orgA.developer.id, costBrl: 30000 },
        ],
      }),
    );
    await transitionSale(db, orgA.orgId, created.sale.id, 'won');

    const before = await adminDb
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.saleId, created.sale.id));
    const paidRow = before.find(
      (row) => row.kind === 'professional_cost' && row.amountBrl === 100000,
    );
    if (!paidRow) throw new Error('expected a professional_cost payable to pay');
    await adminClient`UPDATE sales_ops_payables SET status = 'paid' WHERE id = ${paidRow.id}`;

    const reverted = await transitionSale(db, orgA.orgId, created.sale.id, 'open');
    expect(reverted.ok).toBe(true);

    const after = await adminDb
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.saleId, created.sale.id));
    const byId = new Map(after.map((row) => [row.id, row]));

    // Paid rows are never touched.
    expect(byId.get(paidRow.id)?.status).toBe('paid');
    // Positive control: the other professional_cost row DID get voided, so the
    // assertion above is the paid-row immunity and not a no-op revert.
    const otherRow = before.find(
      (row) => row.kind === 'professional_cost' && row.amountBrl === 30000,
    );
    expect(byId.get(otherRow!.id)?.status).toBe('void');
  });
});
