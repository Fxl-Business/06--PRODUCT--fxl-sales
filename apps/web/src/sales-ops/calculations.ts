import type {
  CommissionType,
  CreateSalePayload,
  DashboardModel,
  PaymentMethod,
  SaleDraft,
  SalesOpsBootstrap,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
  SalesOpsSale,
  SalesOpsSettings,
} from './types';

const wonStatuses = new Set<string>(['won']);

function toNumber(value: string | number | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type SaleCommissionDefaultsProduct = Pick<
  SalesOpsProduct,
  | 'sellerCommissionType'
  | 'sellerCommissionValue'
  | 'sellerWithFinderCommissionType'
  | 'sellerWithFinderCommissionValue'
  | 'finderCommissionType'
  | 'finderCommissionValue'
>;

export type SaleCommissionDefaults = {
  sellerCommissionPct: number;
  finderCommissionPct: number;
};

/**
 * The one place the Produto/Serviço discriminator is read. Everything that needs
 * to branch on "is this a serviço" goes through here, so if the field ever moves
 * again this function body is the whole change.
 *
 * A row without `kind` is not a serviço. That is deliberate: the relaxations a
 * serviço earns (an optional per-item description) must never be granted to a
 * row whose classification the client cannot see.
 */
export function isServiceProduct(product: Pick<SalesOpsProduct, 'kind'> | undefined): boolean {
  return product?.kind === 'service';
}

/** Upper bound of a produto code suffix: the API accepts `/^\d{1,2}$/`, so 0..99. */
export const MAX_PRODUCT_CODE_SUFFIX = 99;

/**
 * The suffix a NEW produto/serviço should start on: the highest suffix already in the
 * catalogue, plus one.
 *
 * `(org_id, code_suffix)` is UNIQUE and the index is not partial, so every existing row -
 * archived included, Produto and Serviço alike - permanently owns its number, and a
 * duplicate INSERT escapes as a 500 (`createProduct` does not map 23505). max + 1 is
 * therefore the next guaranteed-free value in a dense catalogue.
 *
 * Only strictly-shaped values (`/^\d{1,2}$/`, the same regex the API enforces) count
 * toward the max; anything else - a legacy free-text label, an over-wide value - is
 * ignored rather than coerced, because a coerced number could name a slot someone else
 * really holds.
 *
 * Never zero-padded: the stored value is text, `'07'` and `'7'` are two distinct rows
 * under the unique index, and the suffix is concatenated verbatim into every sale code.
 */
export function nextProductCodeSuffix(
  products: readonly Pick<SalesOpsProduct, 'codeSuffix'>[],
): string {
  const used = new Set<number>();
  for (const product of products) {
    const raw = product.codeSuffix;
    if (typeof raw !== 'string' || !/^\d{1,2}$/.test(raw)) continue;
    used.add(Number.parseInt(raw, 10));
  }
  if (used.size === 0) return '0';
  const next = Math.max(...used) + 1;
  if (next <= MAX_PRODUCT_CODE_SUFFIX) return String(next);
  // 99 is taken. Fall back to the lowest free slot so the suggestion stays saveable;
  // if the whole 0..99 space is exhausted no suffix can be saved at all, and '0'
  // reproduces exactly today's behaviour rather than inventing a new failure mode.
  for (let candidate = 0; candidate <= MAX_PRODUCT_CODE_SUFFIX; candidate += 1) {
    if (!used.has(candidate)) return String(candidate);
  }
  return '0';
}

/**
 * The catalog value one unit of this row suggests, in integer CENTS. `0` means the
 * row carries no own value and the operator types one inside the proposta.
 *
 * The one place a catalog own value is read, exactly as `isServiceProduct` is the
 * one place the discriminator is read. It is deliberately kind-blind: a Produto's
 * value is a catalog price and a Serviço's is a base value, but both are DEFAULTS
 * a proposta may overwrite, so the arithmetic that prefills an item is identical.
 * The `||` (not `+`) is the pre-existing wizard rule: a row that has no setup but
 * does recur suggests its mensalidade.
 *
 * Before slice 07 a Serviço was pinned at 0 by a DB CHECK, so this returns exactly
 * what the old `openPrice ? 0 : setupBrl || monthlyBrl` returned on every row that
 * predates it.
 */
export function productBaseValueBrl(
  product: Pick<SalesOpsProduct, 'setupBrl' | 'monthlyBrl'> | undefined,
): number {
  return product ? product.setupBrl || product.monthlyBrl : 0;
}

function percentageOrFallback(
  type: CommissionType | undefined,
  value: string | number | undefined,
  fallback: number,
): number {
  return type === 'pct' ? toNumber(value, fallback) : fallback;
}

export function resolveSaleCommissionDefaults(
  product: SaleCommissionDefaultsProduct | undefined,
  hasFinder: boolean,
  settings: Pick<
    SalesOpsSettings,
    'defaultSellerCommissionPct' | 'defaultFinderCommissionPct'
  > | null,
): SaleCommissionDefaults {
  const sellerFallback = toNumber(settings?.defaultSellerCommissionPct, 10);
  const finderFallback = toNumber(settings?.defaultFinderCommissionPct, 3);

  if (!hasFinder) {
    return {
      sellerCommissionPct: percentageOrFallback(
        product?.sellerCommissionType,
        product?.sellerCommissionValue,
        sellerFallback,
      ),
      finderCommissionPct: finderFallback,
    };
  }

  return {
    sellerCommissionPct: percentageOrFallback(
      product?.sellerWithFinderCommissionType,
      product?.sellerWithFinderCommissionValue,
      sellerFallback,
    ),
    finderCommissionPct: percentageOrFallback(
      product?.finderCommissionType,
      product?.finderCommissionValue,
      finderFallback,
    ),
  };
}

/**
 * The ONE place slice 07's `SalesOpsProductFuncaoCost` shape is interpreted.
 *
 * `mode: 'pct'` reads `valuePct`, a percent serialized by drizzle as a string;
 * `mode: 'fix'` reads `valueBrl`, integer cents. If that contract ever moves, this
 * function body is the whole delta.
 */
export function resolveFuncaoCostCents(
  cost: Pick<SalesOpsProductFuncaoCost, 'mode' | 'valuePct' | 'valueBrl'>,
  subtotalBrl: number,
): number {
  if (cost.mode === 'fix') return Math.max(0, Math.floor(toNumber(cost.valueBrl ?? 0)));
  return Math.max(0, Math.floor((subtotalBrl * toNumber(cost.valuePct ?? 0)) / 100));
}

export type FuncaoCostContribution = {
  productName: string;
  subtotalBrl: number;
  mode: CommissionType;
  /** Percent points for `pct`, integer cents for `fix`. */
  value: number;
  cents: number;
};

export type FuncaoCostBasisEntry = { cents: number; contributions: FuncaoCostContribution[] };

export type FuncaoCostBasisItem = {
  productId?: string;
  productName: string;
  subtotalBrl: number;
};

/**
 * The default `CUSTO ALOCADO` per função, plus the derivation that produced it, so
 * the number rendered and the number explained can never disagree.
 *
 * The base is the item SUBTOTAL of the proposta items whose product declares a
 * default for that função, summed. Not the proposta total, and deliberately NOT
 * the recurring mensalidade: a `professional_cost` payable is one-shot at win with
 * `receivableId: null`, so pricing it off a monthly stream would charge a
 * pay-once cost against every cycle. Free-form items contribute nothing, because
 * a row with no product has no cadastro defaults to read.
 */
export function buildFuncaoCostBasis(
  items: FuncaoCostBasisItem[],
  costs: SalesOpsProductFuncaoCost[],
): Map<string, FuncaoCostBasisEntry> {
  const costsByProduct = new Map<string, SalesOpsProductFuncaoCost[]>();
  for (const cost of costs) {
    const bucket = costsByProduct.get(cost.productId);
    if (bucket) bucket.push(cost);
    else costsByProduct.set(cost.productId, [cost]);
  }

  const basis = new Map<string, FuncaoCostBasisEntry>();
  for (const item of items) {
    if (!item.productId) continue;
    for (const cost of costsByProduct.get(item.productId) ?? []) {
      const cents = resolveFuncaoCostCents(cost, item.subtotalBrl);
      const entry = basis.get(cost.funcaoId) ?? { cents: 0, contributions: [] };
      entry.cents += cents;
      entry.contributions.push({
        productName: item.productName,
        subtotalBrl: item.subtotalBrl,
        mode: cost.mode,
        value: cost.mode === 'fix' ? toNumber(cost.valueBrl ?? 0) : toNumber(cost.valuePct ?? 0),
        cents,
      });
      basis.set(cost.funcaoId, entry);
    }
  }
  return basis;
}

/** `5% de FXL Custom (R$ 20.000,00) + R$ 300,00 de Landing Page`. */
export function describeFuncaoCostBasis(entry: FuncaoCostBasisEntry | undefined): string {
  if (!entry || entry.contributions.length === 0) return '';
  return entry.contributions
    .map((contribution) =>
      contribution.mode === 'fix'
        ? `${formatMoneyBrl(contribution.value)} de ${contribution.productName}`
        : `${contribution.value}% de ${contribution.productName} (${formatMoneyBrl(contribution.subtotalBrl)})`,
    )
    .join(' + ');
}

export type ProfessionalCostUnit = 'pct' | 'fix';

/**
 * The cents a wizard `%` professional cost is measured against.
 *
 * INPUT MODE ONLY: nothing here is persisted. `sales_ops_sale_professionals` stores a
 * single integer-cents `cost_brl`, so a `%` is resolved before it ever reaches the wire.
 *
 * Primary base: the item subtotals of the proposta items whose produto declares this
 * função, which is exactly what `buildFuncaoCostBasis` already summed. NOT the proposta
 * total, and never the recurring mensalidade - a `professional_cost` payable is one-shot
 * at win, so pricing it off a monthly stream would charge a pay-once cost against every
 * cycle.
 *
 * Fallback, when no produto on this proposta declares the função (the inline-created
 * função case): the sum of every PRODUCT item subtotal. Free-form items contribute
 * nothing and the recorrência is still excluded, so both branches obey the same rule.
 */
export function professionalCostBaseCents(
  entry: FuncaoCostBasisEntry | undefined,
  productItemsSubtotalCents: number,
): number {
  const scoped = scopedBaseCents(entry);
  if (scoped > 0) return scoped;
  return Math.max(0, Math.floor(productItemsSubtotalCents));
}

/**
 * A função gets at most one contribution per item (one cost row per
 * `(productId, funcaoId)`), so this sum is exactly "the item subtotals of the items
 * whose produto declares this função", with no double counting.
 */
function scopedBaseCents(entry: FuncaoCostBasisEntry | undefined): number {
  return (entry?.contributions ?? []).reduce(
    (sum, contribution) => sum + contribution.subtotalBrl,
    0,
  );
}

/** `10% de R$ 20.000,00 (FXL Custom)`, or `... (total dos itens de produto)` on the fallback base. */
export function describeProfessionalCostBase(
  pct: string | number,
  entry: FuncaoCostBasisEntry | undefined,
  productItemsSubtotalCents: number,
): string {
  const base = professionalCostBaseCents(entry, productItemsSubtotalCents);
  if (base <= 0) return '';
  const source =
    scopedBaseCents(entry) > 0
      ? [...new Set((entry?.contributions ?? []).map((contribution) => contribution.productName))].join(
          ' + ',
        )
      : 'total dos itens de produto';
  return `${toNumber(pct, 0)}% de ${formatMoneyBrl(base)} (${source})`;
}

/**
 * The ONE place a wizard professional row turns into cents. `fix` reads the reais input,
 * `pct` delegates to `resolveFuncaoCostCents` so there is a single percentage-of-basis
 * implementation in the app.
 */
export function resolveProfessionalCostCents(
  row: { costUnit: ProfessionalCostUnit; costPct: string; costBrl: string },
  baseCents: number,
): number {
  if (row.costUnit === 'fix') return parseCurrencyInputToCents(row.costBrl);
  return resolveFuncaoCostCents({ mode: 'pct', valuePct: row.costPct, valueBrl: null }, baseCents);
}

function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseCurrencyInputToCents(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }
  const trimmed = value?.trim();
  if (!trimmed) return 0;

  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');
  let normalized = trimmed;

  if (hasComma) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const parts = trimmed.split('.');
    const lastPart = parts.at(-1) ?? '';
    normalized =
      lastPart.length > 0 && lastPart.length <= 2
        ? trimmed.replace(/,/g, '')
        : trimmed.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function formatMoneyBrl(
  cents: number,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: options?.minimumFractionDigits ?? maximumFractionDigits,
    maximumFractionDigits,
  })
    .format(cents / 100)
    .replace(/\u00a0/g, ' ');
}

/**
 * Adds whole months and CLAMPS to the last valid day of the target month, so
 * `2026-01-31` plus one month is `2026-02-28` and not the native
 * `Date.UTC(y, m + 1, 31)` rollover into March.
 *
 * This is character for character what the API's own `addMonths` in
 * `apps/api/src/domains/sales-ops/service.ts` does. Before the clamp the two
 * disagreed for every base day of 29-31, which meant the wizard previewed
 * recurring due dates the API would never persist.
 *
 * Callers must pass an ABSOLUTE offset from one anchor rather than stepping one
 * month at a time: `addMonthsToIsoDate('2026-01-31', 2)` is `2026-03-31`, while
 * clamping twice in a row would drift to `2026-03-28`.
 */
export function addMonthsToIsoDate(value: string, months: number): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function splitInstallmentsEqually(
  totalCents: number,
  count: number,
  startDate: string,
  method: PaymentMethod,
): Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }> {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, index) => ({
    dueDate: addMonthsToIsoDate(startDate, index),
    amountBrl: index === n - 1 ? totalCents - base * (n - 1) : base,
    method,
  }));
}

export function installmentSumCents(rows: Array<{ amountBrl: string | number }>): number {
  return rows.reduce((sum, row) => sum + parseCurrencyInputToCents(row.amountBrl), 0);
}

/**
 * `installments: max(120)` on the sale write endpoints counts the entrada row too,
 * so this is the ceiling on the whole generated array and not on the restante alone.
 */
export const MAX_PLAN_INSTALLMENTS = 120;

export type PaymentPlanEntradaMode = 'none' | 'pct' | 'fix';

/**
 * The declarative description of a payment plan: an optional entrada plus the
 * restante split over N monthly parcelas, anchored on one date.
 *
 * It is a FORMULA, not the plan: `generateInstallmentPlan` turns it into the
 * persisted `installments[]` rows and `inferPaymentPlanShape` reads it back out of
 * them. The persisted shape is untouched by this vocabulary.
 *
 * `entradaMode` uses `fix` rather than `fixed` on purpose: those are the literals
 * the produto cadastro already persists in `defaultEntradaMode` (CLAUDE.md), and one
 * spelling across the whole app beats a translation layer between two.
 */
export type PaymentPlanShape = {
  entradaMode: PaymentPlanEntradaMode;
  /** Percent (0-100) when `pct`, integer CENTS when `fix`, ignored when `none`. */
  entradaValue: number;
  /** Parcelas the restante is split into, 1-120. The entrada row is not one of them. */
  restanteCount: number;
  /** yyyy-mm-dd. The due date of row 1, whether that row is the entrada or not. */
  anchorDate: string;
};

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * The entrada in integer cents, clamped into `[0, totalCents]`.
 *
 * A percentage is rounded half-up on integer cents rather than on reais, and a fixed
 * entrada above the total is clamped down rather than rejected, so no cadastro
 * default can make a small proposta unsavable. Both rules match the API's
 * `materializeDefaultPaymentPlan`.
 */
export function entradaCentsFor(totalCents: number, shape: PaymentPlanShape): number {
  const total = Math.max(0, Math.floor(finiteOrZero(totalCents)));
  const value = finiteOrZero(shape.entradaValue);
  const raw =
    shape.entradaMode === 'pct'
      ? Math.round((total * value) / 100)
      : shape.entradaMode === 'fix'
        ? Math.floor(value)
        : 0;
  return Math.min(Math.max(raw, 0), total);
}

function methodAt(methods: PaymentMethod[], index: number): PaymentMethod {
  return methods[index] ?? methods.at(-1) ?? 'pix';
}

/**
 * How many restante parcelas a plan may configure. The entrada row counts against
 * the sale endpoints' `installments: max(120)`, so a plan with one gets 119 and a
 * plan without gets the full 120.
 *
 * Keyed on the MODE rather than on the computed entrada cents, so the number the
 * `Restante` input caps at does not jump around while the operator is still typing
 * the entrada value.
 */
export function maxRemainingInstallments(entradaMode: PaymentPlanEntradaMode): number {
  return entradaMode === 'none' ? MAX_PLAN_INSTALLMENTS : MAX_PLAN_INSTALLMENTS - 1;
}

export function restanteCountFor(shape: PaymentPlanShape): number {
  const raw = Math.floor(finiteOrZero(shape.restanteCount));
  return Math.max(1, Math.min(maxRemainingInstallments(shape.entradaMode), raw || 1));
}

/**
 * Turns a `PaymentPlanShape` into the exact `installments[]` rows the proposta will
 * persist.
 *
 * `sum(rows) === totalCents` holds for EVERY input, with no precondition on the
 * caller: the restante split delegates to `splitInstallmentsEqually`, whose last row
 * absorbs the whole floor remainder, and `restanteCountFor` caps the count low enough
 * that the entrada row still fits under `MAX_PLAN_INSTALLMENTS`. The array is never
 * truncated after the fact, because the row that would be dropped is precisely the
 * one carrying the remainder.
 *
 * `methods` carries the operator's per-row `Forma` choices POSITIONALLY, because
 * Forma is genuinely free per row and must survive a regeneration instead of
 * blocking it. Row `i` keeps `methods[i]`, and the tail inherits the last known one.
 */
export function generateInstallmentPlan(
  totalCents: number,
  shape: PaymentPlanShape,
  methods: PaymentMethod[],
): Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }> {
  const total = Math.max(0, Math.floor(finiteOrZero(totalCents)));
  const entradaCents = entradaCentsFor(total, shape);
  const restanteCents = total - entradaCents;
  const anchorDate = shape.anchorDate;
  const rows: Array<{ dueDate: string; amountBrl: number }> = [];

  if (entradaCents > 0) rows.push({ dueDate: anchorDate, amountBrl: entradaCents });
  if (restanteCents > 0) {
    const offset = entradaCents > 0 ? 1 : 0;
    // The amounts come from splitInstallmentsEqually, but the dates are recomputed
    // from the anchor with an absolute offset so month-end clamping cannot drift.
    splitInstallmentsEqually(restanteCents, restanteCountFor(shape), anchorDate, 'pix').forEach(
      (row, index) => {
        rows.push({
          dueDate: addMonthsToIsoDate(anchorDate, index + offset),
          amountBrl: row.amountBrl,
        });
      },
    );
  }
  // A 100 percent entrada must not leave a trailing 0-cent parcela, but the array
  // still has to satisfy `installments: min(1)`.
  if (rows.length === 0) rows.push({ dueDate: anchorDate, amountBrl: 0 });

  return rows.map((row, index) => ({ ...row, method: methodAt(methods, index) }));
}

/**
 * Reads a `PaymentPlanShape` back out of stored installment rows by
 * REGENERATE-AND-COMPARE over three ordered candidates, never by bespoke pattern
 * matching. A candidate wins only when it reproduces every stored `dueDate` and
 * `amountBrl` exactly, which makes a false positive impossible.
 *
 * `method` is excluded from the comparison because it is free per row and carried
 * positionally by the generator.
 *
 * `matchesFormula: false` means the rows are hand-tuned. The caller must then keep
 * them verbatim and treat the returned shape as a best-effort DESCRIPTION of the
 * table rather than as its source, so a false negative costs an extra "adjusted
 * manually" line and never a rewritten schedule.
 */
export function inferPaymentPlanShape(
  totalCents: number,
  rows: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>,
  fallbackAnchorDate: string,
): { shape: PaymentPlanShape; matchesFormula: boolean } {
  const first = rows[0];
  if (!first) {
    return {
      shape: {
        entradaMode: 'none',
        entradaValue: 0,
        restanteCount: 1,
        anchorDate: fallbackAnchorDate,
      },
      matchesFormula: true,
    };
  }

  // The anchor comes from the rows, not from the proposta base date, so a plan whose
  // first parcela is later than the proposal still infers cleanly.
  const anchorDate = first.dueDate;
  const count = rows.length;
  const candidates: PaymentPlanShape[] = [
    { entradaMode: 'none', entradaValue: 0, restanteCount: count, anchorDate },
  ];

  if (count >= 2) {
    const entradaCents = first.amountBrl;
    const pct = totalCents > 0 ? (entradaCents * 100) / totalCents : 0;
    // "Clean" means an operator could have typed it: at most two decimals, and it has
    // to reproduce the entrada to the cent. Otherwise `%` would show a rounded lie.
    const cleanPct =
      totalCents > 0 &&
      Math.abs(pct * 100 - Math.round(pct * 100)) < 1e-9 &&
      Math.round((totalCents * pct) / 100) === entradaCents;
    if (cleanPct) {
      candidates.push({
        entradaMode: 'pct',
        entradaValue: pct,
        restanteCount: count - 1,
        anchorDate,
      });
    }
    // A fixed entrada always reproduces itself exactly, so it is the reliable
    // fallback and `%` is only ever preferred when it is genuinely lossless.
    candidates.push({
      entradaMode: 'fix',
      entradaValue: entradaCents,
      restanteCount: count - 1,
      anchorDate,
    });
  }

  const methods = rows.map((row) => row.method);
  for (const candidate of candidates) {
    const generated = generateInstallmentPlan(totalCents, candidate, methods);
    const matches =
      generated.length === count &&
      generated.every(
        (row, index) =>
          row.dueDate === rows[index]!.dueDate && row.amountBrl === rows[index]!.amountBrl,
      );
    if (matches) return { shape: candidate, matchesFormula: true };
  }

  return { shape: candidates.at(-1)!, matchesFormula: false };
}

/**
 * The ONE seam between the produto cadastro's default payment plan and the proposta
 * wizard's builder. The cadastro persists the template as six flat columns
 * (CLAUDE.md); three of them describe the shape, and this is where they are read.
 *
 * `defaultEntradaMode: 'none'` plus `defaultRemainingInstallments: 1` IS the app
 * default and reproduces a single cash parcela, so a product with no stored template
 * and a product with the default one behave identically.
 *
 * `defaultPaymentMethod` and `defaultRecurringCycles` are deliberately NOT read
 * here: neither is part of the shape, and per-proposta overrides of the remaining
 * defaults are their own slice.
 */
export function defaultPlanShapeForProduct(
  product:
    | Pick<
        SalesOpsProduct,
        | 'defaultEntradaMode'
        | 'defaultEntradaPct'
        | 'defaultEntradaBrl'
        | 'defaultRemainingInstallments'
      >
    | undefined,
  baseDate: string,
): PaymentPlanShape {
  const entradaMode = product?.defaultEntradaMode ?? 'none';
  const entradaValue =
    entradaMode === 'pct'
      ? Math.max(0, toNumber(product?.defaultEntradaPct ?? undefined, 0))
      : entradaMode === 'fix'
        ? Math.max(0, Math.floor(product?.defaultEntradaBrl ?? 0))
        : 0;
  return {
    entradaMode,
    entradaValue,
    restanteCount: Math.max(
      1,
      Math.min(MAX_PLAN_INSTALLMENTS, Math.floor(product?.defaultRemainingInstallments ?? 1) || 1),
    ),
    anchorDate: baseDate,
  };
}

export function buildSalePayload(draft: SaleDraft): CreateSalePayload {
  return {
    clientId: cleanId(draft.clientId),
    clientName: draft.clientName.trim(),
    sellerPersonId: cleanId(draft.sellerPersonId),
    sellerName: draft.sellerName.trim(),
    finderPersonId: cleanId(draft.finderPersonId),
    finderName: cleanId(draft.finderName) ?? null,
    status: draft.status,
    baseDate: draft.baseDate,
    notes: cleanId(draft.notes) ?? null,
    sellerCommissionPct: toNumber(draft.sellerCommissionPct),
    finderCommissionPct: toNumber(draft.finderCommissionPct),
    taxPct: toNumber(draft.taxPct),
    otherCostsBrl: Math.max(0, Math.floor(toNumber(draft.otherCostsBrl))),
    installments: draft.installments.map((row) => ({
      dueDate: row.dueDate,
      amountBrl: Math.max(0, Math.floor(toNumber(row.amountBrl))),
      method: row.method,
    })),
    recurring: draft.recurring
      ? {
          monthlyBrl: Math.max(0, Math.floor(toNumber(draft.recurring.monthlyBrl))),
          startDate: draft.recurring.startDate,
          cycles: draft.recurring.cycles === null ? null : Math.max(1, Math.floor(draft.recurring.cycles)),
          method: draft.recurring.method ?? 'pix',
        }
      : null,
    items: draft.items.map((item) => ({
      productId: cleanId(item.productId),
      areaId: cleanId(item.areaId),
      productName: item.productName.trim(),
      productType: item.productType.trim() || 'SaaS',
      quantity: Math.max(1, Math.floor(toNumber(item.quantity, 1))),
      unitBrl: Math.max(0, Math.floor(toNumber(item.unitBrl))),
    })),
    professionals: draft.professionals.map((professional) => ({
      personId: cleanId(professional.personId),
      personName: professional.personName.trim(),
      funcaoId: cleanId(professional.funcaoId),
      /*
        The API derives `funcao_name_snapshot` from the resolved cadastro row and
        ignores whatever arrives here, so `role` is sent only to keep the legacy
        free-text path (`funcaoId` absent) a valid payload. `undefined` rather than
        `''` because SaleProfessionalSchema.role is `.min(1).optional()`.
      */
      role: professional.role?.trim() || undefined,
      costBrl: Math.max(0, Math.floor(toNumber(professional.costBrl))),
    })),
  };
}

function saleTime(sale: SalesOpsSale): number {
  return new Date(sale.createdAt || sale.baseDate).getTime();
}

export function buildDashboardModel(bootstrap: SalesOpsBootstrap): DashboardModel {
  const activeSales = bootstrap.sales.filter((sale) => sale.status !== 'cancelled');
  const wonSales = activeSales.filter((sale) => wonStatuses.has(sale.status));
  const payableBrl = bootstrap.payables
    .filter((payable) => payable.status === 'open')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);
  const revenueMap = new Map<string, number>();
  const sellerMap = new Map<string, { totalBrl: number; commissionBrl: number; count: number }>();
  const finderMap = new Map<string, { totalBrl: number; commissionBrl: number; count: number }>();

  for (const item of bootstrap.saleItems) {
    revenueMap.set(
      item.productNameSnapshot,
      (revenueMap.get(item.productNameSnapshot) ?? 0) + item.subtotalBrl,
    );
  }

  for (const sale of wonSales) {
    const seller = sellerMap.get(sale.sellerNameSnapshot) ?? {
      totalBrl: 0,
      commissionBrl: 0,
      count: 0,
    };
    seller.totalBrl += sale.totalBrl;
    seller.commissionBrl += sale.sellerCommissionBrl;
    seller.count += 1;
    sellerMap.set(sale.sellerNameSnapshot, seller);

    if (sale.finderNameSnapshot) {
      const finder = finderMap.get(sale.finderNameSnapshot) ?? {
        totalBrl: 0,
        commissionBrl: 0,
        count: 0,
      };
      finder.totalBrl += sale.totalBrl;
      finder.commissionBrl += sale.finderCommissionBrl;
      finder.count += 1;
      finderMap.set(sale.finderNameSnapshot, finder);
    }
  }

  const maxProductRevenue = Math.max(1, ...revenueMap.values());

  return {
    kpis: {
      wonRevenueBrl: wonSales.reduce((sum, sale) => sum + sale.totalBrl, 0),
      activeMrrBrl: activeSales.reduce((sum, sale) => sum + sale.recurringBrl, 0),
      payableBrl,
      wonSalesCount: wonSales.length,
    },
    revenueByProduct: [...revenueMap.entries()]
      .map(([name, amountBrl]) => ({
        name,
        amountBrl,
        widthPct: Math.round((amountBrl / maxProductRevenue) * 100),
      }))
      .sort((a, b) => b.amountBrl - a.amountBrl),
    topSellers: [...sellerMap.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.commissionBrl - a.commissionBrl),
    topFinders: [...finderMap.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.commissionBrl - a.commissionBrl),
    latestSales: [...activeSales].sort((a, b) => saleTime(b) - saleTime(a)).slice(0, 6),
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
