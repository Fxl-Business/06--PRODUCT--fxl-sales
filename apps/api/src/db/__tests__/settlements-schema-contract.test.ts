/**
 * Pure oracle for migration 0024 (contract C3): no database connection, just
 * the journal, the shipped SQL bytes and the Drizzle mirror.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  salesOpsPayables,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSettlements,
} from '../schema.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drizzleDir = path.join(apiRoot, 'drizzle');

function journal(): { idx: number; tag: string; when: number }[] {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
  return JSON.parse(raw).entries;
}

function migrationSql(): string {
  return fs.readFileSync(path.join(drizzleDir, '0024_sales_ops_settlements.sql'), 'utf8');
}

function columnByName(config: ReturnType<typeof getTableConfig>, name: string) {
  return config.columns.find((column) => column.name === name);
}

describe('settlements schema contract (migration 0024)', () => {
  it('journals 0024_sales_ops_settlements immediately after 0023', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === '0024_sales_ops_settlements');
    expect(at).toBeGreaterThan(0);
    const entry = entries[at];
    const previous = entries[at - 1];
    expect(entry).toMatchObject({ idx: 24, tag: '0024_sales_ops_settlements' });
    expect(previous).toMatchObject({ idx: 23, tag: '0023_lead_seller_identity' });
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('ships the immutability trigger, the estorno trigger and forced RLS for sales_ops_settlements', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/^-- fxl-migration-mode: phased/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "sales_ops_settlements"/);
    expect(sql).toMatch(/ERRCODE = 'FXS01'/);
    expect(sql).toMatch(/ERRCODE = 'FXS02'/);
    expect(sql).toMatch(/ERRCODE = 'FXS03'/);
    expect(sql).toMatch(/ALTER TABLE sales_ops_settlements FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/sales_ops_settlements_tenant_isolation/);
    expect(sql).toMatch(/sales_ops_settlements_admin_context/);
    expect(sql).toMatch(/sales_ops_settlements_one_estorno_per_baixa_idx/);
  });

  it('mirrors contract C3 in the Drizzle table', () => {
    const settlementsConfig = getTableConfig(salesOpsSettlements);
    expect(settlementsConfig.columns.map((column) => column.name)).toEqual([
      'id',
      'org_id',
      'sale_id',
      'target_kind',
      'receivable_id',
      'payable_id',
      'type',
      'reverses_settlement_id',
      'paid_on',
      'amount_brl',
      'origin',
      'actor_user_id',
      'actor_name',
      'recorded_at',
      'reason',
    ]);

    for (const table of [salesOpsReceivables, salesOpsPayables]) {
      const config = getTableConfig(table);
      const revision = columnByName(config, 'revision');
      const updatedAt = columnByName(config, 'updated_at');
      expect(revision?.notNull).toBe(true);
      expect(updatedAt?.notNull).toBe(true);
    }

    for (const table of [salesOpsSaleItems, salesOpsSaleProfessionals]) {
      const config = getTableConfig(table);
      const removedAt = columnByName(config, 'removed_at');
      expect(removedAt).toBeTruthy();
      expect(removedAt?.notNull).toBe(false);
    }

    const sql = migrationSql();
    expect(sql).toMatch(/ALTER TABLE "sales_ops_sale_items" ADD COLUMN "removed_at"/);
    expect(sql).toMatch(/ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "removed_at"/);
  });
});
