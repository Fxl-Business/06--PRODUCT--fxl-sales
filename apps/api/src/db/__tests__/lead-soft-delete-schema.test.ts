/**
 * Pure oracle for migration 0028 (lead-lixeira slice 01): no database
 * connection, just the journal, the shipped SQL bytes, the snapshot chain and
 * the Drizzle mirror. Applying the migration is proven by
 * test/rls/lead-soft-delete-migration.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { salesOpsLeads } from '../schema.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drizzleDir = path.join(apiRoot, 'drizzle');
const TAG = '0028_lead_soft_delete';

type SnapshotColumn = { name: string; type: string; primaryKey: boolean; notNull: boolean; default?: unknown };
type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      columns: Record<string, SnapshotColumn>;
      checkConstraints?: Record<string, { name: string; value: string }>;
      indexes?: Record<string, { name: string; columns: { expression: string }[]; where?: string }>;
    }
  >;
};

function journal(): { idx: number; tag: string; when: number }[] {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
  return JSON.parse(raw).entries;
}

function migrationSql(): string {
  return fs.readFileSync(path.join(drizzleDir, `${TAG}.sql`), 'utf8');
}

function migrationStatements(): string[] {
  return migrationSql()
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('--'))
    .join('\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

function snapshot(index: string): Snapshot {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', `${index}_snapshot.json`), 'utf8');
  return JSON.parse(raw) as Snapshot;
}

const COLUMNS = [
  { name: 'deleted_at', sqlType: 'timestamp with time zone' },
  { name: 'deleted_by_user_id', sqlType: 'text' },
  { name: 'deleted_by_name', sqlType: 'text' },
] as const;

describe('lead soft delete schema (migration 0028)', () => {
  it('journals 0028_lead_soft_delete immediately after 0027_lead_contact_fields', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    const entry = entries[at];
    const previous = entries[at - 1];
    expect(entry).toMatchObject({ idx: 28, tag: TAG });
    expect(previous).toMatchObject({ idx: 27, tag: '0027_lead_contact_fields' });
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('ships exactly the three columns, the partial index and the pair CHECK', () => {
    expect(migrationStatements()).toEqual([
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_at" timestamp with time zone;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_user_id" text;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_name" text;',
      'CREATE INDEX "sales_ops_leads_org_deleted_idx" ON "sales_ops_leads" USING btree ("org_id","deleted_at","id") WHERE "sales_ops_leads"."deleted_at" is not null;',
      'ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_deleted_pair_check" CHECK (("sales_ops_leads"."deleted_at" is null) = ("sales_ops_leads"."deleted_by_user_id" is null));',
    ]);
  });

  it('is an ordinary migration with no phase header or marker', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/fxl-migration-mode/);
    expect(sql).not.toMatch(/fxl-phase/);
  });

  it('chains the 0028 snapshot to 0027 and records columns, index and check', () => {
    const previous = snapshot('0027');
    const current = snapshot('0028');
    expect(current.prevId).toBe(previous.id);
    const table = current.tables['public.sales_ops_leads'];
    expect(table).toBeDefined();
    for (const { name, sqlType } of COLUMNS) {
      expect(table!.columns[name], name).toEqual({ name, type: sqlType, primaryKey: false, notNull: false });
    }
    expect(table!.checkConstraints?.sales_ops_leads_deleted_pair_check?.value).toBe(
      '("sales_ops_leads"."deleted_at" is null) = ("sales_ops_leads"."deleted_by_user_id" is null)',
    );
    const index = table!.indexes?.sales_ops_leads_org_deleted_idx;
    expect(index?.where).toBe('"sales_ops_leads"."deleted_at" is not null');
    expect(index?.columns.map((column) => column.expression)).toEqual(['org_id', 'deleted_at', 'id']);
    expect(previous.tables['public.sales_ops_leads']?.columns.deleted_at).toBeUndefined();
  });

  it('exposes the lixeira columns on the Drizzle table', () => {
    expect(salesOpsLeads.deletedAt.name).toBe('deleted_at');
    expect(salesOpsLeads.deletedAt.columnType).toBe('PgTimestamp');
    expect(salesOpsLeads.deletedByUserId.name).toBe('deleted_by_user_id');
    expect(salesOpsLeads.deletedByName.name).toBe('deleted_by_name');
    const config = getTableConfig(salesOpsLeads);
    for (const { name } of COLUMNS) {
      const column = config.columns.find((candidate) => candidate.name === name);
      expect(column, name).toBeDefined();
      expect(column!.notNull).toBe(false);
      expect(column!.hasDefault).toBe(false);
    }
    expect(config.checks.map((check) => check.name)).toContain('sales_ops_leads_deleted_pair_check');
    expect(
      config.indexes.find((index) => index.config.name === 'sales_ops_leads_org_deleted_idx')?.config.where,
    ).toBeDefined();
  });
});
