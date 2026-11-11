import * as React from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { blockedNoticeClass, dangerButtonClass, noticeClass, secondaryButtonClass } from './board-ui';
import { STAGE_DELETE_COPY, stageDeleteErrorCopy, stageDeleteTypedMatches } from './stage-delete-copy';

/**
 * THE one confirmation for deleting every lead of an etapa. PURELY presentational:
 * it names the etapa, shows the server's count (`preview`) and awaits `onConfirm`
 * only after the operator typed that exact count. Resolve closes it; a rejection
 * keeps it open with the mapped error inline, like `LeadDeleteDialog`.
 *
 * The confirm button is a plain button and NOT `AlertDialogAction`, because the
 * Radix action closes the dialog on click, before the answer is known. It needs no
 * `useInlineLayer`: it is a Radix layer itself and holds no inner layer.
 *
 * Mount-scoped (the caller keys it by the etapa id), so the typed text and the
 * error never leak from one etapa to the next.
 */

export type StageDeletePreviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; deletableCount: number; skippedConvertedCount: number };

export type StageDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageName: string;
  preview: StageDeletePreviewState;
  /** Awaited: resolve closes the dialog, reject keeps it open with an inline error. */
  onConfirm: () => Promise<unknown>;
};

export function StageDeleteDialog({
  open,
  onOpenChange,
  stageName,
  preview,
  onConfirm,
}: StageDeleteDialogProps) {
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  const count = preview.status === 'ready' ? preview.deletableCount : 0;
  const canConfirm = preview.status === 'ready' && stageDeleteTypedMatches(typed, count) && !busy;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure: unknown) {
      setError(stageDeleteErrorCopy(failure));
      setBusy(false);
      return;
    }
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        // Escape and Cancelar wait for the answer: closing mid-request would hide
        // the outcome of a delete that is already on the wire.
        if (!next && busy) return;
        onOpenChange(next);
      }}
      open={open}
    >
      <AlertDialogContent data-stage-delete-dialog="">
        <AlertDialogHeader>
          <AlertDialogTitle>{STAGE_DELETE_COPY.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription data-stage-delete-stage="">
            {STAGE_DELETE_COPY.stageLine(stageName)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preview.status === 'loading' ? (
          <p className={noticeClass} data-stage-delete-loading="" role="status">
            {STAGE_DELETE_COPY.loading}
          </p>
        ) : null}
        {preview.status === 'error' ? (
          <p className={blockedNoticeClass} data-stage-delete-preview-error="" role="alert">
            {STAGE_DELETE_COPY.loadFailed}
          </p>
        ) : null}
        {preview.status === 'ready' ? (
          <div className="grid gap-3 text-[13.5px] text-[#57575f]">
            <p className="font-semibold text-[#201f24]" data-stage-delete-count="">
              {count > 0 ? STAGE_DELETE_COPY.countLine(count) : STAGE_DELETE_COPY.nothingToDelete}
            </p>
            {preview.skippedConvertedCount > 0 ? (
              <p data-stage-delete-skipped="">
                {STAGE_DELETE_COPY.skippedLine(preview.skippedConvertedCount)}
              </p>
            ) : null}
            <p>{STAGE_DELETE_COPY.reassurance}</p>
            {count > 0 ? (
              <div className="grid gap-1.5">
                <label className="text-[13px] font-semibold text-[#201f24]" htmlFor={inputId}>
                  {STAGE_DELETE_COPY.typePrompt(count)}
                </label>
                <Input
                  autoComplete="off"
                  data-stage-delete-input=""
                  disabled={busy}
                  id={inputId}
                  inputMode="numeric"
                  onChange={(event) => setTyped(event.target.value)}
                  value={typed}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {error !== null ? (
          <p className={blockedNoticeClass} data-stage-delete-error="" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className={secondaryButtonClass} disabled={busy}>
            {STAGE_DELETE_COPY.cancel}
          </AlertDialogCancel>
          <button
            className={dangerButtonClass}
            data-confirm-stage-delete=""
            disabled={!canConfirm}
            onClick={() => {
              void confirm();
            }}
            type="button"
          >
            {busy ? STAGE_DELETE_COPY.pending : STAGE_DELETE_COPY.confirm(count)}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
