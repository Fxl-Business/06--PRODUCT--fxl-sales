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
import { blockedNoticeClass, dangerButtonClass, secondaryButtonClass } from './board-ui';
import { LEAD_DELETE_COPY, leadDeleteErrorCopy } from './delete-copy';
import type { SalesOpsLead } from './types';

/**
 * THE one confirmation for deleting a lead, shared by the card menu, the Lista
 * action and both edit forms. PURELY presentational: it names the lead and
 * awaits `onConfirm`. Resolve closes it; a rejection keeps it open with the
 * mapped error inline, exactly like `ContactLeadDialog`'s save.
 *
 * The confirm button is a plain button and NOT `AlertDialogAction`, because the
 * Radix action closes the dialog on click, before the answer is known.
 *
 * It needs no `useInlineLayer`: it is a Radix layer itself, so when it opens over
 * an edit `Dialog` Radix's own layer stack hands Escape to it alone (oracle:
 * `lead-delete.test.tsx`).
 *
 * Mount-scoped (the caller keys it by the lead id), so the error and the pending
 * state never leak from one lead to the next.
 */

export type LeadDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: SalesOpsLead;
  /** Awaited: resolve closes the dialog, reject keeps it open with an inline error. */
  onConfirm: (lead: SalesOpsLead) => Promise<unknown>;
};

export function LeadDeleteDialog({ open, onOpenChange, lead, onConfirm }: LeadDeleteDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /*
    Where focus goes back to on close. Radix returns it to an `AlertDialogTrigger`
    and this dialog has none (a menu, a row or a form opens it), so without this
    focus fell to <body>, even with the edit form still open underneath. The
    element focused at mount when it is still in the page (the form's `Excluir
    lead`, the Lista's `Excluir`), else this lead's kebab (the menu item that
    opened it is gone by then), else Radix's own default.
  */
  const [opener] = React.useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  function returnFocus(event: Event) {
    const target = opener?.isConnected
      ? opener
      : document.querySelector<HTMLElement>(`[data-lead-menu="${lead.id}"]`);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(lead);
    } catch (failure: unknown) {
      setError(leadDeleteErrorCopy(failure));
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
      <AlertDialogContent data-lead-delete-dialog="" onCloseAutoFocus={returnFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{LEAD_DELETE_COPY.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{LEAD_DELETE_COPY.dialogBody(lead.contactName)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null ? (
          <p className={blockedNoticeClass} data-lead-delete-error="" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className={secondaryButtonClass} disabled={busy}>
            {LEAD_DELETE_COPY.cancel}
          </AlertDialogCancel>
          <button
            className={dangerButtonClass}
            data-confirm-delete=""
            disabled={busy}
            onClick={() => {
              void confirm();
            }}
            type="button"
          >
            {busy ? LEAD_DELETE_COPY.pending : LEAD_DELETE_COPY.confirm}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
