import { RestoreUndoNotice, UndoNotice } from './UndoNotice';
import type { UndoNoticeApi } from './use-undo-notice';

/** The JSX tail: the restore notice or the plain notice, and the alert line. */
export function UndoLayer({ undo }: { undo: UndoNoticeApi }) {
  return (
    <>
      {undo.notice?.restoreLeadId ? (
        <RestoreUndoNotice leadId={undo.notice.restoreLeadId} busy={undo.busy} onUndo={(restore) => { void undo.run(restore); }} />
      ) : undo.notice ? (
        <UndoNotice label={undo.notice.label} busy={undo.busy} onUndo={() => { void undo.run(); }} />
      ) : null}
      {undo.error ? <p className="fixed bottom-20 right-6 z-50 rounded-lg border bg-background px-4 py-3 text-destructive shadow-lg" role="alert">{undo.error}</p> : null}
    </>
  );
}
