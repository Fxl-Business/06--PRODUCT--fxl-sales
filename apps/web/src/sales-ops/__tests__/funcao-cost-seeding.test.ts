import { describe, expect, it } from 'vitest';
import {
  buildFuncaoCostBasis,
  funcaoCostSeedKey,
  planFuncaoCostSeeds,
  professionalRowWillPersist,
  type FuncaoCostBasisItem,
} from '../calculations';
import type { SalesOpsProductFuncaoCost } from '../types';

const customProductId = '11111111-1111-4111-8111-111111111111';
const landingProductId = '22222222-2222-4222-8222-222222222222';
const mentorFuncaoId = 'fc000010-0000-4000-8000-000000000010';
const testerFuncaoId = 'fc000011-0000-4000-8000-000000000011';

function costRow(patch: Partial<SalesOpsProductFuncaoCost>): SalesOpsProductFuncaoCost {
  return {
    id: `cost-${patch.productId}-${patch.funcaoId}`,
    orgId: 'org-test',
    productId: customProductId,
    funcaoId: mentorFuncaoId,
    mode: 'pct',
    valuePct: '75.00',
    valueBrl: null,
    createdAt: '2026-08-04T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function item(productId: string | undefined, productName: string, subtotalBrl: number): FuncaoCostBasisItem {
  return { productId, productName, subtotalBrl };
}

/** `Advisor 360` at R$ 20.000,00, declaring Mentor at 75%. */
const advisorItem = item(customProductId, 'Advisor 360', 2000000);
const landingItem = item(landingProductId, 'Landing Page', 1000000);
const mentorPct = costRow({ productId: customProductId, funcaoId: mentorFuncaoId });
const landingMentorFix = costRow({
  productId: landingProductId,
  funcaoId: mentorFuncaoId,
  mode: 'fix',
  valuePct: null,
  valueBrl: 30000,
});
const testerFix = costRow({
  productId: customProductId,
  funcaoId: testerFuncaoId,
  mode: 'fix',
  valuePct: null,
  valueBrl: 30000,
});

function plan(
  items: FuncaoCostBasisItem[],
  costs: SalesOpsProductFuncaoCost[],
  seededKeys: readonly string[] = [],
  allocatedFuncaoIds: readonly string[] = [],
) {
  return planFuncaoCostSeeds(
    items,
    costs,
    buildFuncaoCostBasis(items, costs),
    seededKeys,
    allocatedFuncaoIds,
  );
}

describe('funcaoCostSeedKey', () => {
  it('keys on the produto and the funcao together', () => {
    expect(funcaoCostSeedKey(customProductId, mentorFuncaoId)).toBe(
      `${customProductId}::${mentorFuncaoId}`,
    );
  });
});

describe('planFuncaoCostSeeds', () => {
  it('seeds one row per funcao an item produto declares, with the basis cents', () => {
    const result = plan([advisorItem], [mentorPct, testerFix]);

    expect(result.keys).toEqual([
      funcaoCostSeedKey(customProductId, mentorFuncaoId),
      funcaoCostSeedKey(customProductId, testerFuncaoId),
    ]);
    expect(result.seeds).toEqual([
      // 75% of R$ 20.000,00.
      { funcaoId: mentorFuncaoId, costCents: 1500000 },
      { funcaoId: testerFuncaoId, costCents: 30000 },
    ]);
  });

  it('keys a declaration on (productId, funcaoId), never on funcaoId alone', () => {
    const result = plan([advisorItem, landingItem], [mentorPct, landingMentorFix]);

    expect(result.keys).toEqual([
      funcaoCostSeedKey(customProductId, mentorFuncaoId),
      funcaoCostSeedKey(landingProductId, mentorFuncaoId),
    ]);
    expect(new Set(result.keys).size).toBe(2);
  });

  it('emits one row with the summed cents when two produtos declare the same funcao', () => {
    const items = [advisorItem, landingItem];
    const costs = [mentorPct, landingMentorFix];
    const basis = buildFuncaoCostBasis(items, costs);
    const result = planFuncaoCostSeeds(items, costs, basis, [], []);

    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0]).toEqual({
      funcaoId: mentorFuncaoId,
      costCents: basis.get(mentorFuncaoId)!.cents,
    });
    // R$ 15.000,00 from Advisor 360 plus R$ 300,00 from Landing Page.
    expect(result.seeds[0]!.costCents).toBe(1530000);
  });

  it('returns nothing once every declaration key has been seen', () => {
    const first = plan([advisorItem], [mentorPct, testerFix]);
    const second = plan([advisorItem], [mentorPct, testerFix], first.keys);

    expect(second).toEqual({ keys: [], seeds: [] });
  });

  it('records the key but emits no row for a funcao already allocated by hand', () => {
    const result = plan([advisorItem], [mentorPct], [], [mentorFuncaoId]);

    expect(result.keys).toEqual([funcaoCostSeedKey(customProductId, mentorFuncaoId)]);
    expect(result.seeds).toEqual([]);
  });

  it('does not re-emit a key for a row the operator deleted', () => {
    const seeded = [funcaoCostSeedKey(customProductId, mentorFuncaoId)];
    const result = plan([advisorItem], [mentorPct], seeded, []);

    expect(result).toEqual({ keys: [], seeds: [] });
  });

  it('ignores free-form items and any produto with no declaration', () => {
    const freeItem = item(undefined, 'Consultoria avulsa', 500000);
    const result = plan([freeItem, landingItem], [mentorPct]);

    expect(result).toEqual({ keys: [], seeds: [] });
  });

  it('emits zero cents when the declaring item has no value yet', () => {
    const servicoAtZero = item(customProductId, 'Advisor 360', 0);
    const result = plan([servicoAtZero], [mentorPct]);

    expect(result.seeds).toEqual([{ funcaoId: mentorFuncaoId, costCents: 0 }]);
  });

  it('is deterministic in item order then cost-row order', () => {
    const forward = plan([advisorItem, landingItem], [testerFix, mentorPct, landingMentorFix]);
    expect(forward.keys).toEqual([
      funcaoCostSeedKey(customProductId, testerFuncaoId),
      funcaoCostSeedKey(customProductId, mentorFuncaoId),
      funcaoCostSeedKey(landingProductId, mentorFuncaoId),
    ]);
    expect(forward.seeds.map((seed) => seed.funcaoId)).toEqual([testerFuncaoId, mentorFuncaoId]);

    const reversed = plan([landingItem, advisorItem], [testerFix, mentorPct, landingMentorFix]);
    expect(reversed.keys).toEqual([
      funcaoCostSeedKey(landingProductId, mentorFuncaoId),
      funcaoCostSeedKey(customProductId, testerFuncaoId),
      funcaoCostSeedKey(customProductId, mentorFuncaoId),
    ]);
    expect(reversed.seeds.map((seed) => seed.funcaoId)).toEqual([mentorFuncaoId, testerFuncaoId]);
  });
});

describe('professionalRowWillPersist', () => {
  /*
    The ONE predicate `createPayload` and the step-3 `Custos profissionais` sum both
    reference. Its contract is narrow on purpose: only the pessoa decides, because
    only `personName: z.string().min(1)` is what the API rejects.
  */
  it('admits a row with a pessoa and rejects a blank or whitespace-only one', () => {
    expect(professionalRowWillPersist({ personName: 'Bruno Entrega' })).toBe(true);
    expect(professionalRowWillPersist({ personName: '' })).toBe(false);
    // Whitespace is not a pessoa: `personName.trim()` is what the API sees fail.
    expect(professionalRowWillPersist({ personName: '   ' })).toBe(false);
  });
});
