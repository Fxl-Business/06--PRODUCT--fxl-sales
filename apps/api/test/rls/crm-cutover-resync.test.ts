/**
 * Migration oracle for 0031 (vendas-crm-unificado slice 07a1): the phase 2 cutover RESYNC.
 *
 * A scratch database is migrated through 0030 (which copied the old etapas and leads), then the OLD
 * tables are mutated the way the old API would have between 0030 and the cutover (a lead moved,
 * edited, deleted, restored, a product replaced, an etapa renamed, a new lead and a new org), then
 * 0031 runs. Synthetic data only.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-resync.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanSql } from '../../src/db/__tests__/additive-migration-scan.js';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
} from './scratch-database.js';

const BREAKPOINT = '--> statement-breakpoint';
const TAG_0029 = '0029_crm_unificado_modelo';
const TAG_0030 = '0030_crm_legacy_copy';
const FILE_0030 = '0030_crm_legacy_copy.sql';
const FILE_0031 = '0031_crm_cutover_resync.sql';
const START = "SELECT set_config('app.fxl_admin'";

const SOURCE_TABLES = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products', 'sales_ops_clients', 'sales_ops_people', 'sales_ops_sales'] as const;
const CRM_TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
] as const;

const A = (n: string) => `a0000000-0000-4000-8000-000000000${n}`;
const D = (n: string) => `d0000000-0000-4000-8000-000000000${n}`;

const SEED_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('${A('001')}','orgA','Vendedora Ana');
INSERT INTO sales_ops_clients (id, org_id, name) VALUES ('${A('010')}','orgA','Cliente Alfa');
INSERT INTO sales_ops_products (id, org_id, name, seller_commission_value, finder_commission_value, seller_with_finder_commission_value) VALUES ('${A('020')}','orgA','Produto X',0,0,0);
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status) VALUES
 ('${A('101')}','orgA','Prospecção','normal',false,1,'active'),
 ('${A('102')}','orgA','Em negociação','normal',false,2,'active'),
 ('${A('103')}','orgA','Proposta','conversion',true,3,'active'),
 ('${A('104')}','orgA','Perdido','lost',true,4,'active'),
 ('${A('105')}','orgA','Antiga','normal',false,5,'active');
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, contact_birth_date, client_id, client_name_snapshot, estimated_value_brl, description, seller_person_id, seller_name_snapshot, stage_id, stage_changed_at, position) VALUES
 ('${A('201')}','orgA','Lead intocado','u@x.com',NULL,NULL,'',1000,NULL,NULL,'','${A('101')}','2026-09-01T10:00:00Z',1),
 ('${A('202')}','orgA','Lead editado','e@x.com','1990-05-04',NULL,'Empresa livre',50000,'desc antiga',NULL,'','${A('101')}','2026-09-02T10:00:00Z',2),
 ('${A('203')}','orgA','Lead excluído','x@x.com',NULL,NULL,'',0,NULL,NULL,'','${A('101')}','2026-09-03T10:00:00Z',3),
 ('${A('204')}','orgA','Lead a excluir','y@x.com',NULL,NULL,'',7000,NULL,NULL,'','${A('101')}','2026-09-04T10:00:00Z',4),
 ('${A('205')}','orgA','Lead a mover','z@x.com',NULL,'${A('010')}','Cliente Alfa',12345,NULL,'${A('001')}','Vendedora Ana','${A('102')}','2026-09-05T10:00:00Z',1);
UPDATE sales_ops_leads SET deleted_at = now(), deleted_by_user_id = 'u1', deleted_by_name = 'Admin' WHERE id = '${A('203')}';
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES
 ('${A('301')}','orgA','${A('205')}','${A('020')}','Produto X'),
 ('${A('302')}','orgA','${A('205')}',NULL,'Item livre sem catálogo');
`;

/** What the OLD API does after 0030: every write stamps updated_at. */
const OLD_WRITES_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
-- moved: etapa, position, stage_changed_at, updated_at
UPDATE sales_ops_leads SET stage_id = '${A('101')}', position = 9, stage_changed_at = '2026-10-01T09:00:00Z', updated_at = '2026-10-01T09:00:00Z' WHERE id = '${A('205')}';
-- edited: name, value, description; the birth date is cleared (a removal the migration cannot mirror)
UPDATE sales_ops_leads SET contact_name = 'Lead editado 2', estimated_value_brl = 99000, description = 'desc nova', contact_birth_date = NULL, updated_at = '2026-10-02T09:00:00Z' WHERE id = '${A('202')}';
-- deleted
UPDATE sales_ops_leads SET deleted_at = '2026-10-03T09:00:00Z', deleted_by_user_id = 'u2', deleted_by_name = 'Gestora', updated_at = '2026-10-03T09:00:00Z' WHERE id = '${A('204')}';
-- restored
UPDATE sales_ops_leads SET deleted_at = NULL, deleted_by_user_id = NULL, deleted_by_name = NULL, updated_at = '2026-10-04T09:00:00Z' WHERE id = '${A('203')}';
-- produtos replaced wholesale (delete + insert) by ONE free item
DELETE FROM sales_ops_lead_products WHERE lead_id = '${A('205')}';
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES ('${A('303')}','orgA','${A('205')}',NULL,'Item novo');
-- an etapa renamed, and a NAME SWAP: 101 gives its name away and 102 takes it. In the new table the
-- take-over collides until 101 is renamed, so the first run skips it (never aborts) and a second converges.
UPDATE sales_ops_lead_stages SET name = 'Antiga 2', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('105')}';
UPDATE sales_ops_lead_stages SET name = 'Novo X', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('101')}';
UPDATE sales_ops_lead_stages SET name = 'Prospecção', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('102')}';
-- an etapa created in the old table AFTER 0030 in an org whose pipeline already has its edges
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status, created_at, updated_at) VALUES ('${A('106')}','orgA','Nova etapa','normal',false,8,'active','2026-10-07T09:00:00Z','2026-10-07T09:00:00Z');
-- a new lead in an existing org, and a brand new org with an etapa and a lead
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, client_name_snapshot, estimated_value_brl, stage_id, stage_changed_at, position, description) VALUES
 ('${A('206')}','orgA','Lead novo','n@x.com','',5,'${A('101')}','2026-10-06T09:00:00Z',10,'com descrição');
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('${D('001')}','orgD','Pessoa D');
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position) VALUES ('${D('101')}','orgD','Novo','normal',false,1);
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, client_name_snapshot, stage_id, position) VALUES ('${D('201')}','orgD','Lead D','d@x.com','','${D('101')}',1);
`;

type Fingerprint = Record<string, { n: number; hash: string }>;

describe('migration 0031 (cutover resync) on a database that took old-table writes after 0030', () => {
  let scratch: ScratchDatabase;
  let sourceBeforeResync: Fingerprint;
  let transitionsBeforeResync: { from_stage_id: string; to_stage_id: string }[];

  async function fingerprint(tables: readonly string[]): Promise<Fingerprint> {
    const result: Fingerprint = {};
    for (const table of tables) {
      const [row] = await scratch.adminScratch.unsafe<{ n: number; hash: string }[]>(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash FROM ${table} t`,
      );
      result[table] = row!;
    }
    return result;
  }
  const rows = async <T extends object>(query: string): Promise<T[]> => [...(await scratch.adminScratch.unsafe<T[]>(query))];
  const chunks31 = () =>
    fs
      .readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0031), 'utf8')
      .split(BREAKPOINT)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  const rerun0031 = async () => {
    for (const chunk of chunks31()) await scratch.adminScratch.unsafe(chunk);
  };

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: TAG_0029 });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(SEED_SQL);
    });
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: TAG_0030 });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(OLD_WRITES_SQL);
    });
    sourceBeforeResync = await fingerprint(SOURCE_TABLES);
    transitionsBeforeResync = await rows(`SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'orgA'`);
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('repeats 0030 byte for byte, then only INSERTs and UPDATEs rows of the unified tables', () => {
    const a = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    const b = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0031), 'utf8');
    const repeat = a.slice(a.indexOf(START)).trimEnd();
    expect(b.includes(repeat)).toBe(true);
    expect(b.indexOf(START)).toBeLessThan(b.indexOf(repeat) + 1);
    expect(scanSql(b)).toEqual([]);
    const after = b.slice(b.indexOf(repeat) + repeat.length);
    for (const chunk of after.split(BREAKPOINT).map((c) => c.trim()).filter(Boolean)) {
      expect(chunk, chunk.slice(0, 60)).toMatch(/^(INSERT INTO|UPDATE) "sales_ops_(pipeline_stages|pipeline_transitions|crm_lead_events|crm_lead_field_values|crm_leads)"/);
    }
  });

  it('writes no old table: the source fingerprint taken before 0031 equals the one after', async () => {
    expect(await fingerprint(SOURCE_TABLES)).toEqual(sourceBeforeResync);
    expect(sourceBeforeResync['sales_ops_leads']!.n).toBe(7);
  });

  it('copies the rows the old tables got after 0030 with the same ids (new lead, new org, its etapa and pipeline)', async () => {
    expect((await rows<{ id: string }>(`SELECT id FROM sales_ops_crm_leads WHERE id IN ('${A('206')}','${D('201')}') ORDER BY id`)).length).toBe(2);
    const pipelineD = await rows<{ system_key: string }>(`SELECT system_key FROM sales_ops_pipelines WHERE org_id = 'orgD'`);
    expect(pipelineD).toEqual([{ system_key: 'crm-padrao' }]);
    expect((await rows(`SELECT id FROM sales_ops_pipeline_stages WHERE id = '${D('101')}'`)).length).toBe(1);
  });

  it('overwrites a stale copy with the row the old table changed last (move, edit, delete, restore)', async () => {
    const lead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_crm_leads WHERE id = '${id}'`))[0]!;
    const moved = await lead(A('205'));
    expect(moved.stage_id).toBe(A('101'));
    expect(moved.position).toBe(9);
    expect(new Date(moved.stage_changed_at as Date).toISOString()).toBe('2026-10-01T09:00:00.000Z');
    const edited = await lead(A('202'));
    expect(edited.contact_name).toBe('Lead editado 2');
    expect(edited.estimated_value_brl).toBe(99000);
    const deleted = await lead(A('204'));
    expect(deleted.deleted_by_name).toBe('Gestora');
    expect(deleted.deleted_at).not.toBeNull();
    const restored = await lead(A('203'));
    expect(restored.deleted_at).toBeNull();
    expect(restored.deleted_by_user_id).toBeNull();
    // An untouched lead is not rewritten.
    expect((await lead(A('201'))).updated_at).toBeNull();
  });

  it('writes ONE history event for the changed etapa, from the stale etapa to the new one', async () => {
    const events = await rows<{ from_stage_id: string | null; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_crm_lead_events WHERE lead_id = '${A('205')}' ORDER BY occurred_at, id`,
    );
    expect(events).toEqual([
      { from_stage_id: null, to_stage_id: A('102') },
      { from_stage_id: A('102'), to_stage_id: A('101') },
    ]);
    const untouched = await rows(`SELECT id FROM sales_ops_crm_lead_events WHERE lead_id = '${A('201')}'`);
    expect(untouched).toHaveLength(1);
  });

  it('upserts changed and added field values, and DOES NOT mirror a removal (a migration may not DELETE)', async () => {
    const value = async (leadId: string, key: string) =>
      rows<{ position: number; value_text: string | null; value_date: string | null; value_product_id: string | null }>(
        `SELECT v.position, v.value_text, v.value_date::text AS value_date, v.value_product_id
           FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id
          WHERE v.lead_id = '${leadId}' AND f.key = '${key}' ORDER BY v.position`,
      );
    expect(await value(A('202'), 'descricao')).toMatchObject([{ position: 0, value_text: 'desc nova' }]);
    // The birth date was cleared in the old table: the stale value stays (documented rule).
    expect(await value(A('202'), 'nascimento')).toMatchObject([{ position: 0, value_date: '1990-05-04' }]);
    // New lead with a description: the definition exists (0030 part) and the value is inserted.
    expect(await value(A('206'), 'descricao')).toMatchObject([{ value_text: 'com descrição' }]);
    // Produtos: position 0 now holds the new free item; the old second row (position 1) is stale.
    expect(await value(A('205'), 'produtos')).toMatchObject([
      { position: 0, value_text: 'Item novo', value_product_id: null },
      { position: 1, value_text: 'Item livre sem catálogo' },
    ]);
  });

  it('renames an etapa, skips a take-over that would collide, and never aborts', async () => {
    const stages = await rows<{ id: string; name: string }>(
      `SELECT id, name FROM sales_ops_pipeline_stages WHERE id IN ('${A('101')}','${A('102')}','${A('105')}') ORDER BY id`,
    );
    expect(stages).toEqual([
      { id: A('101'), name: 'Novo X' },
      { id: A('102'), name: 'Em negociação' },
      { id: A('105'), name: 'Antiga 2' },
    ]);
  });

  it('is idempotent: a second run converges the skipped rename, a third changes nothing', async () => {
    await rerun0031();
    const [swapped] = await rows<{ name: string }>(`SELECT name FROM sales_ops_pipeline_stages WHERE id = '${A('102')}'`);
    expect(swapped!.name).toBe('Prospecção');
    const before = await fingerprint(CRM_TABLES);
    await rerun0031();
    expect(await fingerprint(CRM_TABLES)).toEqual(before);
  });

  it('an etapa created in the old table after 0030 gets its edges, and a graph the org shaped is left alone', async () => {
    const key = (r: { from_stage_id: string; to_stage_id: string }) => `${r.from_stage_id}>${r.to_stage_id}`;
    const after = await rows<{ from_stage_id: string; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'orgA'`,
    );
    const afterKeys = new Set(after.map(key));
    const beforeKeys = new Set(transitionsBeforeResync.map(key));
    for (const k of beforeKeys) expect(afterKeys.has(k), k).toBe(true);
    const added = after.filter((r) => !beforeKeys.has(key(r)));
    expect(added.some((r) => r.from_stage_id === A('106'))).toBe(true);
    expect(added.some((r) => r.to_stage_id === A('106'))).toBe(true);
    for (const r of added) expect([r.from_stage_id, r.to_stage_id], key(r)).toContain(A('106'));
    const before = await fingerprint(CRM_TABLES);
    await rerun0031();
    expect(await fingerprint(CRM_TABLES)).toEqual(before);
  });

  it('never overwrites a row the NEW code wrote after the cutover', async () => {
    await scratch.adminScratch.unsafe(
      `UPDATE sales_ops_crm_leads SET contact_name = 'Editado pelo código novo', updated_at = now() + interval '1 day' WHERE id = '${A('202')}'`,
    );
    const before = await fingerprint(CRM_TABLES);
    await rerun0031();
    expect(await fingerprint(CRM_TABLES)).toEqual(before);
    const [row] = await rows<{ contact_name: string }>(`SELECT contact_name FROM sales_ops_crm_leads WHERE id = '${A('202')}'`);
    expect(row!.contact_name).toBe('Editado pelo código novo');
  });
});
