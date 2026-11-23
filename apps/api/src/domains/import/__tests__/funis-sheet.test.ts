import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_ACCESS_NOTE,
  DEFAULT_FUNIL_ACCESS_NOTE,
  FUNIS_SHEET_HEADERS,
  buildEtapaPairs,
  buildFunisRows,
  etapaDependentFormula,
  writeFunisSheet,
} from '../funis-sheet.js';
import { IDS, pipelineRow, seededCatalog, stageRow } from './plan-fixtures.js';
import type { ImportCatalog } from '../types.js';

const SECOND = IDS.pipelineSecond;
const THIRD = '00000000-0000-4000-8000-0000000000c3';

function twoFunis(): ImportCatalog {
  const base = seededCatalog();
  return {
    ...base,
    funcoes: [
      ...base.funcoes,
      { id: IDS.funcaoDev, name: 'Desenvolvedor', slug: 'dev', isSystem: false, status: 'active' },
      { id: IDS.funcaoArchived, name: 'Antiga', slug: 'antiga', isSystem: false, status: 'archived' },
    ],
    pipelines: [
      pipelineRow(IDS.pipelineMain, 'Funil principal', 0),
      pipelineRow(SECOND, 'Parceiros *', 1, { funcaoIds: [IDS.funcaoDev, IDS.funcaoArchived] }),
      pipelineRow(THIRD, 'Indicações', 2),
      pipelineRow('00000000-0000-4000-8000-0000000000d4', 'Velho', 3, { status: 'archived' }),
    ],
    stages: [
      ...base.stages,
      stageRow('00000000-0000-4000-8000-0000000000e1', 'Novo', 'normal', 1, { pipelineId: SECOND }),
      stageRow('00000000-0000-4000-8000-0000000000e2', 'Ganho', 'normal', 2, {
        pipelineId: SECOND,
        type: 'saida',
        exitKind: 'ganho',
      }),
      stageRow('00000000-0000-4000-8000-0000000000e3', 'Pausa', 'normal', 3, {
        pipelineId: SECOND,
        type: 'saida',
        exitKind: 'pausado',
      }),
      stageRow('00000000-0000-4000-8000-0000000000e4', 'Arquivada', 'normal', 4, { pipelineId: SECOND, status: 'archived' }),
      stageRow('00000000-0000-4000-8000-0000000000e5', 'Orçamento', 'normal', 5, { pipelineId: THIRD, type: 'orcamento' }),
    ],
  };
}

describe('buildFunisRows', () => {
  it('writes one row per active etapa of each active funil in board order, the funil on every row', () => {
    const rows = buildFunisRows(twoFunis());
    expect(rows.map((r) => `${r.funil}|${r.etapa}`)).toEqual([
      'Funil principal|Novo',
      'Funil principal|Em negociação',
      'Funil principal|Proposta',
      'Funil principal|Perdido',
      'Parceiros *|Novo',
      'Parceiros *|Ganho',
      'Parceiros *|Pausa',
      'Indicações|Orçamento',
    ]);
  });

  it('maps the tipo and the two flags from kind, type and exit', () => {
    const rows = buildFunisRows(twoFunis());
    const by = (funil: string, etapa: string) => {
      const row = rows.find((r) => r.funil === funil && r.etapa === etapa);
      if (row === undefined) throw new Error('row missing');
      return row;
    };
    expect(by('Funil principal', 'Novo')).toMatchObject({ tipo: 'Em andamento', aceitaLead: 'Sim', exigeMotivo: 'Não' });
    expect(by('Funil principal', 'Proposta')).toMatchObject({ tipo: 'Proposta', aceitaLead: 'Não', exigeMotivo: 'Não' });
    expect(by('Funil principal', 'Perdido')).toMatchObject({ tipo: 'Saída: Perdido', aceitaLead: 'Sim', exigeMotivo: 'Sim' });
    expect(by('Parceiros *', 'Ganho')).toMatchObject({ tipo: 'Saída: Ganho', aceitaLead: 'Sim', exigeMotivo: 'Não' });
    expect(by('Parceiros *', 'Pausa').tipo).toBe('Saída: Pausado');
    // orcamentos module off: type orcamento, kind normal.
    expect(by('Indicações', 'Orçamento')).toMatchObject({ tipo: 'Em andamento', aceitaLead: 'Sim' });
  });

  it('describes who has access, naming archived funções and the default fallback', () => {
    const rows = buildFunisRows(twoFunis());
    const access = (funil: string) => rows.find((r) => r.funil === funil)?.funcoes;
    expect(access('Funil principal')).toBe(DEFAULT_FUNIL_ACCESS_NOTE);
    expect(access('Parceiros *')).toBe('Desenvolvedor; Antiga (arquivada)');
    expect(access('Indicações')).toBe(ADMIN_ONLY_ACCESS_NOTE);
    const withLinked = twoFunis();
    withLinked.pipelines[0] = pipelineRow(IDS.pipelineMain, 'Funil principal', 0, { funcaoIds: [IDS.funcaoDev] });
    expect(buildFunisRows(withLinked)[0]?.funcoes).toBe(`Desenvolvedor; ${DEFAULT_FUNIL_ACCESS_NOTE}`);
  });

  it('is empty for a catalog with no active funil', () => {
    expect(buildFunisRows({ ...seededCatalog(), pipelines: [], stages: [] })).toEqual([]);
  });
});

describe('buildEtapaPairs', () => {
  it('lists the importable active etapas contiguously per funil, the conversion etapa left out', () => {
    expect(buildEtapaPairs(twoFunis())).toEqual({
      funis: ['Funil principal', 'Funil principal', 'Funil principal', 'Parceiros *', 'Parceiros *', 'Parceiros *', 'Indicações'],
      etapas: ['Novo', 'Em negociação', 'Perdido', 'Novo', 'Ganho', 'Pausa', 'Orçamento'],
    });
  });
});

describe('etapaDependentFormula', () => {
  const formula = etapaDependentFormula('$G2', "'Listas'!$J$2:$J$8", "'Listas'!$K$2");

  it('is the exact OFFSET list formula, never COUNTIF and never a bare MATCH', () => {
    expect(formula).toBe(
      "OFFSET('Listas'!$K$2,MATCH(1,INDEX(--('Listas'!$J$2:$J$8=$G2),0),0)-1,0,SUMPRODUCT(--('Listas'!$J$2:$J$8=$G2)),1)",
    );
    expect(formula).not.toContain('COUNTIF');
    expect(formula.length).toBeLessThan(255);
  });
});

describe('writeFunisSheet', () => {
  it('writes header, rows, freeze, filter, widths and the top border where the funil changes', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Funis e etapas');
    writeFunisSheet(ws, buildFunisRows(twoFunis()));
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await wb.xlsx.writeBuffer()) as ExcelJS.Buffer);
    const out = back.getWorksheet('Funis e etapas');
    if (out === undefined) throw new Error('tab missing');
    FUNIS_SHEET_HEADERS.forEach((h, i) => {
      expect(out.getCell(1, i + 1).value).toBe(h);
      expect(out.getCell(1, i + 1).font?.bold).toBe(true);
    });
    expect(out.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(out.autoFilter).toBeTruthy();
    expect([1, 2, 3, 4, 5, 6].map((c) => out.getColumn(c).width)).toEqual([28, 28, 18, 26, 26, 48]);
    expect(out.rowCount).toBe(9);
    expect(out.getCell(6, 1).value).toBe('Parceiros *');
    expect(out.getCell(6, 1).border?.top?.style).toBe('thin');
    expect(out.getCell(5, 1).border?.top).toBeUndefined();
    expect(out.model.merges ?? []).toEqual([]);
  });
});
