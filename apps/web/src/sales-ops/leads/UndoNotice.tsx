import { secondaryButtonClass } from './board-ui';
import { useRestoreLead } from './deleted-leads';

export function UndoNotice({
  label,
  busy,
  onUndo,
}: {
  label: string;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-4 rounded-lg border bg-background px-4 py-3 shadow-lg"
      data-undo-notice
      role="status"
    >
      <span>{label}</span>
      <button className={secondaryButtonClass} data-undo-action disabled={busy} onClick={onUndo} type="button">
        Desfazer
      </button>
    </div>
  );
}

export function RestoreUndoNotice({
  leadId,
  busy,
  onUndo,
}: {
  leadId: string;
  busy: boolean;
  onUndo: (restore: () => Promise<unknown>) => void;
}) {
  const restoreLead = useRestoreLead();
  return <UndoNotice label="Lead excluído" busy={busy} onUndo={() => onUndo(() => restoreLead.mutateAsync(leadId))} />;
}
