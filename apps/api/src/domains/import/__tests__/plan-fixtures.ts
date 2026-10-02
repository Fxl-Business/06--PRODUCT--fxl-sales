import { emptyParsedWorkbook } from '../parse.js';
import type {
  CellValue,
  ImportCatalog,
  ImportIssue,
  ParsedWorkbook,
  ProductCatalogEntry,
  SheetKey,
} from '../types.js';

const id = (n: string) => `00000000-0000-4000-8000-0000000000${n}`;

export const IDS = {
  areaTec: id('a1'),
  areaArchived: id('a2'),
  funcaoVendedor: id('b1'),
  funcaoFinder: id('b2'),
  funcaoDev: id('b3'),
  funcaoArchived: id('b4'),
  productSistema: id('c1'),
  productArchived: id('c2'),
  personAna: id('d1'),
  personInactive: id('d2'),
  clientPadaria: id('e1'),
  stageNovo: id('f1'),
  stageNegociacao: id('f2'),
  stageProposta: id('f3'),
  stagePerdido: id('f4'),
  stageArchived: id('f5'),
} as const;

/** A catalog shaped like a seeded org (D11/D11b): Vendedor/Finder, the four default etapas, settings 10/3/6. */
export function seededCatalog(overrides: Partial<ImportCatalog> = {}): ImportCatalog {
  return {
    today: '2026-03-10',
    producerFlowLive: false,
    settings: { defaultSellerCommissionPct: 10, defaultFinderCommissionPct: 3, defaultTaxPct: 6 },
    areas: [],
    funcoes: [
      { id: IDS.funcaoVendedor, name: 'Vendedor', slug: 'vendedor', isSystem: true, status: 'active' },
      { id: IDS.funcaoFinder, name: 'Finder', slug: 'finder', isSystem: true, status: 'active' },
    ],
    products: [],
    people: [],
    clients: [],
    stages: [
      { id: IDS.stageNovo, name: 'Novo', kind: 'normal', status: 'active', position: 1 },
      { id: IDS.stageNegociacao, name: 'Em negociação', kind: 'normal', status: 'active', position: 2 },
      { id: IDS.stageProposta, name: 'Proposta', kind: 'conversion', status: 'active', position: 3 },
      { id: IDS.stagePerdido, name: 'Perdido', kind: 'lost', status: 'active', position: 4 },
    ],
    ...overrides,
  };
}

export function productEntry(
  overrides: Partial<ProductCatalogEntry> & { id: string; name: string },
): ProductCatalogEntry {
  return {
    codeSuffix: '0',
    kind: 'product',
    areaId: null,
    status: 'active',
    setupBrl: 0,
    hasMonthly: false,
    monthlyBrl: 0,
    recurringCommission: false,
    hasFinderCommission: false,
    sellerCommissionType: 'pct',
    sellerCommissionValue: 10,
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: 10,
    finderCommissionType: 'pct',
    finderCommissionValue: 3,
    defaultPaymentMethod: 'pix',
    defaultEntradaMode: 'none',
    defaultEntradaPct: null,
    defaultEntradaBrl: null,
    defaultRemainingInstallments: 1,
    defaultRecurringCycles: null,
    productFuncaoCosts: [],
    ...overrides,
  };
}

/** seededCatalog plus one record of each kind, active and archived. */
export function richCatalog(): ImportCatalog {
  const base = seededCatalog();
  return seededCatalog({
    areas: [
      { id: IDS.areaTec, name: 'Tecnologia', status: 'active' },
      { id: IDS.areaArchived, name: 'Área antiga', status: 'archived' },
    ],
    funcoes: [
      ...base.funcoes,
      { id: IDS.funcaoDev, name: 'Desenvolvedor', slug: 'desenvolvedor', isSystem: false, status: 'active' },
      { id: IDS.funcaoArchived, name: 'Função antiga', slug: 'funcao-antiga', isSystem: false, status: 'archived' },
    ],
    products: [
      productEntry({ id: IDS.productSistema, name: 'Sistema legado', codeSuffix: '3', areaId: IDS.areaTec }),
      productEntry({ id: IDS.productArchived, name: 'Produto antigo', codeSuffix: '7', status: 'archived', areaId: IDS.areaTec }),
    ],
    people: [
      {
        id: IDS.personAna,
        displayName: 'Ana Souza',
        contactEmail: 'ana@exemplo.com.br',
        status: 'active',
        funcaoSlugs: ['vendedor'],
        funcaoIds: [IDS.funcaoVendedor],
      },
      {
        id: IDS.personInactive,
        displayName: 'Beto Inativo',
        contactEmail: null,
        status: 'inactive',
        funcaoSlugs: [],
        funcaoIds: [],
      },
    ],
    clients: [{ id: IDS.clientPadaria, name: 'Padaria Pão Quente', document: '12.345.678/0001-90' }],
    stages: [
      ...base.stages,
      { id: IDS.stageArchived, name: 'Etapa antiga', kind: 'normal', status: 'archived', position: 5 },
    ],
  });
}

/** In-memory ParsedWorkbook: rows numbered from 2 in array order unless a `row` is given. */
export function workbook(
  sheets: Partial<Record<SheetKey, Array<Record<string, CellValue> & { row?: number }>>>,
  issues: ImportIssue[] = [],
): ParsedWorkbook {
  const parsed = emptyParsedWorkbook();
  for (const [key, rows] of Object.entries(sheets) as Array<[SheetKey, Array<Record<string, CellValue> & { row?: number }>]>) {
    parsed.sheets[key] = {
      key,
      rows: rows.map((entry, index) => {
        const cells: Record<string, CellValue> = {};
        for (const [k, v] of Object.entries(entry)) {
          if (k !== 'row') cells[k] = v as CellValue;
        }
        return { row: typeof entry.row === 'number' ? entry.row : index + 2, cells };
      }),
    };
  }
  parsed.issues = issues;
  return parsed;
}
