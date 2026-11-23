import { describe, expect, it } from 'vitest';
import { planImport } from '../plan/index.js';
import { summarizeLeadStages } from '../plan/stage-map.js';
import type { PipelineMap } from '../pipeline-resolution.js';
import type { CellValue, ImportCatalog, ImportOperation, SheetKey, StageMap } from '../types.js';
import { IDS, pipelineRow, richCatalog, seededCatalog, stageRow, workbook } from './plan-fixtures.js';

type Row = Record<string, CellValue> & { row?: number };

const SECOND_STAGE_NOVO = '00000000-0000-4000-8000-0000000000e1';
const SECOND_STAGE_FECHADO = '00000000-0000-4000-8000-0000000000e2';
const SECOND_STAGE_LOST = '00000000-0000-4000-8000-0000000000e3';

/** Two funis: "Vendas" (the seeded one) and "Pós-venda", which has its own "Novo" etapa. */
function twoFunis(base: ImportCatalog = richCatalog()): ImportCatalog {
  return {
    ...base,
    pipelines: [
      pipelineRow(IDS.pipelineMain, 'Vendas', 0),
      pipelineRow(IDS.pipelineSecond, 'Pós-venda', 1),
    ],
    stages: [
      ...base.stages,
      stageRow(SECOND_STAGE_NOVO, 'Novo', 'normal', 1, { pipelineId: IDS.pipelineSecond }),
      stageRow(SECOND_STAGE_FECHADO, 'Fechado', 'normal', 2, { pipelineId: IDS.pipelineSecond }),
      stageRow(SECOND_STAGE_LOST, 'Perdido', 'lost', 3, { pipelineId: IDS.pipelineSecond }),
    ],
  };
}

const lead = (cells: Row): Row => ({
  contato: 'Carlos Lima',
  empresa: 'Empresa Nova',
  funil: null,
  valorEstimado: null,
  descricao: null,
  vendedor: null,
  produtos: null,
  etapa: null,
  motivoPerda: null,
  ...cells,
});

function plan(
  sheets: Partial<Record<SheetKey, Row[]>>,
  catalog: ImportCatalog,
  stageMap?: StageMap,
  pipelineMap?: PipelineMap,
) {
  return planImport(workbook(sheets), catalog, stageMap, pipelineMap);
}
const leadOps = (ops: ImportOperation[]) => ops.flatMap((o) => (o.op === 'createLead' ? [o] : []));
const stageOps = (ops: ImportOperation[]) => ops.flatMap((o) => (o.op === 'createLeadStage' ? [o] : []));
const errors = (r: { issues: Array<{ severity: string; code: string; sheet: string | null; column: string | null; row: number | null }> }) =>
  r.issues.filter((i) => i.severity === 'error');

describe('Funil of the Leads tab', () => {
  it('puts the same etapa name in each funil and carries the pipelineId on the operation', () => {
    const r = plan(
      {
        leads: [
          lead({ funil: 'Vendas', etapa: 'Novo' }),
          lead({ contato: 'B', funil: 'pós-venda', etapa: 'novo' }),
        ],
      },
      twoFunis(),
    );
    expect(r.issues).toEqual([]);
    expect(leadOps(r.operations).map((o) => [o.pipelineId, o.stageRef])).toEqual([
      [IDS.pipelineMain, { existingId: IDS.stageNovo }],
      [IDS.pipelineSecond, { existingId: SECOND_STAGE_NOVO }],
    ]);
  });

  it('refuses a blank Funil when there are several active funis, on the Funil column', () => {
    const r = plan({ leads: [lead({ etapa: 'Novo' })] }, twoFunis());
    expect(errors(r)).toEqual([
      expect.objectContaining({ code: 'funil_required', sheet: 'leads', column: 'Funil' }),
    ]);
    expect(leadOps(r.operations)).toEqual([]);
  });

  it('takes a blank Funil as the only active funil', () => {
    const r = plan({ leads: [lead({ etapa: 'Novo' })] }, richCatalog());
    expect(r.issues).toEqual([]);
    expect(leadOps(r.operations)[0]?.pipelineId).toBe(IDS.pipelineMain);
  });

  it('does not judge the etapa of a row whose Funil failed, but still checks the other columns', () => {
    const r = plan({ leads: [lead({ funil: 'Fantasma', etapa: 'Inexistente', vendedor: 'Nada', motivoPerda: 'x' })] }, twoFunis());
    expect(r.issues.map((i) => [i.code, i.column])).toEqual([
      ['unknown_ref', 'Funil'],
      ['unknown_ref', 'Vendedor'],
    ]);
  });

  it('reads an etapa that exists only in the other funil as unknown in this one', () => {
    const r = plan({ leads: [lead({ funil: 'Vendas', etapa: 'Fechado' })] }, twoFunis());
    expect(errors(r).map((i) => [i.code, i.column])).toEqual([['unknown_ref', 'Etapa']]);
    expect(r.issues[0]?.message).toContain('Vendas');
  });

  it('refuses an archived funil with archived_ref', () => {
    const catalog = twoFunis();
    catalog.pipelines[1] = pipelineRow(IDS.pipelineSecond, 'Pós-venda', 1, { status: 'archived' });
    const r = plan({ leads: [lead({ funil: 'Pós-venda' })] }, catalog);
    expect(errors(r).map((i) => i.code)).toEqual(['archived_ref']);
  });

  it('judges the reason rule and the conversion etapa inside the row funil', () => {
    const r = plan({ leads: [lead({ funil: 'Pós-venda', etapa: 'Perdido' })] }, twoFunis());
    expect(errors(r).map((i) => i.code)).toEqual(['lost_reason_required']);
  });

  it('compares possible_duplicate by the resolved funil: a blank cell and the only funil name are the same funil', () => {
    const one = plan(
      { leads: [lead({ funil: null }), lead({ funil: 'Funil principal', row: 3 })] },
      richCatalog(),
    );
    expect(one.issues.filter((i) => i.code === 'possible_duplicate')).toHaveLength(1);
    const apart = plan(
      { leads: [lead({ funil: 'Vendas' }), lead({ funil: 'Pós-venda', row: 3 })] },
      twoFunis(),
    );
    expect(apart.issues.filter((i) => i.code === 'possible_duplicate')).toEqual([]);
  });

  it('refuses a vendedor who does not reach the funil, and accepts one linked through a função', () => {
    const catalog = twoFunis();
    const person = catalog.people.find((p) => p.displayName === 'Ana Souza');
    expect(person).toBeDefined();
    const denied = plan({ leads: [lead({ funil: 'Pós-venda', vendedor: 'Ana Souza' })] }, catalog);
    expect(errors(denied).map((i) => [i.code, i.column])).toEqual([['seller_without_pipeline_access', 'Vendedor']]);
    const own = plan({ leads: [lead({ funil: 'Vendas', vendedor: 'Ana Souza' })] }, catalog);
    expect(own.issues).toEqual([]);
    catalog.pipelines[1] = pipelineRow(IDS.pipelineSecond, 'Pós-venda', 1, { funcaoIds: [IDS.funcaoVendedor] });
    const linked = plan({ leads: [lead({ funil: 'Pós-venda', vendedor: 'Ana Souza' })] }, catalog);
    expect(linked.issues).toEqual([]);
  });

  it('reports no_open_stage once per funil used, naming the funil, and counts an Etapas tab row as open', () => {
    const catalog = twoFunis();
    catalog.stages = catalog.stages.filter((s) => !(s.pipelineId === IDS.pipelineSecond && s.kind === 'normal'));
    const r = plan({ leads: [lead({ funil: 'Pós-venda' }), lead({ funil: 'Pós-venda', contato: 'B' })] }, catalog);
    const noOpen = r.issues.filter((i) => i.code === 'no_open_stage');
    expect(noOpen).toHaveLength(1);
    expect(noOpen[0]?.message).toContain('Pós-venda');
    const withTab = plan(
      { etapas: [{ nome: 'Diagnóstico', funil: 'Pós-venda' }], leads: [lead({ funil: 'Pós-venda' })] },
      catalog,
    );
    expect(withTab.issues.filter((i) => i.code === 'no_open_stage')).toEqual([]);
    const wrongFunil = plan(
      { etapas: [{ nome: 'Diagnóstico', funil: 'Vendas' }], leads: [lead({ funil: 'Pós-venda' })] },
      catalog,
    );
    expect(wrongFunil.issues.filter((i) => i.code === 'no_open_stage')).toHaveLength(1);
  });
});

describe('Funil of the Etapas tab', () => {
  it('creates the etapa in the named funil and judges duplicates per funil', () => {
    const r = plan(
      {
        etapas: [
          { nome: 'Fechado', funil: 'Vendas' },
          { nome: 'Novo', funil: 'Pós-venda' },
          { nome: 'Extra', funil: 'Vendas' },
          { nome: 'extra', funil: 'Pós-venda' },
        ],
      },
      twoFunis(),
    );
    expect(errors(r).map((i) => [i.code, i.row])).toEqual([['duplicate_existing', 3]]);
    expect(r.issues[0]?.message).toContain('Pós-venda');
    expect(stageOps(r.operations).map((o) => [o.input.name, o.pipelineId])).toEqual([
      ['Fechado', IDS.pipelineMain],
      ['Extra', IDS.pipelineMain],
      ['extra', IDS.pipelineSecond],
    ]);
  });

  it('refuses a repeated etapa only inside the same funil', () => {
    const r = plan(
      { etapas: [{ nome: 'X', funil: 'Vendas' }, { nome: 'x', funil: 'Vendas' }, { nome: 'X', funil: 'Pós-venda' }] },
      twoFunis(),
    );
    expect(errors(r).map((i) => [i.code, i.row])).toEqual([['duplicate_in_sheet', 3]]);
  });

  it('refuses a missing, unknown or archived Funil on the Funil column and creates nothing for it', () => {
    const r = plan({ etapas: [{ nome: 'X', funil: null }, { nome: 'Y', funil: 'Fantasma' }] }, twoFunis());
    expect(errors(r).map((i) => [i.code, i.column])).toEqual([
      ['funil_required', 'Funil'],
      ['unknown_ref', 'Funil'],
    ]);
    expect(stageOps(r.operations)).toEqual([]);
  });

  it('lets a Leads row target an etapa created by the Etapas tab in the same funil only', () => {
    const r = plan(
      {
        etapas: [{ nome: 'Diagnóstico', funil: 'Pós-venda' }],
        leads: [lead({ funil: 'Pós-venda', etapa: 'Diagnóstico' }), lead({ contato: 'B', funil: 'Vendas', etapa: 'Diagnóstico' })],
      },
      twoFunis(),
    );
    expect(errors(r).map((i) => [i.code, i.row])).toEqual([['unknown_ref', 3]]);
    expect(leadOps(r.operations)[0]?.stageRef).toEqual({ planKey: 'etapas:2' });
  });
});

describe('maps', () => {
  it('applies the top-level stage map only to a blank Funil and the funil stages to that funil', () => {
    const catalog = seededCatalog();
    const r = plan(
      { leads: [lead({ etapa: 'Contato' })] },
      catalog,
      { Contato: { stageId: IDS.stageNegociacao } },
    );
    expect(r.issues).toEqual([]);
    const both = twoFunis();
    const mapped = plan(
      { leads: [lead({ funil: 'Pós-venda', etapa: 'Contato' })] },
      both,
      { Contato: { stageId: IDS.stageNegociacao } },
      { 'Pós-venda': { stages: { Contato: { stageId: SECOND_STAGE_FECHADO } } } },
    );
    expect(mapped.issues).toEqual([]);
    expect(leadOps(mapped.operations)[0]?.stageRef).toEqual({ existingId: SECOND_STAGE_FECHADO });
  });

  it('refuses a stageId of another funil as invalid_stage_target', () => {
    const r = plan(
      { leads: [lead({ funil: 'Pós-venda', etapa: 'Contato' })] },
      twoFunis(),
      undefined,
      { 'Pós-venda': { stages: { Contato: { stageId: IDS.stageNegociacao } } } },
    );
    expect(errors(r).map((i) => i.code)).toEqual(['invalid_stage_target']);
  });

  it('maps an unknown sheet funil to a pipeline, and refuses an invalid target on the Funil column', () => {
    const ok = plan(
      { leads: [lead({ funil: 'Pos venda', etapa: 'Fechado' })] },
      twoFunis(),
      undefined,
      { 'Pos venda': { pipelineId: IDS.pipelineSecond } },
    );
    expect(ok.issues).toEqual([]);
    expect(leadOps(ok.operations)[0]?.pipelineId).toBe(IDS.pipelineSecond);
    const bad = plan(
      { leads: [lead({ funil: 'Pos venda' })] },
      twoFunis(),
      undefined,
      { 'Pos venda': { pipelineId: '11111111-1111-4111-8111-111111111111' } },
    );
    expect(errors(bad).map((i) => [i.code, i.column])).toEqual([['invalid_pipeline_target', 'Funil']]);
  });

  it('creates ONE etapa per (pipeline, name) even when two sheet funis map to the same pipeline', () => {
    const r = plan(
      {
        leads: [
          lead({ funil: 'A', etapa: 'Contato' }),
          lead({ contato: 'B', funil: 'B', etapa: 'contato' }),
          lead({ contato: 'C', funil: 'Vendas', etapa: 'Contato' }),
        ],
      },
      twoFunis(),
      undefined,
      {
        A: { pipelineId: IDS.pipelineSecond, stages: { Contato: { create: true } } },
        B: { pipelineId: IDS.pipelineSecond, stages: { Contato: { create: true } } },
        Vendas: { stages: { Contato: { create: true } } },
      },
    );
    expect(r.issues).toEqual([]);
    expect(stageOps(r.operations).map((o) => [o.planKey, o.pipelineId])).toEqual([
      ['stageMap:1', IDS.pipelineSecond],
      ['stageMap:2', IDS.pipelineMain],
    ]);
    expect(leadOps(r.operations).map((o) => o.stageRef)).toEqual([
      { planKey: 'stageMap:1' },
      { planKey: 'stageMap:1' },
      { planKey: 'stageMap:2' },
    ]);
  });

  it('never duplicates an Etapas tab row of the same funil with a create entry', () => {
    const r = plan(
      { etapas: [{ nome: 'Contato', funil: 'Pós-venda' }], leads: [lead({ funil: 'Pós-venda', etapa: 'Contato' })] },
      twoFunis(),
      undefined,
      { 'Pós-venda': { stages: { Contato: { create: true } } } },
    );
    expect(r.issues).toEqual([]);
    expect(stageOps(r.operations)).toHaveLength(1);
    expect(leadOps(r.operations)[0]?.stageRef).toEqual({ planKey: 'etapas:2' });
  });
});

describe('summarizeLeadStages with funis', () => {
  const parsed = workbook({
    leads: [
      lead({ funil: 'Vendas', etapa: 'Novo' }),
      lead({ funil: 'vendas', etapa: 'novo' }),
      lead({ funil: 'Pós-venda', etapa: 'Novo' }),
      lead({ funil: 'Pos venda', etapa: 'Fechado' }),
      lead({ funil: 'Fantasma', etapa: 'Novo' }),
      lead({ funil: 'Pós-venda', etapa: 'Contato' }),
    ],
    etapas: [{ nome: 'X', funil: 'Antigo' }, { nome: 'Y', funil: 'Vendas' }],
  });

  it('lists one entry per (funil, etapa), skips funis that do not resolve and lists the funil names without the map', () => {
    const catalog = twoFunis();
    catalog.pipelines.push(pipelineRow('00000000-0000-4000-8000-0000000000c9', 'Antigo', 2, { status: 'archived' }));
    const step = summarizeLeadStages(parsed, catalog);
    expect(step.leadStages).toEqual([
      { name: 'Novo', leads: 2, funil: 'Vendas', resolution: { kind: 'existing', stageId: IDS.stageNovo } },
      { name: 'Novo', leads: 1, funil: 'Pós-venda', resolution: { kind: 'existing', stageId: SECOND_STAGE_NOVO } },
      { name: 'Contato', leads: 1, funil: 'Pós-venda', resolution: { kind: 'not_found' } },
    ]);
    expect(step.leadPipelines).toEqual([
      { name: 'Vendas', leads: 2, resolution: { kind: 'existing', pipelineId: IDS.pipelineMain } },
      { name: 'Pós-venda', leads: 2, resolution: { kind: 'existing', pipelineId: IDS.pipelineSecond } },
      { name: 'Pos venda', leads: 1, resolution: { kind: 'not_found' } },
      { name: 'Fantasma', leads: 1, resolution: { kind: 'not_found' } },
      { name: 'Antigo', leads: 0, resolution: { kind: 'not_found' } },
    ]);
    expect(step.pipelineTargets).toEqual([
      { id: IDS.pipelineMain, name: 'Vendas', isDefault: true },
      { id: IDS.pipelineSecond, name: 'Pós-venda', isDefault: false },
    ]);
    expect(step.stageTargets.map((t) => [t.id, t.pipelineId])).toEqual([
      [IDS.stageNovo, IDS.pipelineMain],
      [IDS.stageNegociacao, IDS.pipelineMain],
      [IDS.stagePerdido, IDS.pipelineMain],
      [SECOND_STAGE_NOVO, IDS.pipelineSecond],
      [SECOND_STAGE_FECHADO, IDS.pipelineSecond],
      [SECOND_STAGE_LOST, IDS.pipelineSecond],
    ]);
  });

  it('applies the pipelineMap target when resolving the etapas', () => {
    const step = summarizeLeadStages(parsed, twoFunis(), { Fantasma: { pipelineId: IDS.pipelineSecond } });
    expect(step.leadStages).toContainEqual({
      name: 'Novo',
      leads: 1,
      funil: 'Fantasma',
      resolution: { kind: 'existing', stageId: SECOND_STAGE_NOVO },
    });
    expect(step.leadPipelines.find((p) => p.name === 'Fantasma')?.resolution).toEqual({ kind: 'not_found' });
  });
});
