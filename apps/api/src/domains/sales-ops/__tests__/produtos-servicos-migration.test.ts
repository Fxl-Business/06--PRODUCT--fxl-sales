import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = resolve(process.cwd(), 'drizzle/0013_produtos_servicos_defaults.sql');

function readMigration(): string {
  expect(existsSync(MIGRATION_PATH), `missing migration: ${MIGRATION_PATH}`).toBe(true);
  return readFileSync(MIGRATION_PATH, 'utf8');
}

function statements(): string[] {
  return readMigration()
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * The backfill window: from the admin-context set_config up to (and excluding) the
 * first `ADD CONSTRAINT` that FOLLOWS it. "Following it" is load-bearing - the new
 * child table's own foreign keys are also `ADD CONSTRAINT` statements and sit in
 * the DDL block above the backfill.
 */
function backfillWindow(): { start: number; end: number; rows: string[] } {
  const rows = statements();
  const start = rows.findIndex((statement) => statement.includes("set_config('app.fxl_admin'"));
  const end = rows.findIndex(
    (statement, index) => index > start && statement.includes('ADD CONSTRAINT'),
  );
  return { start, end, rows };
}

describe('produtos & serviços schema migration 0013', () => {
  it('renames type to kind and backfills from open_price before adding the CHECK constraints', () => {
    const migration = readMigration();

    // A drop-and-add would discard the source of the kind backfill and silently
    // leave every Serviço classified as a Produto.
    expect(migration).toContain('RENAME COLUMN "type" TO "kind"');
    expect(migration).not.toMatch(/DROP COLUMN "type"/i);
    expect(migration).toContain(`ALTER TABLE "sales_ops_products" ALTER COLUMN "kind" SET DEFAULT 'product'`);

    const adminContextIndex = migration.indexOf("SELECT set_config('app.fxl_admin', 'true', true)");
    const kindBackfillIndex = migration.indexOf(
      `SET "kind" = CASE WHEN "open_price" THEN 'service' ELSE 'product' END`,
    );
    const openPriceCheckIndex = migration.indexOf('sales_ops_products_kind_open_price_check');

    expect(adminContextIndex).toBeGreaterThan(-1);
    expect(kindBackfillIndex).toBeGreaterThan(adminContextIndex);
    expect(openPriceCheckIndex).toBeGreaterThan(kindBackfillIndex);
  });

  it('zeroes the own value of every open-price row before enforcing the servico invariant', () => {
    const migration = readMigration();

    const zeroIndex = migration.indexOf('SET "setup_brl" = 0, "monthly_brl" = 0');
    const invariantIndex = migration.indexOf('sales_ops_products_service_no_fixed_value_check');

    expect(zeroIndex).toBeGreaterThan(-1);
    expect(migration.slice(zeroIndex)).toContain('WHERE "open_price"');
    expect(invariantIndex).toBeGreaterThan(zeroIndex);
  });

  it('creates the funcao cost child table with forced RLS and both policies', () => {
    const migration = readMigration();

    expect(migration).toContain('CREATE TABLE "sales_ops_product_funcao_costs"');
    const enableIndex = migration.indexOf(
      'ALTER TABLE sales_ops_product_funcao_costs ENABLE ROW LEVEL SECURITY',
    );
    const forceIndex = migration.indexOf(
      'ALTER TABLE sales_ops_product_funcao_costs FORCE ROW LEVEL SECURITY',
    );
    expect(enableIndex).toBeGreaterThan(-1);
    expect(forceIndex).toBeGreaterThan(enableIndex);
    expect(migration).toContain('sales_ops_product_funcao_costs_tenant_isolation');
    expect(migration).toContain('sales_ops_product_funcao_costs_admin_context');
    expect(migration).toContain("org_id = current_setting('app.current_org_id', true)");
    expect(migration).toContain('sales_ops_product_funcao_costs_mode_check');
    // Money is integer cents, rates are numeric(5,2). One column per unit, never one
    // ambiguous jsonb number.
    expect(migration).toContain('"value_brl" integer');
    expect(migration).toContain('"value_pct" numeric(5, 2)');
  });

  it('binds funcao costs to the caller org through a composite foreign key', () => {
    const migration = readMigration();

    expect(migration).toContain(
      'ADD CONSTRAINT "sales_ops_product_funcao_costs_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict',
    );
    // A single-column FK on funcao_id would not consult the RLS predicate.
    expect(migration).not.toMatch(
      /FOREIGN KEY \("funcao_id"\) REFERENCES "public"\."sales_ops_funcoes"/i,
    );
    // 0012 owns the composite-FK target index; re-creating it here would fail on apply.
    expect(migration).not.toContain('CREATE UNIQUE INDEX "sales_ops_funcoes_org_id_id_idx"');
  });

  it('never uses a session-scoped admin config', () => {
    expect(readMigration()).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i);
  });

  it('does not migrate or drop the deprecated providers column', () => {
    const migration = readMigration();

    // providers keys on a free-text personName with no deterministic mapping to a
    // funcaoId, so there is no honest backfill; slice 10 removes the editor and a
    // later contract slice drops the column.
    expect(migration).not.toMatch(/DROP COLUMN "providers"/i);
    expect(migration).not.toMatch(/INSERT INTO "sales_ops_product_funcao_costs"/i);
  });

  it('keeps the backfill updates contiguous between set_config and the first CHECK constraint', () => {
    const { start, end, rows } = backfillWindow();

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const window = rows.slice(start + 1, end);
    expect(window).toHaveLength(2);
    for (const statement of window) {
      expect(statement.startsWith('UPDATE "sales_ops_products"')).toBe(true);
    }
    // The statement that closes the window is the first CHECK, not a stray DDL.
    expect(rows[end]).toContain('sales_ops_products_kind_check');
  });

  it('adds every CHECK constraint the drizzle schema declares', () => {
    const migration = readMigration();

    for (const constraint of [
      'sales_ops_products_kind_check',
      'sales_ops_products_kind_open_price_check',
      'sales_ops_products_service_no_fixed_value_check',
      'sales_ops_products_default_entrada_mode_check',
      'sales_ops_products_default_installments_check',
      'sales_ops_products_default_recurring_cycles_check',
    ]) {
      expect(migration, `missing constraint: ${constraint}`).toContain(
        `ADD CONSTRAINT "${constraint}"`,
      );
    }
  });

  it('adds the six default-config columns with the defaults that reproduce today behaviour', () => {
    const migration = readMigration();

    expect(migration).toContain(`ADD COLUMN "default_payment_method" text DEFAULT 'pix' NOT NULL`);
    expect(migration).toContain(`ADD COLUMN "default_entrada_mode" text DEFAULT 'none' NOT NULL`);
    expect(migration).toContain('ADD COLUMN "default_entrada_pct" numeric(5, 2)');
    expect(migration).toContain('ADD COLUMN "default_entrada_brl" integer');
    expect(migration).toContain(
      'ADD COLUMN "default_remaining_installments" integer DEFAULT 1 NOT NULL',
    );
    // Nullable on purpose: NULL means indefinite recurrence.
    expect(migration).toContain('ADD COLUMN "default_recurring_cycles" integer DEFAULT 12');
    expect(migration).not.toMatch(/"default_recurring_cycles" integer DEFAULT 12 NOT NULL/i);
    // The recurring amount is not duplicated out of monthly_brl.
    expect(migration).not.toContain('default_recurring_monthly_brl');
  });

  it('is journaled as idx 13', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((row) => row.idx === 13);

    expect(entry?.tag).toBe('0013_produtos_servicos_defaults');
    expect(journal.entries.filter((row) => row.idx === 13)).toHaveLength(1);
    /*
      This used to assert `some(idx === 14) === false`, i.e. "0013 is the last
      migration ever journaled", which every subsequent slice is obliged to break
      and which was never this test's subject. The claim that IS its subject -
      0013 occupies idx 13 and nothing collides with it - is kept above and
      strengthened here into the journal invariant that made it worth asserting:
      every idx is unique and strictly increasing, so no later migration can take
      13 or land out of order.
    */
    const indices = journal.entries.map((row) => row.idx);
    expect(new Set(indices).size).toBe(indices.length);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });
});
