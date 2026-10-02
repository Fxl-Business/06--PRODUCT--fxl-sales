import { randomUUID } from 'node:crypto';
import { CreateSaleSchema } from '../../sales-ops/service.js';
import { buildRefIndex, type ImportRefIndex } from '../refs.js';
import type { ImportCatalog, ParsedWorkbook, SaleDraft } from '../types.js';
import { IDS as BASE_IDS, productEntry, seededCatalog } from './plan-fixtures.js';

const id = (n: string) => `00000000-0000-4000-8000-0000000001${n}`;

export const IDS = {
  area: BASE_IDS.areaTec,
  vendedor: BASE_IDS.funcaoVendedor,
  finder: BASE_IDS.funcaoFinder,
  dev: id('01'),
  ana: id('02'),
  bruno: id('03'),
  carla: id('04'),
  dup1: id('05'),
  dup2: id('06'),
  padaria: id('07'),
  sistema: id('08'),
  consultoria: id('09'),
  licenca: id('10'),
  mensal: id('11'),
  antigo: id('12'),
} as const;

/** Catalog the planner tests share: seeded org plus one area, one extra função, three people, one cliente, four produtos. */
export function testCatalog(patch: Partial<ImportCatalog> = {}): ImportCatalog {
  const base = seededCatalog();
  return seededCatalog({
    today: '2026-10-02',
    areas: [{ id: IDS.area, name: 'Tecnologia', status: 'active' }],
    funcoes: [
      ...base.funcoes,
      { id: IDS.dev, name: 'Desenvolvedor', slug: 'desenvolvedor', isSystem: false, status: 'active' },
    ],
    people: [
      person(IDS.ana, 'Ana Souza', [['vendedor', IDS.vendedor], ['desenvolvedor', IDS.dev]]),
      person(IDS.bruno, 'Bruno Lima', [['finder', IDS.finder]]),
      person(IDS.carla, 'Carla Dias', [['desenvolvedor', IDS.dev]]),
      person(IDS.dup1, 'Dupla Pessoa', [['vendedor', IDS.vendedor]]),
      person(IDS.dup2, 'Dupla Pessoa', [['vendedor', IDS.vendedor]]),
    ],
    clients: [{ id: IDS.padaria, name: 'Padaria Pão Quente', document: null }],
    products: [
      productEntry({
        id: IDS.sistema,
        name: 'Sistema de gestão',
        codeSuffix: '1',
        areaId: IDS.area,
        setupBrl: 500000,
        hasMonthly: true,
        monthlyBrl: 30000,
        sellerCommissionValue: 12,
        sellerWithFinderCommissionValue: 8,
        finderCommissionValue: 4,
        defaultPaymentMethod: 'boleto',
        defaultRemainingInstallments: 3,
        defaultRecurringCycles: 12,
        productFuncaoCosts: [{ funcaoId: IDS.dev, mode: 'pct', valuePct: 20 }],
      }),
      productEntry({
        id: IDS.consultoria,
        name: 'Consultoria',
        codeSuffix: '2',
        kind: 'service',
        areaId: IDS.area,
        sellerCommissionType: 'fix',
        sellerCommissionValue: 500,
        sellerWithFinderCommissionType: 'fix',
        sellerWithFinderCommissionValue: 500,
        finderCommissionType: 'fix',
        finderCommissionValue: 100,
      }),
      productEntry({ id: IDS.licenca, name: 'Licença', codeSuffix: '3', areaId: IDS.area, setupBrl: 100000 }),
      productEntry({
        id: IDS.mensal,
        name: 'Plano mensal',
        codeSuffix: '4',
        areaId: IDS.area,
        hasMonthly: true,
        monthlyBrl: 25000,
      }),
      productEntry({ id: IDS.antigo, name: 'Produto antigo', codeSuffix: '5', status: 'archived', areaId: IDS.area, setupBrl: 1000 }),
    ],
    ...patch,
  });
}

function person(pid: string, name: string, funcoes: Array<[string, string]>): ImportCatalog['people'][number] {
  return {
    id: pid,
    displayName: name,
    contactEmail: null,
    status: 'active',
    funcaoSlugs: funcoes.map(([slug]) => slug),
    funcaoIds: funcoes.map(([, fid]) => fid),
  };
}

/** The REAL resolver over the workbook and the catalog (one implementation, no fake to drift). */
export function realRefs(parsed: ParsedWorkbook, catalog: ImportCatalog): ImportRefIndex {
  return buildRefIndex(parsed, catalog);
}

/** Replaces every ref by a fresh uuid and runs CreateSaleSchema, the check the executor's createSale applies. */
export function probe(draft: SaleDraft): ReturnType<typeof CreateSaleSchema.safeParse> {
  const { clientRef, sellerRef, finderRef, items, professionals, ...rest } = draft;
  return CreateSaleSchema.safeParse({
    ...rest,
    ...(clientRef ? { clientId: randomUUID() } : {}),
    sellerPersonId: sellerRef ? randomUUID() : undefined,
    ...(finderRef ? { finderPersonId: randomUUID() } : {}),
    items: items.map(({ productRef, areaRef, ...item }) => ({
      ...item,
      ...(productRef ? { productId: randomUUID() } : {}),
      ...(areaRef ? { areaId: randomUUID() } : {}),
    })),
    professionals: professionals.map(({ personRef, funcaoRef, ...pro }) => ({
      ...pro,
      ...(personRef ? { personId: randomUUID() } : {}),
      ...(funcaoRef ? { funcaoId: randomUUID() } : {}),
    })),
  });
}
