/**
 * Pure oracle for migration 0029 (vendas-crm-unificado slice 05a): no database connection, just
 * the journal, the shipped SQL bytes, the snapshot chain and the Drizzle mirror. Applying the
 * migration and its RLS is proven by test/rls/crm-schema-rls.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { scanSql } from './additive-migration-scan.js';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const TAG = '0029_crm_unificado_modelo';

const TABLES = {
  sales_ops_pipelines: schema.salesOpsPipelines,
  sales_ops_pipeline_stages: schema.salesOpsPipelineStages,
  sales_ops_pipeline_transitions: schema.salesOpsPipelineTransitions,
  sales_ops_field_definitions: schema.salesOpsFieldDefinitions,
  sales_ops_crm_leads: schema.salesOpsCrmLeads,
  sales_ops_crm_lead_field_values: schema.salesOpsCrmLeadFieldValues,
  sales_ops_crm_lead_events: schema.salesOpsCrmLeadEvents,
  sales_ops_crm_lead_notes: schema.salesOpsCrmLeadNotes,
  sales_ops_crm_lead_followups: schema.salesOpsCrmLeadFollowups,
  sales_ops_org_modules: schema.salesOpsOrgModules,
} as const;

const sql = fs.readFileSync(path.join(drizzleDir, `${TAG}.sql`), 'utf8');
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.split('\n').filter((line) => !line.startsWith('--')).join('\n').trim())
  .filter((s) => s !== '');

function journal(): { idx: number; tag: string; when: number }[] {
  return JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')).entries;
}

describe('CRM schema (migration 0029)', () => {
  it('journals 0029_crm_unificado_modelo immediately after 0028_lead_soft_delete', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    expect(entries[at]).toMatchObject({ idx: 29, tag: TAG });
    expect(entries[at - 1]).toMatchObject({ idx: 28, tag: '0028_lead_soft_delete' });
    expect(entries[at]!.when).toBeGreaterThan(entries[at - 1]!.when);
  });

  it('is additive: the guard scanner finds nothing, and there is no data statement', () => {
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/fxl-migration-mode/);
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(INSERT|UPDATE|SELECT)\b/i);
    }
  });

  it('creates exactly the ten CRM tables and orders CREATE TABLE, then indexes, then FKs, then RLS', () => {
    const created = statements.filter((s) => s.startsWith('CREATE TABLE')).map((s) => /CREATE TABLE "([a-z_]+)"/.exec(s)![1]);
    expect(created.sort()).toEqual(Object.keys(TABLES).sort());
    const rank = (s: string) => (s.startsWith('CREATE TABLE') ? 0 : /^CREATE (UNIQUE )?INDEX/.test(s) ? 1 : /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT/.test(s) ? 2 : 3);
    const ranks = statements.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it.each(Object.keys(TABLES))('%s has ENABLE + FORCE RLS and both org policies spelled exactly like 0022', (table) => {
    expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(
      `CREATE POLICY ${table}_tenant_isolation ON ${table}\n  AS PERMISSIVE FOR ALL\n  USING (org_id = current_setting('app.current_org_id', true))\n  WITH CHECK (org_id = current_setting('app.current_org_id', true));`,
    );
    expect(sql).toContain(
      `CREATE POLICY ${table}_admin_context ON ${table}\n  AS PERMISSIVE FOR ALL\n  USING (current_setting('app.fxl_admin', true) = 'true')\n  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');`,
    );
  });

  it.each(Object.entries(TABLES))('%s: org_id is NOT NULL and every FK is composite with org_id first', (name, table) => {
    const config = getTableConfig(table);
    expect(config.name).toBe(name);
    const orgId = config.columns.find((column) => column.name === 'org_id');
    expect(orgId?.notNull).toBe(true);
    for (const fk of config.foreignKeys) {
      expect(fk.reference().columns[0]!.name, `${name} ${fk.getName()}`).toBe('org_id');
      expect(fk.reference().foreignColumns[0]!.name, `${name} ${fk.getName()} target`).toBe('org_id');
    }
  });

  it('chains the 0029 snapshot to 0028 and records every table', () => {
    const read = (index: string) => JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', `${index}_snapshot.json`), 'utf8'));
    const previous = read('0028');
    const current = read('0029');
    expect(current.prevId).toBe(previous.id);
    for (const name of Object.keys(TABLES)) {
      expect(current.tables[`public.${name}`], name).toBeDefined();
      expect(previous.tables[`public.${name}`], name).toBeUndefined();
    }
  });

  it('keeps the legacy lead tables byte-intact: no 0029 statement touches them', () => {
    for (const legacy of ['sales_ops_leads', 'sales_ops_lead_products', 'sales_ops_lead_stages', 'leads', 'sales_ops_sales', 'sales_ops_receivables', 'sales_ops_payables', 'sales_ops_settlements']) {
      const touching = statements.filter((s) => new RegExp(`(ALTER TABLE|INDEX [^;]* ON|ON) "?${legacy}"?[ ;(]`).test(s) && !s.startsWith('ALTER TABLE "sales_ops_crm') && !/REFERENCES "public"\."/.test(s));
      expect(touching, legacy).toEqual([]);
    }
  });

  it('the Cliente system field and the one-proposta-per-lead index are declared on the Drizzle tables', () => {
    const fields = getTableConfig(schema.salesOpsFieldDefinitions);
    expect(fields.checks.map((c) => c.name)).toContain('sales_ops_field_definitions_removable_check');
    const leads = getTableConfig(schema.salesOpsCrmLeads);
    const saleIdx = leads.indexes.find((index) => index.config.name === 'sales_ops_crm_leads_org_sale_idx');
    expect(saleIdx?.config.unique).toBe(true);
    expect(saleIdx?.config.where).toBeDefined();
    expect(schema.salesOpsCrmLeads.estimatedValueBrl.notNull).toBe(true);
    expect(schema.salesOpsCrmLeads.estimatedValueBrl.default).toBe(0);
  });
});
