/**
 * ensureDefaultPipeline / ensureCrmDefaults (vendas-crm-unificado slice 05b), against a scratch
 * database migrated to the head and driven as the NOSUPERUSER owner (FORCE RLS applies).
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-defaults.test.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  DEFAULT_PIPELINE_KEY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import { defaultStageBehavior, defaultStageRequiresReason } from '@fxl-sales/shared-utils/crm-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ensureCrmDefaults, ensureDefaultPipeline } from '../../src/domains/crm/defaults.js';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import { cleanupScratch, createScratchDatabase, MIGRATIONS_FOLDER, scratchClient, type ScratchDatabase } from './scratch-database.js';

describe('CRM defaults: ensureDefaultPipeline and the Cliente system field', () => {
  let scratch: ScratchDatabase;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  /** The tenant transaction every caller opens: set_config FIRST, then the service call. */
  async function inTenant<T>(org: string, work: (tx: never) => Promise<T>, delayMs = 0): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(`select set_config('app.current_org_id', '${org}', true)` as never);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return work(tx as never);
    });
  }

  async function adminRows<T extends object>(query: string): Promise<T[]> {
    return [...(await scratch.adminScratch.unsafe<T[]>(query))];
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
    client = scratchClient(scratch, 8);
    db = drizzle(client, { schema });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('seeds the default pipeline, its stages, its transitions and the Cliente field for an org with none', async () => {
    const result = await inTenant('org_def_1', (tx) => ensureCrmDefaults(tx, 'org_def_1'));
    expect(result.pipelines).toHaveLength(1);
    expect(result.pipelines[0]).toMatchObject({ name: DEFAULT_PIPELINE_NAME, systemKey: DEFAULT_PIPELINE_KEY, isDefault: true, status: 'active' });
    expect(result.fields.map((f) => [f.key, f.isSystem, f.removable, f.backingColumn])).toEqual([['cliente', true, false, 'client_id']]);

    const stages = await adminRows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason FROM sales_ops_pipeline_stages WHERE org_id = 'org_def_1' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason])).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => [s.label, s.order, s.type, defaultStageBehavior(s), s.exitKind, defaultStageRequiresReason(s)]),
    );
    const idByKey = new Map(DEFAULT_PIPELINE_STAGES.map((s, i) => [s.key as string, stages[i]!.id]));
    const transitions = await adminRows<{ from_stage_id: string; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'org_def_1'`,
    );
    expect(transitions).toHaveLength(DEFAULT_PIPELINE_TRANSITIONS.length);
    expect(new Set(transitions.map((t) => `${t.from_stage_id}>${t.to_stage_id}`))).toEqual(
      new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${idByKey.get(a)}>${idByKey.get(b)}`)),
    );
  });

  it('a second call changes nothing (same ids)', async () => {
    const first = await inTenant('org_def_2', (tx) => ensureCrmDefaults(tx, 'org_def_2'));
    const second = await inTenant('org_def_2', (tx) => ensureCrmDefaults(tx, 'org_def_2'));
    expect(second.pipelines.map((p) => p.id)).toEqual(first.pipelines.map((p) => p.id));
    expect(second.fields.map((f) => f.id)).toEqual(first.fields.map((f) => f.id));
    const [counts] = await adminRows<{ s: number; t: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_pipeline_stages WHERE org_id='org_def_2')::int s, (SELECT count(*) FROM sales_ops_pipeline_transitions WHERE org_id='org_def_2')::int t`,
    );
    expect(counts).toEqual({ s: 7, t: 22 });
  });

  it('three concurrent first callers never error and leave exactly one complete pipeline', async () => {
    const results = await Promise.all([1, 2, 3].map(() => inTenant('org_def_3', (tx) => ensureCrmDefaults(tx, 'org_def_3'), 40)));
    expect(new Set(results.map((r) => r.pipelines[0]!.id)).size).toBe(1);
    expect(results.every((r) => r.pipelines.length === 1 && r.fields.length === 1)).toBe(true);
    const [counts] = await adminRows<{ p: number; s: number; t: number; f: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_pipelines WHERE org_id='org_def_3')::int p, (SELECT count(*) FROM sales_ops_pipeline_stages WHERE org_id='org_def_3')::int s,
              (SELECT count(*) FROM sales_ops_pipeline_transitions WHERE org_id='org_def_3')::int t, (SELECT count(*) FROM sales_ops_field_definitions WHERE org_id='org_def_3')::int f`,
    );
    expect(counts).toEqual({ p: 1, s: 7, t: 22, f: 1 });
  });

  it('"has any pipeline" is the guard: a renamed or archived pipeline is never reinserted', async () => {
    await inTenant('org_def_4', (tx) => ensureDefaultPipeline(tx, 'org_def_4'));
    await scratch.adminScratch.unsafe(`UPDATE sales_ops_pipelines SET name = 'Vendas B2B', status = 'archived', archived_at = now() WHERE org_id = 'org_def_4'`);
    const again = await inTenant('org_def_4', (tx) => ensureDefaultPipeline(tx, 'org_def_4'));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ name: 'Vendas B2B', status: 'archived' });
  });

  it('the Cliente system field is re-created if it is ever missing, and never duplicated', async () => {
    await inTenant('org_def_5', (tx) => ensureCrmDefaults(tx, 'org_def_5'));
    await scratch.adminScratch.unsafe(`DELETE FROM sales_ops_field_definitions WHERE org_id = 'org_def_5'`);
    const result = await inTenant('org_def_5', (tx) => ensureCrmDefaults(tx, 'org_def_5'));
    expect(result.fields.map((f) => f.key)).toEqual(['cliente']);
  });

  it('is tenant-scoped: seeding one org leaves another untouched', async () => {
    const before = await adminRows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipelines WHERE org_id = 'org_def_untouched'`);
    await inTenant('org_def_6', (tx) => ensureCrmDefaults(tx, 'org_def_6'));
    const after = await adminRows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipelines WHERE org_id = 'org_def_untouched'`);
    expect(before).toEqual(after);
    expect(after[0]!.n).toBe(0);
  });
});
