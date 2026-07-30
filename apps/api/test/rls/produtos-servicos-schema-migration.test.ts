import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

/** The three CHECKs the migration adds AFTER the backfill, and only those. */
const POST_BACKFILL_CHECKS = [
  'sales_ops_products_kind_check',
  'sales_ops_products_kind_open_price_check',
  'sales_ops_products_service_no_fixed_value_check',
] as const;

type ProductRow = {
  id: string;
  name: string;
  kind: string;
  open_price: boolean;
  setup_brl: number;
  monthly_brl: number;
  seller_commission_type: string;
  seller_commission_value: string;
  seller_with_finder_commission_type: string;
  seller_with_finder_commission_value: string;
  finder_commission_type: string;
  finder_commission_value: string;
  code_suffix: string;
  area_id: string | null;
  status: string;
  modules: unknown;
  providers: unknown;
};

/**
 * Reads the shipped backfill: every statement from the admin-context set_config up
 * to (and excluding) the first `ADD CONSTRAINT` that FOLLOWS it. The new child
 * table's own foreign keys are `ADD CONSTRAINT` statements too, but they sit in the
 * DDL block above the backfill, so "the first one after set_config" is the only
 * correct boundary.
 */
function backfillStatements(): string[] {
  const migrationFile = fs.readdirSync(DRIZZLE_DIR).find((file) => /^0013_.*\.sql$/.test(file));
  if (!migrationFile) throw new Error('migration 0013 file not found in the drizzle directory');
  const statements = fs
    .readFileSync(path.join(DRIZZLE_DIR, migrationFile), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  const start = statements.findIndex((statement) =>
    statement.includes("set_config('app.fxl_admin'"),
  );
  if (start === -1) throw new Error('backfill statements not found in the shipped 0013 migration');
  const end = statements.findIndex(
    (statement, index) => index > start && statement.includes('ADD CONSTRAINT'),
  );
  if (end === -1) throw new Error('no post-backfill ADD CONSTRAINT found in 0013');
  const slice = statements.slice(start, end);
  if (slice.length !== 3) {
    throw new Error(`expected set_config + 2 UPDATEs in the 0013 backfill, got ${slice.length}`);
  }
  return slice;
}

describe('produtos & serviços schema migration 0013', () => {
  let adminClient: postgres.Sql;

  beforeAll(() => {
    // Raw fixture writes across orgs exercise migration correctness, not per-request
    // RLS behaviour (product-funcao-costs-rls.test.ts covers that), so the admin
    // connection is used throughout.
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
  });

  afterAll(async () => {
    await adminClient.end();
  });

  /**
   * Runs `fn` against a genuinely PRE-migration sales_ops_products: the three
   * post-backfill CHECKs are dropped first, so contradictory legacy rows (an
   * open-price row still carrying a fixed value, a `kind` still holding the old
   * 'SaaS' constant) can be inserted at all. Everything, DDL included, is rolled
   * back afterwards, so the live schema is untouched.
   */
  async function inPreMigrationSandbox<T>(
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    const ROLLBACK = `rollback_sandbox_${randomUUID()}`;
    let captured: T | undefined;
    let didRun = false;
    try {
      await adminClient.begin(async (tx) => {
        await tx.unsafe(
          `ALTER TABLE sales_ops_products ${POST_BACKFILL_CHECKS.map(
            (name) => `DROP CONSTRAINT ${name}`,
          ).join(', ')}`,
        );
        captured = await fn(tx);
        didRun = true;
        throw new Error(ROLLBACK);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
    }
    if (!didRun) throw new Error('sandbox body did not complete');
    return captured as T;
  }

  async function replay(tx: postgres.TransactionSql): Promise<void> {
    for (const statement of backfillStatements()) {
      await tx.unsafe(statement);
    }
  }

  async function insertLegacyProduct(
    tx: postgres.TransactionSql,
    row: {
      orgId: string;
      name: string;
      openPrice: boolean;
      setupBrl: number;
      monthlyBrl: number;
      codeSuffix: string;
    },
  ): Promise<string> {
    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO sales_ops_products (
        org_id, name, kind, code_suffix, open_price, setup_brl, has_monthly, monthly_brl,
        seller_commission_type, seller_commission_value,
        seller_with_finder_commission_type, seller_with_finder_commission_value,
        finder_commission_type, finder_commission_value,
        modules, providers, status
      ) VALUES (
        ${row.orgId}, ${row.name},
        -- the pre-migration content of the renamed column
        'SaaS',
        ${row.codeSuffix}, ${row.openPrice}, ${row.setupBrl}, ${row.monthlyBrl > 0},
        ${row.monthlyBrl},
        'pct', '10.00', 'pct', '7.00', 'pct', '3.00',
        '[]'::jsonb,
        ${tx.json([{ personName: 'Ana', commissionType: 'pct', commissionValue: 5 }])},
        'active'
      )
      RETURNING id
    `;
    return inserted!.id;
  }

  function productById(tx: postgres.TransactionSql, id: string) {
    return tx<ProductRow[]>`SELECT * FROM sales_ops_products WHERE id = ${id}`;
  }

  it('backfills kind from open_price for real rows', async () => {
    const rows = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_kind_${Date.now()}`;
      const serviceId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Consultoria',
        openPrice: true,
        setupBrl: 0,
        monthlyBrl: 0,
        codeSuffix: '1',
      });
      const productId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Licença',
        openPrice: false,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '2',
      });

      await replay(tx);

      const [service] = await productById(tx, serviceId);
      const [product] = await productById(tx, productId);
      return { service: service!, product: product! };
    });

    expect(rows.service.kind).toBe('service');
    expect(rows.product.kind).toBe('product');
    // Nothing is left holding the pre-migration constant.
    expect([rows.service.kind, rows.product.kind]).not.toContain('SaaS');
  });

  it('zeroes the own value of an open-price row without touching a fixed-price row', async () => {
    const rows = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_zero_${Date.now()}`;
      const openId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Serviço com resíduo',
        openPrice: true,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '3',
      });
      const fixedId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Produto com preço',
        openPrice: false,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '4',
      });

      await replay(tx);

      const [open] = await productById(tx, openId);
      const [fixed] = await productById(tx, fixedId);
      return { open: open!, fixed: fixed! };
    });

    expect(rows.open.setup_brl).toBe(0);
    expect(rows.open.monthly_brl).toBe(0);
    // Positive control: a Produto keeps its own value byte for byte.
    expect(rows.fixed.setup_brl).toBe(250000);
    expect(rows.fixed.monthly_brl).toBe(9900);
  });

  it('leaves the backfilled table able to take the three post-backfill CHECK constraints', async () => {
    // This is the ordering oracle the text assertions cannot give: the CHECKs are
    // added AFTER the backfill precisely because a legacy open-price row carrying a
    // fixed value would otherwise fail the ALTER TABLE.
    const outcome = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_order_${Date.now()}`;
      await insertLegacyProduct(tx, {
        orgId,
        name: 'Serviço contraditório',
        openPrice: true,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '5',
      });

      const beforeBackfill = await tx
        .unsafe(
          `ALTER TABLE sales_ops_products ADD CONSTRAINT sales_ops_products_kind_open_price_check CHECK (("kind" = 'service') = "open_price")`,
        )
        .then(() => 'accepted')
        .catch(() => 'rejected');
      // The failed ALTER aborted the transaction, so the ordering proof below runs
      // in its own sandbox; here we only need to know the constraint was refused.
      return beforeBackfill;
    });
    expect(outcome).toBe('rejected');

    const afterBackfill = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_order_ok_${Date.now()}`;
      await insertLegacyProduct(tx, {
        orgId,
        name: 'Serviço contraditório',
        openPrice: true,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '6',
      });

      await replay(tx);

      await tx.unsafe(
        `ALTER TABLE sales_ops_products
           ADD CONSTRAINT sales_ops_products_kind_check CHECK ("kind" in ('product', 'service')),
           ADD CONSTRAINT sales_ops_products_kind_open_price_check CHECK (("kind" = 'service') = "open_price"),
           ADD CONSTRAINT sales_ops_products_service_no_fixed_value_check CHECK ("kind" <> 'service' or ("setup_brl" = 0 and "monthly_brl" = 0))`,
      );
      return 'accepted';
    });
    expect(afterBackfill).toBe('accepted');
  });

  it('is idempotent when the backfill is replayed', async () => {
    const rows = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_idem_${Date.now()}`;
      const serviceId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Serviço',
        openPrice: true,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '7',
      });
      const productId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Produto',
        openPrice: false,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '8',
      });

      await replay(tx);
      const [firstService] = await productById(tx, serviceId);
      const [firstProduct] = await productById(tx, productId);
      await replay(tx);
      const [secondService] = await productById(tx, serviceId);
      const [secondProduct] = await productById(tx, productId);
      return {
        firstService: firstService!,
        firstProduct: firstProduct!,
        secondService: secondService!,
        secondProduct: secondProduct!,
      };
    });

    expect(rows.secondService).toEqual(rows.firstService);
    expect(rows.secondProduct).toEqual(rows.firstProduct);
  });

  it('leaves every product commission column and the providers jsonb intact', async () => {
    const rows = await inPreMigrationSandbox(async (tx) => {
      const orgId = `org_mig07_noreg_${Date.now()}`;
      const areaRows = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_areas (org_id, name) VALUES (${orgId}, 'FXL Tech') RETURNING id
      `;
      const areaId = areaRows[0]!.id;
      const productId = await insertLegacyProduct(tx, {
        orgId,
        name: 'Serviço',
        openPrice: true,
        setupBrl: 250000,
        monthlyBrl: 9900,
        codeSuffix: '9',
      });
      await tx`UPDATE sales_ops_products SET area_id = ${areaId} WHERE id = ${productId}`;

      const [before] = await productById(tx, productId);
      await replay(tx);
      const [after] = await productById(tx, productId);
      return { before: before!, after: after! };
    });

    for (const column of [
      'seller_commission_type',
      'seller_commission_value',
      'seller_with_finder_commission_type',
      'seller_with_finder_commission_value',
      'finder_commission_type',
      'finder_commission_value',
      'code_suffix',
      'area_id',
      'status',
      'name',
      'open_price',
    ] as const) {
      expect(rows.after[column], `column ${column} changed`).toEqual(rows.before[column]);
    }
    expect(rows.after.modules).toEqual(rows.before.modules);
    // The deprecated providers jsonb is neither dropped nor rewritten here.
    expect(rows.after.providers).toEqual([
      { personName: 'Ana', commissionType: 'pct', commissionValue: 5 },
    ]);
  });

  it('rolls the sandbox back so the live schema keeps its CHECK constraints', async () => {
    const constraints = await adminClient<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'sales_ops_products'::regclass AND contype = 'c'
      ORDER BY conname
    `;
    const names = constraints.map((row) => row.conname);
    for (const name of POST_BACKFILL_CHECKS) {
      expect(names, `${name} was not restored`).toContain(name);
    }
    expect(names).toContain('sales_ops_products_default_entrada_mode_check');
    expect(names).toContain('sales_ops_products_default_installments_check');
    expect(names).toContain('sales_ops_products_default_recurring_cycles_check');
  });
});
