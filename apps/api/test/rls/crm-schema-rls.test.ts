/**
 * Migration 0029 oracle (vendas-crm-unificado slice 05a): FORCE RLS with the two org policies on
 * every new table, and the constraints that make an invalid CRM row unrepresentable. A scratch
 * database is migrated to the head and driven as the NOSUPERUSER owner role, so FORCE RLS applies.
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-schema-rls.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
  type SqlClient,
} from './scratch-database.js';

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

const A = 'org_crm_a';
const B = 'org_crm_b';

type Ids = { pipeline: string; stage1: string; stage2: string; lead: string; field: string; event: string };

describe('CRM schema 0029: RLS and constraints', () => {
  let scratch: ScratchDatabase;
  let client: SqlClient;
  const ids: Record<string, Ids> = {};

  /** Runs `work` in a transaction whose tenant is `org` (or admin when org is null). */
  async function as<T>(org: string | null, work: (tx: SqlClient) => Promise<T>): Promise<T> {
    return (await client.begin(async (tx) => {
      if (org === null) await tx.unsafe(`SELECT set_config('app.fxl_admin', 'true', true)`);
      else await tx.unsafe(`SELECT set_config('app.current_org_id', '${org}', true)`);
      return work(tx as unknown as SqlClient);
    })) as T;
  }

  async function seedOrg(org: string): Promise<Ids> {
    return as(org, async (tx) => {
      const one = async (q: string) => (await tx.unsafe(q))[0]!.id as string;
      const pipeline = await one(
        `INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default) VALUES ('${org}', 'Funil', 'crm-padrao', true) RETURNING id`,
      );
      const stage1 = await one(
        `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position) VALUES ('${org}', '${pipeline}', 'Novo', 1) RETURNING id`,
      );
      const stage2 = await one(
        `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position, type, exit_kind) VALUES ('${org}', '${pipeline}', 'Ganho', 2, 'saida', 'ganho') RETURNING id`,
      );
      await tx.unsafe(
        `INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${org}', '${pipeline}', '${stage1}', '${stage2}')`,
      );
      const field = await one(
        `INSERT INTO sales_ops_field_definitions (org_id, key, label, kind) VALUES ('${org}', 'obs', 'Obs', 'text') RETURNING id`,
      );
      const lead = await one(
        `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${org}', 'Fulano', '${pipeline}', '${stage1}') RETURNING id`,
      );
      await tx.unsafe(
        `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, value_text) VALUES ('${org}', '${lead}', '${field}', 'x')`,
      );
      const event = await one(
        `INSERT INTO sales_ops_crm_lead_events (org_id, lead_id, to_stage_id) VALUES ('${org}', '${lead}', '${stage1}') RETURNING id`,
      );
      await tx.unsafe(`INSERT INTO sales_ops_crm_lead_notes (org_id, lead_id, event_id, body) VALUES ('${org}', '${lead}', '${event}', 'nota')`);
      await tx.unsafe(`INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step, due_on) VALUES ('${org}', '${lead}', 'ligar', '2026-11-01')`);
      await tx.unsafe(`INSERT INTO sales_ops_org_modules (org_id, module_key, enabled) VALUES ('${org}', 'orcamentos', true)`);
      return { pipeline, stage1, stage2, lead, field, event };
    });
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
    client = scratchClient(scratch);
    ids[A] = await seedOrg(A);
    ids[B] = await seedOrg(B);
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('every new table has FORCE RLS and exactly the tenant_isolation and admin_context policies', async () => {
    const rows = await scratch.adminScratch.unsafe<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}])`,
    );
    expect(rows).toHaveLength(CRM_TABLES.length);
    for (const row of rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await scratch.adminScratch.unsafe<{ tablename: string; policyname: string }[]>(
      `SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}]) ORDER BY 1, 2`,
    );
    expect(policies.map((p) => p.policyname)).toEqual(
      [...CRM_TABLES].sort().flatMap((t) => [`${t}_admin_context`, `${t}_tenant_isolation`]),
    );
  });

  it.each(CRM_TABLES)('%s: a tenant sees only its own rows, no tenant sees nothing, admin sees both', async (table) => {
    const own = await as(A, (tx) => tx.unsafe(`SELECT org_id FROM ${table}`));
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((r) => r.org_id))).toEqual(new Set([A]));
    const nobody = await client.begin((tx) => tx.unsafe(`SELECT 1 FROM ${table}`));
    expect(nobody).toHaveLength(0);
    const all = await as(null, (tx) => tx.unsafe(`SELECT DISTINCT org_id FROM ${table}`));
    expect(new Set(all.map((r) => r.org_id))).toEqual(new Set([A, B]));
  });

  it.each(CRM_TABLES)('%s: a tenant cannot write another org rows (RLS USING)', async (table) => {
    const updated = await as(B, (tx) => tx.unsafe(`UPDATE ${table} SET org_id = org_id WHERE org_id = '${A}'`));
    expect(updated.count).toBe(0);
  });

  it('a tenant cannot insert a row for another org', async () => {
    await expect(
      as(B, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'intruso')`)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('composite FKs refuse a cross-org reference even over the admin connection', async () => {
    await expect(
      as(null, (tx) =>
        tx.unsafe(
          `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${B}', 'x', '${ids[A]!.pipeline}', '${ids[A]!.stage1}')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('a lead stage must belong to the lead pipeline', async () => {
    const other = await as(A, async (tx) => {
      const p = (await tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'Outro') RETURNING id`))[0]!.id as string;
      return p;
    });
    await expect(
      as(A, (tx) =>
        tx.unsafe(
          `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${A}', 'x', '${other}', '${ids[A]!.stage1}')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'sales_ops_crm_leads_org_stage_fk' });
  });

  it('a transition cannot cross pipelines nor loop on one stage', async () => {
    const other = await as(A, async (tx) => {
      const p = (await tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'Outro 2') RETURNING id`))[0]!.id as string;
      return (await tx.unsafe(`INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name) VALUES ('${A}', '${p}', 'Z') RETURNING id`))[0]!.id as string;
    });
    await expect(
      as(A, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${A}', '${ids[A]!.pipeline}', '${ids[A]!.stage1}', '${other}')`)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      as(A, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${A}', '${ids[A]!.pipeline}', '${ids[A]!.stage1}', '${ids[A]!.stage1}')`)),
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'sales_ops_pipeline_transitions_distinct_check' });
  });

  const bad: [string, string, string][] = [
    ['an exit stage needs an exit_kind', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type) VALUES ('A', 'P', 'S1', 'saida')`, 'sales_ops_pipeline_stages_exit_pair_check'],
    ['a normal stage cannot carry an exit_kind', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, exit_kind) VALUES ('A', 'P', 'S2', 'ganho')`, 'sales_ops_pipeline_stages_exit_pair_check'],
    ['only perdido requires a reason', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, exit_kind, requires_reason) VALUES ('A', 'P', 'S3', 'saida', 'ganho', true)`, 'sales_ops_pipeline_stages_reason_check'],
    ['stage type is a closed set', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type) VALUES ('A', 'P', 'S4', 'x')`, 'sales_ops_pipeline_stages_type_check'],
    ['a stage name is unique per pipeline', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name) VALUES ('A', 'P', 'Novo')`, 'sales_ops_pipeline_stages_org_pipeline_name_idx'],
    ['a second default pipeline is refused', `INSERT INTO sales_ops_pipelines (org_id, name, is_default) VALUES ('A', 'Outro default', true)`, 'sales_ops_pipelines_org_default_idx'],
    ['a system field must stay non-removable', `INSERT INTO sales_ops_field_definitions (org_id, key, label, removable, is_system) VALUES ('A', 'k1', 'K', false, false)`, 'sales_ops_field_definitions_removable_check'],
    ['a reference field needs a target', `INSERT INTO sales_ops_field_definitions (org_id, key, label, kind) VALUES ('A', 'k2', 'K', 'reference')`, 'sales_ops_field_definitions_reference_check'],
    ['a field key is unique per org', `INSERT INTO sales_ops_field_definitions (org_id, key, label) VALUES ('A', 'obs', 'Obs 2')`, 'sales_ops_field_definitions_org_key_idx'],
    ['a value row sets exactly one slot (none)', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position) VALUES ('A', 'L', 'F', 1)`, 'sales_ops_crm_lead_field_values_one_slot_check'],
    ['a value row sets exactly one slot (two)', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_text, value_cents) VALUES ('A', 'L', 'F', 2, 'a', 1)`, 'sales_ops_crm_lead_field_values_one_slot_check'],
    ['a value slot position is unique per lead and field', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, value_text) VALUES ('A', 'L', 'F', 'again')`, 'sales_ops_crm_lead_field_values_slot_idx'],
    ['estimated value cannot be negative', `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, estimated_value_brl) VALUES ('A', 'x', 'P', 'S', -1)`, 'sales_ops_crm_leads_estimated_value_check'],
    ['a half-deleted lead is refused', `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, deleted_at) VALUES ('A', 'x', 'P', 'S', now())`, 'sales_ops_crm_leads_deleted_pair_check'],
    ['a lead has exactly one initial entry event', `INSERT INTO sales_ops_crm_lead_events (org_id, lead_id, to_stage_id) VALUES ('A', 'L', 'S')`, 'sales_ops_crm_lead_events_first_entry_idx'],
    ['a note cannot be blank', `INSERT INTO sales_ops_crm_lead_notes (org_id, lead_id, body) VALUES ('A', 'L', '   ')`, 'sales_ops_crm_lead_notes_body_check'],
    ['a follow-up always has a date', `INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step) VALUES ('A', 'L', 'ligar')`, ''],
    ['a follow-up needs a next step', `INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step, due_on) VALUES ('A', 'L', ' ', '2026-11-01')`, 'sales_ops_crm_lead_followups_step_check'],
    ['a module key is unique per org', `INSERT INTO sales_ops_org_modules (org_id, module_key) VALUES ('A', 'orcamentos')`, 'sales_ops_org_modules_org_key_idx'],
  ];

  it.each(bad)('%s', async (_name, sql, constraint) => {
    const a = ids[A]!;
    const text = sql
      .replaceAll("'A'", `'${A}'`)
      .replaceAll("'P'", `'${a.pipeline}'`)
      .replaceAll("'S'", `'${a.stage1}'`)
      .replaceAll("'L'", `'${a.lead}'`)
      .replaceAll("'F'", `'${a.field}'`);
    const failure = await as(A, (tx) => tx.unsafe(text)).then(
      () => null,
      (error: unknown) => error as { code?: string; constraint_name?: string; column_name?: string },
    );
    expect(failure, text).not.toBeNull();
    if (constraint === '') expect(failure).toMatchObject({ code: '23502', column_name: 'due_on' });
    else expect(failure!.constraint_name).toBe(constraint);
  });

  it('the one-proposta-per-lead partial unique index is on (org_id, sale_id) where sale_id is not null', async () => {
    const [row] = await scratch.adminScratch.unsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'sales_ops_crm_leads_org_sale_idx'`,
    );
    expect(row!.indexdef).toMatch(/UNIQUE INDEX .* \(org_id, sale_id\) WHERE \(sale_id IS NOT NULL\)/);
  });
});
