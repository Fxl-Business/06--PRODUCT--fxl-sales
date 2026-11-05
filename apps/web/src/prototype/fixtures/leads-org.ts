import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import type { LeadTimelineItem } from '@/sales-ops/leads/crm-types';
import type {
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPerson,
} from '@/sales-ops/types';
import { buildLeads } from './lead';
import { buildFieldDefinitions, buildPipeline } from './pipeline';
import { fid, type Clock } from './support';
import type { FixtureFollowup, OrgFixture } from './types';

/** `org_fake_leads`: the compact profile (`orcamentos` off) of `leads-owner` and `leads-seller`. */
export const LEADS_ORG_ID = 'org_fake_leads';
export const LEADS_OWNER_PERSON_ID = fid('person', 21);
export const LEADS_SELLER_PERSON_ID = fid('person', 22);

const ORG_NUMBER = 2;

export function buildLeadsOrgFixture(clock: Clock): OrgFixture {
  const orgId = LEADS_ORG_ID;
  const created = clock.at(-60);
  const modules = modulesForEdition('leads');

  const vendedor: SalesOpsFuncao = {
    id: fid('funcao', 21),
    orgId,
    name: 'Vendedor',
    slug: 'vendedor',
    isSystem: true,
    status: 'active',
    createdAt: created,
    updatedAt: null,
  };
  const finder: SalesOpsFuncao = { ...vendedor, id: fid('funcao', 22), name: 'Finder', slug: 'finder' };
  const nested = { id: vendedor.id, name: vendedor.name, slug: vendedor.slug, isSystem: true };

  const people: SalesOpsPerson[] = [
    { id: LEADS_OWNER_PERSON_ID, orgId, displayName: 'Lara Gestora', contactEmail: 'lara@fake.local', status: 'active', funcaoIds: [vendedor.id], funcoes: [nested], createdAt: created, updatedAt: null },
    { id: LEADS_SELLER_PERSON_ID, orgId, displayName: 'Leo Vendedor', contactEmail: 'leo@fake.local', status: 'active', funcaoIds: [vendedor.id], funcoes: [nested], createdAt: created, updatedAt: null },
  ];
  const [lara, leo] = people as [SalesOpsPerson, SalesOpsPerson];

  const clients: SalesOpsClient[] = [
    { id: fid('client', 21), orgId, name: 'Construtora Aurora', contact: 'obras@aurora.example', createdAt: created, updatedAt: null },
    { id: fid('client', 22), orgId, name: 'Madeireira Pinheiro', contact: null, createdAt: created, updatedAt: null },
  ];
  const [aurora, pinheiro] = clients as [SalesOpsClient, SalesOpsClient];

  const bootstrap: SalesOpsBootstrap = {
    orgModules: { ...modules },
    sales: [],
    products: [],
    productFuncaoCosts: [],
    clients,
    areas: [],
    funcoes: [vendedor, finder],
    people,
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
  };

  const pipeline = buildPipeline(ORG_NUMBER);
  const leads = buildLeads(pipeline, clock, [
    { n: 21, stageKey: 'novo', contactName: 'Eduardo Faria', phone: '(21) 99100-0021', email: 'eduardo@aurora.example', clientId: aurora.id, clientName: aurora.name, valueBrl: 900_000, sellerPersonId: leo.id, sellerName: leo.displayName, daysInStage: 2 },
    { n: 22, stageKey: 'novo', contactName: 'Sônia Pinheiro', phone: '(21) 99100-0022', email: null, clientId: pinheiro.id, clientName: pinheiro.name, valueBrl: 250_000, sellerPersonId: null, sellerName: '', daysInStage: 4 },
    { n: 23, stageKey: 'qualificacao', contactName: 'Tiago Brandão', phone: null, email: 'tiago@brandao.example', clientId: null, clientName: 'Brandão Engenharia', valueBrl: 1_500_000, sellerPersonId: leo.id, sellerName: leo.displayName, daysInStage: 8 },
    { n: 24, stageKey: 'em-negociacao', contactName: 'Vera Campos', phone: '(21) 99100-0024', email: 'vera@campos.example', clientId: null, clientName: 'Campos Reformas', valueBrl: 640_000, sellerPersonId: lara.id, sellerName: lara.displayName, daysInStage: 15 },
    { n: 25, stageKey: 'proposta', contactName: 'Wagner Dias', phone: '(21) 99100-0025', email: null, clientId: null, clientName: 'Dias Pisos', valueBrl: 420_000, sellerPersonId: leo.id, sellerName: leo.displayName, daysInStage: 5 },
    { n: 26, stageKey: 'ganho', contactName: 'Yara Moura', phone: '(21) 99100-0026', email: 'yara@moura.example', clientId: null, clientName: 'Moura Acabamentos', valueBrl: 780_000, sellerPersonId: leo.id, sellerName: leo.displayName, daysInStage: 10 },
  ]);
  const novo = pipeline.stages[0]!;

  const timeline: Record<string, LeadTimelineItem[]> = Object.fromEntries(
    leads.map((lead): [string, LeadTimelineItem[]] => [
      lead.id,
      [
        {
          kind: 'stage_changed',
          at: lead.createdAt,
          actorName: lara.displayName,
          fromStageName: null,
          toStageName: novo.name,
          reason: null,
        },
      ],
    ]),
  );

  const followups: FixtureFollowup[] = [
    { id: fid('followup', 21), leadId: fid('lead', 21), nextStep: 'Enviar catálogo de obras', dueOn: clock.day(0), ownerPersonId: leo.id, ownerName: leo.displayName, doneAt: null },
    { id: fid('followup', 22), leadId: fid('lead', 24), nextStep: 'Visita técnica', dueOn: clock.day(3), ownerPersonId: lara.id, ownerName: lara.displayName, doneAt: null },
  ];

  return {
    orgId,
    modules: { ...modules },
    bootstrap,
    pipelines: [pipeline],
    fieldDefinitions: buildFieldDefinitions(ORG_NUMBER),
    leads,
    timeline,
    followups,
    deletedLeads: [],
    settlements: [],
    history: [],
  };
}
