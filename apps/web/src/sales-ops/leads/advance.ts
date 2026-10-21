import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import type { AdvanceLeadPayload, LeadNextStage, PipelineStageType } from './crm-types';

/*
 * The pure rules of "Avançar". The dialog draws them and the API enforces them;
 * nothing here reads the clock (`today` is passed in) or the network.
 */

export const ADVANCE_COPY = {
  title: 'Avançar lead',
  stageLabel: 'Etapa de destino',
  nextStepLabel: 'Próximo passo',
  dueOnLabel: 'Data do próximo passo',
  noteLabel: 'Nota (opcional)',
  reasonLabel: 'Motivo',
  confirm: 'Avançar',
  conversionHint: 'Esta etapa abre a proposta. Você preenche a proposta na próxima tela.',
  noDestination: 'Escolha a etapa de destino.',
  nextStepRequired: 'Informe o próximo passo.',
  dueOnRequired: 'Informe a data do próximo passo.',
  dueOnPast: 'A data não pode ser anterior a hoje.',
  reasonRequired: 'Informe o motivo.',
  notAllowed: 'Esse avanço não é permitido neste funil.',
  conversionNeeded: 'Esta etapa exige a proposta. Use o fluxo da proposta.',
  failed: 'Não foi possível avançar o lead. Tente novamente.',
} as const;

export type AdvanceDraft = {
  toStageId: string | null;
  nextStep: string;
  dueOn: string;
  note: string;
  reason: string;
};

/** Every destination type but `saida` (an exit) needs a follow-up, unless it opens the proposta. */
export const FOLLOWUP_REQUIRED_BY_TYPE: Record<PipelineStageType, boolean> = {
  normal: true,
  orcamento: true,
  saida: false,
};

export type AdvanceNeeds = { followup: boolean; reason: boolean; conversion: boolean };

export function advanceNeeds(dest: LeadNextStage | undefined, opensConversion: boolean): AdvanceNeeds {
  if (!dest) return { followup: false, reason: false, conversion: false };
  const conversion = opensConversion;
  return {
    conversion,
    followup: !conversion && FOLLOWUP_REQUIRED_BY_TYPE[dest.type],
    reason: dest.requiresReason,
  };
}

/** The first blocking message for the draft, or null when "Avançar" may be sent. */
export function validateAdvance(
  dest: LeadNextStage | undefined,
  opensConversion: boolean,
  draft: AdvanceDraft,
  today: string,
): string | null {
  if (!dest) return ADVANCE_COPY.noDestination;
  const needs = advanceNeeds(dest, opensConversion);
  // A conversion is not a write of this form: the proposta wizard owns it.
  if (needs.conversion) return null;
  if (needs.reason && draft.reason.trim() === '') return ADVANCE_COPY.reasonRequired;
  if (needs.followup) {
    if (draft.nextStep.trim() === '') return ADVANCE_COPY.nextStepRequired;
    if (draft.dueOn === '' || !isIsoDay(draft.dueOn)) return ADVANCE_COPY.dueOnRequired;
    if (draft.dueOn < today) return ADVANCE_COPY.dueOnPast;
  }
  return null;
}

/** The body of `POST /leads/:id/advance`; the caller adds `leadId`. Only the fields the destination needs are sent. */
export function buildAdvancePayload(
  toStageId: string,
  draft: AdvanceDraft,
  needs: AdvanceNeeds,
): Omit<AdvanceLeadPayload, 'leadId'> {
  const payload: Omit<AdvanceLeadPayload, 'leadId'> = { toStageId };
  if (needs.followup) {
    payload.nextStep = draft.nextStep.trim();
    payload.dueOn = draft.dueOn;
  }
  if (needs.reason) payload.reason = draft.reason.trim();
  const note = draft.note.trim();
  if (note !== '') payload.note = note;
  return payload;
}

/** The copy of an advance refusal. Structural on `{status, error, reason}`, never on a class. */
export function advanceErrorCopy(error: unknown): string {
  const shape = (typeof error === 'object' && error !== null ? error : {}) as {
    status?: unknown;
    error?: unknown;
    reason?: unknown;
  };
  if (shape.status === 409 && shape.error === 'transition_not_allowed') return ADVANCE_COPY.notAllowed;
  if (shape.status === 409 && shape.error === 'sale_required_for_conversion') return ADVANCE_COPY.conversionNeeded;
  if (shape.status === 400 && shape.reason === 'followup_required') return ADVANCE_COPY.nextStepRequired;
  if (shape.status === 400 && shape.reason === 'reason_required') return ADVANCE_COPY.reasonRequired;
  return ADVANCE_COPY.failed;
}
