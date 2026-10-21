/**
 * Migration oracle for 0030 (vendas-crm-unificado slice 06): the additive backfill of the
 * unified CRM model. A scratch database is migrated through 0029, populated with a SYNTHETIC
 * isolated dataset, then migrated to the head. No real data is read.
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-legacy-copy-migration.test.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import {
  defaultStageBehavior,
  defaultStageRequiresReason,
  planPipelineTransitions,
  type TransitionPlanStage,
} from '@fxl-sales/shared-utils/crm-model';
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
const FILE_0030 = '0030_crm_legacy_copy.sql';

/** Migration bookkeeping lives outside `public`, but it is excluded by name as well so the list never depends on that. */
const BOOKKEEPING_TABLES = ['__drizzle_migrations'] as const;

/** Every table 0029 creates; each carries org_id and FORCE RLS. */
const CRM_TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
  'sales_ops_crm_lead_notes',
  'sales_ops_crm_lead_followups',
  'sales_ops_org_modules',
] as const;

/** 4000 characters of incompressible text: a btree row over 2704 bytes cannot hold it (0029 indexed the whole value). */
const LONG_DESCRIPTION = crypto.randomBytes(3000).toString('base64').slice(0, 4000);

const SEED_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
-- orgA: full edition
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES
 ('a0000000-0000-4000-8000-000000000001','orgA','Vendedora Ana');
INSERT INTO sales_ops_clients (id, org_id, name) VALUES
 ('a0000000-0000-4000-8000-000000000010','orgA','Cliente Alfa');
INSERT INTO sales_ops_products (id, org_id, name, seller_commission_value, finder_commission_value, seller_with_finder_commission_value) VALUES
 ('a0000000-0000-4000-8000-000000000020','orgA','Produto X',0,0,0);
INSERT INTO sales_ops_sales (id, org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method, condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct, status) VALUES
 ('a0000000-0000-4000-8000-000000000030','orgA',1,'P-1','Cliente Alfa','Vendedora Ana','pix','avista',now(),100000,0,0,0,0,'won'),
 ('a0000000-0000-4000-8000-000000000031','orgA',2,'P-2','Cliente Alfa','Vendedora Ana','pix','avista',now(),50000,0,0,0,0,'lost');
INSERT INTO sales_ops_receivables (id, org_id, sale_id, label, due_date, amount_brl) VALUES
 ('a0000000-0000-4000-8000-000000000040','orgA','a0000000-0000-4000-8000-000000000030','1/1',now(),100000);
INSERT INTO sales_ops_payables (id, org_id, sale_id, beneficiary_name, kind, due_date, amount_brl) VALUES
 ('a0000000-0000-4000-8000-000000000041','orgA','a0000000-0000-4000-8000-000000000030','Ana','seller_commission',now(),5000);
INSERT INTO sales_ops_settlements (id, org_id, sale_id, target_kind, receivable_id, type, paid_on, amount_brl, actor_user_id, actor_name) VALUES
 ('a0000000-0000-4000-8000-000000000042','orgA','a0000000-0000-4000-8000-000000000030','receivable','a0000000-0000-4000-8000-000000000040','baixa','2026-10-01',100000,'user_1','Admin');
INSERT INTO integration_outbox (id, organization_id, event_name, event_version, idempotency_key, payload, occurred_at) VALUES
 ('evt_a_1','orgA','fxl-sales.settlement.recorded',1,'k1','{}'::jsonb, now());
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status, archived_at) VALUES
 ('a0000000-0000-4000-8000-000000000101','orgA','Prospecção','normal',false,1,'active',NULL),
 ('a0000000-0000-4000-8000-000000000102','orgA','Em negociação','normal',false,2,'active',NULL),
 ('a0000000-0000-4000-8000-000000000103','orgA','Proposta','conversion',true,3,'active',NULL),
 ('a0000000-0000-4000-8000-000000000104','orgA','Perdido','lost',true,4,'active',NULL),
 ('a0000000-0000-4000-8000-000000000105','orgA','Antiga','normal',false,5,'archived', now());
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_phone, contact_email, contact_birth_date, client_id, client_name_snapshot, estimated_value_brl, description, seller_person_id, seller_name_snapshot, stage_id, stage_changed_at, position, lost_reason, sale_id, deleted_at, deleted_by_user_id, deleted_by_name) VALUES
 ('a0000000-0000-4000-8000-000000000201','orgA','Lead convertido',NULL,NULL,NULL,'a0000000-0000-4000-8000-000000000010','Cliente Alfa',100000,'desc conv','a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000103','2026-09-01T10:00:00Z',0,NULL,'a0000000-0000-4000-8000-000000000030',NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000202','orgA','Lead perdido','1199','p@x.com','1990-05-04',NULL,'Empresa livre',50000,NULL,'a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000104','2026-09-02T10:00:00Z',0,'Sem orçamento',NULL,NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000203','orgA','Lead excluído',NULL,NULL,NULL,NULL,'',0,NULL,NULL,'','a0000000-0000-4000-8000-000000000101','2026-09-03T10:00:00Z',0,NULL,NULL,now(),'user_1','Admin'),
 ('a0000000-0000-4000-8000-000000000204','orgA','Lead sem vendedor',NULL,'u@x.com',NULL,NULL,'',7000,'',NULL,'','a0000000-0000-4000-8000-000000000101','2026-09-04T10:00:00Z',1,NULL,NULL,NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000205','orgA','Lead em negociação','1188',NULL,NULL,'a0000000-0000-4000-8000-000000000010','Cliente Alfa',12345,NULL,'a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000102','2026-09-05T10:00:00Z',0,NULL,NULL,NULL,NULL,NULL);
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES
 ('a0000000-0000-4000-8000-000000000301','orgA','a0000000-0000-4000-8000-000000000205','a0000000-0000-4000-8000-000000000020','Produto X'),
 ('a0000000-0000-4000-8000-000000000302','orgA','a0000000-0000-4000-8000-000000000205',NULL,'Item livre sem catálogo');
-- orgB: Construbom style, no produtos
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position) VALUES
 ('b0000000-0000-4000-8000-000000000101','orgB','Novo','normal',false,1),
 ('b0000000-0000-4000-8000-000000000102','orgB','Em negociação','normal',false,2),
 ('b0000000-0000-4000-8000-000000000103','orgB','Proposta','conversion',true,3),
 ('b0000000-0000-4000-8000-000000000104','orgB','Perdido','lost',true,4),
 ('b0000000-0000-4000-8000-000000000105','orgB','Ganho','normal',false,5);
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_phone, client_name_snapshot, estimated_value_brl, stage_id, position) VALUES
 ('b0000000-0000-4000-8000-000000000201','orgB','Lead B1','1177','Construtora Z',900,'b0000000-0000-4000-8000-000000000101',0);
-- orgC: person only, no stages
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('c0000000-0000-4000-8000-000000000001','orgC','Pessoa C');
-- legacy finder referral chain (apps, products, finders, links, clicks, conversions) and a finder lead, must NOT be copied
INSERT INTO apps (id, slug, name, publishable_key, secret_key_hash, secret_key_prefix, webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id) VALUES
 ('d0000000-0000-4000-8000-0000000000a1','app-x','App X','pk_x','h','sk_','w','{example.com}','active','user_1');
INSERT INTO products (id, app_id, slug, name, status) VALUES ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','p','P','active');
INSERT INTO finders (id, org_id, status, display_name, contact_email) VALUES ('d0000000-0000-4000-8000-0000000000a3','orgA','approved','Finder','f@x.com');
INSERT INTO referral_links (id, org_id, code, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, signature, destination_url) VALUES
 ('d0000000-0000-4000-8000-0000000000a4','orgA','CODE000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,'sig','https://example.com/x');
INSERT INTO clicks (click_id, org_id, link_id, finder_id, app_id, product_id) VALUES
 ('CLICK0000000000000000000001','orgA','d0000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2');
INSERT INTO leads (id, org_id, click_id, link_id, status) VALUES ('d0000000-0000-4000-8000-000000000001','orgA','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a4','converted');
INSERT INTO conversions (source, external_order_id, idempotency_key, org_id, link_id, click_id, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, realized_setup_brl, realized_monthly_brl, hold_until, closed_at) VALUES
 ('fxl-financiero','ord1','idem1','orgA','d0000000-0000-4000-8000-0000000000a4','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,1000,500,now(),now());
-- orgD: legacy etapas already named like the two exits (Ganho, Ganho (saída), Pausado and an ARCHIVED
-- Pausado (saída)), plus a lead whose description is 4000 incompressible characters.
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status, archived_at) VALUES
 ('d0000000-0000-4000-8000-000000000101','orgD','Ganho','normal',false,1,'active',NULL),
 ('d0000000-0000-4000-8000-000000000102','orgD','Ganho (saída)','normal',false,2,'active',NULL),
 ('d0000000-0000-4000-8000-000000000103','orgD','Pausado','normal',false,3,'active',NULL),
 ('d0000000-0000-4000-8000-000000000104','orgD','Pausado (saída)','normal',false,4,'archived', now()),
 ('d0000000-0000-4000-8000-000000000105','orgD','Proposta','conversion',true,5,'active',NULL),
 ('d0000000-0000-4000-8000-000000000106','orgD','Perdido','lost',true,6,'active',NULL);
INSERT INTO sales_ops_leads (id, org_id, contact_name, client_name_snapshot, estimated_value_brl, description, stage_id, stage_changed_at, position) VALUES
 ('d0000000-0000-4000-8000-000000000301','orgD','Lead descrição longa','',1000,'${LONG_DESCRIPTION}','d0000000-0000-4000-8000-000000000101','2026-09-06T10:00:00Z',0);
`;

type Fingerprint = Record<string, { n: number; hash: string }>;

const L = (suffix: string, org = 'a') => `${org}0000000-0000-4000-8000-000000000${suffix}`;

/** Thrown inside a probe transaction to roll it back without reporting a failure. */
const PROBE_ROLLBACK = 'probe-rollback';

describe('migration 0030 on a database populated at 0029', () => {
  let scratch: ScratchDatabase;
  let sourceBefore: Fingerprint;
  /** Every public table that is not a CRM table: the backfill must only READ them. Read from pg_tables, never hand-listed. */
  let sourceTables: string[] = [];

  /** count + md5 of every row's text form; adminScratch is the superuser, so RLS does not hide rows. */
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

  function copyChunks(): string[] {
    const sql = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    return sql.split(BREAKPOINT).map((chunk) => chunk.trim()).filter(Boolean);
  }

  async function rows<T extends object>(query: string): Promise<T[]> {
    return [...(await scratch.adminScratch.unsafe<T[]>(query))];
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({
      databaseUrl: scratch.ownerUrl,
      migrationsFolder: MIGRATIONS_FOLDER,
      throughTag: TAG_0029,
    });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(SEED_SQL);
    });
    const excluded = [...CRM_TABLES, ...BOOKKEEPING_TABLES].map((t) => `'${t}'`).join(',');
    sourceTables = (
      await rows<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN (${excluded}) ORDER BY tablename`,
      )
    ).map((r) => r.tablename);
    expect(sourceTables.length).toBeGreaterThanOrEqual(30);
    sourceBefore = await fingerprint(sourceTables);
    expect((await fingerprint(CRM_TABLES))['sales_ops_crm_leads']!.n).toBe(0);
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('0030 is additive only (no DROP, DELETE, TRUNCATE, RENAME, GRANT, ROLE) and never writes a source table', () => {
    const sql = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    for (const chunk of copyChunks().slice(1)) {
      expect(chunk, chunk.slice(0, 60)).toMatch(/^INSERT INTO "sales_ops_(pipelines|pipeline_stages|pipeline_transitions|field_definitions|crm_leads|crm_lead_field_values|crm_lead_events)"/);
    }
  });

  it('every public non-CRM table is identical before and after (row count and content hash)', async () => {
    expect(await fingerprint(sourceTables)).toEqual(sourceBefore);
    // spot checks that the fixture was not empty
    expect(sourceBefore['sales_ops_leads']!.n).toBe(7);
    expect(sourceBefore['sales_ops_lead_products']!.n).toBe(2);
    expect(sourceBefore['sales_ops_settlements']!.n).toBe(1);
    expect(sourceBefore['integration_outbox']!.n).toBe(1);
    expect(sourceBefore['leads']!.n).toBe(1);
    expect(sourceBefore['conversions']!.n).toBe(1);
  });

  it('payables, receivables, settlements and the outbox are unchanged and not touched by the new model', async () => {
    const [counts] = await rows<{ r: number; p: number; s: number; o: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_receivables)::int r, (SELECT count(*) FROM sales_ops_payables)::int p,
              (SELECT count(*) FROM sales_ops_settlements)::int s, (SELECT count(*) FROM integration_outbox)::int o`,
    );
    expect(counts).toEqual({ r: 1, p: 1, s: 1, o: 1 });
  });

  it('copies every lead with the SAME id; counts and the estimated value sum match the source per org', async () => {
    const source = await rows<{ org_id: string; n: number; total: number }>(
      `SELECT org_id, count(*)::int n, sum(estimated_value_brl)::int total FROM sales_ops_leads GROUP BY 1 ORDER BY 1`,
    );
    const target = await rows<{ org_id: string; n: number; total: number }>(
      `SELECT org_id, count(*)::int n, sum(estimated_value_brl)::int total FROM sales_ops_crm_leads GROUP BY 1 ORDER BY 1`,
    );
    expect(target).toEqual(source);
    expect(source.find((r) => r.org_id === 'orgA')).toEqual({ org_id: 'orgA', n: 5, total: 169345 });
    const diff = await rows<{ id: string }>(
      `SELECT id FROM sales_ops_leads EXCEPT SELECT id FROM sales_ops_crm_leads`,
    );
    expect(diff).toEqual([]);
    const legacy = await rows<{ id: string }>(`SELECT id FROM sales_ops_crm_leads WHERE id = 'd0000000-0000-4000-8000-000000000001'`);
    expect(legacy).toEqual([]);
  });

  it('copies each lead column for column, including soft delete, unassigned and the proposta link', async () => {
    const lead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_crm_leads WHERE id = '${id}'`))[0]!;
    const sourceLead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_leads WHERE id = '${id}'`))[0]!;
    const shared = [
      'org_id', 'contact_name', 'contact_phone', 'contact_email', 'stage_id', 'position', 'stage_changed_at',
      'seller_person_id', 'seller_name_snapshot', 'client_id', 'client_name_snapshot', 'estimated_value_brl',
      'lost_reason', 'sale_id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by_user_id', 'deleted_by_name',
    ];
    for (const id of ['201', '202', '203', '204', '205'].map((s) => L(s)).concat([L('201', 'b'), L('301', 'd')])) {
      const copied = await lead(id);
      const original = await sourceLead(id);
      for (const column of shared) expect(copied[column], `${id}.${column}`).toEqual(original[column]);
    }
    expect((await lead(L('201')))['sale_id']).toBe(L('030'));
    expect((await lead(L('203')))['deleted_by_name']).toBe('Admin');
    expect((await lead(L('204')))['seller_person_id']).toBeNull();
    expect((await lead(L('202')))['client_id']).toBeNull();
    expect((await lead(L('202')))['client_name_snapshot']).toBe('Empresa livre');
    expect((await lead(L('201')))['client_id']).toBe(L('010'));
  });

  it('keeps at most one lead per proposta and every lead stage inside its own pipeline', async () => {
    const [orphans] = await rows<{ n: number }>(
      `SELECT count(*)::int n FROM sales_ops_crm_leads l
       LEFT JOIN sales_ops_pipeline_stages s ON s.org_id = l.org_id AND s.pipeline_id = l.pipeline_id AND s.id = l.stage_id
       WHERE s.id IS NULL`,
    );
    expect(orphans!.n).toBe(0);
    await expect(
      scratch.adminScratch.unsafe(
        `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, sale_id)
         SELECT org_id, 'dup', pipeline_id, stage_id, sale_id FROM sales_ops_crm_leads WHERE id = '${L('201')}'`,
      ),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'sales_ops_crm_leads_org_sale_idx' });
  });

  it('migrates the etapas of an org with its OWN ids, names and positions, and adds Ganho and Pausado', async () => {
    const stages = await rows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean; status: string }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason, status FROM sales_ops_pipeline_stages WHERE org_id = 'orgA' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason, s.status])).toEqual([
      ['Prospecção', 1, 'normal', 'none', null, false, 'active'],
      ['Em negociação', 2, 'normal', 'none', null, false, 'active'],
      ['Proposta', 3, 'orcamento', 'opens_orcamentos', null, false, 'active'],
      ['Perdido', 4, 'saida', 'none', 'perdido', true, 'active'],
      ['Antiga', 5, 'normal', 'none', null, false, 'archived'],
      ['Ganho', 6, 'saida', 'none', 'ganho', false, 'active'],
      ['Pausado', 7, 'saida', 'none', 'pausado', false, 'active'],
    ]);
    expect(stages.slice(0, 5).map((s) => s.id)).toEqual(['101', '102', '103', '104', '105'].map((s) => L(s)));
    const noRename = await rows<{ id: string }>(
      `SELECT id FROM sales_ops_lead_stages EXCEPT SELECT id FROM sales_ops_pipeline_stages`,
    );
    expect(noRename).toEqual([]);
  });

  it('never loses an exit when an org already named a normal etapa Ganho', async () => {
    const names = await rows<{ name: string; type: string; exit_kind: string | null }>(
      `SELECT name, type, exit_kind FROM sales_ops_pipeline_stages WHERE org_id = 'orgB' AND name LIKE 'Ganho%' ORDER BY name`,
    );
    expect(names).toEqual([
      { name: 'Ganho', type: 'normal', exit_kind: null },
      { name: 'Ganho (saída)', type: 'saida', exit_kind: 'ganho' },
    ]);
  });

  it('copies a 4000-character incompressible description byte-equal into a text value', async () => {
    const [value] = await rows<{ value_text: string }>(
      `SELECT v.value_text FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'descricao'
       WHERE v.lead_id = '${L('301', 'd')}'`,
    );
    expect(value!.value_text).toBe(LONG_DESCRIPTION);
    expect(value!.value_text).toHaveLength(4000);
  });

  it('gives an org whose names collide with the exits a free name for each exit, once, and keeps its etapas', async () => {
    const exits = await rows<{ name: string; type: string; exit_kind: string }>(
      `SELECT name, type, exit_kind FROM sales_ops_pipeline_stages WHERE org_id = 'orgD' AND exit_kind IS NOT NULL ORDER BY exit_kind`,
    );
    expect(exits).toEqual([
      { name: 'Ganho (saída 2)', type: 'saida', exit_kind: 'ganho' },
      { name: 'Pausado (saída 2)', type: 'saida', exit_kind: 'pausado' },
      { name: 'Perdido', type: 'saida', exit_kind: 'perdido' },
    ]);
    const kept = await rows<{ name: string }>(
      `SELECT name FROM sales_ops_pipeline_stages WHERE org_id = 'orgD' AND exit_kind IS NULL ORDER BY position`,
    );
    expect(kept.map((r) => r.name)).toEqual(['Ganho', 'Ganho (saída)', 'Pausado', 'Pausado (saída)', 'Proposta']);
  });

  it('gives an org with no etapa the pure default pipeline, equal to DEFAULT_PIPELINE_STAGES and its transitions', async () => {
    const stages = await rows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason FROM sales_ops_pipeline_stages WHERE org_id = 'orgC' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason])).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => [s.label, s.order, s.type, defaultStageBehavior(s), s.exitKind, defaultStageRequiresReason(s)]),
    );
    const idByKey = new Map(DEFAULT_PIPELINE_STAGES.map((s, i) => [s.key as string, stages[i]!.id]));
    const transitions = await rows<{ from_stage_id: string; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'orgC'`,
    );
    expect(new Set(transitions.map((t) => `${t.from_stage_id}>${t.to_stage_id}`))).toEqual(
      new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${idByKey.get(a)}>${idByKey.get(b)}`)),
    );
  });

  it('the SQL transition graph equals the TS rule planPipelineTransitions for every org', async () => {
    for (const org of ['orgA', 'orgB', 'orgC', 'orgD']) {
      const stages = await rows<{ id: string; name: string; position: number; type: TransitionPlanStage['type']; exit_kind: TransitionPlanStage['exitKind']; status: TransitionPlanStage['status'] }>(
        `SELECT id, name, position, type, exit_kind, status FROM sales_ops_pipeline_stages WHERE org_id = '${org}'`,
      );
      const planned = planPipelineTransitions(stages.map((s) => ({ id: s.id, name: s.name, position: s.position, type: s.type, exitKind: s.exit_kind, status: s.status })));
      const stored = await rows<{ from_stage_id: string; to_stage_id: string }>(
        `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = '${org}'`,
      );
      expect(new Set(stored.map((t) => `${t.from_stage_id}>${t.to_stage_id}`)), org).toEqual(new Set(planned.map(([a, b]) => `${a}>${b}`)));
    }
    const [a] = await rows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipeline_transitions WHERE org_id = 'orgA'`);
    expect(a!.n).toBe(16);
  });

  it('creates one default pipeline per org, named and keyed, and no module rows (the token is not in the database)', async () => {
    const pipelines = await rows<{ org_id: string; name: string; system_key: string; is_default: boolean }>(
      `SELECT org_id, name, system_key, is_default FROM sales_ops_pipelines ORDER BY org_id`,
    );
    expect(pipelines).toEqual(
      ['orgA', 'orgB', 'orgC', 'orgD'].map((org_id) => ({ org_id, name: 'Funil CRM padrão', system_key: 'crm-padrao', is_default: true })),
    );
    expect((await fingerprint(['sales_ops_org_modules']))['sales_ops_org_modules']!.n).toBe(0);
  });

  it('Cliente becomes the non-removable system field; other fields exist only where data needs them', async () => {
    const fields = await rows<{ org_id: string; key: string; kind: string; reference_target: string | null; multiple: boolean; is_system: boolean; removable: boolean; backing_column: string | null }>(
      `SELECT org_id, key, kind, reference_target, multiple, is_system, removable, backing_column FROM sales_ops_field_definitions ORDER BY org_id, position`,
    );
    const cliente = { key: 'cliente', kind: 'reference', reference_target: 'cliente', multiple: false, is_system: true, removable: false, backing_column: 'client_id' };
    expect(fields.filter((f) => f.org_id === 'orgA').map((f) => f.key)).toEqual(['cliente', 'produtos', 'descricao', 'nascimento']);
    expect(fields.filter((f) => f.org_id === 'orgB').map((f) => f.key)).toEqual(['cliente']);
    expect(fields.filter((f) => f.org_id === 'orgC').map((f) => f.key)).toEqual(['cliente']);
    expect(fields.filter((f) => f.org_id === 'orgD').map((f) => f.key)).toEqual(['cliente', 'descricao']);
    for (const org of ['orgA', 'orgB', 'orgC', 'orgD']) {
      expect(fields.find((f) => f.org_id === org && f.key === 'cliente')).toMatchObject({ org_id: org, ...cliente });
    }
    expect(fields.find((f) => f.key === 'produtos')).toMatchObject({ kind: 'reference', reference_target: 'produto', multiple: true, is_system: false, removable: true });
  });

  it('lead produtos become Produto values, FREE items (no catalog row) included with their name snapshot', async () => {
    const values = await rows<{ lead_id: string; position: number; value_product_id: string | null; value_text: string | null; ref_name_snapshot: string }>(
      `SELECT v.lead_id, v.position, v.value_product_id, v.value_text, v.ref_name_snapshot
       FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'produtos'
       ORDER BY v.lead_id, v.position`,
    );
    expect(values).toEqual([
      { lead_id: L('205'), position: 0, value_product_id: L('020'), value_text: null, ref_name_snapshot: 'Produto X' },
      { lead_id: L('205'), position: 1, value_product_id: null, value_text: 'Item livre sem catálogo', ref_name_snapshot: 'Item livre sem catálogo' },
    ]);
    const [counts] = await rows<{ source: number }>(`SELECT count(*)::int source FROM sales_ops_lead_products`);
    expect(values).toHaveLength(counts!.source);
  });

  it('description and birth date become typed values; an empty description is preserved', async () => {
    const desc = await rows<{ lead_id: string; value_text: string }>(
      `SELECT v.lead_id, v.value_text FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'descricao' ORDER BY v.lead_id`,
    );
    expect(desc).toEqual([
      { lead_id: L('201'), value_text: 'desc conv' },
      { lead_id: L('204'), value_text: '' },
      { lead_id: L('301', 'd'), value_text: LONG_DESCRIPTION },
    ]);
    const birth = await rows<{ lead_id: string; value_date: string }>(
      `SELECT v.lead_id, v.value_date::text FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'nascimento'`,
    );
    expect(birth).toEqual([{ lead_id: L('202'), value_date: '1990-05-04' }]);
  });

  it('stage_changed_at becomes the first and only history event of each lead', async () => {
    const events = await rows<{ lead_id: string; kind: string; from_stage_id: string | null; to_stage_id: string; reason: string | null; actor_user_id: string; actor_name_snapshot: string; same_time: boolean }>(
      `SELECT e.lead_id, e.kind, e.from_stage_id, e.to_stage_id, e.reason, e.actor_user_id, e.actor_name_snapshot,
              e.occurred_at = l.stage_changed_at AS same_time
       FROM sales_ops_crm_lead_events e JOIN sales_ops_leads l ON l.id = e.lead_id ORDER BY e.lead_id`,
    );
    expect(events).toHaveLength(7);
    for (const event of events) {
      expect(event).toMatchObject({ kind: 'stage_changed', from_stage_id: null, actor_user_id: 'system', actor_name_snapshot: 'Migração', same_time: true });
    }
    expect(events.find((e) => e.lead_id === L('202'))).toMatchObject({ to_stage_id: L('104'), reason: 'Sem orçamento' });
  });

  it('leaves no orphan foreign key anywhere in the new tables', async () => {
    const fks = await rows<{ conrelid: string; conname: string; validated: boolean }>(
      `SELECT conrelid::regclass::text conrelid, conname, convalidated validated FROM pg_constraint
       WHERE contype = 'f' AND conrelid::regclass::text = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}])`,
    );
    expect(fks.length).toBe(20);
    expect(fks.filter((fk) => !fk.validated)).toEqual([]);
    const [orphans] = await rows<{ n: number }>(
      `SELECT ((SELECT count(*) FROM sales_ops_crm_lead_field_values v LEFT JOIN sales_ops_crm_leads l ON l.org_id = v.org_id AND l.id = v.lead_id WHERE l.id IS NULL)
             + (SELECT count(*) FROM sales_ops_crm_lead_events e LEFT JOIN sales_ops_crm_leads l ON l.org_id = e.org_id AND l.id = e.lead_id WHERE l.id IS NULL)
             + (SELECT count(*) FROM sales_ops_pipeline_transitions t LEFT JOIN sales_ops_pipeline_stages s ON s.org_id = t.org_id AND s.pipeline_id = t.pipeline_id AND s.id = t.from_stage_id WHERE s.id IS NULL))::int n`,
    );
    expect(orphans!.n).toBe(0);
  });

  it('RLS isolates orgs on every new table, for the owner role that FORCE RLS applies to', async () => {
    const client = scratchClient(scratch);
    for (const table of CRM_TABLES) {
      const counts = await client.begin(async (tx) => {
        const none = (await tx.unsafe(`SELECT count(*)::int n FROM ${table}`))[0]!.n as number;
        await tx.unsafe(`SELECT set_config('app.current_org_id', 'orgA', true)`);
        const a = (await tx.unsafe(`SELECT count(*)::int n FROM ${table} WHERE org_id <> 'orgA'`))[0]!.n as number;
        const own = (await tx.unsafe(`SELECT count(*)::int n FROM ${table}`))[0]!.n as number;
        return { none, a, own };
      });
      expect(counts.none, `${table} without a tenant`).toBe(0);
      expect(counts.a, `${table} foreign rows visible to orgA`).toBe(0);
      const total = (await fingerprint([table]))[table]!.n;
      if (total > 0) expect(counts.own, `${table} own rows`).toBeGreaterThan(0);
    }
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.current_org_id', 'orgB', true)`);
        await tx.unsafe(`UPDATE sales_ops_crm_leads SET contact_name = 'x' WHERE org_id = 'orgA'`).then((r) => {
          if (r.count !== 0) throw new Error(`orgB updated ${r.count} orgA rows`);
        });
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * The purge helper of the integration suite deletes the sale tree after its lead rows. A CRM
   * lead copy restrict-references the same sale, so the helper's sequence fails with 23503 unless
   * the CRM rows of the org are deleted first. Each attempt runs in a transaction that is rolled back.
   */
  async function purgeSequenceOutcome(org: string, withCrmDeletes: boolean): Promise<string | 'ok'> {
    const sales = ['sales_ops_lead_products', 'sales_ops_leads', 'sales_ops_payables', 'sales_ops_receivables', 'sales_ops_sale_professionals', 'sales_ops_sale_items', 'sales_ops_sales'];
    const crm = ['sales_ops_crm_lead_notes', 'sales_ops_crm_lead_followups', 'sales_ops_crm_lead_field_values', 'sales_ops_crm_lead_events', 'sales_ops_crm_leads'];
    try {
      await scratch.adminScratch.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL session_replication_role = replica`);
        await tx.unsafe(`DELETE FROM sales_ops_settlements WHERE org_id = '${org}'`);
        await tx.unsafe(`SET LOCAL session_replication_role = origin`);
        if (withCrmDeletes) for (const table of crm) await tx.unsafe(`DELETE FROM ${table} WHERE org_id = '${org}'`);
        for (const table of sales) await tx.unsafe(`DELETE FROM ${table} WHERE org_id = '${org}'`);
        throw new Error(PROBE_ROLLBACK);
      });
      return 'ok';
    } catch (error) {
      if (error instanceof Error && error.message === PROBE_ROLLBACK) return 'ok';
      return String((error as { code?: string }).code ?? error);
    }
  }

  it('the purge helper sequence fails with 23503 without the CRM deletes and succeeds with them', async () => {
    expect(await purgeSequenceOutcome('orgA', false)).toBe('23503');
    expect(await purgeSequenceOutcome('orgA', true)).toBe('ok');
  });

  it('running the backfill SQL a second time is a no-op for every destination and source table', async () => {
    const before = await fingerprint([...CRM_TABLES, ...sourceTables]);
    await scratchClient(scratch).begin(async (tx) => {
      for (const chunk of copyChunks()) await tx.unsafe(chunk);
    });
    expect(await fingerprint([...CRM_TABLES, ...sourceTables])).toEqual(before);
  });
});
