/**
 * Slice 07 (produtos-servicos-api) integration coverage.
 *
 * Exercises the real product write path against the local test DB through the
 * non-superuser app role, so RLS is genuinely enforced, plus a raw probe role for
 * the policies themselves and an ADMIN-context connection used deliberately to
 * prove the service's explicit orgId filters are load-bearing: under the admin
 * policy every org is visible, so a missing `eq(table.orgId, orgId)` can no longer
 * hide behind row security.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  CreateSaleSchema,
  FuncaoSchema,
  INVALID_PRODUCT_ENTRADA_VALUE,
  ProductSchema,
  createArea,
  createFuncao,
  createProduct,
  createSale,
  getSalesOpsSnapshot,
  listProductFuncaoCosts,
  listProducts,
  resolveProductRefs,
  updateProduct,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

function withRole(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

describe('produtos & serviços defaults, função costs and tenancy', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * The same service functions driven over a connection whose session carries
   * app.fxl_admin = 'true'. The admin policy exposes every org, so RLS cannot
   * silently satisfy a tenancy assertion here.
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
      // Order matters: the composite `restrict` FK from the cost rows to
      // sales_ops_funcoes blocks the teardown if funções go first.
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  function newOrg(label: string): string {
    const orgId = `org_pfc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function seedArea(orgId: string, name = 'FXL Tech') {
    const area = await createArea(db, orgId, AreaSchema.parse({ name }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    return area;
  }

  async function seedFuncao(orgId: string, name: string) {
    const funcao = await createFuncao(db, orgId, FuncaoSchema.parse({ name }));
    if (typeof funcao === 'string') throw new Error(`unexpected funcao outcome: ${funcao}`);
    return funcao;
  }

  it('funcao cost defaults round-trip through create, patch and bootstrap', async () => {
    const orgA = newOrg('roundtrip_a');
    const orgB = newOrg('roundtrip_b');
    const area = await seedArea(orgA);
    const developer = await seedFuncao(orgA, 'Desenvolvedor');
    const tester = await seedFuncao(orgA, 'Tester');

    const created = await createProduct(
      db,
      orgA,
      ProductSchema.parse({
        name: 'Custom',
        codeSuffix: '71',
        areaId: area.id,
        kind: 'service',
        defaultEntradaMode: 'pct',
        defaultEntradaPct: 50,
        defaultRemainingInstallments: 3,
        defaultPaymentMethod: 'pix',
        productFuncaoCosts: [
          { funcaoId: developer.id, mode: 'pct', valuePct: 5 },
          { funcaoId: tester.id, mode: 'fix', valueBrl: 30000 },
        ],
      }),
    );

    expect(created.product.kind).toBe('service');
    // open_price is a derived projection of kind, written server-side.
    expect(created.product.openPrice).toBe(true);
    expect(created.product.setupBrl).toBe(0);
    expect(created.product.monthlyBrl).toBe(0);
    expect(created.product.defaultEntradaMode).toBe('pct');
    expect(created.product.defaultEntradaPct).toBe('50.00');
    expect(created.product.defaultEntradaBrl).toBeNull();
    expect(created.product.defaultRemainingInstallments).toBe(3);
    expect(created.product.defaultPaymentMethod).toBe('pix');
    // The column default reproduces today's 12-cycle wizard behaviour.
    expect(created.product.defaultRecurringCycles).toBe(12);

    expect(created.productFuncaoCosts).toHaveLength(2);
    expect(created.productFuncaoCosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: orgA,
          productId: created.product.id,
          funcaoId: developer.id,
          mode: 'pct',
          valuePct: '5.00',
          valueBrl: null,
        }),
        expect.objectContaining({
          orgId: orgA,
          productId: created.product.id,
          funcaoId: tester.id,
          mode: 'fix',
          // Cents, not reais.
          valueBrl: 30000,
          valuePct: null,
        }),
      ]),
    );
    // Cost rows come back ordered by (productId, funcaoId), never by insertion
    // order, so the payload is stable across requests.
    expect(created.productFuncaoCosts.map((cost) => cost.funcaoId)).toEqual(
      [developer.id, tester.id].sort(),
    );

    // A PATCH that omits the key leaves the set untouched.
    const renamed = await updateProduct(db, orgA, created.product.id, { name: 'Custom v2' });
    if (typeof renamed === 'string' || !renamed) throw new Error('unexpected patch outcome');
    expect(renamed.product.name).toBe('Custom v2');
    expect(renamed.productFuncaoCosts).toHaveLength(2);

    // A PATCH that sends the key is a full replace.
    const replaced = await updateProduct(db, orgA, created.product.id, {
      productFuncaoCosts: [{ funcaoId: tester.id, mode: 'pct', valuePct: 12.5 }],
    });
    if (typeof replaced === 'string' || !replaced) throw new Error('unexpected patch outcome');
    expect(replaced.productFuncaoCosts).toEqual([
      expect.objectContaining({ funcaoId: tester.id, mode: 'pct', valuePct: '12.50' }),
    ]);

    // An empty list clears the set.
    const cleared = await updateProduct(db, orgA, created.product.id, { productFuncaoCosts: [] });
    if (typeof cleared === 'string' || !cleared) throw new Error('unexpected patch outcome');
    expect(cleared.productFuncaoCosts).toEqual([]);
    expect(await listProductFuncaoCosts(db, orgA, created.product.id)).toEqual([]);

    // Re-populate so the snapshot assertions below have something to see.
    const repopulated = await updateProduct(db, orgA, created.product.id, {
      productFuncaoCosts: [
        { funcaoId: developer.id, mode: 'pct', valuePct: 5 },
        { funcaoId: tester.id, mode: 'fix', valueBrl: 30000 },
      ],
    });
    if (typeof repopulated === 'string' || !repopulated) throw new Error('unexpected outcome');

    const snapshotA = await getSalesOpsSnapshot(db, orgA);
    expect(snapshotA.productFuncaoCosts).toEqual(await listProductFuncaoCosts(db, orgA));
    expect(snapshotA.productFuncaoCosts).toHaveLength(2);
    expect(snapshotA.products.map((product) => product.kind)).toEqual(['service']);

    const snapshotB = await getSalesOpsSnapshot(db, orgB);
    expect(snapshotB.productFuncaoCosts).toEqual([]);
    expect(snapshotB.products).toEqual([]);
  });

  it('keeps cost rows out of another org even over an admin connection', async () => {
    // The admin policy exposes every org, so this fails the moment the service
    // stops filtering by orgId - RLS cannot cover for it here.
    const orgA = newOrg('adminfilter_a');
    const orgB = newOrg('adminfilter_b');
    const area = await seedArea(orgA);
    const funcao = await seedFuncao(orgA, 'Desenvolvedor');

    const created = await createProduct(
      adminDb,
      orgA,
      ProductSchema.parse({
        name: 'Serviço A',
        codeSuffix: '72',
        areaId: area.id,
        kind: 'service',
        productFuncaoCosts: [{ funcaoId: funcao.id, mode: 'pct', valuePct: 5 }],
      }),
    );
    expect(created.productFuncaoCosts).toHaveLength(1);

    expect(await listProductFuncaoCosts(adminDb, orgB)).toEqual([]);
    expect(await listProducts(adminDb, orgB)).toEqual([]);
    expect((await getSalesOpsSnapshot(adminDb, orgB)).productFuncaoCosts).toEqual([]);
    expect(await updateProduct(adminDb, orgB, created.product.id, { name: 'hijack' })).toBeNull();
    // Positive control: the owning org still sees and can still write its own row.
    expect(await listProductFuncaoCosts(adminDb, orgA)).toHaveLength(1);
    const own = await updateProduct(adminDb, orgA, created.product.id, { name: 'Serviço A v2' });
    if (typeof own === 'string' || !own) throw new Error('unexpected patch outcome');
    expect(own.product.name).toBe('Serviço A v2');
  });

  it('rejects a funcao id owned by another org', async () => {
    const orgA = newOrg('crossorg_a');
    const orgB = newOrg('crossorg_b');
    const area = await seedArea(orgA);
    const ownFuncao = await seedFuncao(orgA, 'Desenvolvedor');
    const foreignFuncao = await seedFuncao(orgB, 'Desenvolvedor');

    const foreign = await resolveProductRefs(db, orgA, {
      areaId: area.id,
      productFuncaoCosts: [{ funcaoId: foreignFuncao.id, mode: 'pct', valuePct: 5 }],
    });
    expect(foreign).toEqual({
      ok: false,
      reason: 'unknown_funcao',
      funcaoId: foreignFuncao.id,
    });

    // Positive control: the org's OWN função resolves.
    expect(
      await resolveProductRefs(db, orgA, {
        areaId: area.id,
        productFuncaoCosts: [{ funcaoId: ownFuncao.id, mode: 'pct', valuePct: 5 }],
      }),
    ).toEqual({ ok: true });

    // An unknown área is still rejected with its own reason code.
    expect(await resolveProductRefs(db, orgA, { areaId: randomUUID() })).toEqual({
      ok: false,
      reason: 'unknown_area',
    });

    // The composite FK is the in-transaction backstop: even a raw insert that
    // bypasses the pre-check cannot store the cross-org pair.
    const created = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Serviço', codeSuffix: '73', areaId: area.id, kind: 'service' }),
    );
    await expect(
      adminClient`
        INSERT INTO sales_ops_product_funcao_costs (org_id, product_id, funcao_id, mode, value_pct)
        VALUES (${orgA}, ${created.product.id}, ${foreignFuncao.id}, 'pct', 5.00)
      `,
    ).rejects.toThrow(/sales_ops_product_funcao_costs_org_funcao_fk/);

    // Positive control: the same raw insert with the org's own função succeeds.
    await adminClient`
      INSERT INTO sales_ops_product_funcao_costs (org_id, product_id, funcao_id, mode, value_pct)
      VALUES (${orgA}, ${created.product.id}, ${ownFuncao.id}, 'pct', 5.00)
    `;
    expect(await listProductFuncaoCosts(db, orgA, created.product.id)).toHaveLength(1);
  });

  it('a servico persists a base value, and one left alone stays at zero', async () => {
    const orgA = newOrg('basevalue');
    const area = await seedArea(orgA);
    const serviceA = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Serviço A', codeSuffix: '74', areaId: area.id, kind: 'service' }),
    );
    const serviceB = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Serviço B', codeSuffix: '77', areaId: area.id, kind: 'service' }),
    );
    const product = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Produto', codeSuffix: '75', areaId: area.id, kind: 'product' }),
    );

    const priced = await updateProduct(db, orgA, serviceA.product.id, { setupBrl: 500000 });
    if (typeof priced === 'string' || !priced) throw new Error('unexpected patch outcome');
    expect(priced.product.setupBrl).toBe(500000);
    expect(priced.product.kind).toBe('service');
    // The projection is untouched by the base value: a Serviço with one is still a Serviço.
    expect(priced.product.openPrice).toBe(true);

    const recurring = await updateProduct(db, orgA, serviceA.product.id, {
      hasMonthly: true,
      monthlyBrl: 20000,
    });
    if (typeof recurring === 'string' || !recurring) throw new Error('unexpected patch outcome');
    expect(recurring.product.monthlyBrl).toBe(20000);

    // Re-read: the values really landed on the row, not just on the RETURNING clause.
    const stored = await listProducts(db, orgA);
    const storedA = stored.find((row) => row.id === serviceA.product.id);
    expect(storedA?.setupBrl).toBe(500000);
    expect(storedA?.monthlyBrl).toBe(20000);

    // No-regression: a Serviço nobody touched is still exactly what it always was.
    const storedB = stored.find((row) => row.id === serviceB.product.id);
    expect(storedB?.setupBrl).toBe(0);
    expect(storedB?.monthlyBrl).toBe(0);
    expect(storedB?.openPrice).toBe(true);
    expect(storedB?.kind).toBe('service');

    // Behavior flip: reclassifying a priced Produto used to be INVALID_PRODUCT_KIND_VALUE.
    const pricedProduct = await updateProduct(db, orgA, product.product.id, { setupBrl: 5000 });
    if (typeof pricedProduct === 'string' || !pricedProduct) {
      throw new Error('unexpected patch outcome');
    }
    expect(pricedProduct.product.setupBrl).toBe(5000);
    const reclassified = await updateProduct(db, orgA, product.product.id, { kind: 'service' });
    if (typeof reclassified === 'string' || !reclassified) {
      throw new Error('unexpected patch outcome');
    }
    expect(reclassified.product.kind).toBe('service');
    expect(reclassified.product.setupBrl).toBe(5000);

    // The load-bearing assertion: only the dropped DB CHECK can make this resolve.
    await expect(
      adminClient`
        UPDATE sales_ops_products SET setup_brl = 5000 WHERE id = ${serviceB.product.id}
      `,
    ).resolves.toBeDefined();
    const [rawB] = await adminClient<{ setup_brl: number }[]>`
      SELECT setup_brl FROM sales_ops_products WHERE id = ${serviceB.product.id}
    `;
    expect(rawB?.setup_brl).toBe(5000);
  });

  it('a merged entrada block that contradicts itself is a 400-shaped sentinel, not a 500', async () => {
    const orgA = newOrg('entrada');
    const area = await seedArea(orgA);
    const created = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Produto', codeSuffix: '76', areaId: area.id }),
    );
    expect(created.product.defaultEntradaMode).toBe('none');

    // A pct value against a stored mode of 'none' is only visible once merged.
    expect(await updateProduct(db, orgA, created.product.id, { defaultEntradaPct: 50 })).toBe(
      INVALID_PRODUCT_ENTRADA_VALUE,
    );

    // Positive control: sending the mode alongside the value succeeds.
    const ok = await updateProduct(db, orgA, created.product.id, {
      defaultEntradaMode: 'pct',
      defaultEntradaPct: 50,
    });
    if (typeof ok === 'string' || !ok) throw new Error('unexpected patch outcome');
    expect(ok.product.defaultEntradaPct).toBe('50.00');

    // And clearing back to 'none' has to clear the value too.
    expect(await updateProduct(db, orgA, created.product.id, { defaultEntradaMode: 'none' })).toBe(
      INVALID_PRODUCT_ENTRADA_VALUE,
    );
    const reset = await updateProduct(db, orgA, created.product.id, {
      defaultEntradaMode: 'none',
      defaultEntradaPct: null,
    });
    if (typeof reset === 'string' || !reset) throw new Error('unexpected patch outcome');
    expect(reset.product.defaultEntradaPct).toBeNull();
  });

  it('openPrice stays equal to kind service in the database', async () => {
    const orgA = newOrg('openprice');
    const area = await seedArea(orgA);
    const service = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Serviço', codeSuffix: '77', areaId: area.id, kind: 'service' }),
    );
    const product = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Produto', codeSuffix: '78', areaId: area.id, kind: 'product' }),
    );
    expect(service.product.openPrice).toBe(true);
    expect(product.product.openPrice).toBe(false);

    await expect(
      adminClient`
        UPDATE sales_ops_products SET open_price = false WHERE id = ${service.product.id}
      `,
    ).rejects.toThrow(/sales_ops_products_kind_open_price_check/);
    await expect(
      adminClient`
        UPDATE sales_ops_products SET open_price = true WHERE id = ${product.product.id}
      `,
    ).rejects.toThrow(/sales_ops_products_kind_open_price_check/);
    await expect(
      adminClient`UPDATE sales_ops_products SET kind = 'servico' WHERE id = ${product.product.id}`,
    ).rejects.toThrow(/sales_ops_products_kind_check/);

    // Positive control: flipping BOTH together is what the migration itself does.
    await adminClient`
      UPDATE sales_ops_products SET kind = 'service', open_price = true
      WHERE id = ${product.product.id}
    `;

    // The deprecated wire alias keeps working: master's dialog sends only openPrice.
    const viaAlias = await createProduct(
      db,
      orgA,
      ProductSchema.parse({
        name: 'Legacy dialog serviço',
        codeSuffix: '79',
        areaId: area.id,
        openPrice: true,
      }),
    );
    expect(viaAlias.product.kind).toBe('service');
    expect(viaAlias.product.openPrice).toBe(true);

    const patchedViaAlias = await updateProduct(db, orgA, viaAlias.product.id, {
      openPrice: false,
    });
    if (typeof patchedViaAlias === 'string' || !patchedViaAlias) {
      throw new Error('unexpected patch outcome');
    }
    expect(patchedViaAlias.product.kind).toBe('product');
    expect(patchedViaAlias.product.openPrice).toBe(false);
  });

  it('a funcao still used as a product cost default cannot be deleted', async () => {
    const orgA = newOrg('restrict');
    const area = await seedArea(orgA);
    const funcao = await seedFuncao(orgA, 'Desenvolvedor');
    const spare = await seedFuncao(orgA, 'Designer');
    const created = await createProduct(
      db,
      orgA,
      ProductSchema.parse({
        name: 'Serviço',
        codeSuffix: '80',
        areaId: area.id,
        kind: 'service',
        productFuncaoCosts: [{ funcaoId: funcao.id, mode: 'fix', valueBrl: 30000 }],
      }),
    );

    await expect(
      adminClient`DELETE FROM sales_ops_funcoes WHERE id = ${funcao.id}`,
    ).rejects.toThrow(/sales_ops_product_funcao_costs_org_funcao_fk/);

    // Positive control: an unreferenced função in the same org deletes fine.
    await adminClient`DELETE FROM sales_ops_funcoes WHERE id = ${spare.id}`;

    // Deleting the product cascades its cost rows, which then frees the função.
    await adminClient`DELETE FROM sales_ops_products WHERE id = ${created.product.id}`;
    expect(await listProductFuncaoCosts(db, orgA)).toEqual([]);
    await adminClient`DELETE FROM sales_ops_funcoes WHERE id = ${funcao.id}`;
  });

  it('raw RLS blocks cross-org reads and smuggled inserts on sales_ops_product_funcao_costs', async () => {
    const roleName = `rls_probe_${randomUUID().replace(/-/g, '_')}`;
    const rolePassword = randomUUID();

    await adminClient.unsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await adminClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_product_funcao_costs TO ${roleName}`,
    );

    const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });

    try {
      const ORG_A = newOrg('rls_a');
      const ORG_B = newOrg('rls_b');
      const area = await seedArea(ORG_A);
      const funcao = await seedFuncao(ORG_A, 'Desenvolvedor');
      const created = await createProduct(
        db,
        ORG_A,
        ProductSchema.parse({
          name: 'Serviço',
          codeSuffix: '81',
          areaId: area.id,
          kind: 'service',
        }),
      );

      const [inserted] = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`
          INSERT INTO sales_ops_product_funcao_costs (org_id, product_id, funcao_id, mode, value_brl)
          VALUES (${ORG_A}, ${created.product.id}, ${funcao.id}, 'fix', 30000)
          RETURNING id
        `;
      });
      const id = (inserted as { id: string }).id;

      const ownRows = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`SELECT id FROM sales_ops_product_funcao_costs WHERE id = ${id}`;
      });
      expect(ownRows).toHaveLength(1);

      const otherRows = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
        return tx`SELECT id FROM sales_ops_product_funcao_costs WHERE id = ${id}`;
      });
      expect(otherRows).toHaveLength(0);

      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_product_funcao_costs (org_id, product_id, funcao_id, mode, value_brl)
            VALUES (${ORG_B}, ${created.product.id}, ${funcao.id}, 'fix', 30000)
            RETURNING id
          `;
        }),
      ).rejects.toThrow();

      // The mode CHECK is enforced at the row level too, not only in Zod.
      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_product_funcao_costs (org_id, product_id, funcao_id, mode, value_pct, value_brl)
            VALUES (${ORG_A}, ${created.product.id}, ${funcao.id}, 'pct', 5.00, 30000)
            RETURNING id
          `;
        }),
      ).rejects.toThrow(/sales_ops_product_funcao_costs_mode_check/);
    } finally {
      await roleClient.end();
      await adminClient.unsafe(`DROP OWNED BY ${roleName}`);
      await adminClient.unsafe(`DROP ROLE ${roleName}`);
    }
  });

  it('a new sale item snapshots the product kind', async () => {
    const orgA = newOrg('snapshot');
    const area = await seedArea(orgA);
    const service = await createProduct(
      db,
      orgA,
      ProductSchema.parse({ name: 'Serviço', codeSuffix: '82', areaId: area.id, kind: 'service' }),
    );
    const product = await createProduct(
      db,
      orgA,
      ProductSchema.parse({
        name: 'Produto',
        codeSuffix: '83',
        areaId: area.id,
        kind: 'product',
        setupBrl: 100000,
      }),
    );

    const sale = await createSale(
      db,
      orgA,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana',
        status: 'draft',
        baseDate: '2026-07-29',
        items: [
          { productId: service.product.id, productName: 'Consultoria', quantity: 1, unitBrl: 60000 },
          { productId: product.product.id, productName: 'Licença', quantity: 1, unitBrl: 40000 },
        ],
        installments: [{ dueDate: '2026-07-29', amountBrl: 100000, method: 'pix' }],
      }),
    );

    const rows = await adminClient<{ product_name_snapshot: string; product_type_snapshot: string }[]>`
      SELECT product_name_snapshot, product_type_snapshot
      FROM sales_ops_sale_items WHERE sale_id = ${sale.sale.id}
      ORDER BY product_name_snapshot
    `;
    expect(rows.map((row) => [row.product_name_snapshot, row.product_type_snapshot])).toEqual([
      ['Consultoria', 'service'],
      ['Licença', 'product'],
    ]);
  });
});
