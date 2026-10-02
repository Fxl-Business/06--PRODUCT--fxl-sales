import { describe, expect, it } from 'vitest';
import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { coercePctList, coerceCell, normalizeLabel, rawCell } from '../cells.js';
import { buildExampleDataset, shiftCivilDay } from '../template.js';
import { SHEET_KEYS, getSheetDef } from '../workbook-schema.js';
import { LEAD_STAGE_SEEDS } from '../../sales-ops/leads/stages-seed.js';
import type { CellValue, SheetKey } from '../types.js';

const TODAYS = ['2026-10-02', '2027-01-05', '2028-03-01'];
const TODAY = TODAYS[0] as string;

function rowsOf(key: SheetKey, today = TODAY) {
  return buildExampleDataset(today)[key];
}
function str(v: CellValue | undefined): string | null {
  return typeof v === 'string' ? v : null;
}
function names(key: SheetKey, col: string): Set<string> {
  return new Set(rowsOf(key).map((r) => normalizeLabel(str(r[col]) ?? '')));
}
function num(v: CellValue | undefined): number {
  if (typeof v !== 'number') throw new Error('expected number');
  return v;
}

describe('example dataset', () => {
  it('shifts civil days across month, year and leap boundaries', () => {
    expect(shiftCivilDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftCivilDay('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftCivilDay('2027-01-05', -10)).toBe('2026-12-26');
    expect(shiftCivilDay('2026-01-31', 1)).toBe('2026-02-01');
    expect(() => shiftCivilDay('15/01/2026', 1)).toThrow(RangeError);
  });

  it('row 1 of every sheet is the schema example row', () => {
    for (const key of SHEET_KEYS) {
      const def = getSheetDef(key);
      const expected = Object.fromEntries(
        def.columns.map((c) => {
          if (c.example === null) return [c.key, null];
          const res = coerceCell(c.kind, rawCell(c.example));
          if (!res.ok) throw new Error('example does not coerce');
          return [c.key, res.value];
        }),
      );
      expect(rowsOf(key)[0]).toEqual(expected);
    }
  });

  it("every row carries exactly its sheet's column keys", () => {
    for (const key of SHEET_KEYS) {
      const keys = getSheetDef(key).columns.map((c) => c.key).sort();
      for (const row of rowsOf(key)) expect(Object.keys(row).sort()).toEqual(keys);
    }
  });

  it('exercises every sheet, both depths and every outcome', () => {
    for (const key of SHEET_KEYS) expect(rowsOf(key).length).toBeGreaterThan(0);
    const propostas = rowsOf('propostas');
    const situacoes = propostas.map((r) => r.situacao);
    for (const s of ['won', 'open', 'draft', 'lost', 'cancelled']) expect(situacoes).toContain(s);
    expect(propostas.some((r) => r.produto !== null)).toBe(true);
    const full = propostas.filter((r) => r.produto === null).map((r) => r.ref);
    expect(full.length).toBeGreaterThan(0);
    for (const ref of full) {
      expect(rowsOf('itens').some((r) => r.ref === ref)).toBe(true);
      expect(rowsOf('parcelas').some((r) => r.ref === ref)).toBe(true);
    }
    const produtos = rowsOf('produtos');
    expect(produtos.some((r) => r.tipo === 'service')).toBe(true);
    expect(produtos.some((r) => r.temMensalidade === true)).toBe(true);
    expect(rowsOf('itens').some((r) => r.produto === null && r.descricao !== null && r.area !== null)).toBe(true);
    expect(rowsOf('pagamentos').some((r) => str(r.parcela)?.startsWith('M'))).toBe(true);
  });

  it('no example day is after today', () => {
    for (const today of TODAYS) {
      for (const key of SHEET_KEYS) {
        for (const c of getSheetDef(key).columns.filter((x) => x.kind.type === 'day')) {
          for (const row of rowsOf(key, today)) {
            const v = row[c.key];
            if (v === null) continue;
            expect(typeof v === 'string' && isIsoDay(v)).toBe(true);
            expect((v as string) <= today).toBe(true);
          }
        }
      }
    }
  });

  it('every reference resolves inside the example or to a system cadastro', () => {
    const areas = names('areas', 'nome');
    const produtos = names('produtos', 'nome');
    const funcoes = names('funcoes', 'nome');
    const clientes = names('clientes', 'nome');
    const pessoas = names('pessoas', 'nome');
    const norm = (v: CellValue | undefined) => normalizeLabel(str(v) ?? '');
    const has = (set: Set<string>, v: CellValue | undefined) => v === null || v === undefined || set.has(norm(v));

    for (const r of rowsOf('produtos')) expect(has(areas, r.area)).toBe(true);
    for (const r of rowsOf('itens')) {
      expect(has(areas, r.area)).toBe(true);
      expect(has(produtos, r.produto)).toBe(true);
    }
    for (const r of rowsOf('custosProduto')) {
      expect(has(produtos, r.produto)).toBe(true);
      expect(has(funcoes, r.funcao)).toBe(true);
    }
    for (const r of rowsOf('propostas')) {
      expect(has(produtos, r.produto)).toBe(true);
      expect(has(clientes, r.cliente)).toBe(true);
    }
    for (const r of rowsOf('profissionais')) {
      expect(has(funcoes, r.funcao)).toBe(true);
      expect(['vendedor', 'finder']).not.toContain(norm(r.funcao));
      expect(has(pessoas, r.pessoa)).toBe(true);
    }
    const withFuncao = (slug: string) =>
      new Set(
        rowsOf('pessoas')
          .filter((p) => Array.isArray(p.funcoes) && p.funcoes.some((f) => normalizeLabel(f) === slug))
          .map((p) => normalizeLabel(str(p.nome) ?? '')),
      );
    for (const p of rowsOf('pessoas')) {
      for (const f of p.funcoes as string[]) {
        expect(funcoes.has(normalizeLabel(f)) || ['vendedor', 'finder'].includes(normalizeLabel(f))).toBe(true);
      }
    }
    for (const r of [...rowsOf('propostas'), ...rowsOf('leads')]) expect(has(withFuncao('vendedor'), r.vendedor)).toBe(true);
    for (const r of rowsOf('propostas')) expect(has(withFuncao('finder'), r.finder)).toBe(true);
    const refs = rowsOf('propostas').map((r) => r.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const key of ['itens', 'profissionais', 'parcelas', 'pagamentos'] as const) {
      for (const r of rowsOf(key)) expect(refs).toContain(r.ref);
    }
    const etapas = names('etapas', 'nome');
    for (const r of rowsOf('leads')) {
      expect(r.etapa).not.toBeNull();
      expect(etapas.has(norm(r.etapa))).toBe(true);
    }
  });

  it('example cadastro names never collide with seeds', () => {
    const seedStages = new Set(LEAD_STAGE_SEEDS.map((s) => normalizeLabel(s.name)));
    for (const n of names('etapas', 'nome')) expect(seedStages.has(n)).toBe(false);
    for (const n of names('funcoes', 'nome')) expect(['vendedor', 'finder', 'prestador']).not.toContain(n);
  });

  it('full propostas add up', () => {
    const itens = rowsOf('itens');
    const parcelas = rowsOf('parcelas');
    const refs = new Set(parcelas.map((p) => p.ref));
    for (const ref of refs) {
      const total = itens
        .filter((i) => i.ref === ref)
        .reduce((s, i) => s + (i.quantidade === null ? 1 : num(i.quantidade)) * num(i.valorUnitario), 0);
      const parts = parcelas.filter((p) => p.ref === ref);
      expect(parts.reduce((s, p) => s + num(p.valor), 0)).toBe(total);
      for (const pro of rowsOf('profissionais').filter((p) => p.ref === ref && p.divisaoCusto !== null)) {
        const res = coercePctList(str(pro.divisaoCusto) ?? '');
        expect(res.ok && res.value !== null).toBe(true);
        if (res.ok && res.value !== null) {
          expect(res.value.reduce((a, b) => a + b, 0)).toBe(100);
          expect(res.value.length).toBeLessThanOrEqual(parts.length);
        }
      }
    }
  });

  it('payments hit real labels of won propostas', () => {
    const seen = new Set<string>();
    for (const today of TODAYS) {
      for (const pay of rowsOf('pagamentos', today)) {
        const sale = rowsOf('propostas', today).find((p) => p.ref === pay.ref);
        expect(sale?.situacao).toBe('won');
        expect(sale?.dataGanho).not.toBeNull();
        const label = str(pay.parcela) ?? '';
        const key = `${today}|${String(pay.ref)}|${label}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        let due: string;
        const rec = /^M(\d+)\/(\d+)$/.exec(label);
        if (rec) {
          const k = Number(rec[1]);
          expect(k).toBeGreaterThanOrEqual(1);
          expect(k).toBeLessThanOrEqual(num(sale?.ciclosRecorrencia));
          expect(Number(rec[2])).toBe(num(sale?.ciclosRecorrencia));
          const start = str(sale?.inicioRecorrencia) ?? '';
          const dt = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + (k - 1), Number(start.slice(8, 10))));
          due = dt.toISOString().slice(0, 10);
        } else {
          const m = /^(\d+)\/(\d+)$/.exec(label);
          expect(m).not.toBeNull();
          const mine = rowsOf('parcelas', today).filter((p) => p.ref === pay.ref && num(p.valor) > 0);
          expect(Number(m?.[2])).toBe(mine.length);
          const sorted = [...mine].sort((a, b) => (str(a.vencimento) ?? '').localeCompare(str(b.vencimento) ?? ''));
          due = str(sorted[Number(m?.[1]) - 1]?.vencimento) ?? '';
        }
        const paid = str(pay.dataPagamento) ?? '';
        expect(paid >= due).toBe(true);
        expect(paid <= today).toBe(true);
      }
    }
  });
});
