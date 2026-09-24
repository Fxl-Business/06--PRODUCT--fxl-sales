/**
 * Migration oracle for 0024's backfill (contract C3, D03-1): proves the
 * synthetic baixas it writes for pre-existing paid rows are coherent with the
 * reducer rules, are stamped with the CIVIL due day even when the database
 * session runs in America/Sao_Paulo, are idempotent to replay, and that the
 * shipped verification block really aborts on divergence.
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api test:integration
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
} from './scratch-database.js';

const BREAKPOINT = '--> statement-breakpoint';

function shippedMigrationSql(): string {
  return fs.readFileSync(
    path.resolve(MIGRATIONS_FOLDER, '0024_sales_ops_settlements.sql'),
    'utf8',
  );
}

function backfillChunks(): string[] {
  const chunks = shippedMigrationSql().split(BREAKPOINT);
  const startIndex = chunks.findIndex((chunk) => chunk.includes("set_config('app.fxl_admin'"));
  if (startIndex === -1) throw new Error("could not find the backfill's set_config chunk");
  return chunks.slice(startIndex);
}

function verificationChunk(): string {
  const chunks = shippedMigrationSql().split(BREAKPOINT);
  const chunk = chunks.find((candidate) => candidate.includes("ERRCODE = 'FXS03'"));
  if (!chunk) throw new Error("could not find the FXS03 verification chunk");
  return chunk;
}

describe('migration 0024 on a database populated at 0023', () => {
  let scratch: ScratchDatabase;
  let orgA: string;
  let orgB: string;
  let saleAId: string;
  let ra1: string;
  let ra2: string;
  let ra3: string;
  let ra4: string;
  let pa1: string;
  let pa2: string;
  let pa3: string;
  let rb1: string;
  let spTodayBefore: string;
  let spTodayAfter: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await scratch.admin.unsafe(
      `ALTER DATABASE "${scratch.databaseName}" SET timezone TO 'America/Sao_Paulo'`,
    );

    await runDatabaseMigrations({
      databaseUrl: scratch.ownerUrl,
      migrationsFolder: MIGRATIONS_FOLDER,
      throughTag: '0023_lead_seller_identity',
    });

    orgA = `org_migration_a_${Date.now()}`;
    orgB = `org_migration_b_${Date.now()}`;

    const seedClient = scratchClient(scratch);
    await seedClient.begin(async (tx) => {
      await tx`SELECT set_config('app.fxl_admin', 'true', true)`;

      const [saleA] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_sales (
          org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
          status, payment_method, condition, base_date, total_brl,
          seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
        ) VALUES (
          ${orgA}, 1, 'MIG-A-1', 'Cliente A', 'Vendedor A',
          'won', 'pix', 'installments', '2026-01-01', 300000, '10.00', '0.00', '6.00', '84.00'
        ) RETURNING id
      `;
      saleAId = saleA!.id;

      const [saleB] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_sales (
          org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
          status, payment_method, condition, base_date, total_brl,
          seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
        ) VALUES (
          ${orgB}, 1, 'MIG-B-1', 'Cliente B', 'Vendedor B',
          'won', 'pix', 'cash', '2026-01-01', 50000, '10.00', '0.00', '6.00', '84.00'
        ) RETURNING id
      `;
      const saleBId = saleB!.id;

      const [receivableA1] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
        VALUES (${orgA}, ${saleAId}, '1/3', '2026-03-01T00:00:00Z', 120000, 'paid')
        RETURNING id
      `;
      ra1 = receivableA1!.id;

      const [receivableA2] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
        VALUES (${orgA}, ${saleAId}, '2/3', '2026-04-01T00:00:00Z', 120000, 'open')
        RETURNING id
      `;
      ra2 = receivableA2!.id;

      const [receivableA3] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
        VALUES (${orgA}, ${saleAId}, '3/3', '2026-05-01T00:00:00Z', 120000, 'void')
        RETURNING id
      `;
      ra3 = receivableA3!.id;

      const [receivableA4] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
        VALUES (${orgA}, ${saleAId}, 'M1/12', now() + interval '400 days', 80000, 'paid')
        RETURNING id
      `;
      ra4 = receivableA4!.id;

      const [payableA1] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_payables (
          org_id, sale_id, beneficiary_name, kind, receivable_id, due_date, amount_brl, status
        ) VALUES (
          ${orgA}, ${saleAId}, 'Vendedor A', 'seller_commission', ${ra1}, '2026-03-01T00:00:00Z', 6000, 'paid'
        ) RETURNING id
      `;
      pa1 = payableA1!.id;

      const [payableA2] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_payables (
          org_id, sale_id, beneficiary_name, kind, receivable_id, due_date, amount_brl, status
        ) VALUES (
          ${orgA}, ${saleAId}, 'Impostos', 'tax', ${ra2}, '2026-04-01T00:00:00Z', 14400, 'open'
        ) RETURNING id
      `;
      pa2 = payableA2!.id;

      const [payableA3] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_payables (
          org_id, sale_id, beneficiary_name, kind, receivable_id, due_date, amount_brl, status
        ) VALUES (
          ${orgA}, ${saleAId}, 'Finder A', 'finder_commission', ${ra1}, '2026-03-01T00:00:00Z', 0, 'paid'
        ) RETURNING id
      `;
      pa3 = payableA3!.id;

      const [receivableB1] = await tx<{ id: string }[]>`
        INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
        VALUES (${orgB}, ${saleBId}, '1/1', '2026-01-15T00:00:00Z', 50000, 'paid')
        RETURNING id
      `;
      rb1 = receivableB1!.id;
    });

    const [beforeRow] = await scratch.adminScratch<{ today: string }[]>`
      SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
    `;
    spTodayBefore = beforeRow!.today;

    await runDatabaseMigrations({
      databaseUrl: scratch.ownerUrl,
      migrationsFolder: MIGRATIONS_FOLDER,
    });

    const [afterRow] = await scratch.adminScratch<{ today: string }[]>`
      SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
    `;
    spTodayAfter = afterRow!.today;
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('backfills exactly one synthetic baixa per paid receivable and payable with a positive amount, coherent with the reducer rules', async () => {
    const rows = await scratch.adminScratch<
      Array<{
        org_id: string;
        sale_id: string;
        target_kind: string;
        receivable_id: string | null;
        payable_id: string | null;
        type: string;
        reverses_settlement_id: string | null;
        amount_brl: number;
        origin: string;
        actor_user_id: string;
        actor_name: string | null;
        reason: string | null;
        paid_on: string;
      }>
    >`SELECT
        org_id, sale_id, target_kind, receivable_id, payable_id, type,
        reverses_settlement_id, amount_brl, origin, actor_user_id, actor_name,
        reason, paid_on::text AS paid_on
      FROM sales_ops_settlements`;

    expect(rows).toHaveLength(4);

    const byRowId = new Map(
      rows.map((row) => [row.receivable_id ?? row.payable_id, row] as const),
    );
    expect(new Set(byRowId.keys())).toEqual(new Set([ra1, ra4, pa1, rb1]));
    expect(byRowId.has(ra2)).toBe(false);
    expect(byRowId.has(ra3)).toBe(false);
    expect(byRowId.has(pa2)).toBe(false);
    expect(byRowId.has(pa3)).toBe(false);

    for (const row of rows) {
      expect(row.type).toBe('baixa');
      expect(row.reverses_settlement_id).toBeNull();
      expect(row.origin).toBe('manual');
      expect(row.actor_user_id).toBe('system');
      expect(row.actor_name).toBe('Migração');
      expect(row.reason).toBeNull();
    }

    const ra1Row = byRowId.get(ra1)!;
    expect(ra1Row.org_id).toBe(orgA);
    expect(ra1Row.sale_id).toBe(saleAId);
    expect(ra1Row.target_kind).toBe('receivable');
    expect(ra1Row.amount_brl).toBe(120000);
    expect(ra1Row.paid_on).toBe('2026-03-01');

    const pa1Row = byRowId.get(pa1)!;
    expect(pa1Row.target_kind).toBe('payable');
    expect(pa1Row.amount_brl).toBe(6000);
    expect(pa1Row.paid_on).toBe('2026-03-01');

    const rb1Row = byRowId.get(rb1)!;
    expect(rb1Row.target_kind).toBe('receivable');
    expect(rb1Row.amount_brl).toBe(50000);
    expect(rb1Row.paid_on).toBe('2026-01-15');

    // Reducer coherence, in SQL: every paid, positive-amount ledger row's
    // active (no estorno) baixas sum to its amount_brl.
    const [divergence] = await scratch.adminScratch<{ count: string }[]>`
      WITH paid_rows AS (
        SELECT org_id, id, amount_brl FROM sales_ops_receivables WHERE status = 'paid' AND amount_brl > 0
        UNION ALL
        SELECT org_id, id, amount_brl FROM sales_ops_payables WHERE status = 'paid' AND amount_brl > 0
      ), active AS (
        SELECT org_id, coalesce(receivable_id, payable_id) AS row_id, sum(amount_brl) AS paid_brl
        FROM sales_ops_settlements
        WHERE type = 'baixa'
          AND NOT EXISTS (
            SELECT 1 FROM sales_ops_settlements e WHERE e.reverses_settlement_id = sales_ops_settlements.id
          )
        GROUP BY 1, 2
      )
      SELECT count(*)::text AS count
      FROM paid_rows pr
      LEFT JOIN active a ON a.org_id = pr.org_id AND a.row_id = pr.id
      WHERE coalesce(a.paid_brl, 0) <> pr.amount_brl
    `;
    expect(divergence?.count).toBe('0');

    const [ledgerRevisions] = await scratch.adminScratch<{ count: string }[]>`
      SELECT count(*)::text AS count FROM (
        SELECT revision, updated_at FROM sales_ops_receivables
        UNION ALL
        SELECT revision, updated_at FROM sales_ops_payables
      ) rows
      WHERE revision <> 1 OR updated_at IS NULL
    `;
    expect(ledgerRevisions?.count).toBe('0');
  });

  it('stamps paid_on with the UTC civil due day even when the database runs in America/Sao_Paulo, and clamps a future due day to the Sao Paulo today', async () => {
    const client = scratchClient(scratch);
    try {
      const [tz] = await client<{ TimeZone: string }[]>`SHOW timezone`;
      expect(tz?.TimeZone).toBe('America/Sao_Paulo');
    } finally {
      await client.end({ timeout: 1 });
    }

    const [ra1Row] = await scratch.adminScratch<{ paid_on: string }[]>`
      SELECT paid_on::text AS paid_on FROM sales_ops_settlements WHERE receivable_id = ${ra1}
    `;
    expect(ra1Row?.paid_on).toBe('2026-03-01');

    const [ra4Row] = await scratch.adminScratch<{ paid_on: string }[]>`
      SELECT paid_on::text AS paid_on FROM sales_ops_settlements WHERE receivable_id = ${ra4}
    `;
    expect([spTodayBefore, spTodayAfter]).toContain(ra4Row?.paid_on);
  });

  it('is idempotent: replaying the shipped backfill statements adds nothing', async () => {
    const client = scratchClient(scratch);
    try {
      await client.begin(async (tx) => {
        for (const chunk of backfillChunks()) {
          const statement = chunk.trim();
          if (statement.length === 0) continue;
          await tx.unsafe(statement);
        }
      });
    } finally {
      await client.end({ timeout: 1 });
    }

    const [count] = await scratch.adminScratch<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_settlements
    `;
    expect(count?.count).toBe('4');
  });

  it('the shipped verification block aborts with FXS03 when a paid row has no matching baixa', async () => {
    const client = scratchClient(scratch);
    try {
      await expect(
        client.begin(async (tx) => {
          await tx`SELECT set_config('app.fxl_admin', 'true', true)`;
          await tx`
            INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
            VALUES (${orgA}, ${saleAId}, 'MIG-EXTRA', '2026-06-01T00:00:00Z', 1000, 'paid')
          `;
          await tx.unsafe(verificationChunk().trim());
        }),
      ).rejects.toMatchObject({ code: 'FXS03' });
    } finally {
      await client.end({ timeout: 1 });
    }

    const [count] = await scratch.adminScratch<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_settlements
    `;
    expect(count?.count).toBe('4');
    const [extra] = await scratch.adminScratch<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_receivables WHERE label = 'MIG-EXTRA'
    `;
    expect(extra?.count).toBe('0');
  });
});
