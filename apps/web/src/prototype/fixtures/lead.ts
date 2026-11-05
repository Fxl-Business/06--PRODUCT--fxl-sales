import type { CrmPipeline } from '@/sales-ops/leads/crm-types';
import type { SalesOpsLead } from '@/sales-ops/leads/types';
import { fid, type Clock } from './support';

export type LeadSeed = {
  n: number;
  stageKey: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  clientId: string | null;
  clientName: string;
  valueBrl: number;
  sellerPersonId: string | null;
  sellerName: string;
  daysInStage: number;
  description?: string;
  lostReason?: string;
  saleId?: string | null;
  saleCode?: string | null;
  saleStatus?: SalesOpsLead['saleStatus'];
};

const STAGE_KEY_BY_NAME: Record<string, string> = {
  Novo: 'novo',
  Qualificação: 'qualificacao',
  'Em negociação': 'em-negociacao',
  Proposta: 'proposta',
  Ganho: 'ganho',
  Perdido: 'perdido',
  Pausado: 'pausado',
};

/** Builds the wire lead for a seed, placed in the pipeline stage the key names. */
export function buildLeads(pipeline: CrmPipeline, clock: Clock, seeds: LeadSeed[]): SalesOpsLead[] {
  const positionByStage = new Map<string, number>();
  return seeds.map((seed) => {
    const stage = pipeline.stages.find((candidate) => STAGE_KEY_BY_NAME[candidate.name] === seed.stageKey);
    if (!stage) throw new Error(`prototype fixtures: no stage "${seed.stageKey}" in pipeline ${pipeline.name}`);
    const position = (positionByStage.get(stage.id) ?? 0) + 1;
    positionByStage.set(stage.id, position);
    return {
      id: fid('lead', seed.n),
      stageId: stage.id,
      position,
      contactName: seed.contactName,
      clientId: seed.clientId,
      clientNameSnapshot: seed.clientName,
      estimatedValueBrl: seed.valueBrl,
      description: seed.description ?? null,
      contactPhone: seed.phone,
      contactEmail: seed.email,
      contactBirthDate: null,
      sellerPersonId: seed.sellerPersonId,
      sellerNameSnapshot: seed.sellerName,
      lostReason: seed.lostReason ?? null,
      stageChangedAt: clock.at(-seed.daysInStage),
      saleId: seed.saleId ?? null,
      saleStatus: seed.saleStatus ?? null,
      saleCode: seed.saleCode ?? null,
      products: [],
      createdAt: clock.at(-seed.daysInStage - 5),
      updatedAt: null,
      pipelineId: pipeline.id,
      stageType: stage.type,
      stageExitKind: stage.exitKind,
      fields: [],
    };
  });
}
