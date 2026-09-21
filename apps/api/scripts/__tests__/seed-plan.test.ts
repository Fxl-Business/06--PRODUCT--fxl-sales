/**
 * The pure oracle for apps/api/scripts/seed/plan.ts.
 *
 * No database, no dotenv, no roster import: every input is a literal fixture,
 * exactly as the plan requires. This is what lets "the plan is deterministic"
 * be asserted with no database at all, and what proves `buildDevSeedPlan`
 * itself never reads the wall clock, `process.env`, or the dev-fake package.
 */
import { describe, expect, it, vi } from 'vitest';
import { computeSaleFinancials, pctOfCents } from '@fxl-sales/shared-utils/sale-financials';
import {
  assertFakeOrgIds,
  buildDevSeedPlan,
  DEV_SEED_ORG_PREFIX,
  SEED_DELETE_ORDER,
  SEED_WRITE_ORDER,
  seededFuncaoSlugsFor,
  type DevSeedPlan,
  type SeedIdentity,
} from '../seed/plan.js';

const CUTOFF = { iso: '2026-09-01', year: 2026, month: 9, day: 1 };

const ORG_ALPHA = 'org_fake_alpha';
const ORG_BETA = 'org_fake_beta';
const ORG_IDS = [ORG_ALPHA, ORG_BETA];

// One owner, one seller-only, one finder-only, one admin+seller, one
// zero-role, with the admin+seller identity listing BOTH orgs.
const IDENTITIES: SeedIdentity[] = [
  {
    accountId: 'acct_owner',
    workspaceIds: [ORG_ALPHA],
    workspaceRole: 'owner',
    productRoles: [],
    name: 'Owner Test',
    email: 'owner@test.local',
  },
  {
    accountId: 'acct_seller',
    workspaceIds: [ORG_ALPHA],
    workspaceRole: 'member',
    productRoles: ['seller'],
    name: 'Seller Test',
    email: 'seller@test.local',
  },
  {
    accountId: 'acct_finder',
    workspaceIds: [ORG_BETA],
    workspaceRole: 'member',
    productRoles: ['finder'],
    name: 'Finder Test',
    email: 'finder@test.local',
  },
  {
    accountId: 'acct_adminseller',
    workspaceIds: [ORG_ALPHA, ORG_BETA],
    workspaceRole: 'member',
    productRoles: ['admin', 'seller'],
    name: 'Admin Seller Test',
    email: 'adminseller@test.local',
  },
  {
    accountId: 'acct_zero',
    workspaceIds: [ORG_ALPHA],
    workspaceRole: 'member',
    productRoles: [],
    name: 'Zero Role Test',
    email: 'zero@test.local',
  },
];

const INPUT = { orgIds: ORG_IDS, identities: IDENTITIES, cutoff: CUTOFF };

// Timestamp fields that anchor "when this row happened" - createdAt, updatedAt
// and their per-row equivalents. Deliberately EXCLUDES dueDate: a receivable's
// due date is legitimately projected months into the future (M12/12 is the
// cutoff plus 12 months, which is a different calendar year for any cutoff),
// so the cutoff-year pin would be false for the exact rows that prove the
// plan does date arithmetic at all rather than stamping everything "now".
const ANCHOR_TIMESTAMP_FIELDS = [
  'createdAt',
  'updatedAt',
  'archivedAt',
  'baseDate',
  'wonAt',
  'lostAt',
  'stageChangedAt',
] as const;

const MONEY_FIELD_SUFFIX = 'Brl';

/** Every row shape in plan.ts is a closed interface with no index signature,
 *  which is exactly right for the writer but inconvenient for a generic sweep
 *  here. This is the one cast site: through `unknown`, never `any`. */
function asRows<T>(rows: readonly T[]): readonly Record<string, unknown>[] {
  return rows as unknown as readonly Record<string, unknown>[];
}

function allTables(plan: DevSeedPlan): Array<readonly Record<string, unknown>[]> {
  return Object.values(plan.rows).map((rows) => asRows(rows as readonly unknown[]));
}

/** salesOpsSettings has no `id` column at all - its primary key IS orgId (one
 *  row per org, see CLAUDE.md's "there is no orgs table" note) - so it
 *  contributes orgId, and every other table contributes its uuid `id`. */
function collectIds(plan: DevSeedPlan): string[] {
  return [
    ...plan.rows.salesOpsSettings.map((row) => `settings:${row.orgId}`),
    ...allTables({ rows: { ...plan.rows, salesOpsSettings: [] } } as DevSeedPlan).flatMap((rows) =>
      rows.map((row) => row.id as string),
    ),
  ];
}

function sweepAnchorTimestamps(plan: DevSeedPlan): string[] {
  const values: string[] = [];
  for (const rows of allTables(plan)) {
    for (const row of rows) {
      for (const field of ANCHOR_TIMESTAMP_FIELDS) {
        const value = row[field];
        if (typeof value === 'string') values.push(value);
      }
    }
  }
  return values;
}

function sweepMoneyValues(plan: DevSeedPlan): number[] {
  const values: number[] = [];
  for (const rows of allTables(plan)) {
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith(MONEY_FIELD_SUFFIX) && typeof value === 'number') {
          values.push(value);
        }
      }
    }
  }
  return values;
}

function assertSameOrgReference(
  sourceRows: readonly Record<string, unknown>[],
  refField: string,
  targetRows: readonly { id: string; orgId: string }[],
): void {
  for (const row of sourceRows) {
    const refValue = row[refField];
    if (refValue === null || refValue === undefined) continue;
    const orgId = row.orgId as string;
    const match = targetRows.find((target) => target.id === refValue && target.orgId === orgId);
    expect(
      match,
      `${refField}=${String(refValue)} on org ${orgId} does not resolve inside the same org's slice`,
    ).toBeTruthy();
  }
}

describe('buildDevSeedPlan - determinism', () => {
  it('is deep-equal across two builds', () => {
    expect(buildDevSeedPlan(INPUT)).toEqual(buildDevSeedPlan(INPUT));
  });

  it('produces byte-identical JSON, which also pins row order', () => {
    expect(JSON.stringify(buildDevSeedPlan(INPUT))).toBe(JSON.stringify(buildDevSeedPlan(INPUT)));
  });

  it('never repeats an id anywhere in the plan', () => {
    const ids = collectIds(buildDevSeedPlan(INPUT));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads no wall clock - identical output under two wildly different system times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2001-01-01T00:00:00.000Z'));
    const first = JSON.stringify(buildDevSeedPlan(INPUT));
    vi.setSystemTime(new Date('2099-12-31T23:59:59.000Z'));
    const second = JSON.stringify(buildDevSeedPlan(INPUT));
    vi.useRealTimers();
    expect(second).toBe(first);
  });

  it('stamps every anchor timestamp with the cutoff year', () => {
    const plan = buildDevSeedPlan(INPUT);
    const values = sweepAnchorTimestamps(plan);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value.startsWith(String(CUTOFF.year))).toBe(true);
    }
  });
});

describe('buildDevSeedPlan - idempotence, structurally', () => {
  it('has every SEED_WRITE_ORDER entry present in SEED_DELETE_ORDER', () => {
    for (const key of SEED_WRITE_ORDER) {
      expect(SEED_DELETE_ORDER).toContain(key);
    }
  });

  it('orders SEED_DELETE_ORDER as the reverse-dependency order the restrict FKs require', () => {
    const index = (key: string) => SEED_DELETE_ORDER.indexOf(key as (typeof SEED_DELETE_ORDER)[number]);
    expect(index('salesOpsLeads')).toBeLessThan(index('salesOpsLeadStages'));
    expect(index('salesOpsLeads')).toBeLessThan(index('salesOpsClients'));
    expect(index('salesOpsLeads')).toBeLessThan(index('salesOpsPeople'));
    expect(index('salesOpsLeads')).toBeLessThan(index('salesOpsSales'));
    expect(index('salesOpsPersonFuncoes')).toBeLessThan(index('salesOpsFuncoes'));
    expect(index('salesOpsPayables')).toBeLessThan(index('salesOpsSaleProfessionals'));
    expect(index('salesOpsPayables')).toBeLessThan(index('salesOpsReceivables'));
  });
});

describe('buildDevSeedPlan - tenancy', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('scopes every row to a known org id', () => {
    for (const rows of allTables(plan)) {
      for (const row of rows) {
        expect(ORG_IDS).toContain(row.orgId);
      }
    }
  });

  it('never lets a foreign-key-shaped field cross an org boundary', () => {
    const { rows } = plan;
    assertSameOrgReference(asRows(rows.salesOpsPersonFuncoes), 'personId', rows.salesOpsPeople);
    assertSameOrgReference(asRows(rows.salesOpsPersonFuncoes), 'funcaoId', rows.salesOpsFuncoes);
    assertSameOrgReference(asRows(rows.salesOpsProducts), 'areaId', rows.salesOpsAreas);
    assertSameOrgReference(asRows(rows.salesOpsProductFuncaoCosts), 'productId', rows.salesOpsProducts);
    assertSameOrgReference(asRows(rows.salesOpsProductFuncaoCosts), 'funcaoId', rows.salesOpsFuncoes);
    assertSameOrgReference(asRows(rows.salesOpsSales), 'clientId', rows.salesOpsClients);
    assertSameOrgReference(asRows(rows.salesOpsSales), 'sellerPersonId', rows.salesOpsPeople);
    assertSameOrgReference(asRows(rows.salesOpsSales), 'finderPersonId', rows.salesOpsPeople);
    assertSameOrgReference(asRows(rows.salesOpsSaleItems), 'saleId', rows.salesOpsSales);
    assertSameOrgReference(asRows(rows.salesOpsSaleItems), 'productId', rows.salesOpsProducts);
    assertSameOrgReference(asRows(rows.salesOpsSaleItems), 'areaId', rows.salesOpsAreas);
    assertSameOrgReference(asRows(rows.salesOpsSaleProfessionals), 'saleId', rows.salesOpsSales);
    assertSameOrgReference(asRows(rows.salesOpsSaleProfessionals), 'personId', rows.salesOpsPeople);
    assertSameOrgReference(asRows(rows.salesOpsSaleProfessionals), 'funcaoId', rows.salesOpsFuncoes);
    assertSameOrgReference(asRows(rows.salesOpsReceivables), 'saleId', rows.salesOpsSales);
    assertSameOrgReference(asRows(rows.salesOpsPayables), 'saleId', rows.salesOpsSales);
    assertSameOrgReference(asRows(rows.salesOpsPayables), 'receivableId', rows.salesOpsReceivables);
    assertSameOrgReference(asRows(rows.salesOpsPayables), 'saleProfessionalId', rows.salesOpsSaleProfessionals);
    assertSameOrgReference(asRows(rows.salesOpsLeads), 'clientId', rows.salesOpsClients);
    assertSameOrgReference(asRows(rows.salesOpsLeads), 'sellerPersonId', rows.salesOpsPeople);
    assertSameOrgReference(asRows(rows.salesOpsLeads), 'stageId', rows.salesOpsLeadStages);
    assertSameOrgReference(asRows(rows.salesOpsLeads), 'saleId', rows.salesOpsSales);
    assertSameOrgReference(asRows(rows.salesOpsLeadProducts), 'leadId', rows.salesOpsLeads);
    assertSameOrgReference(asRows(rows.salesOpsLeadProducts), 'productId', rows.salesOpsProducts);
  });
});

describe('assertFakeOrgIds - the org_fake_ rail', () => {
  it('is clean for a properly prefixed org id', () => {
    expect(assertFakeOrgIds(['org_fake_alpha'])).toEqual([]);
  });

  it('names the offender for a real-looking org id', () => {
    const violations = assertFakeOrgIds(['org_real_acme']);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('org_real_acme');
  });

  it('is clean for an empty list', () => {
    expect(assertFakeOrgIds([])).toEqual([]);
  });

  it('exports the prefix it checks against', () => {
    expect(DEV_SEED_ORG_PREFIX).toBe('org_fake_');
  });
});

describe('buildDevSeedPlan - funcoes', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('gives every org exactly the two system funcoes vendedor and finder', () => {
    for (const orgId of ORG_IDS) {
      const systemFuncoes = plan.rows.salesOpsFuncoes.filter(
        (row) => row.orgId === orgId && row.isSystem,
      );
      expect(systemFuncoes.map((row) => row.slug).sort()).toEqual(['finder', 'vendedor']);
    }
  });

  it('never flags a non-system funcao as isSystem - what the database CHECK would refuse', () => {
    for (const row of plan.rows.salesOpsFuncoes) {
      expect(row.isSystem).toBe(row.slug === 'vendedor' || row.slug === 'finder');
    }
  });

  it('gives every pessoa at least one funcao - a person write is a full-set replacement and the API refuses an empty set with funcao_required', () => {
    const funcoesByPerson = new Map<string, number>();
    for (const row of plan.rows.salesOpsPersonFuncoes) {
      funcoesByPerson.set(row.personId, (funcoesByPerson.get(row.personId) ?? 0) + 1);
    }
    for (const person of plan.rows.salesOpsPeople) {
      expect(funcoesByPerson.get(person.id) ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('buildDevSeedPlan - identity binding', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('gives every identity a pessoa, bound by hubAccountId, in every org it lists', () => {
    for (const identity of IDENTITIES) {
      for (const orgId of identity.workspaceIds) {
        const matches = plan.rows.salesOpsPeople.filter(
          (row) => row.orgId === orgId && row.hubAccountId === identity.accountId,
        );
        expect(
          matches.length,
          `identity ${identity.accountId} should have exactly one bound pessoa in ${orgId}`,
        ).toBe(1);
      }
    }
  });

  it('binds the two-org identity in both orgs it lists', () => {
    const twoOrgIdentity = IDENTITIES.find((identity) => identity.workspaceIds.length > 1)!;
    expect(twoOrgIdentity.workspaceIds).toEqual([ORG_ALPHA, ORG_BETA]);
    for (const orgId of twoOrgIdentity.workspaceIds) {
      const bound = plan.rows.salesOpsPeople.some(
        (row) => row.orgId === orgId && row.hubAccountId === twoOrgIdentity.accountId,
      );
      expect(bound).toBe(true);
    }
  });

  it.each([
    ['owner', { workspaceRole: 'owner', productRoles: [] }, ['vendedor', 'finder']],
    ['admin', { workspaceRole: 'admin', productRoles: [] }, ['vendedor', 'finder']],
    ['productRoles admin', { workspaceRole: 'member', productRoles: ['admin'] }, ['vendedor', 'finder']],
    ['productRoles seller', { workspaceRole: 'member', productRoles: ['seller'] }, ['vendedor']],
    ['productRoles finder', { workspaceRole: 'member', productRoles: ['finder'] }, ['finder']],
    ['no roles at all', { workspaceRole: 'member', productRoles: [] }, ['vendedor']],
  ] as const)('seededFuncaoSlugsFor: %s', (_label, partial, expected) => {
    const identity: SeedIdentity = {
      accountId: 'acct_table',
      workspaceIds: [ORG_ALPHA],
      workspaceRole: partial.workspaceRole,
      productRoles: [...partial.productRoles],
      name: 'Table Test',
      email: 'table@test.local',
    };
    expect(seededFuncaoSlugsFor(identity)).toEqual(expected);
  });
});

function sortedReceivablesForSale(plan: DevSeedPlan, saleId: string) {
  return plan.rows.salesOpsReceivables
    .filter((row) => row.saleId === saleId)
    .slice()
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

describe('buildDevSeedPlan - money', () => {
  const plan = buildDevSeedPlan(INPUT);
  const saleOne = plan.rows.salesOpsSales.find(
    (row) => row.orgId === ORG_ALPHA && row.sequence === 1,
  )!;
  const saleOneItem = plan.rows.salesOpsSaleItems.find((row) => row.saleId === saleOne.id)!;
  const saleOneReceivables = sortedReceivablesForSale(plan, saleOne.id);
  const saleOneProfessional = plan.rows.salesOpsSaleProfessionals.find(
    (row) => row.saleId === saleOne.id,
  )!;

  it('keeps every *Brl field an integer', () => {
    const values = sweepMoneyValues(plan);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("sums S1's installment receivables to exactly the itens total", () => {
    const installmentTotal = saleOneReceivables
      .filter((row) => !row.label.startsWith('M'))
      .reduce((sum, row) => sum + row.amountBrl, 0);
    expect(installmentTotal).toBe(saleOneItem.unitBrl * saleOneItem.quantity);
  });

  it('sets S1.totalBrl to the itens total plus the bounded recorrencia', () => {
    const itemsTotal = saleOneItem.unitBrl * saleOneItem.quantity;
    const boundedRecurring = saleOneReceivables
      .filter((row) => row.label.startsWith('M'))
      .reduce((sum, row) => sum + row.amountBrl, 0);
    expect(saleOne.totalBrl).toBe(itemsTotal + boundedRecurring);
  });

  it('writes S1.netMarginPct as a toFixed(2) string', () => {
    expect(saleOne.netMarginPct).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('matches a direct computeSaleFinancials call over the same inputs - proving the plan calls it rather than re-implementing it', () => {
    const itemsTotalBrl = saleOneItem.unitBrl * saleOneItem.quantity;
    const boundedRecurringBrl = saleOneReceivables
      .filter((row) => row.label.startsWith('M'))
      .reduce((sum, row) => sum + row.amountBrl, 0);
    const financials = computeSaleFinancials({
      itemsTotalBrl,
      boundedRecurringBrl,
      receivableAmountsBrl: saleOneReceivables.map((row) => row.amountBrl),
      sellerCommissionPct: Number(saleOne.sellerCommissionPct),
      finderCommissionPct: Number(saleOne.finderCommissionPct),
      hasFinder: saleOne.finderPersonId !== null,
      taxPct: Number(saleOne.taxPct),
      otherCostsBrl: saleOne.otherCostsBrl,
      professionalCostsBrl: saleOneProfessional.costBrl,
    });
    expect(saleOne.totalBrl).toBe(financials.totalBrl);
    expect(saleOne.sellerCommissionBrl).toBe(financials.sellerCommissionBrl);
    expect(saleOne.finderCommissionBrl).toBe(financials.finderCommissionBrl);
    expect(saleOne.taxBrl).toBe(financials.taxBrl);
    expect(saleOne.netMarginBrl).toBe(financials.netMarginBrl);
    expect(saleOne.netMarginPct).toBe(financials.netMarginPct);
  });
});

describe('buildDevSeedPlan - receivable labels', () => {
  const plan = buildDevSeedPlan(INPUT);
  const saleOne = plan.rows.salesOpsSales.find(
    (row) => row.orgId === ORG_ALPHA && row.sequence === 1,
  )!;
  const saleOneReceivables = sortedReceivablesForSale(plan, saleOne.id);

  it("gives S1 exactly the installment labels 1/3, 2/3, 3/3", () => {
    const installmentLabels = saleOneReceivables
      .filter((row) => !row.label.startsWith('M'))
      .map((row) => row.label);
    expect(installmentLabels).toEqual(['1/3', '2/3', '3/3']);
  });

  it('gives S1 exactly the twelve M-prefixed recurring labels - the deriveWizardPrefill pin', () => {
    const recurringLabels = saleOneReceivables
      .filter((row) => row.label.startsWith('M'))
      .map((row) => row.label);
    expect(recurringLabels).toEqual(Array.from({ length: 12 }, (_, i) => `M${i + 1}/12`));
  });

  it('never emits a recurring-looking label missing the M prefix', () => {
    for (const row of plan.rows.salesOpsReceivables) {
      expect(row.label).toMatch(/^(M\d+|\d+)\/\d+$/);
    }
  });
});

describe('buildDevSeedPlan - payables', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('materializes payables only for the won proposta (S1) - payables materialize only at won', () => {
    const payablesBySale = new Map<string, number>();
    for (const row of plan.rows.salesOpsPayables) {
      payablesBySale.set(row.saleId, (payablesBySale.get(row.saleId) ?? 0) + 1);
    }
    for (const sale of plan.rows.salesOpsSales) {
      const count = payablesBySale.get(sale.id) ?? 0;
      if (sale.sequence === 1) {
        expect(count).toBeGreaterThan(0);
      } else {
        expect(count).toBe(0);
      }
    }
  });

  it("sums S1's professional_cost payables to exactly the professional's costBrl", () => {
    for (const orgId of ORG_IDS) {
      const saleOne = plan.rows.salesOpsSales.find(
        (row) => row.orgId === orgId && row.sequence === 1,
      )!;
      const professional = plan.rows.salesOpsSaleProfessionals.find(
        (row) => row.saleId === saleOne.id,
      )!;
      const sum = plan.rows.salesOpsPayables
        .filter((row) => row.saleId === saleOne.id && row.kind === 'professional_cost')
        .reduce((total, row) => total + row.amountBrl, 0);
      expect(sum).toBe(professional.costBrl);
    }
  });

  it('never points a professional_cost payable at an M-prefixed recurring receivable', () => {
    const receivablesById = new Map(plan.rows.salesOpsReceivables.map((row) => [row.id, row]));
    for (const payable of plan.rows.salesOpsPayables) {
      if (payable.kind !== 'professional_cost') continue;
      const receivable = receivablesById.get(payable.receivableId as string);
      expect(receivable).toBeTruthy();
      expect(receivable!.label.startsWith('M')).toBe(false);
    }
  });

  it('has exactly one other_cost payable per org, receivableId null, named Outros custos', () => {
    for (const orgId of ORG_IDS) {
      const otherCosts = plan.rows.salesOpsPayables.filter(
        (row) => row.orgId === orgId && row.kind === 'other_cost',
      );
      expect(otherCosts.length).toBe(1);
      expect(otherCosts[0]!.receivableId).toBeNull();
      expect(otherCosts[0]!.beneficiaryName).toBe('Outros custos');
    }
  });

  it('computes every seller_commission amount as pctOfCents of its own receivable, imported rather than recomputed inline', () => {
    const receivablesById = new Map(plan.rows.salesOpsReceivables.map((row) => [row.id, row]));
    const sellerCommissions = plan.rows.salesOpsPayables.filter(
      (row) => row.kind === 'seller_commission',
    );
    expect(sellerCommissions.length).toBeGreaterThan(0);
    for (const payable of sellerCommissions) {
      const receivable = receivablesById.get(payable.receivableId as string)!;
      expect(payable.amountBrl).toBe(pctOfCents(receivable.amountBrl, 5));
    }
  });
});

describe('buildDevSeedPlan - leads', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('gives exactly one converted lead (non-null saleId) per org', () => {
    for (const orgId of ORG_IDS) {
      const converted = plan.rows.salesOpsLeads.filter(
        (row) => row.orgId === orgId && row.saleId !== null,
      );
      expect(converted.length).toBe(1);
    }
  });

  it('gives exactly one lost lead per org, carrying a non-empty lostReason', () => {
    for (const orgId of ORG_IDS) {
      const lostStage = plan.rows.salesOpsLeadStages.find(
        (row) => row.orgId === orgId && row.kind === 'lost',
      )!;
      const lostLeads = plan.rows.salesOpsLeads.filter(
        (row) => row.orgId === orgId && row.stageId === lostStage.id,
      );
      expect(lostLeads.length).toBe(1);
      expect(lostLeads[0]!.lostReason).toBeTruthy();
    }
  });

  it('gives exactly one unassigned lead (sellerPersonId null) per org', () => {
    for (const orgId of ORG_IDS) {
      const unassigned = plan.rows.salesOpsLeads.filter(
        (row) => row.orgId === orgId && row.sellerPersonId === null,
      );
      expect(unassigned.length).toBe(1);
    }
  });

  it('never leaves clientNameSnapshot empty, including the free-text-company leads', () => {
    for (const lead of plan.rows.salesOpsLeads) {
      expect(lead.clientNameSnapshot.length).toBeGreaterThan(0);
    }
  });

  it('makes every stageChangedAt differ from createdAt - the parked-days pin', () => {
    for (const lead of plan.rows.salesOpsLeads) {
      expect(lead.stageChangedAt).not.toBe(lead.createdAt);
    }
  });
});

describe('buildDevSeedPlan - lead etapas', () => {
  const plan = buildDevSeedPlan(INPUT);

  it('gives every org exactly one conversion and one lost etapa, with isSystem matching kind', () => {
    for (const orgId of ORG_IDS) {
      const stages = plan.rows.salesOpsLeadStages.filter((row) => row.orgId === orgId);
      expect(stages.filter((row) => row.kind === 'conversion').length).toBe(1);
      expect(stages.filter((row) => row.kind === 'lost').length).toBe(1);
      for (const stage of stages) {
        expect(stage.isSystem).toBe(stage.kind !== 'normal');
      }
    }
  });
});
