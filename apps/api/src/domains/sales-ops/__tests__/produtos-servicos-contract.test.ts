import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ProductSchema,
  UpdateProductSchema,
  resolveProductKind,
} from '../service.js';

const areaId = randomUUID();
const funcaoId = randomUUID();
const otherFuncaoId = randomUUID();

const completeProduct = {
  name: 'Produtos & Serviços fixture',
  areaId,
  sellerCommissionType: 'pct' as const,
  sellerCommissionValue: 10,
  sellerWithFinderCommissionType: 'pct' as const,
  sellerWithFinderCommissionValue: 7,
  finderCommissionType: 'pct' as const,
  finderCommissionValue: 3,
};

describe('produtos & serviços write contract', () => {
  it('defaults a product payload to kind product with the cash payment template', () => {
    const parsed = ProductSchema.parse(completeProduct);

    expect(resolveProductKind(parsed)).toBe('product');
    expect(parsed.defaultPaymentMethod).toBe('pix');
    expect(parsed.defaultEntradaMode).toBe('none');
    expect(parsed.defaultRemainingInstallments).toBe(1);
    // The recurring amount is never duplicated into the defaults block: it stays
    // monthlyBrl, and hasMonthly is what says "this recurs".
    expect(parsed).not.toHaveProperty('defaultRecurringMonthlyBrl');
  });

  it('accepts a servico with no own value', () => {
    const parsed = ProductSchema.parse({
      ...completeProduct,
      kind: 'service',
      setupBrl: 0,
      monthlyBrl: 0,
    });

    expect(parsed.kind).toBe('service');
    expect(resolveProductKind(parsed)).toBe('service');
  });

  it('accepts a base value on a servico exactly as on a produto', () => {
    // A Serviço's own value is a BASE value: a per-proposta default, exactly like a
    // Produto's catalog price. The `service_cannot_have_fixed_value` refine that
    // used to reject these two payloads is gone (slice 07).
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'service', setupBrl: 5000 }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        kind: 'service',
        hasMonthly: true,
        monthlyBrl: 5000,
      }).success,
    ).toBe(true);

    // Positive control: a Produto still takes a fixed own value.
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'product', setupBrl: 5000 }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        kind: 'product',
        hasMonthly: true,
        monthlyBrl: 5000,
      }).success,
    ).toBe(true);
  });

  it('accepts the legacy openPrice alias and maps it to kind service', () => {
    // This is what keeps master's product dialog working before slice 10 lands.
    const asService = ProductSchema.parse({ ...completeProduct, openPrice: true });
    expect(resolveProductKind(asService)).toBe('service');

    const asProduct = ProductSchema.parse({ ...completeProduct, openPrice: false });
    expect(resolveProductKind(asProduct)).toBe('product');

    // No alias and no kind at all still resolves, because the dialog may send neither.
    expect(resolveProductKind(ProductSchema.parse(completeProduct))).toBe('product');
  });

  it('still accepts the exact payload master product dialog sends', () => {
    // The pre-slice-10 dialog sends `type` (now removed) and `openPrice` (now the
    // deprecated alias) and no `kind` at all. Nothing about it may 400.
    const legacyDialogPayload = {
      ...completeProduct,
      type: 'SaaS',
      openPrice: true,
      setupBrl: 0,
      hasMonthly: false,
      monthlyBrl: 0,
      modules: [],
      providers: [{ personName: 'Ana', commissionType: 'pct' as const, commissionValue: 5 }],
      status: 'active' as const,
    };

    const parsed = ProductSchema.parse(legacyDialogPayload);

    expect(resolveProductKind(parsed)).toBe('service');
    // The removed key is stripped, not rejected.
    expect(parsed).not.toHaveProperty('type');
    // The deprecated providers array is still accepted and returned unchanged.
    expect(parsed.providers).toEqual([
      { personName: 'Ana', commissionType: 'pct', commissionValue: 5 },
    ]);
    expect(UpdateProductSchema.safeParse({ type: 'SaaS', openPrice: false }).success).toBe(true);
  });

  it('rejects a kind and openPrice contradiction', () => {
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'product', openPrice: true }).success,
    ).toBe(false);
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'service', openPrice: false }).success,
    ).toBe(false);

    // Positive controls: the agreeing pairs both parse.
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'service', openPrice: true }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({ ...completeProduct, kind: 'product', openPrice: false }).success,
    ).toBe(true);
  });

  it('accepts a pct funcao cost and a fix funcao cost in one payload', () => {
    const parsed = ProductSchema.parse({
      ...completeProduct,
      productFuncaoCosts: [
        { funcaoId, mode: 'pct', valuePct: 5 },
        { funcaoId: otherFuncaoId, mode: 'fix', valueBrl: 30000 },
      ],
    });

    expect(parsed.productFuncaoCosts).toEqual([
      { funcaoId, mode: 'pct', valuePct: 5 },
      // 30000 CENTS, i.e. R$ 300,00. Money is integer cents per schema.ts.
      { funcaoId: otherFuncaoId, mode: 'fix', valueBrl: 30000 },
    ]);
  });

  it('rejects a funcao cost that mixes units', () => {
    const cases = [
      { funcaoId, mode: 'pct', valueBrl: 30000 },
      { funcaoId, mode: 'fix', valuePct: 5 },
      { funcaoId, mode: 'pct' },
      { funcaoId, mode: 'fix' },
      { funcaoId, mode: 'brl', valueBrl: 30000 },
      // A pct above 100 is not a rate.
      { funcaoId, mode: 'pct', valuePct: 101 },
      // Cents are integers.
      { funcaoId, mode: 'fix', valueBrl: 300.5 },
    ];
    for (const cost of cases) {
      expect(
        ProductSchema.safeParse({ ...completeProduct, productFuncaoCosts: [cost] }).success,
        `expected ${JSON.stringify(cost)} to be rejected`,
      ).toBe(false);
    }

    // Positive controls for the two well-formed shapes.
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        productFuncaoCosts: [{ funcaoId, mode: 'pct', valuePct: 5 }],
      }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        productFuncaoCosts: [{ funcaoId, mode: 'fix', valueBrl: 30000 }],
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate funcaoId rows', () => {
    const duplicated = ProductSchema.safeParse({
      ...completeProduct,
      productFuncaoCosts: [
        { funcaoId, mode: 'pct', valuePct: 5 },
        { funcaoId, mode: 'fix', valueBrl: 30000 },
      ],
    });

    expect(duplicated.success).toBe(false);
    if (duplicated.success) throw new Error('unreachable');
    expect(duplicated.error.issues.map((issue) => issue.message)).toContain(
      'duplicate_funcao_cost',
    );

    // Positive control: two DIFFERENT funções may each carry a cost.
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        productFuncaoCosts: [
          { funcaoId, mode: 'pct', valuePct: 5 },
          { funcaoId: otherFuncaoId, mode: 'fix', valueBrl: 30000 },
        ],
      }).success,
    ).toBe(true);
  });

  it('validates the entrada mode and value pairing', () => {
    const rejected = [
      { defaultEntradaMode: 'none', defaultEntradaPct: 50 },
      { defaultEntradaMode: 'none', defaultEntradaBrl: 50000 },
      { defaultEntradaMode: 'pct' },
      { defaultEntradaMode: 'pct', defaultEntradaBrl: 50000 },
      { defaultEntradaMode: 'pct', defaultEntradaPct: 50, defaultEntradaBrl: 50000 },
      { defaultEntradaMode: 'fix' },
      { defaultEntradaMode: 'fix', defaultEntradaPct: 50 },
    ];
    for (const patch of rejected) {
      expect(
        ProductSchema.safeParse({ ...completeProduct, ...patch }).success,
        `expected ${JSON.stringify(patch)} to be rejected`,
      ).toBe(false);
    }

    // Positive controls for each of the three well-formed modes.
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        defaultEntradaMode: 'pct',
        defaultEntradaPct: 50,
      }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({
        ...completeProduct,
        defaultEntradaMode: 'fix',
        defaultEntradaBrl: 50000,
      }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({ ...completeProduct, defaultEntradaMode: 'none' }).success,
    ).toBe(true);
  });

  it('bounds the default installment count and recurring cycles', () => {
    for (const defaultRemainingInstallments of [0, 121, 1.5, -1]) {
      expect(
        ProductSchema.safeParse({ ...completeProduct, defaultRemainingInstallments }).success,
        `expected ${defaultRemainingInstallments} parcelas to be rejected`,
      ).toBe(false);
    }
    for (const defaultRecurringCycles of [0, 121, 2.5]) {
      expect(
        ProductSchema.safeParse({ ...completeProduct, defaultRecurringCycles }).success,
        `expected ${defaultRecurringCycles} cycles to be rejected`,
      ).toBe(false);
    }

    // Positive controls, including the boundaries and the indefinite recurrence.
    expect(
      ProductSchema.safeParse({ ...completeProduct, defaultRemainingInstallments: 1 }).success,
    ).toBe(true);
    expect(
      ProductSchema.safeParse({ ...completeProduct, defaultRemainingInstallments: 120 }).success,
    ).toBe(true);
    const indefinite = ProductSchema.parse({
      ...completeProduct,
      defaultRecurringCycles: null,
    });
    expect(indefinite.defaultRecurringCycles).toBeNull();
  });

  it('UpdateProductSchema partials every field while keeping the invariants', () => {
    expect(UpdateProductSchema.safeParse({ name: 'x' }).success).toBe(true);
    expect(UpdateProductSchema.safeParse({}).success).toBe(true);
    // areaId is required on create but optional on patch.
    expect(ProductSchema.safeParse({ name: 'x' }).success).toBe(false);

    // A base value on a partial serviço patch is as legal as one on a produto:
    // the value is a per-proposta default either way (slice 07).
    expect(UpdateProductSchema.safeParse({ kind: 'service', setupBrl: 100 }).success).toBe(true);
    expect(UpdateProductSchema.safeParse({ kind: 'product', setupBrl: 100 }).success).toBe(true);
    expect(UpdateProductSchema.safeParse({ kind: 'service', openPrice: false }).success).toBe(
      false,
    );
    expect(
      UpdateProductSchema.safeParse({ defaultEntradaMode: 'pct', defaultEntradaPct: 50 }).success,
    ).toBe(true);
    expect(UpdateProductSchema.safeParse({ defaultEntradaMode: 'pct' }).success).toBe(false);
    // An entrada value on its own carries no mode to contradict, so the schema
    // lets it through and updateProduct re-checks it against the merged row.
    expect(UpdateProductSchema.safeParse({ defaultEntradaPct: 50 }).success).toBe(true);
  });

  it('resolveProductKind prefers kind, then the alias, then the stored row', () => {
    expect(resolveProductKind({ kind: 'service', openPrice: false })).toBe('service');
    expect(resolveProductKind({ openPrice: true })).toBe('service');
    expect(resolveProductKind({ openPrice: false })).toBe('product');
    expect(resolveProductKind({}, 'service')).toBe('service');
    expect(resolveProductKind({}, 'product')).toBe('product');
    expect(resolveProductKind({})).toBe('product');
    // A patch that says nothing must never silently reclassify a stored Serviço.
    expect(resolveProductKind({ name: 'renamed' } as { kind?: never }, 'service')).toBe('service');
  });
});
