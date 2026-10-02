import { describe, expect, it } from 'vitest';
import {
  AreaSchema,
  ClientSchema,
  FuncaoSchema,
  PersonSchema,
  ProductKindSchema,
  ProductSchema,
  SaleInstallmentSchema,
} from '../../sales-ops/service.js';
import { LeadStageSchema } from '../../sales-ops/leads/schemas.js';
import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
import { LEAD_STAGE_SEEDS } from '../../sales-ops/leads/stages-seed.js';
import { coerceCell, normalizeLabel, rawCell } from '../cells.js';
import {
  LEIAME_TAB,
  LISTAS_TAB,
  MAX_RETURNED_ISSUES,
  MAX_TOTAL_ROWS,
  MAX_UPLOAD_BYTES,
  PAYMENT_METHOD_OPTIONS,
  PRODUCT_KIND_OPTIONS,
  SALE_STATUS_OPTIONS,
  SHEET_KEYS,
  WORKBOOK_SHEETS,
  getColumnDef,
  getSheetDef,
  type ColumnDef,
} from '../workbook-schema.js';
import type { SheetKey } from '../types.js';

const col = (sheet: SheetKey, key: string): ColumnDef => getColumnDef(sheet, key);
const coerced = (sheet: SheetKey, key: string) => {
  const c = col(sheet, key);
  const r = coerceCell(c.kind, rawCell(c.example));
  if (!r.ok) throw new Error(`${sheet}.${key}: ${r.message}`);
  return r.value;
};
const maxOf = (sheet: SheetKey, key: string) => {
  const k = col(sheet, key).kind;
  if (k.type !== 'text') throw new Error('not text');
  return k.max;
};

describe('workbook schema', () => {
  it('lists the 13 data sheets in contract order with the contract tab names', () => {
    expect(WORKBOOK_SHEETS.map((s) => [s.key, s.tab])).toEqual([
      ['areas', 'Áreas'],
      ['funcoes', 'Funções'],
      ['produtos', 'Produtos'],
      ['custosProduto', 'Custos por produto'],
      ['pessoas', 'Pessoas'],
      ['clientes', 'Clientes'],
      ['etapas', 'Etapas'],
      ['leads', 'Leads'],
      ['propostas', 'Propostas'],
      ['itens', 'Itens da proposta'],
      ['profissionais', 'Profissionais da proposta'],
      ['parcelas', 'Parcelas'],
      ['pagamentos', 'Pagamentos'],
    ]);
    expect(WORKBOOK_SHEETS.map((s) => s.key)).toEqual([...SHEET_KEYS]);
  });

  it('has unique keys and headers per sheet', () => {
    for (const s of WORKBOOK_SHEETS) {
      const keys = s.columns.map((c) => c.key);
      for (const k of keys) expect(k).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(new Set(keys).size).toBe(keys.length);
      const headers = s.columns.map((c) => normalizeLabel(c.header));
      expect(new Set(headers).size).toBe(headers.length);
    }
  });

  it('has unique tab names that never collide with Leia-me or Listas', () => {
    const tabs = WORKBOOK_SHEETS.map((s) => normalizeLabel(s.tab));
    expect(new Set(tabs).size).toBe(tabs.length);
    expect(tabs).not.toContain(normalizeLabel(LEIAME_TAB));
    expect(tabs).not.toContain(normalizeLabel(LISTAS_TAB));
  });

  it('gives every column a pt-BR help sentence', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) {
        expect(c.help.length).toBeGreaterThan(0);
        expect(c.help.endsWith('.')).toBe(true);
        expect(c.help.includes(String.fromCharCode(0x2014))).toBe(false);
      }
    }
  });

  it('every example coerces cleanly with its own kind', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) {
        if (c.example === null) continue;
        expect(coerceCell(c.kind, rawCell(c.example)).ok, `${s.key}.${c.key}`).toBe(true);
      }
    }
  });

  it('every required column has an example', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) if (c.required) expect(c.example, `${s.key}.${c.key}`).not.toBeNull();
    }
  });

  it('marks enum and bool columns, and only them, with list enum', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) {
        const isEnumish = c.kind.type === 'enum' || c.kind.type === 'bool';
        expect(c.list === 'enum', `${s.key}.${c.key}`).toBe(isEnumish);
      }
    }
  });

  it('enum examples are option labels', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) {
        if (c.kind.type !== 'enum' || c.example === null) continue;
        expect(c.kind.options.map((o) => o.label)).toContain(c.example);
      }
    }
  });

  it('child sheets and propostas start with a required Ref text column', () => {
    for (const key of ['propostas', 'itens', 'profissionais', 'parcelas', 'pagamentos'] as const) {
      const first = getSheetDef(key).columns[0];
      expect(first).toMatchObject({ key: 'ref', header: 'Ref', required: true });
      expect(first?.kind.type).toBe('text');
    }
    expect(col('custosProduto', 'produto').required).toBe(true);
  });

  it('list columns with a reference source accept free text', () => {
    for (const s of WORKBOOK_SHEETS) {
      for (const c of s.columns as readonly ColumnDef[]) {
        if (c.kind.type === 'list' && c.list) expect(c.freeText, `${s.key}.${c.key}`).toBe(true);
      }
    }
    expect(col('leads', 'empresa').freeText).toBe(true);
  });

  it('option values mirror the domain enums', () => {
    expect(PAYMENT_METHOD_OPTIONS.map((o) => o.value)).toEqual([...SaleInstallmentSchema.shape.method.options]);
    expect(PRODUCT_KIND_OPTIONS.map((o) => o.value)).toEqual([...ProductKindSchema.options]);
    expect(SALE_STATUS_OPTIONS.map((o) => o.value)).toEqual(['draft', 'open', 'won', 'lost', 'cancelled']);
  });

  it('text limits mirror the domain schemas', () => {
    expect(maxOf('areas', 'nome')).toBe(AreaSchema.shape.name.maxLength);
    expect(maxOf('funcoes', 'nome')).toBe(FuncaoSchema.shape.name.maxLength);
    expect(maxOf('produtos', 'nome')).toBe(ProductSchema.innerType().shape.name.maxLength);
    expect(maxOf('pessoas', 'nome')).toBe(PersonSchema.shape.displayName.maxLength);
    expect(maxOf('etapas', 'nome')).toBe(LeadStageSchema.shape.name.maxLength);
    expect(maxOf('leads', 'contato')).toBe(CreateLeadSchema.shape.contactName.maxLength);
    expect(maxOf('leads', 'empresa')).toBe(CreateLeadSchema.shape.clientName.maxLength);
    expect(maxOf('leads', 'descricao')).toBe(CreateLeadSchema.shape.description.unwrap().unwrap().maxLength);
    const clientFields = {
      nome: ClientSchema.shape.name.maxLength,
      contato: ClientSchema.shape.contact.unwrap().unwrap().maxLength,
      razaoSocial: ClientSchema.shape.legalName.unwrap().unwrap().maxLength,
      documento: ClientSchema.shape.document.unwrap().unwrap().maxLength,
      endereco: ClientSchema.shape.address.unwrap().unwrap().maxLength,
      representante: ClientSchema.shape.legalRepName.unwrap().unwrap().maxLength,
      documentoRepresentante: ClientSchema.shape.legalRepDocument.unwrap().unwrap().maxLength,
    };
    for (const [key, max] of Object.entries(clientFields)) expect(maxOf('clientes', key), key).toBe(max);
  });

  it('the example story is coherent across sheets', () => {
    const one = (sheet: SheetKey, key: string) => coerced(sheet, key);
    expect(one('produtos', 'area')).toBe(one('areas', 'nome'));
    expect(one('custosProduto', 'produto')).toBe(one('produtos', 'nome'));
    expect(one('custosProduto', 'funcao')).toBe(one('funcoes', 'nome'));
    const funcoesPessoa = one('pessoas', 'funcoes') as string[];
    expect(funcoesPessoa).toContain('Vendedor');
    expect(funcoesPessoa).toContain(one('funcoes', 'nome'));
    expect(one('leads', 'empresa')).toBe(one('propostas', 'cliente'));
    expect(one('propostas', 'cliente')).toBe(one('clientes', 'nome'));
    expect(one('leads', 'vendedor')).toBe(one('propostas', 'vendedor'));
    expect(one('propostas', 'vendedor')).toBe(one('profissionais', 'pessoa'));
    expect(one('profissionais', 'pessoa')).toBe(one('pessoas', 'nome'));
    expect(one('leads', 'etapa')).toBe(one('etapas', 'nome'));
    expect(LEAD_STAGE_SEEDS.map((s) => s.name)).not.toContain(one('etapas', 'nome'));
    expect(one('leads', 'produtos')).toEqual([one('produtos', 'nome')]);
    expect(one('itens', 'produto')).toBe(one('produtos', 'nome'));
    for (const child of ['itens', 'profissionais', 'parcelas', 'pagamentos'] as const) {
      expect(one(child, 'ref')).toBe(one('propostas', 'ref'));
    }
    expect(one('parcelas', 'valor')).toBe(
      (one('itens', 'quantidade') as number) * (one('itens', 'valorUnitario') as number),
    );
    expect(one('parcelas', 'valor')).toBe(500000);
    expect(one('profissionais', 'funcao')).toBe(one('funcoes', 'nome'));
  });

  it('MAX_TOTAL_ROWS, MAX_UPLOAD_BYTES and MAX_RETURNED_ISSUES match D9', () => {
    expect(MAX_TOTAL_ROWS).toBe(5000);
    expect(MAX_UPLOAD_BYTES).toBe(5242880);
    expect(MAX_RETURNED_ISSUES).toBe(500);
  });

  it('getSheetDef and getColumnDef throw on unknown names', () => {
    expect(() => getSheetDef('nope' as SheetKey)).toThrow();
    expect(() => getColumnDef('areas', 'nope')).toThrow();
  });
});
