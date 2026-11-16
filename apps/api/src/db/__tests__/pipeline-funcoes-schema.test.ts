/**
 * Pure oracle for migration 0034 (vários funis por organização): the journal, the shipped SQL
 * bytes, the snapshot chain and the Drizzle mirror, no database. Applying it and its RLS is proven
 * by test/rls/pipeline-access.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { scanSql } from './additive-migration-scan.js';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const TAG = '0034_crm_pipeline_funcoes';
const TABLE = 'sales_ops_pipeline_funcoes';

const sql = fs.readFileSync(path.join(drizzleDir, `${TAG}.sql`), 'utf8');
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.split('\n').filter((line) => !line.startsWith('--')).join('\n').trim())
  .filter((s) => s !== '');

function journal(): { idx: number; tag: string; when: number }[] {
  return JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')).entries;
}

describe('pipeline funções schema (migration 0034)', () => {
  it('journals 0034 immediately after 0033', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    expect(entries[at]).toMatchObject({ idx: 34, tag: TAG });
    expect(entries[at - 1]).toMatchObject({ idx: 33, tag: '0033_crm_exit_reopen_transitions' });
    expect(entries[at]!.when).toBeGreaterThan(entries[at - 1]!.when);
  });

  it('is additive and ordinary: the guard finds nothing, no data statement, no phased header', () => {
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/fxl-migration-mode/);
    for (const statement of statements) expect(statement).not.toMatch(/^(INSERT|UPDATE|SELECT|DELETE)\b/i);
  });

  it('creates exactly one table, then indexes, then FKs, then RLS', () => {
    const created = statements.filter((s) => s.startsWith('CREATE TABLE')).map((s) => /CREATE TABLE "([a-z_]+)"/.exec(s)![1]);
    expect(created).toEqual([TABLE]);
    const rank = (s: string) =>
      s.startsWith('CREATE TABLE') ? 0 : /^CREATE (UNIQUE )?INDEX/.test(s) ? 1 : /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT/.test(s) ? 2 : 3;
    const ranks = statements.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('has ENABLE + FORCE RLS and both org policies spelled exactly like 0029', () => {
    expect(sql).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(
      `CREATE POLICY ${TABLE}_tenant_isolation ON ${TABLE}\n  AS PERMISSIVE FOR ALL\n  USING (org_id = current_setting('app.current_org_id', true))\n  WITH CHECK (org_id = current_setting('app.current_org_id', true));`,
    );
    expect(sql).toContain(
      `CREATE POLICY ${TABLE}_admin_context ON ${TABLE}\n  AS PERMISSIVE FOR ALL\n  USING (current_setting('app.fxl_admin', true) = 'true')\n  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');`,
    );
  });

  it('every FK is composite with org_id first, restrict, onto the pipelines and the funções', () => {
    const config = getTableConfig(schema.salesOpsPipelineFuncoes);
    expect(config.name).toBe(TABLE);
    expect(config.columns.find((column) => column.name === 'org_id')?.notNull).toBe(true);
    const targets = config.foreignKeys.map((fk) => {
      const reference = fk.reference();
      expect(reference.columns.map((column) => column.name)[0]).toBe('org_id');
      expect(reference.foreignColumns.map((column) => column.name)).toEqual(['org_id', 'id']);
      expect(fk.onDelete).toBe('restrict');
      return getTableConfig(reference.foreignTable).name;
    });
    expect(targets.sort()).toEqual(['sales_ops_funcoes', 'sales_ops_pipelines']);
    expect(sql).toContain('REFERENCES "public"."sales_ops_pipelines"("org_id","id") ON DELETE restrict');
    expect(sql).toContain('REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict');
    const unique = config.indexes.find((index) => index.config.name === 'sales_ops_pipeline_funcoes_org_pipeline_funcao_idx');
    expect(unique?.config.unique).toBe(true);
  });

  it('chains the 0034 snapshot to 0033 and records the table', () => {
    const read = (index: string) => JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', `${index}_snapshot.json`), 'utf8'));
    const previous = read('0033');
    const current = read('0034');
    expect(current.prevId).toBe(previous.id);
    expect(current.tables[`public.${TABLE}`]).toBeDefined();
    expect(previous.tables[`public.${TABLE}`]).toBeUndefined();
  });
});
