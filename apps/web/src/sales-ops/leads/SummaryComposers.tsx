import * as React from 'react';
import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { Input } from '@/components/ui/input';
import { fieldLabelClass, formInputClass, formTextareaClass, primaryButtonClass, blockedNoticeClass } from './board-ui';

/*
 * The two composers of the lead summary: a note and a follow-up. Plain forms of
 * buttons with `type="button"`; a failed write keeps the typed text.
 */

const NOTE_FAILED = 'Não foi possível salvar a nota.';
const FOLLOWUP_FAILED = 'Não foi possível agendar o próximo passo.';

export function NoteComposer({
  onAdd,
  pending = false,
}: {
  onAdd: (body: string) => Promise<unknown>;
  pending?: boolean;
}) {
  const [body, setBody] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const text = body.trim();

  async function add() {
    if (text === '') return;
    setError(null);
    try {
      await onAdd(text);
      setBody('');
    } catch {
      setError(NOTE_FAILED);
    }
  }

  return (
    <section aria-label="Nova nota" className="flex flex-col gap-2 rounded-[14px] border border-[#e8e8ec] bg-white p-4" data-summary-section="note">
      <label className={fieldLabelClass} htmlFor="summary-note">Nova nota</label>
      <textarea
        className={formTextareaClass}
        id="summary-note"
        onChange={(event) => setBody(event.target.value)}
        value={body}
      />
      <div>
        <button
          className={primaryButtonClass}
          data-note-add="true"
          disabled={text === '' || pending}
          onClick={() => void add()}
          type="button"
        >
          Adicionar nota
        </button>
      </div>
      {error ? <p className={blockedNoticeClass} role="alert">{error}</p> : null}
    </section>
  );
}

export function FollowupComposer({
  today,
  onAdd,
  pending = false,
}: {
  today: string;
  onAdd: (followup: { nextStep: string; dueOn: string }) => Promise<unknown>;
  pending?: boolean;
}) {
  const [nextStep, setNextStep] = React.useState('');
  const [dueOn, setDueOn] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const valid = nextStep.trim() !== '' && isIsoDay(dueOn) && dueOn >= today;

  async function add() {
    if (!valid) return;
    setError(null);
    try {
      await onAdd({ nextStep: nextStep.trim(), dueOn });
      setNextStep('');
      setDueOn('');
    } catch {
      setError(FOLLOWUP_FAILED);
    }
  }

  return (
    <section aria-label="Agendar próximo passo" className="flex flex-col gap-2 rounded-[14px] border border-[#e8e8ec] bg-white p-4" data-summary-section="followup-composer">
      <label className={fieldLabelClass} htmlFor="summary-followup-step">Próximo passo</label>
      <Input
        className={formInputClass}
        id="summary-followup-step"
        maxLength={200}
        onChange={(event) => setNextStep(event.target.value)}
        value={nextStep}
      />
      <label className={fieldLabelClass} htmlFor="summary-followup-due">Data do próximo passo</label>
      <Input
        className={formInputClass}
        id="summary-followup-due"
        min={today}
        onChange={(event) => setDueOn(event.target.value)}
        type="date"
        value={dueOn}
      />
      <div>
        <button
          className={primaryButtonClass}
          data-followup-add="true"
          disabled={!valid || pending}
          onClick={() => void add()}
          type="button"
        >
          Agendar próximo passo
        </button>
      </div>
      {error ? <p className={blockedNoticeClass} role="alert">{error}</p> : null}
    </section>
  );
}
