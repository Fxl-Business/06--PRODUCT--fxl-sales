/**
 * Migration oracle for 0033: every active Ganho and Perdido exit gets an edge to every active open
 * etapa of its pipeline, in every existing pipeline of every organization.
 *
 * A scratch database is migrated through 0032 and seeded with SYNTHETIC pipelines whose graph an org
 * already shaped (one Ganho edge on purpose, an org-created normal etapa, archived etapas, a second
 * pipeline and a second org), then migrated to the head. No real data is read.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-exit-reopen-migration.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { planPipelineTransitions, type TransitionPlanStage } from '@fxl-sales/shared-utils/crm-model';
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
const TAG_0032 = '0032_lead_delete_batch';
const FILE_0033 = '0033_crm_exit_reopen_transitions.sql';

const id = (n: string) => `e0000000-0000-4000-8000-000000000${n}`;
const PA = id('001');
const PB = id('002');
const PC = id('003');
const S = {
  novo: id('101'),
  negociacao: id('102'),
  proposta: id('103'),
  ganho: id('104'),
  perdido: id('105'),
  pausado: id('106'),
  faturada: id('107'),
  antiga: id('108'),
  ganhoAntigo: id('109'),
  carteira: id('201'),
  ganhoB: id('202'),
  perdidoB: id('203'),
  entradaC: id('301'),
  perdidoC: id('302'),
} as const;

const SEED_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
INSERT INTO sales_ops_pipelines (id, org_id, name, system_key, position, is_default) VALUES
 ('${PA}', 'orgA', 'Funil CRM padrão', 'crm-padrao', 0, true),
 ('${PB}', 'orgA', 'Carteira', NULL, 1, false),
 ('${PC}', 'orgB', 'Funil CRM padrão', 'crm-padrao', 0, true);
INSERT INTO sales_ops_pipeline_stages (id, org_id, pipeline_id, name, position, type, behavior, exit_kind, requires_reason, status, archived_at) VALUES
 ('${S.novo}', 'orgA', '${PA}', 'Novo', 1, 'normal', 'none', NULL, false, 'active', NULL),
 ('${S.negociacao}', 'orgA', '${PA}', 'Em negociação', 2, 'normal', 'none', NULL, false, 'active', NULL),
 ('${S.proposta}', 'orgA', '${PA}', 'Proposta', 3, 'orcamento', 'opens_orcamentos', NULL, false, 'active', NULL),
 ('${S.ganho}', 'orgA', '${PA}', 'Ganho', 4, 'saida', 'none', 'ganho', false, 'active', NULL),
 ('${S.perdido}', 'orgA', '${PA}', 'Perdido', 5, 'saida', 'none', 'perdido', true, 'active', NULL),
 ('${S.pausado}', 'orgA', '${PA}', 'Pausado', 6, 'saida', 'none', 'pausado', false, 'active', NULL),
 ('${S.faturada}', 'orgA', '${PA}', 'Venda faturada', 7, 'normal', 'none', NULL, false, 'active', NULL),
 ('${S.antiga}', 'orgA', '${PA}', 'Antiga', 8, 'normal', 'none', NULL, false, 'archived', now()),
 ('${S.ganhoAntigo}', 'orgA', '${PA}', 'Ganho antigo', 9, 'saida', 'none', 'ganho', false, 'archived', now()),
 ('${S.carteira}', 'orgA', '${PB}', 'Carteira', 1, 'normal', 'none', NULL, false, 'active', NULL),
 ('${S.ganhoB}', 'orgA', '${PB}', 'Ganho', 2, 'saida', 'none', 'ganho', false, 'active', NULL),
 ('${S.perdidoB}', 'orgA', '${PB}', 'Perdido', 3, 'saida', 'none', 'perdido', true, 'active', NULL),
 ('${S.entradaC}', 'orgB', '${PC}', 'Entrada', 1, 'normal', 'none', NULL, false, 'active', NULL),
 ('${S.perdidoC}', 'orgB', '${PC}', 'Perdido', 2, 'saida', 'none', 'perdido', true, 'active', NULL);
-- The graph orgA shaped: a partial chain, the pausado return, and ONE Ganho edge it already granted.
INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id, created_at) VALUES
 ('orgA', '${PA}', '${S.novo}', '${S.negociacao}', '2026-01-01T00:00:00Z'),
 ('orgA', '${PA}', '${S.novo}', '${S.ganho}', '2026-01-01T00:00:00Z'),
 ('orgA', '${PA}', '${S.novo}', '${S.perdido}', '2026-01-01T00:00:00Z'),
 ('orgA', '${PA}', '${S.pausado}', '${S.novo}', '2026-01-01T00:00:00Z'),
 ('orgA', '${PA}', '${S.ganho}', '${S.novo}', '2026-01-01T00:00:00Z');
`;

type Edge = { id: string; org_id: string; pipeline_id: string; from_stage_id: string; to_stage_id: string; created_at: string };
const key = (e: Pick<Edge, 'from_stage_id' | 'to_stage_id'>) => `${e.from_stage_id}>${e.to_stage_id}`;

describe('migration 0033 (exits Ganho and Perdido reopen into every open etapa)', () => {
  let scratch: ScratchDatabase;
  let before: Edge[];

  const rows = async <T extends object>(query: string): Promise<T[]> => [...(await scratch.adminScratch.unsafe<T[]>(query))];
  const edges = () =>
    rows<Edge>(`SELECT id, org_id, pipeline_id, from_stage_id, to_stage_id, created_at::text AS created_at FROM sales_ops_pipeline_transitions ORDER BY id`);
  const source = () => fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0033), 'utf8');
  const rerun0033 = async () => {
    for (const chunk of source().split(BREAKPOINT).map((c) => c.trim()).filter(Boolean)) await scratch.adminScratch.unsafe(chunk);
  };

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: TAG_0032 });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(SEED_SQL);
    });
    before = await edges();
    expect(before).toHaveLength(5);
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('is additive only: one INSERT into the transitions with ON CONFLICT DO NOTHING, no UPDATE and no DELETE', () => {
    const sql = source();
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    const chunks = sql.split(BREAKPOINT).map((c) => c.trim()).filter(Boolean);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatch(/^INSERT INTO "sales_ops_pipeline_transitions"/);
    expect(chunks[1]).toMatch(/ON CONFLICT DO NOTHING;$/);
  });

  it('keeps every existing pair byte for byte (same id, same created_at)', async () => {
    const after = new Map((await edges()).map((e) => [e.id, e]));
    for (const edge of before) expect(after.get(edge.id), key(edge)).toEqual(edge);
  });

  it('adds exactly the missing pairs from each active Ganho and Perdido to each active open etapa of the same pipeline', async () => {
    const beforeKeys = new Set(before.map(key));
    const added = (await edges()).filter((e) => !beforeKeys.has(key(e)));
    const expected = [
      // orgA default pipeline: open = Novo, Em negociação, Proposta, Venda faturada; Ganho > Novo already existed.
      ...[S.negociacao, S.proposta, S.faturada].map((to) => `${S.ganho}>${to}`),
      ...[S.novo, S.negociacao, S.proposta, S.faturada].map((to) => `${S.perdido}>${to}`),
      // orgA second pipeline.
      `${S.ganhoB}>${S.carteira}`,
      `${S.perdidoB}>${S.carteira}`,
      // orgB.
      `${S.perdidoC}>${S.entradaC}`,
    ];
    expect(added.map(key).sort()).toEqual(expected.sort());
    const pipelineOf = new Map<string, [string, string]>([
      [S.ganho, ['orgA', PA]],
      [S.perdido, ['orgA', PA]],
      [S.ganhoB, ['orgA', PB]],
      [S.perdidoB, ['orgA', PB]],
      [S.perdidoC, ['orgB', PC]],
    ]);
    for (const edge of added) expect([edge.org_id, edge.pipeline_id], key(edge)).toEqual(pipelineOf.get(edge.from_stage_id));
  });

  it('never links an exit to an exit, an archived etapa, or the pausado exit beyond what it had', async () => {
    const after = await edges();
    const exits = new Set<string>([S.ganho, S.perdido, S.pausado, S.ganhoAntigo, S.ganhoB, S.perdidoB, S.perdidoC]);
    expect(after.filter((e) => exits.has(e.from_stage_id) && exits.has(e.to_stage_id))).toEqual([]);
    const archived = new Set<string>([S.antiga, S.ganhoAntigo]);
    expect(after.filter((e) => archived.has(e.from_stage_id) || archived.has(e.to_stage_id))).toEqual([]);
    expect(after.filter((e) => e.from_stage_id === S.pausado).map(key)).toEqual([`${S.pausado}>${S.novo}`]);
  });

  it('agrees with the shared rule: the exit edges of Ganho and Perdido equal planPipelineTransitions', async () => {
    const after = new Set((await edges()).map(key));
    for (const pipelineId of [PA, PB, PC]) {
      const stages = await rows<{ id: string; name: string; position: number; type: TransitionPlanStage['type']; exit_kind: TransitionPlanStage['exitKind']; status: TransitionPlanStage['status'] }>(
        `SELECT id, name, position, type, exit_kind, status FROM sales_ops_pipeline_stages WHERE pipeline_id = '${pipelineId}'`,
      );
      const plan = stages.map((s) => ({ id: s.id, name: s.name, position: s.position, type: s.type, exitKind: s.exit_kind, status: s.status }));
      const reopen = new Set(plan.filter((s) => s.exitKind === 'ganho' || s.exitKind === 'perdido').map((s) => s.id));
      const planned = planPipelineTransitions(plan).filter(([from]) => reopen.has(from));
      expect(planned.length, pipelineId).toBeGreaterThan(0);
      for (const [from, to] of planned) expect(after.has(`${from}>${to}`), `${from}>${to}`).toBe(true);
    }
  });

  it('is idempotent: a second run writes nothing', async () => {
    const snapshot = await edges();
    await rerun0033();
    expect(await edges()).toEqual(snapshot);
  });
});
