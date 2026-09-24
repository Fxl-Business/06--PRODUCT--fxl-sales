import { describe, expect, it } from 'vitest';
import {
  checkEditableStatusChange,
  findBlockedRows,
  findUnknownRowId,
  liveRowIds,
  payableIdentityKey,
  payableRowLabel,
  planLineReconcile,
  planPayableReconcile,
  planReceivableReconcile,
  planSaleEdit,
  receivableRowLabel,
  type DesiredPayable,
  type DesiredReceivable,
  type ExistingPayableRow,
  type ExistingReceivableRow,
  type FinalReceivable,
} from '../ledger-reconcile.js';

function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `id-new-${n}`;
  };
}

function receivable(overrides: Partial<ExistingReceivableRow> & { id: string }): ExistingReceivableRow {
  return {
    label: '1/1',
    dueDate: '2026-08-01',
    amountBrl: 100000,
    method: 'pix',
    status: 'open',
    ...overrides,
  };
}

function desiredReceivable(
  overrides: Partial<DesiredReceivable> & { sourceId: string | null },
): DesiredReceivable {
  return {
    label: '1/1',
    dueDate: '2026-08-01',
    amountBrl: 100000,
    method: 'pix',
    ...overrides,
  };
}

function payable(overrides: Partial<ExistingPayableRow> & { id: string }): ExistingPayableRow {
  return {
    kind: 'seller_commission',
    beneficiaryName: 'Ana Martins',
    receivableId: 'r1',
    saleProfessionalId: null,
    dueDate: '2026-08-01',
    amountBrl: 10000,
    status: 'open',
    ...overrides,
  };
}

function desiredPayable(overrides: Partial<DesiredPayable> = {}): DesiredPayable {
  return {
    kind: 'seller_commission',
    beneficiaryName: 'Ana Martins',
    receivableId: 'r1',
    saleProfessionalId: null,
    dueDate: '2026-08-01',
    amountBrl: 10000,
    ...overrides,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

describe('checkEditableStatusChange', () => {
  it('checkEditableStatusChange refuses lost and cancelled and any move into or out of won', () => {
    expect(checkEditableStatusChange('lost', 'open')).toEqual({ ok: false, reason: 'not_editable' });
    expect(checkEditableStatusChange('cancelled', 'draft')).toEqual({
      ok: false,
      reason: 'not_editable',
    });
    expect(checkEditableStatusChange('weird', 'open')).toEqual({ ok: false, reason: 'not_editable' });
    expect(checkEditableStatusChange('lost', 'won')).toEqual({ ok: false, reason: 'not_editable' });
    expect(checkEditableStatusChange('won', 'open')).toEqual({
      ok: false,
      reason: 'invalid_status_change',
    });
    expect(checkEditableStatusChange('won', 'draft')).toEqual({
      ok: false,
      reason: 'invalid_status_change',
    });
    expect(checkEditableStatusChange('open', 'won')).toEqual({
      ok: false,
      reason: 'invalid_status_change',
    });
    expect(checkEditableStatusChange('draft', 'won')).toEqual({
      ok: false,
      reason: 'invalid_status_change',
    });
    expect(checkEditableStatusChange('won', 'won')).toEqual({ ok: true });
    expect(checkEditableStatusChange('draft', 'open')).toEqual({ ok: true });
    expect(checkEditableStatusChange('open', 'draft')).toEqual({ ok: true });
    expect(checkEditableStatusChange('open', 'open')).toEqual({ ok: true });
  });
});

describe('findUnknownRowId', () => {
  const live = liveRowIds({
    items: [{ id: 'i1' }],
    professionals: [{ id: 'p1' }],
    receivables: [
      receivable({ id: 'r1', label: '1/1' }),
      receivable({ id: 'm1', label: 'M1/2' }),
      receivable({ id: 'rv', status: 'void' }),
    ],
  });

  it('findUnknownRowId reports the first foreign or void id with its array index', () => {
    expect(
      findUnknownRowId(
        { items: [{ id: 'i1' }, {}], professionals: [{ id: 'p1' }], installments: [{ id: 'r1' }] },
        live,
      ),
    ).toBeNull();
    expect(
      findUnknownRowId(
        { items: [{}, { id: 'foreign' }], professionals: [], installments: [{}] },
        live,
      ),
    ).toEqual({ code: 'item_not_found', index: 1 });
    expect(
      findUnknownRowId(
        { items: [{ id: 'i1' }], professionals: [{}, {}, { id: 'i1' }], installments: [{}] },
        live,
      ),
    ).toEqual({ code: 'professional_not_found', index: 2 });
    // A void receivable is not live, zero-amount installments are checked too.
    expect(
      findUnknownRowId(
        { items: [], professionals: [], installments: [{ id: 'r1' }, { id: 'rv' }] },
        live,
      ),
    ).toEqual({ code: 'installment_not_found', index: 1 });
    expect(
      findUnknownRowId(
        {
          items: [],
          professionals: [],
          installments: [{}],
          recurring: { receivableIds: ['m1', 'nope'] },
        },
        live,
      ),
    ).toEqual({ code: 'recurring_row_not_found', index: 1 });
    // Identity is the id, never the label: an installment may claim an M row.
    expect(
      findUnknownRowId(
        { items: [], professionals: [], installments: [{ id: 'm1' }], recurring: { receivableIds: ['r1'] } },
        live,
      ),
    ).toBeNull();
    // Items are checked before professionals.
    expect(
      findUnknownRowId(
        { items: [{ id: 'x' }], professionals: [{ id: 'y' }], installments: [] },
        live,
      ),
    ).toEqual({ code: 'item_not_found', index: 0 });
  });
});

describe('planLineReconcile', () => {
  it('planLineReconcile updates claimed rows, inserts rows without id and removes unclaimed ones', () => {
    const plan = planLineReconcile(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { sourceId: 'c', row: 'C2' },
        { sourceId: null, row: 'N' },
        { sourceId: 'a', row: 'A2' },
      ],
      counter(),
    );
    expect(plan).toEqual({
      updates: [
        { id: 'c', row: 'C2' },
        { id: 'a', row: 'A2' },
      ],
      inserts: [{ id: 'id-new-1', row: 'N' }],
      removes: ['b'],
      finalIds: ['c', 'id-new-1', 'a'],
    });
  });
});

describe('planReceivableReconcile', () => {
  it('planReceivableReconcile keeps the id of a receivable whose label renumbers when a middle installment is zeroed', () => {
    const existing = [
      receivable({ id: 'A', label: '1/3', dueDate: '2026-08-01' }),
      receivable({ id: 'B', label: '2/3', dueDate: '2026-09-01' }),
      receivable({ id: 'C', label: '3/3', dueDate: '2026-10-01' }),
    ];
    const plan = planReceivableReconcile(
      existing,
      [
        desiredReceivable({ sourceId: 'A', label: '1/2', dueDate: '2026-08-01', amountBrl: 150000 }),
        desiredReceivable({ sourceId: 'C', label: '2/2', dueDate: '2026-10-01', amountBrl: 150000 }),
      ],
      counter(),
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.voids).toEqual(['B']);
    expect(plan.updates).toEqual([
      { id: 'A', label: '1/2', dueDate: '2026-08-01', amountBrl: 150000, method: 'pix', lockRelevant: true },
      { id: 'C', label: '2/2', dueDate: '2026-10-01', amountBrl: 150000, method: 'pix', lockRelevant: true },
    ]);
    expect(plan.final.map((row) => [row.id, row.label])).toEqual([
      ['A', '1/2'],
      ['C', '2/2'],
    ]);
  });

  it('planReceivableReconcile voids a live receivable whose id is absent and never matches by label', () => {
    const existing = [
      receivable({ id: 'A', label: '1/1' }),
      receivable({ id: 'V', label: '1/1', status: 'void' }),
    ];
    const plan = planReceivableReconcile(
      existing,
      [desiredReceivable({ sourceId: null, label: '1/1' })],
      counter(),
    );
    expect(plan.inserts).toEqual([
      { id: 'id-new-1', label: '1/1', dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.voids).toEqual(['A']);
    expect(plan.final).toEqual([
      { id: 'id-new-1', label: '1/1', dueDate: '2026-08-01', amountBrl: 100000, status: 'open' },
    ]);
  });

  it('planReceivableReconcile emits no update for an identical row', () => {
    const plan = planReceivableReconcile(
      [receivable({ id: 'A' })],
      [desiredReceivable({ sourceId: 'A' })],
      counter(),
    );
    expect(plan).toEqual({
      inserts: [],
      updates: [],
      voids: [],
      final: [{ id: 'A', label: '1/1', dueDate: '2026-08-01', amountBrl: 100000, status: 'open' }],
    });
  });

  it('planReceivableReconcile marks amount and due-date changes lock-relevant but not method or label changes', () => {
    const existing = [
      receivable({ id: 'A' }),
      receivable({ id: 'B' }),
      receivable({ id: 'C' }),
      receivable({ id: 'D' }),
    ];
    const plan = planReceivableReconcile(
      existing,
      [
        desiredReceivable({ sourceId: 'A', amountBrl: 1 }),
        desiredReceivable({ sourceId: 'B', dueDate: '2026-08-02' }),
        desiredReceivable({ sourceId: 'C', method: 'boleto' }),
        desiredReceivable({ sourceId: 'D', label: '9/9' }),
      ],
      counter(),
    );
    expect(plan.updates.map((row) => [row.id, row.lockRelevant])).toEqual([
      ['A', true],
      ['B', true],
      ['C', false],
      ['D', false],
    ]);
  });

  it('planReceivableReconcile keeps paid status on a matched row in final', () => {
    const plan = planReceivableReconcile(
      [receivable({ id: 'A', status: 'paid' })],
      [desiredReceivable({ sourceId: 'A', method: 'card' }), desiredReceivable({ sourceId: null })],
      counter(),
    );
    expect(plan.final.map((row) => [row.id, row.status])).toEqual([
      ['A', 'paid'],
      ['id-new-1', 'open'],
    ]);
  });
});

describe('planPayableReconcile', () => {
  it('payableIdentityKey keys professional_cost by professional and receivable, others by kind and receivable', () => {
    expect(
      payableIdentityKey({ kind: 'professional_cost', receivableId: 'r1', saleProfessionalId: 'p1' }),
    ).toBe('professional_cost|p1|r1');
    expect(payableIdentityKey({ kind: 'tax', receivableId: 'r1', saleProfessionalId: null })).toBe(
      'tax|r1',
    );
    expect(payableIdentityKey({ kind: 'other_cost', receivableId: null, saleProfessionalId: null })).toBe(
      'other_cost|',
    );
  });

  it('planPayableReconcile matches by (kind, receivableId) and (saleProfessionalId, receivableId), never by beneficiary name', () => {
    const existing = [
      payable({ id: 'S1', kind: 'seller_commission', beneficiaryName: 'Ana Martins', receivableId: 'r1' }),
      payable({
        id: 'P1',
        kind: 'professional_cost',
        beneficiaryName: 'Julia Prado',
        receivableId: 'r1',
        saleProfessionalId: 'prof-1',
        amountBrl: 30000,
      }),
    ];
    const plan = planPayableReconcile(
      existing,
      [
        desiredPayable({ kind: 'seller_commission', beneficiaryName: 'Bruno Lima', receivableId: 'r1' }),
        desiredPayable({
          kind: 'professional_cost',
          beneficiaryName: 'Julia Prado',
          receivableId: 'r1',
          saleProfessionalId: 'prof-2',
          amountBrl: 30000,
        }),
      ],
      counter(),
    );
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: 'S1', beneficiaryName: 'Bruno Lima', lockRelevant: false }),
    ]);
    // Same beneficiary, different sale professional: a different obligation.
    expect(plan.inserts).toEqual([
      expect.objectContaining({ id: 'id-new-1', saleProfessionalId: 'prof-2' }),
    ]);
    expect(plan.voids).toEqual(['P1']);
  });

  it('planPayableReconcile voids an open payable whose receivable left the plan and never revives a void payable', () => {
    const existing = [
      payable({ id: 'VOID', kind: 'tax', receivableId: 'r1', status: 'void', beneficiaryName: 'Impostos' }),
      payable({ id: 'GONE', kind: 'tax', receivableId: 'r2', beneficiaryName: 'Impostos' }),
    ];
    const plan = planPayableReconcile(
      existing,
      [desiredPayable({ kind: 'tax', receivableId: 'r1', beneficiaryName: 'Impostos' })],
      counter(),
    );
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([expect.objectContaining({ id: 'id-new-1', kind: 'tax', receivableId: 'r1' })]);
    expect(plan.voids).toEqual(['GONE']);
  });

  it('planPayableReconcile keeps the stored due date of a null-receivable payable', () => {
    const existing = [
      payable({
        id: 'O1',
        kind: 'other_cost',
        beneficiaryName: 'Outros custos',
        receivableId: null,
        dueDate: '2026-07-28',
        amountBrl: 5000,
      }),
    ];
    const same = planPayableReconcile(
      existing,
      [
        desiredPayable({
          kind: 'other_cost',
          beneficiaryName: 'Outros custos',
          receivableId: null,
          dueDate: '2026-07-29',
          amountBrl: 5000,
        }),
      ],
      counter(),
    );
    expect(same).toEqual({ inserts: [], updates: [], voids: [] });

    const changed = planPayableReconcile(
      existing,
      [
        desiredPayable({
          kind: 'other_cost',
          beneficiaryName: 'Outros custos',
          receivableId: null,
          dueDate: '2026-07-29',
          amountBrl: 6000,
        }),
      ],
      counter(),
    );
    expect(changed.updates).toEqual([
      expect.objectContaining({ id: 'O1', dueDate: '2026-07-28', amountBrl: 6000, lockRelevant: true }),
    ]);
  });

  it('planPayableReconcile heals a legacy null saleProfessionalId payable by receivable and beneficiary', () => {
    const existing = [
      payable({
        id: 'L1',
        kind: 'professional_cost',
        beneficiaryName: 'Julia Prado',
        receivableId: 'r1',
        saleProfessionalId: null,
        amountBrl: 30000,
      }),
      payable({
        id: 'L2',
        kind: 'professional_cost',
        beneficiaryName: 'Outra Pessoa',
        receivableId: 'r1',
        saleProfessionalId: null,
        amountBrl: 30000,
      }),
    ];
    const plan = planPayableReconcile(
      existing,
      [
        desiredPayable({
          kind: 'professional_cost',
          beneficiaryName: 'Julia Prado',
          receivableId: 'r1',
          saleProfessionalId: 'prof-1',
          amountBrl: 30000,
        }),
      ],
      counter(),
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([
      {
        id: 'L1',
        kind: 'professional_cost',
        beneficiaryName: 'Julia Prado',
        receivableId: 'r1',
        saleProfessionalId: 'prof-1',
        dueDate: '2026-08-01',
        amountBrl: 30000,
        lockRelevant: false,
      },
    ]);
    expect(plan.voids).toEqual(['L2']);
  });

  it('planPayableReconcile voids the surplus duplicate of one identity key', () => {
    const existing = [
      payable({ id: 'T2', kind: 'tax', receivableId: 'r1', beneficiaryName: 'Impostos', dueDate: '2026-08-01' }),
      payable({ id: 'T1', kind: 'tax', receivableId: 'r1', beneficiaryName: 'Impostos', dueDate: '2026-08-01' }),
    ];
    const plan = planPayableReconcile(
      existing,
      [desiredPayable({ kind: 'tax', receivableId: 'r1', beneficiaryName: 'Impostos' })],
      counter(),
    );
    // Candidates sort by (dueDate, id): T1 wins, T2 is the surplus.
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.voids).toEqual(['T2']);
  });
});

describe('findBlockedRows', () => {
  const existingReceivables = [
    receivable({ id: 'r1', label: '1/2' }),
    receivable({ id: 'r2', label: '2/2' }),
    receivable({ id: 'r3', label: 'M1/2' }),
  ];
  const existingPayables = [
    payable({ id: 's2', receivableId: 'r2', beneficiaryName: 'Ana Martins' }),
    payable({ id: 'o1', kind: 'other_cost', receivableId: null, beneficiaryName: 'Outros custos' }),
    payable({ id: 't1', kind: 'tax', receivableId: 'r1', beneficiaryName: 'Impostos' }),
  ];

  it('findBlockedRows names every blocking row with kind, id and label', () => {
    const rows = findBlockedRows({
      existingReceivables,
      existingPayables,
      receivables: {
        inserts: [],
        updates: [
          { id: 'r2', label: '2/2', dueDate: '2026-08-01', amountBrl: 1, method: 'pix', lockRelevant: true },
        ],
        voids: ['r1'],
        final: [],
      },
      payables: {
        inserts: [],
        updates: [
          {
            id: 's2',
            kind: 'seller_commission',
            beneficiaryName: 'Ana Martins',
            receivableId: 'r2',
            saleProfessionalId: null,
            dueDate: '2026-08-01',
            amountBrl: 1,
            lockRelevant: true,
          },
          {
            id: 't1',
            kind: 'tax',
            beneficiaryName: 'Impostos',
            receivableId: 'r1',
            saleProfessionalId: null,
            dueDate: '2026-08-01',
            amountBrl: 1,
            lockRelevant: true,
          },
        ],
        voids: ['o1'],
      },
      activeReceivableIds: new Set(['r2', 'r1']),
      activePayableIds: new Set(['o1', 's2']),
    });
    expect(rows).toEqual([
      { kind: 'receivable', id: 'r1', label: '1/2' },
      { kind: 'receivable', id: 'r2', label: '2/2' },
      { kind: 'payable', id: 's2', label: 'Ana Martins (2/2)' },
      { kind: 'payable', id: 'o1', label: 'Outros custos' },
    ]);
  });

  it('payableRowLabel names the beneficiary and the linked parcela, or the beneficiary alone', () => {
    const labels = new Map([['r1', '1/3']]);
    expect(receivableRowLabel({ label: 'M1/12' })).toBe('M1/12');
    expect(payableRowLabel({ beneficiaryName: 'Impostos', receivableId: 'r1' }, labels)).toBe(
      'Impostos (1/3)',
    );
    expect(payableRowLabel({ beneficiaryName: 'Outros custos', receivableId: null }, labels)).toBe(
      'Outros custos',
    );
    expect(payableRowLabel({ beneficiaryName: 'Ana', receivableId: 'unknown' }, labels)).toBe('Ana');
  });

  it('findBlockedRows lets a method-only change through on a settled row', () => {
    const rows = findBlockedRows({
      existingReceivables,
      existingPayables,
      receivables: {
        inserts: [],
        updates: [
          { id: 'r1', label: '1/2', dueDate: '2026-08-01', amountBrl: 100000, method: 'card', lockRelevant: false },
        ],
        voids: [],
        final: [],
      },
      payables: { inserts: [], updates: [], voids: [] },
      activeReceivableIds: new Set(['r1']),
      activePayableIds: EMPTY_SET,
    });
    expect(rows).toEqual([]);
  });

  it('findBlockedRows treats a paid status row as settled even without facts', () => {
    const rows = findBlockedRows({
      existingReceivables: [receivable({ id: 'r1', label: '1/1', status: 'paid' })],
      existingPayables: [payable({ id: 'p1', status: 'paid', receivableId: 'r1' })],
      receivables: { inserts: [], updates: [], voids: ['r1'], final: [] },
      payables: { inserts: [], updates: [], voids: ['p1'] },
      activeReceivableIds: EMPTY_SET,
      activePayableIds: EMPTY_SET,
    });
    expect(rows).toEqual([
      { kind: 'receivable', id: 'r1', label: '1/1' },
      { kind: 'payable', id: 'p1', label: 'Ana Martins (1/1)' },
    ]);
  });
});

describe('planSaleEdit', () => {
  it('planSaleEdit derives payables only when derivePayables is given and feeds it receivables in due-date order', () => {
    const state = {
      items: [{ id: 'i1' }],
      professionals: [{ id: 'p1' }, { id: 'p2' }],
      receivables: [
        receivable({ id: 'r1', label: '1/2', dueDate: '2026-08-01' }),
        receivable({ id: 'r2', label: '2/2', dueDate: '2026-09-01' }),
      ],
      payables: [payable({ id: 'x1', receivableId: 'r2' })],
    };
    const desiredReceivables = [
      desiredReceivable({ sourceId: 'r2', label: '1/2', dueDate: '2026-09-01' }),
      desiredReceivable({ sourceId: null, label: '2/2', dueDate: '2026-07-01' }),
      desiredReceivable({ sourceId: null, label: 'M1/1', dueDate: '2026-09-01' }),
    ];

    const withoutPayables = planSaleEdit({
      state,
      desiredItems: [{ sourceId: 'i1', row: 'item' }],
      desiredProfessionals: [{ sourceId: 'p2', row: 'prof' }],
      desiredReceivables,
      derivePayables: null,
      activeReceivableIds: EMPTY_SET,
      activePayableIds: EMPTY_SET,
      newId: counter(),
    });
    expect(withoutPayables.payables).toEqual({ inserts: [], updates: [], voids: [] });
    expect(withoutPayables.professionals.removes).toEqual(['p1']);
    expect(withoutPayables.receivables.voids).toEqual(['r1']);
    expect(withoutPayables.blocked).toEqual([]);

    let seen: { receivables: FinalReceivable[]; professionalIds: string[] } | null = null;
    const withPayables = planSaleEdit({
      state,
      desiredItems: [{ sourceId: 'i1', row: 'item' }],
      desiredProfessionals: [
        { sourceId: null, row: 'new-prof' },
        { sourceId: 'p2', row: 'prof' },
      ],
      desiredReceivables,
      derivePayables: (args) => {
        seen = args;
        return [desiredPayable({ receivableId: 'r2' })];
      },
      activeReceivableIds: EMPTY_SET,
      activePayableIds: EMPTY_SET,
      newId: counter(),
    });
    expect(seen).not.toBeNull();
    const args = seen as unknown as { receivables: FinalReceivable[]; professionalIds: string[] };
    // Ties on dueDate keep plan order.
    expect(args.receivables.map((row) => row.label)).toEqual(['2/2', '1/2', 'M1/1']);
    expect(args.professionalIds).toEqual(['id-new-1', 'p2']);
    expect(withPayables.payables).toEqual({ inserts: [], updates: [], voids: [] });
  });
});
