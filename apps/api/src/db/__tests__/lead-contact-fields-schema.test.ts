/**
 * Pure oracle for migration 0027 (edicao-leads slice 03): no database
 * connection, just the journal, the shipped SQL bytes, the snapshot chain and
 * the Drizzle mirror. Applying the migration is proven by
 * test/rls/lead-contact-fields-migration.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { salesOpsLeads } from '../schema.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drizzleDir = path.join(apiRoot, 'drizzle');
const TAG = '0027_lead_contact_fields';

type SnapshotColumn = { name: string; type: string; primaryKey: boolean; notNull: boolean; default?: unknown };
type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, { columns: Record<string, SnapshotColumn> }>;
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

const CONTACT_COLUMNS = [
  { name: 'contact_phone', sqlType: 'text' },
  { name: 'contact_email', sqlType: 'text' },
  { name: 'contact_birth_date', sqlType: 'date' },
] as const;

describe('lead contact fields schema (migration 0027)', () => {
  it('journals 0027_lead_contact_fields immediately after 0026_seller_invitation_state', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    const entry = entries[at];
    const previous = entries[at - 1];
    expect(entry).toMatchObject({ idx: 27, tag: TAG });
    expect(previous).toMatchObject({ idx: 26, tag: '0026_seller_invitation_state' });
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('ships exactly three additive nullable sales_ops_leads columns', () => {
    expect(migrationStatements()).toEqual([
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_phone" text;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_email" text;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_birth_date" date;',
    ]);
  });

  it('is an ordinary migration with no phase header or marker', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/fxl-migration-mode/);
    expect(sql).not.toMatch(/fxl-phase/);
  });

  it('chains the 0027 snapshot to the 0026 snapshot and records the three columns', () => {
    const previous = snapshot('0026');
    const current = snapshot('0027');
    expect(current.prevId).toBe(previous.id);
    const columns = current.tables['public.sales_ops_leads']?.columns;
    expect(columns).toBeDefined();
    for (const { name, sqlType } of CONTACT_COLUMNS) {
      expect(columns![name], name).toEqual({ name, type: sqlType, primaryKey: false, notNull: false });
    }
    expect(previous.tables['public.sales_ops_leads']?.columns.contact_phone).toBeUndefined();
  });

  it('exposes the contact fields on the Drizzle salesOpsLeads table', () => {
    expect(salesOpsLeads.contactPhone.name).toBe('contact_phone');
    expect(salesOpsLeads.contactEmail.name).toBe('contact_email');
    expect(salesOpsLeads.contactBirthDate.name).toBe('contact_birth_date');
    // String mode: a civil day never becomes a JS Date.
    expect(salesOpsLeads.contactBirthDate.columnType).toBe('PgDateString');
  });

  it('declares the contact columns as nullable with no default', () => {
    const config = getTableConfig(salesOpsLeads);
    for (const { name, sqlType } of CONTACT_COLUMNS) {
      const column = config.columns.find((candidate) => candidate.name === name);
      expect(column, name).toBeDefined();
      expect(column!.getSQLType()).toBe(sqlType);
      expect(column!.notNull).toBe(false);
      expect(column!.hasDefault).toBe(false);
    }
  });
});
