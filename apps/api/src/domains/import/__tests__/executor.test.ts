/**
 * Slice 06 unit oracles: message formatting, ref collection, pre-DB refusals and the
 * source guard. No database: the transaction is a proxy that throws when touched.
 *
 * Run: pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/executor.test.ts
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuditActionSchema,
  CADASTRO_LIFECYCLE_ACTIONS,
  CadastroEntityTypeSchema,
} from '../../audit/service.js';
import { registerProducerFlowGate } from '../../integration/producer-gate.js';
import type { Db } from '../../sales-ops/service.js';
import {
  ImportExecutionError,
  collectOperationRefs,
  executeImportPlan,
  importExecutionMessage,
} from '../executor.js';
import type { ImportOperation, ImportPlan, SaleDraft } from '../types.js';

const untouchableTx = new Proxy(
  {},
  {
    get() {
      throw new Error('tx touched');
    },
  },
) as unknown as Db;

const ACTOR = { userId: 'acct-1', displayName: 'Equipe FXL' };
const NOW = new Date('2026-06-01T15:00:00.000Z');
const UUID = '8f14e45f-ceea-467f-a0e6-b1a8d9c1f2aa';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

afterEach(() => {
  registerProducerFlowGate(() => false);
});

function saleDraft(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    clientRef: { existingId: UUID },
    clientName: 'Cliente',
    sellerRef: { existingId: UUID },
    sellerName: 'Ana',
    finderRef: null,
    finderName: null,
    status: 'open',
    baseDate: '2026-03-01',
    notes: null,
    sellerCommissionPct: 10,
    finderCommissionPct: 0,
    taxPct: 6,
    otherCostsBrl: 0,
    items: [{ productRef: null, areaRef: null, productName: 'X', quantity: 1, unitBrl: 1000 }],
    professionals: [],
    installments: [{ dueDate: '2026-05-01', amountBrl: 1000, method: 'pix' }],
    recurring: null,
    ...overrides,
  } as SaleDraft;
}

const area: ImportOperation = {
  op: 'createArea',
  planKey: 'areas:2',
  input: { name: 'A', status: 'active' },
};
const wonSale: ImportOperation = {
  op: 'createSale',
  planKey: 'propostas:2',
  input: saleDraft({ status: 'won' }),
  wonOn: '2026-03-10',
};
const openSale: ImportOperation = {
  op: 'createSale',
  planKey: 'propostas:3',
  input: saleDraft(),
  wonOn: null,
};
const settle: ImportOperation = {
  op: 'settleReceivable',
  saleKey: 'propostas:3',
  receivableLabel: '1/1',
  paidOn: '2026-05-01',
  settlePayables: false,
};

const plan = (operations: ImportOperation[]): ImportPlan => ({ operations, issues: [], counts: {}, recognized: {} });

describe('importExecutionMessage', () => {
  it('formats the tab and Excel row of a cadastro operation', () => {
    const op: ImportOperation = {
      op: 'createProduct',
      planKey: 'produtos:7',
      input: {} as never,
      areaRef: { planKey: 'areas:2' },
      funcaoCosts: [],
    };
    expect(importExecutionMessage(op, 'db_unique_violation')).toMatch(/^Aba Produtos, linha 7: /);
  });

  it('names the parcela of a refused settlement', () => {
    const op: ImportOperation = {
      op: 'settleReceivable',
      saleKey: 'propostas:3',
      receivableLabel: '2/4',
      paidOn: '2026-05-01',
      settlePayables: true,
    };
    expect(importExecutionMessage(op, 'already_paid')).toBe(
      'Aba Propostas, linha 3 (parcela 2/4): a parcela já está paga.',
    );
  });

  it('never puts an id in the message', () => {
    const reasons = [
      'duplicate',
      'unknown_area',
      'seller_not_found',
      'invalid_sale',
      'producer_flow_live',
      'unresolved_ref',
      'db_unique_violation',
      'something_unknown',
    ];
    for (const reason of reasons) {
      const message = importExecutionMessage(wonSale, reason);
      expect(message).not.toMatch(UUID_RE);
      expect(message).not.toContain('planKey');
      expect(message).not.toContain('system:');
    }
  });

  it('falls back to a generic sentence for an unknown reason', () => {
    expect(importExecutionMessage(area, 'zzz')).toBe(
      'Aba Áreas, linha 2: o registro foi recusado pelo sistema.',
    );
  });

  it('uses Importação for a malformed key', () => {
    const op = { ...area, planKey: 'x' } as ImportOperation;
    expect(importExecutionMessage(op, 'duplicate')).toMatch(/^Importação: /);
  });
});

describe('ImportExecutionError', () => {
  it('exposes operation and reason', () => {
    const error = new ImportExecutionError(area, 'duplicate');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ImportExecutionError');
    expect(error.operation).toBe(area);
    expect(error.reason).toBe('duplicate');
  });
});

describe('collectOperationRefs', () => {
  it('collects every ref of every operation kind', () => {
    const a = { planKey: 'areas:2' };
    const f = { planKey: 'funcoes:2' };
    const c = { planKey: 'clientes:2' };
    const s = { planKey: 'pessoas:2' };
    const p = { planKey: 'produtos:2' };
    const e = { planKey: 'etapas:2' };
    const fi = { existingId: UUID };
    expect(collectOperationRefs(area)).toEqual([]);
    expect(
      collectOperationRefs({
        op: 'createProduct',
        planKey: 'produtos:2',
        input: {} as never,
        areaRef: a,
        funcaoCosts: [
          { funcaoRef: f, cost: { mode: 'pct', valuePct: 1 } as never },
          { funcaoRef: fi, cost: { mode: 'pct', valuePct: 1 } as never },
        ],
      }),
    ).toEqual([a, f, fi]);
    expect(
      collectOperationRefs({
        op: 'createPerson',
        planKey: 'pessoas:2',
        input: {} as never,
        funcaoRefs: [f, fi],
      }),
    ).toEqual([f, fi]);
    expect(
      collectOperationRefs({
        op: 'createLead',
        planKey: 'leads:2',
        input: {} as never,
        clientRef: c,
        sellerRef: s,
        products: [
          { productRef: p, name: 'P' },
          { productRef: null, name: 'Q' },
        ],
        stageRef: e,
        lostReason: null,
      }),
    ).toEqual([c, s, p, e]);
    expect(
      collectOperationRefs({
        op: 'createLead',
        planKey: 'leads:3',
        input: {} as never,
        clientRef: null,
        sellerRef: null,
        products: [],
        stageRef: null,
        lostReason: null,
      }),
    ).toEqual([]);
    expect(
      collectOperationRefs({
        op: 'createSale',
        planKey: 'propostas:2',
        input: saleDraft({
          clientRef: c,
          sellerRef: s,
          finderRef: fi,
          items: [
            { productRef: p, areaRef: a, productName: 'X', quantity: 1, unitBrl: 1 },
            { productRef: null, areaRef: null, productName: 'Y', quantity: 1, unitBrl: 1 },
          ] as SaleDraft['items'],
          professionals: [
            { personRef: s, funcaoRef: f, personName: 'A', costBrl: 1, costSplitBp: null },
            { personRef: null, funcaoRef: null, personName: 'B', costBrl: 1, costSplitBp: null },
          ] as SaleDraft['professionals'],
        }),
        wonOn: null,
      }),
    ).toEqual([c, s, fi, p, a, s, f]);
    expect(
      collectOperationRefs({ op: 'transitionSale', saleKey: 'propostas:3', to: 'lost' }),
    ).toEqual([{ planKey: 'propostas:3' }]);
    expect(collectOperationRefs(settle)).toEqual([{ planKey: 'propostas:3' }]);
    expect(collectOperationRefs({ op: 'createClient', planKey: 'clientes:2', input: {} as never })).toEqual([]);
  });
});

describe('executeImportPlan before the database', () => {
  it('refuses a plan that still carries an error issue before touching the transaction', async () => {
    const bad: ImportPlan = {
      operations: [area],
      counts: {},
      recognized: {},
      issues: [
        { severity: 'error', sheet: 'areas', row: 2, column: null, code: 'x', message: 'x' },
      ],
    };
    await expect(executeImportPlan(untouchableTx, 'org', bad, ACTOR, NOW)).rejects.toThrow(
      'import_plan_has_errors',
    );
  });

  it('refuses a won proposta in a producer-live org before touching the transaction', async () => {
    registerProducerFlowGate(() => true);
    const error = await executeImportPlan(untouchableTx, 'org', plan([area, wonSale]), ACTOR, NOW).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImportExecutionError);
    expect((error as ImportExecutionError).reason).toBe('producer_flow_live');
    expect((error as ImportExecutionError).operation.op).toBe('createSale');
  });

  it('refuses a settlement in a producer-live org before touching the transaction', async () => {
    registerProducerFlowGate(() => true);
    const error = await executeImportPlan(untouchableTx, 'org', plan([openSale, settle]), ACTOR, NOW).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImportExecutionError);
    expect((error as ImportExecutionError).reason).toBe('producer_flow_live');
    expect((error as ImportExecutionError).operation.op).toBe('settleReceivable');
  });
});

describe('audit action', () => {
  it('adds import.completed to the audit actions and keeps it out of the cadastro lifecycle', () => {
    expect(AuditActionSchema.safeParse('import.completed').success).toBe(true);
    expect(CADASTRO_LIFECYCLE_ACTIONS as readonly string[]).not.toContain('import.completed');
    expect(CadastroEntityTypeSchema.safeParse('importacao').success).toBe(false);
  });
});

describe('source guard', () => {
  it('executor source writes nothing itself', () => {
    const source = readFileSync(new URL('../executor.ts', import.meta.url), 'utf8');
    expect(source.length).toBeGreaterThan(3000);
    expect(source).toContain('applyBaixaTx(');
    expect(source).toContain('writeAuditEntry(');
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toMatch(/getAdminDb|getDb\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/new Date\(\)/);
    expect(source).not.toMatch(/withTenant/);
    expect(source).not.toMatch(/toISOString\(\)\.slice/);
    expect(source).not.toMatch(/ensureLeadStages|ensureSystemFuncoes|system:/);
  });
});
