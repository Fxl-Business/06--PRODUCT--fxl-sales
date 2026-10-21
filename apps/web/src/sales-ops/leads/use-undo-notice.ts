import * as React from 'react';
import { UNDO_CONFLICT, UndoConflictError } from './undo-conflict';

/**
 * The shared "Desfazer" notice of the lead screens. The board (move, delete) and
 * the lead summary (edit) both publish into it, so the behaviour is written once:
 * a five second window, a single in-flight undo, and a conflict copy when the lead
 * changed under the operator.
 */

export type UndoNoticeState = {
  id: number;
  label: string;
  undo?: () => Promise<unknown>;
  restoreLeadId?: string;
} | null;

const UNDO_FAILED = 'Não foi possível desfazer. Tente novamente.';
const UNDO_WINDOW_MS = 5000;

export function useUndoNotice() {
  const [notice, setNotice] = React.useState<UndoNoticeState>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sequence = React.useRef(0);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!notice || busy || error) return;
    const timer = window.setTimeout(() => setNotice((current) =>
      current?.id === notice.id ? null : current,
    ), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [notice, busy, error]);

  function publish(label: string, undo: () => Promise<unknown>) {
    setError(null);
    setNotice({ id: ++sequence.current, label, undo });
  }

  function publishRestore(leadId: string) {
    setError(null);
    setNotice({ id: ++sequence.current, label: 'Lead excluído', restoreLeadId: leadId });
  }

  async function run(restore?: () => Promise<unknown>) {
    if (!notice || inFlight.current) return;
    const active = notice;
    const action = restore ?? active.undo;
    if (!action) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setNotice((current) => current?.id === active.id ? null : current);
      setError(null);
    } catch (caught) {
      setError(caught instanceof UndoConflictError ? UNDO_CONFLICT : UNDO_FAILED);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { notice, error, busy, publish, publishRestore, run };
}

export type UndoNoticeApi = ReturnType<typeof useUndoNotice>;
