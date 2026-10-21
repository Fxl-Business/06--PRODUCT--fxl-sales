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
import { Input } from '@/components/ui/input';
import {
  ADVANCE_COPY,
  type AdvanceDraft,
  advanceErrorCopy,
  advanceNeeds,
  buildAdvancePayload,
  validateAdvance,
} from './advance';
import {
  blockedNoticeClass,
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  formTextareaClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';
import type { AdvanceLeadPayload, LeadNextStage } from './crm-types';

export type AdvanceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  /** Only the destinations the API allows from this stage. Nothing else is offered. */
  nextStages: LeadNextStage[];
  /** The ids of the destinations that open the proposta (the conversion door). */
  opensConversionIds: ReadonlySet<string>;
  /** The São Paulo civil day, passed in. */
  today: string;
  onSubmit: (payload: Omit<AdvanceLeadPayload, 'leadId'>) => Promise<unknown>;
  /** Resolves `true` when the conversion was carried out, `false` when the operator cancelled it. */
  onConvert: (stage: LeadNextStage) => Promise<boolean>;
};

const EMPTY_DRAFT: AdvanceDraft = { toStageId: null, nextStep: '', dueOn: '', note: '', reason: '' };

/*
 * The "Avançar" dialog. Mount-scoped state, like `MoveLeadDialog`: the container
 * keys it by the open cycle, so a cancelled advance leaves nothing behind.
 */
export function AdvanceDialog({
  open,
  onOpenChange,
  leadName,
  nextStages,
  opensConversionIds,
  today,
  onSubmit,
  onConvert,
}: AdvanceDialogProps) {
  const [draft, setDraft] = React.useState<AdvanceDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dest = nextStages.find((stage) => stage.id === draft.toStageId);
  const opensConversion = dest ? opensConversionIds.has(dest.id) : false;
  const needs = advanceNeeds(dest, opensConversion);
  const refusal = validateAdvance(dest, opensConversion, draft, today);
  const showRefusal = (touched || submitted) && refusal !== null;

  function update(patch: Partial<AdvanceDraft>) {
    setTouched(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function confirm() {
    setSubmitted(true);
    if (refusal !== null || !dest) return;
    setSubmitting(true);
    setError(null);
    try {
      if (needs.conversion) {
        const done = await onConvert(dest);
        if (!done) return;
      } else {
        await onSubmit(buildAdvancePayload(dest.id, draft, needs));
      }
      onOpenChange(false);
    } catch (caught: unknown) {
      setError(advanceErrorCopy(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ADVANCE_COPY.title}</DialogTitle>
          <DialogDescription>{`Escolha a próxima etapa de ${leadName}.`}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="advance-stage-label">
              {ADVANCE_COPY.stageLabel}
            </span>
            <Combobox
              aria-label="Etapa de destino"
              className={formSelectClass}
              onChange={(value) => update({ toStageId: value })}
              options={nextStages.map((stage) => ({ value: stage.id, label: stage.name }))}
              placeholder="Selecione a etapa"
              value={draft.toStageId}
            />
          </div>

          {needs.conversion ? (
            <p className={noticeClass} data-advance-conversion-hint="true">
              {ADVANCE_COPY.conversionHint}
            </p>
          ) : null}

          {needs.followup ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="advance-next-step">
                  {ADVANCE_COPY.nextStepLabel}
                </label>
                <Input
                  className={formInputClass}
                  id="advance-next-step"
                  maxLength={200}
                  onChange={(event) => update({ nextStep: event.target.value })}
                  value={draft.nextStep}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="advance-due-on">
                  {ADVANCE_COPY.dueOnLabel}
                </label>
                <Input
                  className={formInputClass}
                  id="advance-due-on"
                  min={today}
                  onChange={(event) => update({ dueOn: event.target.value })}
                  type="date"
                  value={draft.dueOn}
                />
              </div>
            </>
          ) : null}

          {needs.reason ? (
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="advance-reason">
                {ADVANCE_COPY.reasonLabel}
              </label>
              <textarea
                aria-required="true"
                className={formTextareaClass}
                id="advance-reason"
                onChange={(event) => update({ reason: event.target.value })}
                required
                value={draft.reason}
              />
            </div>
          ) : null}

          {needs.conversion ? null : (
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="advance-note">
                {ADVANCE_COPY.noteLabel}
              </label>
              <textarea
                className={formTextareaClass}
                id="advance-note"
                onChange={(event) => update({ note: event.target.value })}
                value={draft.note}
              />
            </div>
          )}

          {showRefusal ? (
            <p className={blockedNoticeClass} data-advance-blocked="true">
              {refusal}
            </p>
          ) : null}
          {error ? (
            <p className={blockedNoticeClass} data-advance-error="true" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button className={secondaryButtonClass} onClick={() => onOpenChange(false)} type="button">
            Cancelar
          </button>
          {/* `type="button"` on every render: the activation behaviour must never depend on state. */}
          <button
            className={primaryButtonClass}
            data-advance-confirm="true"
            disabled={refusal !== null || submitting}
            onClick={() => void confirm()}
            type="button"
          >
            {ADVANCE_COPY.confirm}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
