import type { SalesOpsLead } from './types';

export type PipelineStageType = 'normal' | 'orcamento' | 'saida';
export type PipelineExitKind = 'ganho' | 'perdido' | 'pausado';
export type CrmStatus = 'active' | 'archived';
export type CrmPipelineStage = {
  id: string;
  name: string;
  position: number;
  type: PipelineStageType;
  behavior: string;
  exitKind: PipelineExitKind | null;
  requiresReason: boolean;
  status: CrmStatus;
};
export type CrmPipelineTransition = { fromStageId: string; toStageId: string };
export type CrmPipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  status: CrmStatus;
  stages: CrmPipelineStage[];
  transitions: CrmPipelineTransition[];
};
export type PipelinesResponse = { pipelines: CrmPipeline[] };
export type FieldKind = 'text' | 'number' | 'money' | 'date' | 'options' | 'reference';
export type FieldReferenceTarget = 'cliente' | 'contato' | 'produto' | 'servico' | 'venda';
export type FieldOption = { key: string; label: string };
export type FieldDefinition = {
  id: string;
  key: string;
  label: string;
  kind: FieldKind;
  referenceTarget: FieldReferenceTarget | null;
  multiple: boolean;
  options: FieldOption[] | null;
  filterable: boolean;
  isSystem: boolean;
  removable: boolean;
  position: number;
};
export type FieldDefinitionsResponse = { fields: FieldDefinition[] };
export type FieldReferenceItem = { id: string | null; name: string };
/** Read shape of one dynamic value: money in integer cents, date as ISO civil day, option as option key, references as items. */
export type LeadFieldValue = { fieldId: string; key: string; value: string | number | null | FieldReferenceItem[] };
export type LeadTimelineKind = 'stage_changed' | 'note' | 'followup';
export type LeadTimelineItem = {
  kind: LeadTimelineKind;
  at: string;
  actorName: string | null;
  fromStageName?: string | null;
  toStageName?: string | null;
  reason?: string | null;
  body?: string;
  nextStep?: string;
  dueOn?: string;
  doneAt?: string | null;
};
export type LeadFollowup = { id: string; nextStep: string; dueOn: string; ownerName: string | null; doneAt: string | null };
export type LeadNextStage = {
  id: string;
  name: string;
  type: PipelineStageType;
  exitKind: PipelineExitKind | null;
  requiresReason: boolean;
};
export type LeadSummaryResponse = {
  lead: SalesOpsLead;
  pipeline: { id: string; name: string };
  stage: { id: string; name: string; type: PipelineStageType; exitKind: PipelineExitKind | null };
  nextStages: LeadNextStage[];
  timeline: LeadTimelineItem[];
  followups: LeadFollowup[];
};
export type FollowupScope = 'mine' | 'team';
export type FollowupStatus = 'open' | 'done' | 'all';
export type FollowupListRow = {
  id: string;
  leadId: string;
  leadContactName: string;
  nextStep: string;
  dueOn: string;
  ownerName: string | null;
  doneAt: string | null;
};
export type FollowupsResponse = { followups: FollowupListRow[] };
export type AdvanceLeadPayload = { leadId: string; toStageId: string; nextStep?: string; dueOn?: string; note?: string; reason?: string };
export type AddLeadNotePayload = { leadId: string; body: string };
export type AddLeadFollowupPayload = { leadId: string; nextStep: string; dueOn: string; ownerPersonId?: string };
export type ListFollowupsParams = { scope: FollowupScope; status: FollowupStatus; from?: string; to?: string };
