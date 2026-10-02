import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportCatalog, ImportCounts, ImportIssue, ImportOperation, SheetPlanResult } from '../types.js';

const refsSentinel = vi.hoisted(() => ({ resolve: vi.fn() }));
const mocks = vi.hoisted(() => ({
  buildRefIndex: vi.fn(),
  planCadastros: vi.fn(),
  planLeads: vi.fn(),
  planPropostas: vi.fn(),
  planDesfechos: vi.fn(),
}));

vi.mock('../refs.js', () => ({ buildRefIndex: mocks.buildRefIndex }));
vi.mock('../plan/cadastros.js', () => ({ planCadastros: mocks.planCadastros }));
vi.mock('../plan/leads.js', () => ({ planLeads: mocks.planLeads }));
vi.mock('../plan/propostas.js', () => ({ planPropostas: mocks.planPropostas }));
vi.mock('../plan/desfechos.js', () => ({ planDesfechos: mocks.planDesfechos }));

const { emptyParsedWorkbook } = await import('../parse.js');
const { planImport, sortIssues, mergeCounts, isPlanOk, toPreviewBody } = await import('../plan/index.js');
const { MAX_RETURNED_ISSUES } = await import('../workbook-schema.js');

const catalog: ImportCatalog = {
  today: '2026-10-02',
  producerFlowLive: false,
  settings: { defaultSellerCommissionPct: 10, defaultFinderCommissionPct: 3, defaultTaxPct: 6 },
  areas: [],
  funcoes: [],
  products: [],
  people: [],
  clients: [],
  stages: [],
};

const empty = (): SheetPlanResult => ({ operations: [], issues: [], counts: {} });
const issue = (
  severity: ImportIssue['severity'],
  sheet: ImportIssue['sheet'],
  row: number | null,
  code = 'x',
): ImportIssue => ({ severity, sheet, row, column: null, code, message: code });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.buildRefIndex.mockReturnValue(refsSentinel);
  mocks.planCadastros.mockReturnValue(empty());
  mocks.planLeads.mockReturnValue(empty());
  mocks.planPropostas.mockReturnValue(empty());
  mocks.planDesfechos.mockReturnValue(empty());
});

describe('planImport', () => {
  it('builds the ref index once and hands the same index to every planner', () => {
    const parsed = emptyParsedWorkbook();
    const propostas = empty();
    mocks.planPropostas.mockReturnValue(propostas);
    planImport(parsed, catalog);
    expect(mocks.buildRefIndex).toHaveBeenCalledTimes(1);
    expect(mocks.buildRefIndex).toHaveBeenCalledWith(parsed, catalog);
    expect(mocks.planCadastros.mock.calls[0]?.[2]).toBe(refsSentinel);
    expect(mocks.planLeads.mock.calls[0]?.[2]).toBe(refsSentinel);
    expect(mocks.planPropostas.mock.calls[0]?.[2]).toBe(refsSentinel);
    expect(mocks.planDesfechos.mock.calls[0]?.[2]).toBe(refsSentinel);
    expect(mocks.planDesfechos.mock.calls[0]?.[3]).toBe(propostas);
  });

  it('concatenates operations in cadastros, leads, propostas, desfechos order', () => {
    const op = (o: object): ImportOperation => o as ImportOperation;
    mocks.planCadastros.mockReturnValue({ ...empty(), operations: [op({ op: 'createArea', planKey: 'areas:2' })] });
    mocks.planLeads.mockReturnValue({ ...empty(), operations: [op({ op: 'createLead', planKey: 'leads:2' })] });
    mocks.planPropostas.mockReturnValue({ ...empty(), operations: [op({ op: 'createSale', planKey: 'propostas:2' })] });
    mocks.planDesfechos.mockReturnValue({
      ...empty(),
      operations: [op({ op: 'transitionSale', saleKey: 'propostas:2' })],
    });
    const plan = planImport(emptyParsedWorkbook(), catalog);
    expect(plan.operations.map((o) => o.op)).toEqual(['createArea', 'createLead', 'createSale', 'transitionSale']);
  });

  it('puts errors before warnings, file-level before sheets, sheet order, then row', () => {
    const parsed = emptyParsedWorkbook();
    parsed.issues.push(issue('warning', null, null, 'unknown_sheet'), issue('error', 'parcelas', 3));
    mocks.planCadastros.mockReturnValue({
      ...empty(),
      issues: [issue('error', 'areas', 5), issue('error', 'areas', null), issue('error', null, null)],
    });
    mocks.planPropostas.mockReturnValue({ ...empty(), issues: [issue('warning', 'propostas', 2)] });
    const plan = planImport(parsed, catalog);
    expect(plan.issues.map((i) => [i.severity, i.sheet, i.row])).toEqual([
      ['error', null, null],
      ['error', 'areas', null],
      ['error', 'areas', 5],
      ['error', 'parcelas', 3],
      ['warning', null, null],
      ['warning', 'propostas', 2],
    ]);
  });

  it('keeps the original order for ties', () => {
    mocks.planCadastros.mockReturnValue({ ...empty(), issues: [issue('error', 'produtos', 4, 'a')] });
    mocks.planLeads.mockReturnValue({ ...empty(), issues: [issue('error', 'produtos', 4, 'b')] });
    const plan = planImport(emptyParsedWorkbook(), catalog);
    expect(plan.issues.map((i) => i.code)).toEqual(['a', 'b']);
    expect(sortIssues([issue('error', 'areas', 1, 'p'), issue('error', 'areas', 1, 'q')]).map((i) => i.code)).toEqual([
      'p',
      'q',
    ]);
  });

  it('merges counts by summing per sheet and never writes zeros', () => {
    mocks.planCadastros.mockReturnValue({ ...empty(), counts: { areas: 1 } });
    mocks.planLeads.mockReturnValue({ ...empty(), counts: { leads: 2 } });
    mocks.planPropostas.mockReturnValue({ ...empty(), counts: { propostas: 1 } });
    expect(planImport(emptyParsedWorkbook(), catalog).counts).toEqual({ areas: 1, leads: 2, propostas: 1 });
    expect(mergeCounts({ areas: 1 }, { areas: 2 })).toEqual({ areas: 3 });
    expect(mergeCounts({}, {})).toEqual({});
  });

  it('is ok only with zero errors', () => {
    expect(isPlanOk({ issues: [issue('warning', null, null)] })).toBe(true);
    expect(isPlanOk({ issues: [issue('warning', null, null), issue('error', 'areas', 2)] })).toBe(false);
  });
});

describe('toPreviewBody', () => {
  const counts: ImportCounts = { areas: 4 };
  it('truncates at MAX_RETURNED_ISSUES and flags it', () => {
    const issues = [issue('error', 'areas', 2), ...Array.from({ length: MAX_RETURNED_ISSUES }, () => issue('warning', 'areas', 3))];
    const body = toPreviewBody({ operations: [], issues, counts });
    expect(body.issues).toHaveLength(MAX_RETURNED_ISSUES);
    expect(body.truncated).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.issues[0]?.severity).toBe('error');
    expect(body.counts).toBe(counts);
  });

  it('does not flag exactly MAX_RETURNED_ISSUES and computes ok from the full list', () => {
    const exact = toPreviewBody({
      operations: [],
      issues: Array.from({ length: MAX_RETURNED_ISSUES }, () => issue('warning', 'areas', 3)),
      counts,
    });
    expect(exact.truncated).toBe(false);
    expect(exact.ok).toBe(true);
  });
});
