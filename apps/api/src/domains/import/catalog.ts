/**
 * Read-only. The routes seed default etapas (`ensureLeadStages`) and system funções
 * (`ensureSystemFuncoes`) in the same transaction BEFORE calling this (Amendment D11/D11b).
 */
import { and, asc, eq } from 'drizzle-orm';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import {
  salesOpsAreas,
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsLeadStages,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProductFuncaoCosts,
  salesOpsProducts,
  salesOpsSettings,
} from '../../db/schema.js';
import { isProducerFlowLive } from '../integration/producer-gate.js';
import {
  ProductEntradaModeSchema,
  ProductKindSchema,
  SaleInstallmentSchema,
  type Db,
} from '../sales-ops/service.js';
import type {
  ImportCatalog,
  ImportCatalogSettings,
  ProductCatalogEntry,
  ProductCatalogFuncaoCost,
} from './types.js';

export const DEFAULT_IMPORT_SETTINGS: ImportCatalogSettings = {
  defaultSellerCommissionPct: 10,
  defaultFinderCommissionPct: 3,
  defaultTaxPct: 6,
};

/** One drizzle numeric string (or null) to a number. */
export function numericToNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error('invalid numeric value');
  return n;
}

function commissionType(value: string): 'pct' | 'fix' {
  return value === 'fix' ? 'fix' : 'pct';
}

export async function readImportCatalog(tx: Db, orgId: string, now: Date): Promise<ImportCatalog> {
  const areas = await tx
    .select({ id: salesOpsAreas.id, name: salesOpsAreas.name, status: salesOpsAreas.status })
    .from(salesOpsAreas)
    .where(eq(salesOpsAreas.orgId, orgId))
    .orderBy(asc(salesOpsAreas.name));

  const funcoes = await tx
    .select({
      id: salesOpsFuncoes.id,
      name: salesOpsFuncoes.name,
      slug: salesOpsFuncoes.slug,
      isSystem: salesOpsFuncoes.isSystem,
      status: salesOpsFuncoes.status,
    })
    .from(salesOpsFuncoes)
    .where(eq(salesOpsFuncoes.orgId, orgId))
    .orderBy(asc(salesOpsFuncoes.name));

  const productRows = await tx
    .select()
    .from(salesOpsProducts)
    .where(eq(salesOpsProducts.orgId, orgId))
    .orderBy(asc(salesOpsProducts.name));
  const costRows = await tx
    .select({
      productId: salesOpsProductFuncaoCosts.productId,
      funcaoId: salesOpsProductFuncaoCosts.funcaoId,
      mode: salesOpsProductFuncaoCosts.mode,
      valuePct: salesOpsProductFuncaoCosts.valuePct,
      valueBrl: salesOpsProductFuncaoCosts.valueBrl,
    })
    .from(salesOpsProductFuncaoCosts)
    .where(eq(salesOpsProductFuncaoCosts.orgId, orgId))
    .orderBy(asc(salesOpsProductFuncaoCosts.productId), asc(salesOpsProductFuncaoCosts.funcaoId));

  const costsByProduct = new Map<string, ProductCatalogFuncaoCost[]>();
  for (const row of costRows) {
    const cost: ProductCatalogFuncaoCost =
      row.mode === 'fix'
        ? { funcaoId: row.funcaoId, mode: 'fix', valueBrl: row.valueBrl ?? 0 }
        : { funcaoId: row.funcaoId, mode: 'pct', valuePct: numericToNumber(row.valuePct) ?? 0 };
    const list = costsByProduct.get(row.productId);
    if (list) list.push(cost);
    else costsByProduct.set(row.productId, [cost]);
  }

  const products: ProductCatalogEntry[] = productRows.map((row) => {
    const kind = ProductKindSchema.safeParse(row.kind);
    const method = SaleInstallmentSchema.shape.method.safeParse(row.defaultPaymentMethod);
    const entradaMode = ProductEntradaModeSchema.safeParse(row.defaultEntradaMode);
    return {
      id: row.id,
      name: row.name,
      codeSuffix: row.codeSuffix,
      kind: kind.success ? kind.data : 'product',
      areaId: row.areaId,
      status: row.status,
      setupBrl: row.setupBrl,
      hasMonthly: row.hasMonthly,
      monthlyBrl: row.monthlyBrl,
      recurringCommission: row.recurringCommission,
      hasFinderCommission: row.hasFinderCommission,
      sellerCommissionType: commissionType(row.sellerCommissionType),
      sellerCommissionValue: numericToNumber(row.sellerCommissionValue) ?? 0,
      sellerWithFinderCommissionType: commissionType(row.sellerWithFinderCommissionType),
      sellerWithFinderCommissionValue: numericToNumber(row.sellerWithFinderCommissionValue) ?? 0,
      finderCommissionType: commissionType(row.finderCommissionType),
      finderCommissionValue: numericToNumber(row.finderCommissionValue) ?? 0,
      defaultPaymentMethod: method.success ? method.data : 'pix',
      defaultEntradaMode: entradaMode.success ? entradaMode.data : 'none',
      defaultEntradaPct: numericToNumber(row.defaultEntradaPct),
      defaultEntradaBrl: row.defaultEntradaBrl,
      defaultRemainingInstallments: row.defaultRemainingInstallments,
      defaultRecurringCycles: row.defaultRecurringCycles,
      productFuncaoCosts: costsByProduct.get(row.id) ?? [],
    };
  });

  const peopleRows = await tx
    .select({
      id: salesOpsPeople.id,
      displayName: salesOpsPeople.displayName,
      contactEmail: salesOpsPeople.contactEmail,
      status: salesOpsPeople.status,
    })
    .from(salesOpsPeople)
    .where(eq(salesOpsPeople.orgId, orgId))
    .orderBy(asc(salesOpsPeople.displayName));
  const assignments = await tx
    .select({
      personId: salesOpsPersonFuncoes.personId,
      funcaoId: salesOpsPersonFuncoes.funcaoId,
      slug: salesOpsFuncoes.slug,
    })
    .from(salesOpsPersonFuncoes)
    .innerJoin(
      salesOpsFuncoes,
      and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.id, salesOpsPersonFuncoes.funcaoId)),
    )
    .where(eq(salesOpsPersonFuncoes.orgId, orgId));
  const people: ImportCatalog['people'] = peopleRows.map((row) => {
    const own = assignments.filter((a) => a.personId === row.id);
    return {
      id: row.id,
      displayName: row.displayName,
      contactEmail: row.contactEmail,
      status: row.status,
      funcaoSlugs: own.map((a) => a.slug),
      funcaoIds: own.map((a) => a.funcaoId),
    };
  });

  const clients = await tx
    .select({ id: salesOpsClients.id, name: salesOpsClients.name, document: salesOpsClients.document })
    .from(salesOpsClients)
    .where(eq(salesOpsClients.orgId, orgId))
    .orderBy(asc(salesOpsClients.name));

  const stageRows = await tx
    .select({
      id: salesOpsLeadStages.id,
      name: salesOpsLeadStages.name,
      kind: salesOpsLeadStages.kind,
      status: salesOpsLeadStages.status,
      position: salesOpsLeadStages.position,
    })
    .from(salesOpsLeadStages)
    .where(eq(salesOpsLeadStages.orgId, orgId))
    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
  const stages: ImportCatalog['stages'] = stageRows.map((row) => ({
    ...row,
    kind: row.kind === 'conversion' || row.kind === 'lost' ? row.kind : 'normal',
  }));

  const [settingsRow] = await tx
    .select({
      seller: salesOpsSettings.defaultSellerCommissionPct,
      finder: salesOpsSettings.defaultFinderCommissionPct,
      tax: salesOpsSettings.defaultTaxPct,
    })
    .from(salesOpsSettings)
    .where(eq(salesOpsSettings.orgId, orgId))
    .limit(1);
  const settings: ImportCatalogSettings = settingsRow
    ? {
        defaultSellerCommissionPct:
          numericToNumber(settingsRow.seller) ?? DEFAULT_IMPORT_SETTINGS.defaultSellerCommissionPct,
        defaultFinderCommissionPct:
          numericToNumber(settingsRow.finder) ?? DEFAULT_IMPORT_SETTINGS.defaultFinderCommissionPct,
        defaultTaxPct: numericToNumber(settingsRow.tax) ?? DEFAULT_IMPORT_SETTINGS.defaultTaxPct,
      }
    : { ...DEFAULT_IMPORT_SETTINGS };

  return {
    today: todayInSaoPaulo(now),
    producerFlowLive: isProducerFlowLive(orgId),
    settings,
    areas,
    funcoes,
    products,
    people,
    clients,
    stages,
  };
}
