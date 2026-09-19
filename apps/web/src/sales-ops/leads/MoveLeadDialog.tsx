import * as React from 'react';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MoveLeadPayload } from './api';
import {
  buildMovePayload,
  movePositionOptions,
  stageOpensConversion,
  validateMove,
} from './board-move';
import {
  blockedNoticeClass,
  fieldLabelClass,
  formSelectClass,
  formTextareaClass,
  mutedStateClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';
import { leadsInStage, stageRequiresReason } from './calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * THE REAL CONTROL.
 *
 * Every move in this feature is a `MoveLeadPayload` and this dialog is where the
 * operator builds one. The drag layer is a convenience that ends in the same
 * `emitMove`, and it installs no keyboard sensor of its own, so deleting the
 * whole dnd-kit layer removes a convenience and not a capability.
 *
 * `Posição na coluna` is also the keyboard affordance for reordering WITHIN a
 * column: the operator leaves `Etapa de destino` on the lead's own stage and
 * picks a different slot. Not a separate control and not a separate payload -
 * the only difference is that `toStageId === lead.stageId`.
 *
 * The real `Dialog` / `DialogContent` are used and never a hand-rolled div,
 * because `DialogContent` is the inline-layer registry host: without it an
 * Escape aimed at an open `Combobox` panel would discard the whole dialog.
 */

export type MoveLeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: SalesOpsLead;
  /** Already filtered by `moveTargetsFor`. */
  targets: SalesOpsLeadStage[];
  /** All leads, so the position picker can read any destination column. */
  leads: readonly SalesOpsLead[];
  /** Pre-selected destination, used when a drag handed control back. `null` means the lead's own stage. */
  initialStageId?: string | null;
  onSubmit: (payload: MoveLeadPayload) => void;
  /** True while a previous move is in flight. */
  pending?: boolean;
};

export function MoveLeadDialog({
  open,
  onOpenChange,
  lead,
  targets,
  leads,
  initialStageId = null,
  onSubmit,
  pending = false,
}: MoveLeadDialogProps) {
  const seedStageId = React.useMemo(() => {
    const wanted = initialStageId ?? lead.stageId;
    if (targets.some((stage) => stage.id === wanted)) return wanted;
    return targets[0]?.id ?? null;
  }, [initialStageId, lead.stageId, targets]);

  /*
    EVERY piece of local state here is MOUNT-SCOPED, and there is deliberately no
    reset effect. `LeadsBoard` mounts this dialog only while a move is being
    composed and keys it by `lead.id`, so a cancelled move cannot leave a
    half-typed reason or a stale destination behind: the component is gone. That
    is a stronger guarantee than a reset effect, which has to remember every
    field, and it keeps `setState` out of an effect body entirely.

    Both pickers are stored as an OVERRIDE over a derived default rather than as
    the value itself, which is what lets the position re-seed itself when the
    destination changes without anything writing state outside an event handler.
  */
  const [stagePick, setStagePick] = React.useState<string | null>(null);
  const [indexPick, setIndexPick] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState('');

  const selectedStageId = stagePick ?? seedStageId;
  const selectedStage = targets.find((stage) => stage.id === selectedStageId) ?? null;

  const positionOptions = React.useMemo(() => {
    if (!selectedStageId) return [];
    return movePositionOptions(lead, selectedStageId, leadsInStage(leads, selectedStageId));
  }, [lead, leads, selectedStageId]);

  // The first offered slot is the default, so the picker is never left pointing
  // at a slot the newly chosen column does not have.
  const selectedIndex = indexPick ?? positionOptions[0]?.index ?? null;

  const refusal = validateMove({
    targetStage: selectedStage,
    targetIndex: selectedIndex,
    reason,
  });
  const needsReason = stageRequiresReason(selectedStage ?? undefined);
  const opensConversion = stageOpensConversion(selectedStage ?? undefined);

  function confirm() {
    if (refusal !== null || selectedStage === null || selectedIndex === null) return;
    onSubmit(
      buildMovePayload({ lead, targetStage: selectedStage, targetIndex: selectedIndex, reason }),
    );
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mover para</DialogTitle>
          <DialogDescription>{`Escolha o destino de ${lead.contactName}.`}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="move-lead-stage-label">
              Etapa de destino
            </span>
            {/*
              No `onCreate`: a stage needs a kind, a position, a system flag and a
              status, so an inline create cannot yield a complete valid record.
              Stages are created in Cadastros.
            */}
            <Combobox
              aria-labelledby="move-lead-stage-label"
              className={formSelectClass}
              onChange={(value) => {
                setStagePick(value);
                // The chosen slot belongs to the old column, so it is released
                // here and the new column's first slot becomes the default.
                setIndexPick(null);
              }}
              options={targets.map((stage) => ({ value: stage.id, label: stage.name }))}
              placeholder="Selecione a etapa"
              value={selectedStageId}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="move-lead-position-label">
              Posição na coluna
            </span>
            <Combobox
              aria-labelledby="move-lead-position-label"
              className={formSelectClass}
              onChange={(value) => setIndexPick(Number(value))}
              options={positionOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              placeholder="Selecione a posição"
              value={selectedIndex === null ? null : String(selectedIndex)}
            />
          </div>

          {needsReason ? (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass} id="move-lead-reason-label">
                Motivo da perda
              </span>
              <textarea
                aria-labelledby="move-lead-reason-label"
                aria-required="true"
                className={formTextareaClass}
                data-lost-reason="true"
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
              <span className={mutedStateClass}>Uma etapa de perda exige o motivo.</span>
            </div>
          ) : null}

          {opensConversion ? (
            <p className={noticeClass} data-conversion-notice="true">
              Esta etapa abre o wizard de proposta. O card só muda de etapa depois que a proposta
              for criada.
            </p>
          ) : null}

          {refusal !== null ? (
            <p className={blockedNoticeClass} data-move-blocked="true">
              {refusal}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button
            className={secondaryButtonClass}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancelar
          </button>
          {/*
            `type="button"` on EVERY render, never derived from state: a click runs
            the event dispatch and then the browser's activation behaviour, and
            React flushes a discrete update between the two, so an attribute that
            changes with state changes what the same click does.
          */}
          <button
            className={primaryButtonClass}
            data-move-confirm="true"
            disabled={refusal !== null || pending}
            onClick={confirm}
            type="button"
          >
            Mover
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
