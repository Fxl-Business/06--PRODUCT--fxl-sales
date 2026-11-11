import { describe, expect, it } from 'vitest';
import { planImport } from '../plan/index.js';
import { StageMapSchema, summarizeLeadStages } from '../plan/stage-map.js';
import type { CellValue, ImportOperation, SheetKey, StageMap } from '../types.js';
import { IDS, richCatalog, workbook } from './plan-fixtures.js';

type Row = Record<string, CellValue> & { row?: number };

const lead = (cells: Row): Row => ({
  contato: 'Carlos Lima',
  empresa: 'Empresa Nova',
  valorEstimado: null,
  descricao: null,
  vendedor: null,
  produtos: null,
  etapa: null,
  motivoPerda: null,
  ...cells,
});

function plan(sheets: Partial<Record<SheetKey, Row[]>>, stageMap?: StageMap) {
  return planImport(workbook(sheets), richCatalog(), stageMap);
}
const leadOps = (ops: ImportOperation[]) => ops.flatMap((o) => (o.op === 'createLead' ? [o] : []));
const stageOps = (ops: ImportOperation[]) => ops.flatMap((o) => (o.op === 'createLeadStage' ? [o] : []));
const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);

describe('planImport with a stageMap', () => {
  it('without a map keeps today\'s refusal of an unknown etapa', () => {
    const r = plan({ leads: [lead({ etapa: 'Contato' })] });
    expect(codes(r)).toEqual(['unknown_ref']);
    expect(leadOps(r.operations)).toEqual([]);
  });

  it('sends a row to the etapa chosen for its sheet name', () => {
    const r = plan({ leads: [lead({ etapa: 'Contato' }), lead({ contato: 'Outro', etapa: ' contato ' })] }, {
      Contato: { stageId: IDS.stageNegociacao },
    });
    expect(r.issues).toEqual([]);
    expect(leadOps(r.operations).map((o) => o.stageRef)).toEqual([
      { existingId: IDS.stageNegociacao },
      { existingId: IDS.stageNegociacao },
    ]);
  });

  it.each([
    ['an unknown id', '00000000-0000-4000-8000-000000000000'],
    ['an archived etapa', IDS.stageArchived],
    ['the conversion etapa', IDS.stageProposta],
  ])('refuses %s as a row error and plans nothing for the row', (_label, stageId) => {
    const r = plan({ leads: [lead({ etapa: 'Contato' })] }, { Contato: { stageId } });
    expect(codes(r)).toEqual(['invalid_stage_target']);
    expect(r.issues[0]).toMatchObject({ severity: 'error', sheet: 'leads', column: 'Etapa' });
    expect(leadOps(r.operations)).toEqual([]);
  });

  it('keeps the lost reason rule on the chosen etapa', () => {
    const map: StageMap = { Contato: { stageId: IDS.stagePerdido } };
    expect(codes(plan({ leads: [lead({ etapa: 'Contato' })] }, map))).toEqual(['lost_reason_required']);
    const ok = plan({ leads: [lead({ etapa: 'Contato', motivoPerda: 'Sem orçamento' })] }, map);
    expect(ok.issues).toEqual([]);
    expect(leadOps(ok.operations)[0]?.lostReason).toBe('Sem orçamento');
  });

  it('{first: true} plans the same lead as a blank Etapa', () => {
    const mapped = plan({ leads: [lead({ etapa: 'Contato' })] }, { Contato: { first: true } });
    const blank = plan({ leads: [lead({ etapa: null })] });
    expect(mapped.issues).toEqual([]);
    expect(leadOps(mapped.operations)).toEqual(leadOps(blank.operations));
  });

  it('{create: true} creates the etapa once through the Etapas rule and points the leads at it', () => {
    const r = plan(
      { leads: [lead({ etapa: 'Contato' }), lead({ contato: 'Outro', etapa: 'contato' })] },
      { Contato: { create: true } },
    );
    expect(r.issues).toEqual([]);
    expect(stageOps(r.operations)).toHaveLength(1);
    const created = stageOps(r.operations)[0];
    expect(created?.input).toMatchObject({ name: 'Contato', status: 'active' });
    expect(leadOps(r.operations).map((o) => o.stageRef)).toEqual([
      { planKey: created?.planKey },
      { planKey: created?.planKey },
    ]);
    expect(r.counts).toEqual({ leads: 2, etapas: 1 });
    expect(r.operations.indexOf(created as ImportOperation)).toBeLessThan(
      r.operations.findIndex((o) => o.op === 'createLead'),
    );
  });

  it('{create: true} keeps the duplicate rules of the Etapas tab', () => {
    const r = plan({ leads: [lead({ etapa: 'Novo' })] }, { Novo: { create: true } });
    expect(codes(r)).toEqual(['duplicate_existing']);
    const archived = plan({ leads: [lead({ etapa: 'Etapa antiga' })] }, { 'Etapa antiga': { create: true } });
    expect(codes(archived)).toEqual(['duplicate_archived']);
  });

  it('{create: true} reuses the etapa the Etapas tab already creates', () => {
    const r = plan(
      { etapas: [{ nome: 'Contato' }], leads: [lead({ etapa: 'Contato' })] },
      { Contato: { create: true } },
    );
    expect(r.issues).toEqual([]);
    expect(stageOps(r.operations)).toHaveLength(1);
    expect(leadOps(r.operations)[0]?.stageRef).toEqual({ planKey: 'etapas:2' });
  });
});

describe('StageMapSchema', () => {
  it('accepts the three shapes and refuses anything else', () => {
    expect(
      StageMapSchema.safeParse({ A: { stageId: IDS.stageNovo }, B: { create: true }, C: { first: true } }).success,
    ).toBe(true);
    for (const bad of [{ A: {} }, { A: { create: false } }, { A: { first: true, stageId: 'x' } }, { A: 'x' }]) {
      expect(StageMapSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('summarizeLeadStages', () => {
  it('lists distinct names with counts, resolution and the chosen destinations', () => {
    const parsed = workbook({
      leads: [
        lead({ etapa: 'Novo' }),
        lead({ etapa: 'novo' }),
        lead({ etapa: 'Contato' }),
        lead({ etapa: 'Proposta' }),
        lead({ etapa: null }),
      ],
    });
    const step = summarizeLeadStages(parsed, richCatalog());
    expect(step.leadStages).toEqual([
      { name: 'Novo', leads: 2, resolution: { kind: 'existing', stageId: IDS.stageNovo } },
      { name: 'Contato', leads: 1, resolution: { kind: 'not_found' } },
      { name: 'Proposta', leads: 1, resolution: { kind: 'conversion' } },
    ]);
    expect(step.stageTargets.map((t) => t.id)).toEqual([IDS.stageNovo, IDS.stageNegociacao, IDS.stagePerdido]);
  });
});
