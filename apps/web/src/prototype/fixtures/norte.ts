import { ALL_MODULES_ENABLED } from '@fxl-sales/shared-utils/crm-model';
import type { LeadTimelineItem } from '@/sales-ops/leads/crm-types';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPayable,
  SalesOpsPerson,
  SalesOpsProduct,
  SalesOpsReceivable,
  SalesOpsSale,
  SalesOpsSaleItem,
  SalesOpsSaleProfessional,
  SalesOpsSettings,
  SalesOpsSettlement,
} from '@/sales-ops/types';
import { buildLeads } from './lead';
import { buildFieldDefinitions, buildPipeline } from './pipeline';
import { fid, type Clock } from './support';
import type { FixtureFollowup, OrgFixture } from './types';

/** `org_fake_norte`: the everyday organization of the `team-owner` identity, every module on. */
export const NORTE_ORG_ID = 'org_fake_norte';
export const NORTE_OWNER_PERSON_ID = fid('person', 1);

const ORG_NUMBER = 1;

export function buildNorteFixture(clock: Clock): OrgFixture {
  const orgId = NORTE_ORG_ID;
  const created = clock.at(-90);

  const funcoes: SalesOpsFuncao[] = [
    { id: fid('funcao', 1), orgId, name: 'Vendedor', slug: 'vendedor', isSystem: true, status: 'active', createdAt: created, updatedAt: null },
    { id: fid('funcao', 2), orgId, name: 'Finder', slug: 'finder', isSystem: true, status: 'active', createdAt: created, updatedAt: null },
    { id: fid('funcao', 3), orgId, name: 'Designer', slug: 'designer', isSystem: false, status: 'active', createdAt: created, updatedAt: null },
  ];
  const [vendedor, finder, designer] = funcoes as [SalesOpsFuncao, SalesOpsFuncao, SalesOpsFuncao];
  const asNested = (funcao: SalesOpsFuncao) => ({
    id: funcao.id,
    name: funcao.name,
    slug: funcao.slug,
    isSystem: funcao.isSystem,
  });

  const people: SalesOpsPerson[] = [
    { id: NORTE_OWNER_PERSON_ID, orgId, displayName: 'Ana Diretora', contactEmail: 'ana@fake.local', status: 'active', funcaoIds: [vendedor.id], funcoes: [asNested(vendedor)], createdAt: created, updatedAt: null },
    { id: fid('person', 2), orgId, displayName: 'Bruno Indicador', contactEmail: 'bruno@fake.local', status: 'active', funcaoIds: [finder.id], funcoes: [asNested(finder)], createdAt: created, updatedAt: null },
    { id: fid('person', 3), orgId, displayName: 'Carla Designer', contactEmail: 'carla@fake.local', status: 'active', funcaoIds: [designer.id], funcoes: [asNested(designer)], createdAt: created, updatedAt: null },
  ];
  const [ana, bruno, carla] = people as [SalesOpsPerson, SalesOpsPerson, SalesOpsPerson];

  const areas: SalesOpsArea[] = [
    { id: fid('area', 1), orgId, name: 'Marketing', status: 'active', createdAt: created, updatedAt: null },
    { id: fid('area', 2), orgId, name: 'Tecnologia', status: 'active', createdAt: created, updatedAt: null },
  ];
  const [marketing, tecnologia] = areas as [SalesOpsArea, SalesOpsArea];

  const clients: SalesOpsClient[] = [
    { id: fid('client', 1), orgId, name: 'Padaria Estrela', contact: 'dono@padariaestrela.example', legalName: 'Padaria Estrela Ltda', document: '12.345.678/0001-90', createdAt: created, updatedAt: null },
    { id: fid('client', 2), orgId, name: 'Clínica Vida', contact: 'contato@clinicavida.example', legalName: 'Clínica Vida S/A', document: '98.765.432/0001-10', createdAt: created, updatedAt: null },
    { id: fid('client', 3), orgId, name: 'Oficina do Zé', contact: null, createdAt: created, updatedAt: null },
  ];
  const [padaria, clinica, oficina] = clients as [SalesOpsClient, SalesOpsClient, SalesOpsClient];

  // A function, so no two products share one `modules` array a write could mutate.
  const productBase = (): Omit<
    SalesOpsProduct,
    'id' | 'name' | 'kind' | 'codeSuffix' | 'areaId' | 'setupBrl' | 'hasMonthly' | 'monthlyBrl'
  > => ({
    orgId,
    openPrice: false,
    recurringCommission: false,
    hasFinderCommission: true,
    sellerCommissionType: 'pct',
    sellerCommissionValue: '5.00',
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: '3.00',
    finderCommissionType: 'pct',
    finderCommissionValue: '2.00',
    defaultPaymentMethod: 'pix',
    defaultEntradaMode: 'none',
    defaultEntradaPct: null,
    defaultEntradaBrl: null,
    defaultRemainingInstallments: 1,
    defaultRecurringCycles: null,
    modules: [],
    providers: [],
    status: 'active',
    createdAt: created,
    updatedAt: null,
  });
  const products: SalesOpsProduct[] = [
    { ...productBase(), id: fid('product', 1), name: 'Site institucional', kind: 'product', codeSuffix: '1', areaId: tecnologia.id, setupBrl: 1_200_000, hasMonthly: false, monthlyBrl: 0 },
    { ...productBase(), id: fid('product', 2), name: 'Gestão de redes sociais', kind: 'service', codeSuffix: '2', areaId: marketing.id, setupBrl: 0, hasMonthly: true, monthlyBrl: 450_000, recurringCommission: true },
    { ...productBase(), id: fid('product', 3), name: 'Identidade visual', kind: 'service', codeSuffix: '3', areaId: marketing.id, setupBrl: 800_000, hasMonthly: false, monthlyBrl: 0 },
  ];
  const [site, redes] = products as [SalesOpsProduct, SalesOpsProduct, SalesOpsProduct];

  const settings: SalesOpsSettings = {
    orgId,
    legalName: 'Agência Norte Ltda',
    document: '11.222.333/0001-44',
    phone: '(11) 4000-1000',
    financeEmail: 'financeiro@norte.fake.local',
    defaultSellerCommissionPct: '5.00',
    defaultFinderCommissionPct: '2.00',
    defaultTaxPct: '6.00',
    currency: 'BRL',
    taxRegime: 'simples',
    periodClosingDay: 30,
    tableDensity: 'comfortable',
    dateFormat: 'dd/MM/yyyy',
    language: 'pt-BR',
    commissionOnRecurring: false,
    sellerCanBeFinder: false,
    createdAt: created,
    updatedAt: null,
  };

  const saleBase = {
    orgId,
    sellerPersonId: ana.id,
    sellerNameSnapshot: ana.displayName,
    finderPersonId: null,
    finderNameSnapshot: null,
    paymentMethod: 'pix',
    notes: null,
    sellerCommissionPct: '5.00',
    finderCommissionPct: '0.00',
    taxPct: '6.00',
    otherCostsBrl: 0,
    updatedAt: null,
  } as const;
  const sales: SalesOpsSale[] = [
    {
      ...saleBase,
      id: fid('sale', 1),
      sequence: 1,
      code: '0001-1',
      clientId: padaria.id,
      clientNameSnapshot: padaria.name,
      status: 'won',
      condition: 'installments',
      installments: 2,
      baseDate: clock.day(-20),
      wonAt: clock.at(-18),
      lostAt: null,
      totalBrl: 1_200_000,
      recurringBrl: 0,
      professionalCostsBrl: 200_000,
      sellerCommissionBrl: 60_000,
      finderCommissionBrl: 0,
      taxBrl: 72_000,
      netMarginBrl: 868_000,
      netMarginPct: '72.33',
      createdAt: clock.at(-20),
    },
    {
      ...saleBase,
      id: fid('sale', 2),
      sequence: 2,
      code: '0002-1',
      clientId: clinica.id,
      clientNameSnapshot: clinica.name,
      finderPersonId: bruno.id,
      finderNameSnapshot: bruno.displayName,
      status: 'open',
      condition: 'recurring',
      installments: 1,
      baseDate: clock.day(-3),
      wonAt: null,
      lostAt: null,
      totalBrl: 0,
      recurringBrl: 450_000,
      finderCommissionPct: '2.00',
      professionalCostsBrl: 0,
      sellerCommissionBrl: 22_500,
      finderCommissionBrl: 9_000,
      taxBrl: 27_000,
      netMarginBrl: 391_500,
      netMarginPct: '87.00',
      createdAt: clock.at(-3),
    },
    {
      ...saleBase,
      id: fid('sale', 3),
      sequence: 3,
      code: '0003-1',
      clientId: oficina.id,
      clientNameSnapshot: oficina.name,
      status: 'lost',
      condition: 'cash',
      installments: 1,
      baseDate: clock.day(-40),
      wonAt: null,
      lostAt: clock.at(-35),
      totalBrl: 800_000,
      recurringBrl: 0,
      professionalCostsBrl: 0,
      sellerCommissionBrl: 40_000,
      finderCommissionBrl: 0,
      taxBrl: 48_000,
      netMarginBrl: 712_000,
      netMarginPct: '89.00',
      createdAt: clock.at(-40),
    },
  ];
  const [wonSale, openSale] = sales as [SalesOpsSale, SalesOpsSale, SalesOpsSale];

  const saleItems: SalesOpsSaleItem[] = [
    { id: fid('item', 1), orgId, saleId: wonSale.id, productId: site.id, productNameSnapshot: site.name, productTypeSnapshot: 'product', quantity: 1, unitBrl: 1_200_000, subtotalBrl: 1_200_000, areaId: tecnologia.id, areaNameSnapshot: tecnologia.name },
    { id: fid('item', 2), orgId, saleId: openSale.id, productId: redes.id, productNameSnapshot: redes.name, productTypeSnapshot: 'service', quantity: 1, unitBrl: 450_000, subtotalBrl: 450_000, areaId: marketing.id, areaNameSnapshot: marketing.name },
    { id: fid('item', 3), orgId, saleId: fid('sale', 3), productId: products[2]!.id, productNameSnapshot: products[2]!.name, productTypeSnapshot: 'service', quantity: 1, unitBrl: 800_000, subtotalBrl: 800_000, areaId: marketing.id, areaNameSnapshot: marketing.name },
  ];

  const receivables: SalesOpsReceivable[] = [
    { id: fid('receivable', 1), orgId, saleId: wonSale.id, label: '1/2', dueDate: clock.due(-18), amountBrl: 600_000, method: 'pix', status: 'paid', createdAt: clock.at(-18), updatedAt: null, revision: 2, paidOn: clock.day(-16) },
    { id: fid('receivable', 2), orgId, saleId: wonSale.id, label: '2/2', dueDate: clock.due(12), amountBrl: 600_000, method: 'pix', status: 'open', createdAt: clock.at(-18), updatedAt: null, revision: 1, paidOn: null },
    { id: fid('receivable', 3), orgId, saleId: openSale.id, label: 'M1/12', dueDate: clock.due(27), amountBrl: 450_000, method: 'boleto', status: 'open', createdAt: clock.at(-3), updatedAt: null, revision: 1, paidOn: null },
  ];

  const payables: SalesOpsPayable[] = [
    { id: fid('payable', 1), orgId, saleId: wonSale.id, beneficiaryName: ana.displayName, kind: 'seller_commission', receivableId: fid('receivable', 1), dueDate: clock.due(-16), amountBrl: 30_000, status: 'paid', revision: 2, updatedAt: null, paidOn: clock.day(-16) },
    { id: fid('payable', 2), orgId, saleId: wonSale.id, beneficiaryName: ana.displayName, kind: 'seller_commission', receivableId: fid('receivable', 2), dueDate: clock.due(12), amountBrl: 30_000, status: 'open', revision: 1, updatedAt: null, paidOn: null },
    { id: fid('payable', 3), orgId, saleId: wonSale.id, beneficiaryName: carla.displayName, kind: 'professional_cost', receivableId: fid('receivable', 1), dueDate: clock.due(-16), amountBrl: 100_000, status: 'paid', revision: 2, updatedAt: null, paidOn: clock.day(-16) },
    { id: fid('payable', 4), orgId, saleId: wonSale.id, beneficiaryName: carla.displayName, kind: 'professional_cost', receivableId: fid('receivable', 2), dueDate: clock.due(12), amountBrl: 100_000, status: 'open', revision: 1, updatedAt: null, paidOn: null },
  ];

  const saleProfessionals: SalesOpsSaleProfessional[] = [
    { id: fid('professional', 1), orgId, saleId: wonSale.id, personId: carla.id, personNameSnapshot: carla.displayName, funcaoId: designer.id, funcaoNameSnapshot: designer.name, role: designer.name, costBrl: 200_000, costSplitBp: null },
  ];

  const settlements: SalesOpsSettlement[] = [
    { id: fid('settlement', 1), saleId: wonSale.id, targetKind: 'receivable', receivableId: fid('receivable', 1), payableId: null, type: 'baixa', reversesSettlementId: null, reversedBySettlementId: null, paidOn: clock.day(-16), amountBrl: 600_000, origin: 'manual', actorName: 'Ana Diretora', recordedAt: clock.at(-16), reason: null },
    { id: fid('settlement', 2), saleId: wonSale.id, targetKind: 'payable', receivableId: null, payableId: fid('payable', 1), type: 'baixa', reversesSettlementId: null, reversedBySettlementId: null, paidOn: clock.day(-16), amountBrl: 30_000, origin: 'manual', actorName: 'Ana Diretora', recordedAt: clock.at(-16), reason: null },
    { id: fid('settlement', 3), saleId: wonSale.id, targetKind: 'payable', receivableId: null, payableId: fid('payable', 3), type: 'baixa', reversesSettlementId: null, reversedBySettlementId: null, paidOn: clock.day(-16), amountBrl: 100_000, origin: 'manual', actorName: 'Ana Diretora', recordedAt: clock.at(-16), reason: null },
  ];

  const bootstrap: SalesOpsBootstrap = {
    orgModules: { ...ALL_MODULES_ENABLED },
    sales,
    products,
    productFuncaoCosts: [
      { id: fid('cost', 1), orgId, productId: site.id, funcaoId: designer.id, mode: 'pct', valuePct: '15.00', valueBrl: null, createdAt: created, updatedAt: null },
    ],
    clients,
    areas,
    funcoes,
    people,
    payables,
    saleItems,
    receivables,
    saleProfessionals,
    settings,
  };

  const pipeline = buildPipeline(ORG_NUMBER);
  const leads = buildLeads(pipeline, clock, [
    { n: 1, stageKey: 'novo', contactName: 'Marta Lima', phone: '(11) 99999-0001', email: 'marta@lima.example', clientId: null, clientName: 'Mercado Lima', valueBrl: 350_000, sellerPersonId: ana.id, sellerName: ana.displayName, daysInStage: 1 },
    { n: 2, stageKey: 'novo', contactName: 'Paulo Reis', phone: null, email: 'paulo@reis.example', clientId: null, clientName: 'Reis Contabilidade', valueBrl: 0, sellerPersonId: null, sellerName: '', daysInStage: 3 },
    { n: 3, stageKey: 'qualificacao', contactName: 'Helena Prado', phone: '(11) 98888-0003', email: null, clientId: clinica.id, clientName: clinica.name, valueBrl: 450_000, sellerPersonId: ana.id, sellerName: ana.displayName, daysInStage: 6 },
    { n: 4, stageKey: 'em-negociacao', contactName: 'Rui Matos', phone: '(11) 97777-0004', email: 'rui@oficina.example', clientId: oficina.id, clientName: oficina.name, valueBrl: 800_000, sellerPersonId: ana.id, sellerName: ana.displayName, daysInStage: 9 },
    { n: 5, stageKey: 'proposta', contactName: 'Dona Estela', phone: '(11) 96666-0005', email: 'dona@padariaestrela.example', clientId: padaria.id, clientName: padaria.name, valueBrl: 1_200_000, sellerPersonId: ana.id, sellerName: ana.displayName, daysInStage: 20, saleId: wonSale.id, saleCode: wonSale.code, saleStatus: 'won' },
    { n: 6, stageKey: 'perdido', contactName: 'Jorge Alves', phone: '(11) 95555-0006', email: null, clientId: null, clientName: 'Alves & Filhos', valueBrl: 200_000, sellerPersonId: ana.id, sellerName: ana.displayName, daysInStage: 12, lostReason: 'Escolheu um concorrente mais barato' },
  ]);
  const novo = pipeline.stages[0]!;

  const timeline: Record<string, LeadTimelineItem[]> = Object.fromEntries(
    leads.map((lead): [string, LeadTimelineItem[]] => [
      lead.id,
      [
        {
          kind: 'stage_changed',
          at: lead.createdAt,
          actorName: ana.displayName,
          fromStageName: null,
          toStageName: novo.name,
          reason: null,
        },
      ],
    ]),
  );

  const followups: FixtureFollowup[] = [
    { id: fid('followup', 1), leadId: fid('lead', 3), nextStep: 'Ligar para confirmar a reunião', dueOn: clock.day(1), ownerPersonId: ana.id, ownerName: ana.displayName, doneAt: null },
    { id: fid('followup', 2), leadId: fid('lead', 4), nextStep: 'Enviar proposta revisada', dueOn: clock.day(-1), ownerPersonId: ana.id, ownerName: ana.displayName, doneAt: null },
  ];

  return {
    orgId,
    modules: { ...ALL_MODULES_ENABLED },
    bootstrap,
    pipelines: [pipeline],
    fieldDefinitions: buildFieldDefinitions(ORG_NUMBER),
    leads,
    timeline,
    followups,
    deletedLeads: [],
    settlements,
    history: [],
  };
}
