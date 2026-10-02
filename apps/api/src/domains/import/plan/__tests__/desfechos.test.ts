import { describe, expect, it } from 'vitest';
import { CreateSaleSchema, buildSaleLedger, type ResolvedItemContext, type ResolvedPartyContexts } from '../../../sales-ops/service.js';
import type { ImportRefIndex } from '../../refs.js';
import type {
  CellValue,
  ImportCatalog,
  ImportIssue,
  ImportOperation,
  ParsedWorkbook,
  SaleDraft,
  SheetKey,
  SheetPlanResult,
} from '../../types.js';
import { seededCatalog, workbook } from '../../__tests__/plan-fixtures.js';
import { canonicalParcelaLabel, planDesfechos, plannedReceivableLabels } from '../desfechos.js';

type Rows = Partial<Record<SheetKey, Array<Record<string, CellValue> & { row?: number }>>>;
type SaleOp = Extract<ImportOperation, { op: 'createSale' }>;

const throwing = (): never => {
  throw new Error('RefIndex must not be used by planDesfechos');
};
const refs: ImportRefIndex = {
  resolve: throwing,
  resolvePersonWithFuncao: throwing,
  personHasFuncaoSlug: throwing,
  personHasFuncao: throwing,
  funcaoIsSystem: throwing,
};

const catalog = (overrides: Partial<ImportCatalog> = {}): ImportCatalog =>
  seededCatalog({ today: '2026-10-02', ...overrides });

function draft(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    clientRef: null,
    clientName: 'Cliente',
    sellerRef: { existingId: 'seller' },
    sellerName: 'Ana',
    finderRef: null,
    finderName: null,
    items: [
      {
        productRef: null,
        areaRef: null,
        productName: 'Licença',
        quantity: 1,
        unitBrl: 3000,
      },
    ],
    installments: [1000, 1000, 1000].map((amountBrl, i) => ({
      dueDate: `2026-0${i + 1}-15`,
      amountBrl,
      method: 'pix' as const,
    })),
    recurring: null,
    status: 'open',
    baseDate: '2026-01-15',
    sellerCommissionPct: 10,
    finderCommissionPct: 3,
    taxPct: 6,
    otherCostsBrl: 0,
    professionals: [],
    notes: null,
    ...overrides,
  } as SaleDraft;
}

function saleOp(row: number, status: SaleDraft['status'], wonOn: string | null, overrides: Partial<SaleDraft> = {}): SaleOp {
  return { op: 'createSale', planKey: `propostas:${row}`, input: draft({ status, ...overrides }), wonOn };
}

const ALL: ImportIssue[] = [];

function run(
  rows: Rows,
  ops: SaleOp[],
  cat: ImportCatalog = catalog(),
  issues: ImportIssue[] = [],
): SheetPlanResult {
  const parsed: ParsedWorkbook = workbook(rows, issues);
  const result = planDesfechos(parsed, cat, refs, { operations: ops, issues: [], counts: {} });
  ALL.push(...result.issues);
  return result;
}

const codes = (r: SheetPlanResult) => r.issues.map((i) => i.code);

describe('plannedReceivableLabels', () => {
  const inst = (...amounts: number[]) =>
    amounts.map((amountBrl, i) => ({ dueDate: `2026-0${i + 1}-15`, amountBrl, method: 'pix' as const }));

  it('labels installments N/M in order', () => {
    expect(plannedReceivableLabels({ installments: inst(1000, 1000, 1000), recurring: null })).toEqual(['1/3', '2/3', '3/3']);
  });
  it('drops a zero-amount installment and renumbers the rest', () => {
    expect(plannedReceivableLabels({ installments: inst(1000, 0, 1000), recurring: null })).toEqual(['1/2', '2/2']);
  });
  it('appends bounded recurring cycles as MN/M', () => {
    const recurring = { monthlyBrl: 500, startDate: '2026-02-15', cycles: 3, method: 'pix' as const };
    expect(plannedReceivableLabels({ installments: inst(1000), recurring })).toEqual(['1/1', 'M1/3', 'M2/3', 'M3/3']);
  });
  it('creates no label for an indefinite recurring', () => {
    const recurring = { monthlyBrl: 500, startDate: '2026-02-15', cycles: null, method: 'pix' as const };
    expect(plannedReceivableLabels({ installments: inst(1000), recurring })).toEqual(['1/1']);
  });

  it('matches buildSaleLedger on the same input', () => {
    const sellerId = '22222222-2222-4222-8222-222222222222';
    const itemContexts: ResolvedItemContext[] = [
      { areaId: '77777777-7777-4777-8777-777777777777', areaNameSnapshot: 'Tech', productTypeSnapshot: 'product' },
    ];
    const parties: ResolvedPartyContexts = {
      people: new Map([[sellerId, { id: sellerId, displayName: 'Ana' }]]),
      funcoes: new Map(),
    };
    const recurringOf = (cycles: number | null) => ({
      monthlyBrl: 500,
      startDate: '2026-02-15',
      cycles,
      method: 'pix' as const,
    });
    const cases = [
      { installments: inst(1000, 1000, 1000), recurring: null },
      { installments: inst(1000, 0, 1000), recurring: null },
      { installments: inst(1000), recurring: recurringOf(3) },
      { installments: inst(1000), recurring: recurringOf(null) },
    ];
    for (const input of cases) {
      const payload = {
        clientId: '11111111-1111-4111-8111-111111111111',
        clientName: 'Cliente',
        sellerPersonId: sellerId,
        sellerName: 'Ana',
        status: 'open' as const,
        baseDate: '2026-01-15',
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 6,
        otherCostsBrl: 0,
        items: [{ productId: '44444444-4444-4444-8444-444444444444', productName: 'Licença', quantity: 1, unitBrl: input.installments.reduce((sum, row) => sum + row.amountBrl, 0) }],
        professionals: [],
        installments: input.installments,
        recurring: input.recurring,
      };
      const ledger = buildSaleLedger(CreateSaleSchema.parse(payload), itemContexts, parties);
      expect(plannedReceivableLabels(input)).toEqual(ledger.receivables.map((r) => r.label));
    }
  });
});

describe('canonicalParcelaLabel', () => {
  it('removes whitespace and uppercases', () => {
    expect(canonicalParcelaLabel(' 1/3 ')).toBe('1/3');
    expect(canonicalParcelaLabel('m 2 / 12')).toBe('M2/12');
  });
});

describe('planDesfechos - Propostas outcomes', () => {
  const won = (extra: Record<string, CellValue> = {}) => ({ ref: 'P1', situacao: 'won', dataBase: '2026-01-15', dataGanho: '2026-01-20', ...extra });

  it('accepts a Ganha proposta with a past won day and emits no extra op', () => {
    const r = run({ propostas: [won()] }, [saleOp(2, 'won', '2026-01-20')]);
    expect(r.operations).toEqual([]);
    expect(r.issues).toEqual([]);
  });
  it('accepts a won day equal to today', () => {
    const r = run({ propostas: [won({ dataGanho: '2026-10-02' })] }, [saleOp(2, 'won', '2026-10-02')]);
    expect(r.issues).toEqual([]);
  });
  it('requires the won day of a Ganha proposta', () => {
    const r = run({ propostas: [won({ dataGanho: null })] }, [saleOp(2, 'won', null)]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ severity: 'error', sheet: 'propostas', row: 2, column: 'Data de ganho', code: 'won_date_required' });
  });
  it('does not repeat a parser error on the won day', () => {
    const parserIssue: ImportIssue = { severity: 'error', sheet: 'propostas', row: 2, column: 'Data de ganho', code: 'invalid_day', message: 'x' };
    const r = run({ propostas: [won({ dataGanho: null })] }, [saleOp(2, 'won', null)], catalog(), [parserIssue]);
    expect(r.issues).toEqual([]);
  });
  it('refuses a won day in the future', () => {
    const r = run({ propostas: [won({ dataGanho: '2026-10-03' })] }, [saleOp(2, 'won', '2026-10-03')]);
    expect(codes(r)).toEqual(['won_date_in_future']);
    expect(r.issues[0]?.message).toContain('03/10/2026');
    expect(r.issues[0]?.message).toContain('02/10/2026');
  });
  it('does not compare the won day with the base date', () => {
    const r = run({ propostas: [won({ dataGanho: '2026-01-10', dataBase: '2026-02-01' })] }, [saleOp(2, 'won', '2026-01-10')]);
    expect(r.issues).toEqual([]);
  });
  it('warns that a won day on a non-Ganha proposta is ignored', () => {
    const open = run({ propostas: [{ ref: 'P1', situacao: 'open', dataGanho: '2026-01-20' }] }, [saleOp(2, 'open', null)]);
    expect(open.issues).toHaveLength(1);
    expect(open.issues[0]).toMatchObject({ severity: 'warning', code: 'won_date_ignored', column: 'Data de ganho' });
    const blank = run({ propostas: [{ ref: 'P1', situacao: null, dataGanho: '2026-01-20' }] }, [saleOp(2, 'open', null)]);
    expect(codes(blank)).toEqual(['won_date_ignored']);
  });
  it('appends a lost transition after a Perdida proposta', () => {
    const r = run({ propostas: [{ ref: 'P1' }, { ref: 'P2', situacao: 'lost' }] }, [saleOp(2, 'open', null), saleOp(3, 'open', null)]);
    expect(r.operations).toEqual([{ op: 'transitionSale', saleKey: 'propostas:3', to: 'lost' }]);
  });
  it('appends a cancelled transition after a Cancelada proposta', () => {
    const r = run({ propostas: [{ ref: 'P1', situacao: 'cancelled' }] }, [saleOp(2, 'open', null)]);
    expect(r.operations).toEqual([{ op: 'transitionSale', saleKey: 'propostas:2', to: 'cancelled' }]);
  });
  it('keeps Propostas row order for transitions', () => {
    const r = run(
      { propostas: [{ ref: 'A', situacao: 'cancelled' }, { ref: 'B', situacao: 'open' }, { ref: 'C', situacao: 'lost' }] },
      [saleOp(4, 'open', null), saleOp(2, 'open', null), saleOp(3, 'open', null)],
    );
    expect(r.operations.map((o) => (o.op === 'transitionSale' ? o.saleKey : ''))).toEqual(['propostas:2', 'propostas:4']);
  });
  it('emits nothing for a Perdida row slice 04 refused', () => {
    const r = run({ propostas: [{ ref: 'P1', situacao: 'lost' }] }, []);
    expect(r.operations).toEqual([]);
    expect(r.issues).toEqual([]);
  });
  it('throws on a seam violation', () => {
    expect(() => run({ propostas: [{ ref: 'P1', situacao: 'lost' }] }, [saleOp(2, 'draft', null)])).toThrow(/planDesfechos seam/);
    expect(() => run({ propostas: [won()] }, [saleOp(2, 'open', null)])).toThrow(/planDesfechos seam/);
  });
  it('allows Perdida and Cancelada in a producer-live org', () => {
    const r = run(
      { propostas: [{ ref: 'A', situacao: 'lost' }, { ref: 'B', situacao: 'cancelled' }] },
      [saleOp(2, 'open', null), saleOp(3, 'open', null)],
      catalog({ producerFlowLive: true }),
    );
    expect(r.operations).toHaveLength(2);
    expect(r.issues).toEqual([]);
  });
  it('refuses a Ganha proposta in a producer-live org', () => {
    const r = run({ propostas: [won({ dataGanho: null })] }, [saleOp(2, 'won', null)], catalog({ producerFlowLive: true }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ severity: 'error', code: 'producer_flow_live', column: 'Situação', row: 2 });
  });
});

describe('planDesfechos - Pagamentos', () => {
  const recurring = { monthlyBrl: 500, startDate: '2026-04-15', cycles: 2, method: 'pix' as const };
  const base = (): Rows => ({
    propostas: [
      { ref: 'P1', situacao: 'won', dataGanho: '2026-01-20' },
      { ref: 'P2', situacao: 'lost' },
    ],
  });
  const ops = (over: Partial<SaleDraft> = {}): SaleOp[] => [
    saleOp(2, 'won', '2026-01-20', { recurring, ...over }),
    saleOp(3, 'open', null),
  ];
  const pay = (extra: Record<string, CellValue> = {}) => ({
    ref: 'P1',
    parcela: '2/3',
    dataPagamento: '2026-03-01',
    repassesPagos: true,
    ...extra,
  });
  const runPay = (pagamentos: Array<Record<string, CellValue> & { row?: number }>, o = ops(), cat = catalog()) =>
    run({ ...base(), pagamentos }, o, cat);
  const settles = (r: SheetPlanResult) => r.operations.filter((o) => o.op === 'settleReceivable');

  it('plans one settlement per valid row with the generated label', () => {
    const r = runPay([pay()]);
    expect(settles(r)).toEqual([
      { op: 'settleReceivable', saleKey: 'propostas:2', receivableLabel: '2/3', paidOn: '2026-03-01', settlePayables: true },
    ]);
    expect(r.counts).toEqual({ pagamentos: 1 });
  });
  it('treats a blank Repasses pagos as false', () => {
    const r = runPay([pay({ repassesPagos: null })]);
    expect(settles(r)[0]).toMatchObject({ settlePayables: false });
  });
  it('matches the Ref ignoring case and accents and the parcela ignoring spaces and case', () => {
    const r = runPay([pay({ ref: 'p1', parcela: ' m1/2 ' })]);
    expect(r.issues).toEqual([]);
    expect(settles(r)[0]).toMatchObject({ receivableLabel: 'M1/2' });
  });
  it('refuses a Ref that is not in Propostas', () => {
    const r = runPay([pay({ ref: 'P9' })]);
    expect(r.issues[0]).toMatchObject({ code: 'unknown_proposta_ref', column: 'Ref', sheet: 'pagamentos', row: 2 });
    expect(r.issues[0]?.message).toContain('"P9"');
    expect(settles(r)).toEqual([]);
  });
  it('refuses a payment on a non-Ganha proposta', () => {
    const r = runPay([pay({ ref: 'P2' })]);
    expect(r.issues[0]).toMatchObject({ code: 'proposta_not_won', column: 'Ref' });
    expect(r.issues[0]?.message).toContain('Perdida');
    expect(settles(r)).toEqual([]);
  });
  it('refuses a parcela the proposta will not have', () => {
    const r = runPay([pay({ parcela: '4/3' })]);
    expect(r.issues[0]).toMatchObject({ code: 'unknown_parcela', column: 'Parcela' });
    expect(r.issues[0]?.message).toContain('1/3, 2/3, 3/3, M1/2, M2/2');
    expect(settles(r)).toEqual([]);
  });
  it('refuses a parcela of a zero-amount installment', () => {
    const inst = [1000, 0].map((amountBrl, i) => ({ dueDate: `2026-0${i + 1}-15`, amountBrl, method: 'pix' as const }));
    const r = runPay([pay({ parcela: '2/2' })], ops({ installments: inst, recurring: null }));
    expect(codes(r)).toEqual(['unknown_parcela']);
    expect(r.issues[0]?.message).toContain('1/1');
    expect(r.issues[0]?.message).not.toContain('1/2');
  });
  it('explains an indefinite recurring', () => {
    const r = runPay([pay({ parcela: 'M1/12' })], ops({ recurring: { ...recurring, cycles: null } }));
    expect(codes(r)).toEqual(['unknown_parcela']);
    expect(r.issues[0]?.message).toContain('prazo indeterminado');
  });
  it('truncates a long parcela list', () => {
    const inst = Array.from({ length: 15 }, (_, i) => ({ dueDate: '2026-01-15', amountBrl: 100 + i, method: 'pix' as const }));
    const r = runPay([pay({ parcela: '99/15' })], ops({ installments: inst, recurring: null }));
    expect(r.issues[0]?.message.endsWith('e mais 3.')).toBe(true);
  });
  it('refuses the same parcela twice', () => {
    const r = runPay([pay({ row: 2 }), pay({ row: 4 })]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'duplicate_payment', row: 4, column: 'Parcela' });
    expect(r.issues[0]?.message).toContain('linha 2');
    expect(settles(r)).toHaveLength(1);
  });
  it('refuses a payment day in the future', () => {
    const bad = runPay([pay({ dataPagamento: '2026-10-03' })]);
    expect(bad.issues[0]).toMatchObject({ code: 'payment_in_future', column: 'Data do pagamento' });
    expect(settles(bad)).toEqual([]);
    const ok = runPay([pay({ dataPagamento: '2026-10-02' })]);
    expect(settles(ok)).toHaveLength(1);
  });
  it('stays silent when the Ref is duplicated or its proposta was refused', () => {
    const dup = run(
      { propostas: [{ ref: 'P1', situacao: 'won', dataGanho: '2026-01-20' }, { ref: 'P1', situacao: 'won', dataGanho: '2026-01-20' }], pagamentos: [pay()] },
      [saleOp(2, 'won', '2026-01-20'), saleOp(3, 'won', '2026-01-20')],
    );
    expect(dup.issues).toEqual([]);
    expect(settles(dup)).toEqual([]);
    const refused = run({ propostas: [{ ref: 'P1', situacao: 'won', dataGanho: '2026-01-20' }], pagamentos: [pay()] }, []);
    expect(refused.issues).toEqual([]);
    expect(settles(refused)).toEqual([]);
  });
  it('stays silent on blank required cells', () => {
    const r = runPay([pay({ ref: null }), pay({ parcela: null })]);
    expect(r.issues).toEqual([]);
    expect(settles(r)).toEqual([]);
  });
  it('refuses every payment row in a producer-live org', () => {
    const r = runPay([pay({ row: 2 }), pay({ row: 3, ref: 'P9' }), pay({ row: 4 })], ops(), catalog({ producerFlowLive: true }));
    const paymentIssues = r.issues.filter((i) => i.sheet === 'pagamentos');
    expect(paymentIssues).toHaveLength(3);
    for (const i of paymentIssues) expect(i).toMatchObject({ severity: 'error', code: 'producer_flow_live', column: null });
    expect(settles(r)).toEqual([]);
    expect(r.counts).toEqual({});
  });
  it('puts transitions before settlements', () => {
    const r = run(
      { propostas: [{ ref: 'P1', situacao: 'won', dataGanho: '2026-01-20' }, { ref: 'P2', situacao: 'lost' }], pagamentos: [pay()] },
      ops(),
    );
    expect(r.operations.map((o) => o.op)).toEqual(['transitionSale', 'settleReceivable']);
  });
  it('never uses the RefIndex', () => {
    expect(() => runPay([pay()])).not.toThrow();
  });
  it('does not mutate the propostas result', () => {
    const o = ops();
    const input: SheetPlanResult = { operations: o, issues: [], counts: { propostas: 2 } };
    planDesfechos(workbook({ ...base(), pagamentos: [pay()] }), catalog(), refs, input);
    expect(input.operations).toHaveLength(2);
    expect(input.counts).toEqual({ propostas: 2 });
  });
});

describe('planDesfechos - messages', () => {
  it('never contain a planKey or a uuid', () => {
    expect(ALL.length).toBeGreaterThan(5);
    for (const i of ALL) {
      expect(i.message).not.toMatch(/propostas:\d+/);
      expect(i.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(i.message).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
