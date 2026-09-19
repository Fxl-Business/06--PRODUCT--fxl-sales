import type { MoveLeadPayload } from './api';
import { leadIsConverted, stageRequiresReason } from './calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * The small pure move layer the board sits on. React-free, and it imports only
 * types plus slice 04's `calculations`, so every oracle over it runs in plain
 * node with no DOM.
 *
 * The three stage kinds are `'normal' | 'conversion' | 'lost'` and there is no
 * fourth. READ-ONLY IS A PROPERTY OF THE CARD: a card is read-only exactly when
 * `leadIsConverted(lead)`, which is `lead.saleId !== null`. There is deliberately
 * no `stageIsReadOnly` anywhere in this feature, because a column is never
 * read-only - the conversion column in particular is the DESTINATION a card is
 * moved onto in order to start a proposta.
 */

/**
 * The one place this slice asks "is this the conversion door?".
 *
 * It is the mirror of `stageRequiresReason`, and it exists for the same reason:
 * so that no later call site drifts into its own comparison and no rename of the
 * column can silently stop finding it.
 */
export function stageOpensConversion(stage: SalesOpsLeadStage | undefined): boolean {
  return stage?.kind === 'conversion';
}

/**
 * The stages `lead` may be moved to. `stages` is already `boardStages`-filtered
 * by the caller.
 *
 *  - `[]` when `leadIsConverted(lead)`: a converted card has NO move affordance
 *    at all. This is the ONLY read-only rule and it keys on the LEAD, never on a
 *    stage, which is why a NON-converted card parked in the conversion column
 *    still gets every target.
 *  - the conversion stage IS an ordinary target for a non-converted lead
 *    whenever `hasConversionHandler` is true. It is the door to the proposta
 *    wizard, and excluding it would make the headline criterion unreachable from
 *    the keyboard. What is special about it is not that it is forbidden, but
 *    that `emitMove` does not move the card when it is chosen: it hands back to
 *    the conversion flow first.
 *  - it is excluded ONLY when `hasConversionHandler` is false, so a board with no
 *    conversion flow attached cannot produce a card sitting in a conversion
 *    column with no proposta behind it.
 *  - the lead's OWN stage is INCLUDED: that is the reorder-within-column case,
 *    which the same dialog and the same payload serve.
 */
export function moveTargetsFor(
  lead: SalesOpsLead,
  stages: readonly SalesOpsLeadStage[],
  hasConversionHandler: boolean,
): SalesOpsLeadStage[] {
  if (leadIsConverted(lead)) return [];
  return stages.filter((stage) => (stageOpensConversion(stage) ? hasConversionHandler : true));
}

export type MovePositionOption = { value: string; label: string; index: number };

/**
 * Positions offered for `lead` landing in the column of `toStageId`.
 *
 * `columnLeads` is already `leadsInStage`-ordered and still CONTAINS `lead` when
 * the destination is its own column. The indexes are POST-REMOVAL insertion
 * indexes, which is exactly what `MoveLeadPayload.toIndex` means to the API.
 *
 * In the lead's own column its current post-removal slot is dropped, because
 * moving a card to where it already is is not a move; that is what makes the
 * own-column option count `columnLeads.length - 1` while another column's is
 * `columnLeads.length + 1`.
 *
 * NEVER renders an id: every label is a contact name or fixed pt-BR copy.
 */
export function movePositionOptions(
  lead: SalesOpsLead,
  toStageId: string,
  columnLeads: readonly SalesOpsLead[],
): MovePositionOption[] {
  const ownColumn = lead.stageId === toStageId;
  const currentIndex = ownColumn ? columnLeads.findIndex((row) => row.id === lead.id) : -1;
  const others = ownColumn ? columnLeads.filter((row) => row.id !== lead.id) : columnLeads;

  const options: MovePositionOption[] = [];
  for (let index = 0; index <= others.length; index += 1) {
    if (index === currentIndex) continue;
    options.push({
      value: String(index),
      index,
      label: index === 0 ? 'Início da coluna' : `Depois de ${others[index - 1]?.contactName ?? ''}`,
    });
  }
  return options;
}

/** pt-BR days copy. `0` is `hoje`, because "há 0 dias" is not something anyone says. */
export function describeDaysInStage(days: number): string {
  if (days <= 0) return 'hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

/**
 * The single validity gate `MoveLeadDialog`'s primary button reads. `null` means
 * the move may be sent; anything else is the pt-BR refusal to render.
 *
 * Rule 3 is the CLIENT half of the lost-reason requirement: blocked before the
 * request is built, in ADDITION to the API's own `400 validation_error`. It keys
 * on `stageRequiresReason` and never on the stage's NAME, which an org may
 * rename at will.
 */
export function validateMove(input: {
  targetStage: SalesOpsLeadStage | null;
  targetIndex: number | null;
  reason: string;
}): string | null {
  if (input.targetStage === null) return 'Escolha a etapa de destino.';
  if (input.targetIndex === null) return 'Escolha a posição na coluna.';
  if (stageRequiresReason(input.targetStage) && input.reason.trim() === '') {
    return 'Informe o motivo da perda.';
  }
  return null;
}

/**
 * Builds slice 04's payload, and THROWS when `validateMove` would have refused -
 * a belt to the button's braces, so a future call site cannot bypass the gate by
 * forgetting to read it.
 *
 * `reason` is the TRIMMED string when the destination requires one and `null`
 * for every other destination, so a reason typed and then re-targeted at a
 * non-lost stage is never smuggled onto the wire.
 */
export function buildMovePayload(input: {
  lead: SalesOpsLead;
  targetStage: SalesOpsLeadStage;
  targetIndex: number;
  reason: string;
}): MoveLeadPayload {
  const refusal = validateMove({
    targetStage: input.targetStage,
    targetIndex: input.targetIndex,
    reason: input.reason,
  });
  if (refusal !== null) throw new Error(refusal);

  return {
    leadId: input.lead.id,
    toStageId: input.targetStage.id,
    toIndex: input.targetIndex,
    reason: stageRequiresReason(input.targetStage) ? input.reason.trim() : null,
  };
}
