import { describe, expect, it } from 'vitest';
import { canTransition, materializeWonPayables } from '../service.js';

const ALL_STATUSES = ['draft', 'open', 'won', 'lost', 'cancelled'] as const;
const ALL_TARGETS = ['open', 'won', 'lost', 'cancelled'] as const;

// Mirrors the transition matrix table from the plan (04-proposal-transition-backend.md).
const EXPECTED_MATRIX: Record<(typeof ALL_STATUSES)[number], Record<(typeof ALL_TARGETS)[number], boolean>> = {
  draft: { open: true, won: true, lost: false, cancelled: true },
  open: { open: false, won: true, lost: true, cancelled: true },
  won: { open: true, won: false, lost: false, cancelled: false },
  lost: { open: true, won: false, lost: false, cancelled: true },
  cancelled: { open: true, won: false, lost: false, cancelled: false },
};

describe('canTransition', () => {
  it('transition matrix: allows exactly the documented pairs', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_TARGETS) {
        expect(canTransition(from, to)).toBe(EXPECTED_MATRIX[from][to]);
      }
    }

    expect(canTransition('forecast', 'won')).toBe(false);
    expect(canTransition('closed', 'open')).toBe(false);
  });
});

describe('materializeWonPayables (slice 04 standalone contract pin)', () => {
  it('links per-receivable commission and tax payables via receivableId', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: 'Carlos Finder',
        hasFinder: true,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 6,
        otherCostsBrl: 0,
      },
      professionals: [],
      receivables: [
        { id: 'r1', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' },
        { id: 'r2', dueDate: '2026-09-01', amountBrl: 500000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toHaveLength(6);
    expect(drafts.every((d) => d.receivableId !== null)).toBe(true);

    const r1Drafts = drafts.filter((d) => d.receivableId === 'r1');
    expect(r1Drafts).toHaveLength(3);
    expect(r1Drafts.map((d) => d.amountBrl).sort((a, b) => a - b)).toEqual([15000, 30000, 50000]);
    expect(r1Drafts.every((d) => d.dueDate === '2026-08-01')).toBe(true);

    const r2Drafts = drafts.filter((d) => d.receivableId === 'r2');
    expect(r2Drafts).toHaveLength(3);
    expect(r2Drafts.map((d) => d.amountBrl).sort((a, b) => a - b)).toEqual([15000, 30000, 50000]);
    expect(r2Drafts.every((d) => d.dueDate === '2026-09-01')).toBe(true);
  });

  it('falls back to a one-shot professional cost when there is no receivable', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: null,
        hasFinder: false,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 6,
        otherCostsBrl: 25000,
      },
      professionals: [{ id: 'professional-rafael', personName: 'Rafael Nunes', costBrl: 40000 }],
      receivables: [],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-07-29',
        amountBrl: 40000,
        status: 'open',
        receivableId: null,
        saleProfessionalId: 'professional-rafael',
      },
      {
        beneficiaryName: 'Outros custos',
        kind: 'other_cost',
        dueDate: '2026-07-29',
        amountBrl: 25000,
        status: 'open',
        receivableId: null,
        saleProfessionalId: null,
      },
    ]);
  });

  it('skips finder commission when hasFinder is false and drops zero-amount drafts', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: 'Carlos Finder',
        hasFinder: false,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 0,
        otherCostsBrl: 0,
      },
      professionals: [],
      receivables: [{ id: 'r1', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' }],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-08-01',
        amountBrl: 50000,
        status: 'open',
        receivableId: 'r1',
        saleProfessionalId: null,
      },
    ]);
  });

  it('never duplicates a surviving paid payable on re-win', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: null,
        hasFinder: false,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 0,
        otherCostsBrl: 20000,
      },
      professionals: [],
      receivables: [
        { id: 'r1', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' },
        { id: 'r2', dueDate: '2026-09-01', amountBrl: 500000, status: 'open' },
      ],
      existingPayables: [
        {
          kind: 'seller_commission',
          receivableId: 'r1',
          status: 'paid',
          beneficiaryName: 'Ana Martins',
          amountBrl: 50000,
          saleProfessionalId: null,
        },
        {
          kind: 'seller_commission',
          receivableId: 'r2',
          status: 'void',
          beneficiaryName: 'Ana Martins',
          amountBrl: 50000,
          saleProfessionalId: null,
        },
        {
          kind: 'other_cost',
          receivableId: null,
          status: 'paid',
          beneficiaryName: 'Outros custos',
          amountBrl: 20000,
          saleProfessionalId: null,
        },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-09-01',
        amountBrl: 50000,
        status: 'open',
        receivableId: 'r2',
        saleProfessionalId: null,
      },
    ]);
  });

  it('ignores void receivable rows', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: null,
        hasFinder: false,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 6,
        otherCostsBrl: 0,
      },
      professionals: [],
      receivables: [{ id: 'r1', dueDate: '2026-08-01', amountBrl: 500000, status: 'void' }],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([]);
  });
});

describe('materializeWonPayables: professional cost split (slice 06)', () => {
  const NO_COMMISSIONS = {
    sellerName: 'Ana Martins',
    finderName: null,
    hasFinder: false,
    sellerCommissionPct: 0,
    finderCommissionPct: 0,
    taxPct: 0,
    otherCostsBrl: 0,
  } as const;

  it('splits a professional cost across the installment receivables pro rata', () => {
    const drafts = materializeWonPayables({
      sale: { ...NO_COMMISSIONS },
      professionals: [{ id: 'professional-rafael', personName: 'Rafael Nunes', costBrl: 500000 }],
      receivables: [
        { id: 'r1', label: '1/3', dueDate: '2026-08-01', amountBrl: 1000000, status: 'open' },
        { id: 'r2', label: '2/3', dueDate: '2026-09-01', amountBrl: 2000000, status: 'open' },
        { id: 'r3', label: '3/3', dueDate: '2026-10-01', amountBrl: 2000000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-08-01',
        amountBrl: 100000,
        status: 'open',
        receivableId: 'r1',
        saleProfessionalId: 'professional-rafael',
      },
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-09-01',
        amountBrl: 200000,
        status: 'open',
        receivableId: 'r2',
        saleProfessionalId: 'professional-rafael',
      },
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-10-01',
        amountBrl: 200000,
        status: 'open',
        receivableId: 'r3',
        saleProfessionalId: 'professional-rafael',
      },
    ]);
    expect(drafts.reduce((sum, d) => sum + d.amountBrl, 0)).toBe(500000);
  });

  it('honours a stored cost_split_bp instead of the pro-rata default', () => {
    const drafts = materializeWonPayables({
      sale: { ...NO_COMMISSIONS },
      professionals: [
        {
          id: 'professional-rafael',
          personName: 'Rafael Nunes',
          costBrl: 500000,
          costSplitBp: [3000, 7000],
        },
      ],
      receivables: [
        { id: 'r1', label: '1/3', dueDate: '2026-08-01', amountBrl: 1000000, status: 'open' },
        { id: 'r2', label: '2/3', dueDate: '2026-09-01', amountBrl: 2000000, status: 'open' },
        { id: 'r3', label: '3/3', dueDate: '2026-10-01', amountBrl: 2000000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    // Two parts over three parcelas: front-aligned, so parcela 3 carries nothing.
    expect(drafts).toEqual([
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-08-01',
        amountBrl: 150000,
        status: 'open',
        receivableId: 'r1',
        saleProfessionalId: 'professional-rafael',
      },
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-09-01',
        amountBrl: 350000,
        status: 'open',
        receivableId: 'r2',
        saleProfessionalId: 'professional-rafael',
      },
    ]);
  });

  it('leaves professional_cost one-shot when every receivable is recurring', () => {
    const drafts = materializeWonPayables({
      sale: { ...NO_COMMISSIONS },
      professionals: [{ id: 'professional-rafael', personName: 'Rafael Nunes', costBrl: 40000 }],
      receivables: [
        { id: 'r1', label: 'M1/3', dueDate: '2026-08-01', amountBrl: 100000, status: 'open' },
        { id: 'r2', label: 'M2/3', dueDate: '2026-09-01', amountBrl: 100000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-07-29',
        amountBrl: 40000,
        status: 'open',
        receivableId: null,
        saleProfessionalId: 'professional-rafael',
      },
    ]);
  });

  it('matches current professional payables by durable id instead of display name', () => {
    const drafts = materializeWonPayables({
      sale: { ...NO_COMMISSIONS },
      professionals: [
        { id: 'professional-a', personName: 'Profissional Homonimo', costBrl: 100000 },
        { id: 'professional-b', personName: 'Profissional Homonimo', costBrl: 100000 },
      ],
      receivables: [
        { id: 'r1', label: '1/1', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' },
      ],
      existingPayables: [
        {
          kind: 'professional_cost',
          receivableId: 'r1',
          status: 'paid',
          beneficiaryName: 'Profissional Homonimo',
          amountBrl: 100000,
          saleProfessionalId: 'professional-a',
        },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Profissional Homonimo',
        kind: 'professional_cost',
        dueDate: '2026-08-01',
        amountBrl: 100000,
        status: 'open',
        receivableId: 'r1',
        saleProfessionalId: 'professional-b',
      },
    ]);
  });

  it('consumes each null-id legacy payable at most once', () => {
    const baseInput = {
      sale: { ...NO_COMMISSIONS },
      professionals: [
        { id: 'professional-a', personName: 'Profissional Homonimo', costBrl: 100000 },
        { id: 'professional-b', personName: 'Profissional Homonimo', costBrl: 100000 },
      ],
      receivables: [
        { id: 'r1', label: '1/1', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    };
    const legacyPayable = {
      kind: 'professional_cost' as const,
      receivableId: 'r1',
      status: 'paid',
      beneficiaryName: 'Profissional Homonimo',
      amountBrl: 100000,
      saleProfessionalId: null,
    };

    const drafts = materializeWonPayables({
      ...baseInput,
      existingPayables: [legacyPayable],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.amountBrl).toBe(100000);
    expect(['professional-a', 'professional-b']).toContain(drafts[0]?.saleProfessionalId);

    const amountMismatch = materializeWonPayables({
      ...baseInput,
      existingPayables: [{ ...legacyPayable, amountBrl: 99999 }],
    });
    expect(amountMismatch).toHaveLength(2);
    expect(amountMismatch.map((draft) => draft.saleProfessionalId)).toEqual([
      'professional-a',
      'professional-b',
    ]);
  });

  it('keeps other_cost one-shot', () => {
    const drafts = materializeWonPayables({
      sale: { ...NO_COMMISSIONS, otherCostsBrl: 25000 },
      professionals: [],
      receivables: [
        { id: 'r1', label: '1/2', dueDate: '2026-08-01', amountBrl: 500000, status: 'open' },
        { id: 'r2', label: '2/2', dueDate: '2026-09-01', amountBrl: 500000, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    // Deliberate: `other_cost` names no beneficiary and has no wizard row to hang
    // a schedule on. See 00-OVERVIEW-split.md Decision 5 and CLAUDE.md.
    expect(drafts).toEqual([
      {
        beneficiaryName: 'Outros custos',
        kind: 'other_cost',
        dueDate: '2026-07-29',
        amountBrl: 25000,
        status: 'open',
        receivableId: null,
        saleProfessionalId: null,
      },
    ]);
  });
});
