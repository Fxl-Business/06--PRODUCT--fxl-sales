/**
 * The conflict copy and error of the lead undo notice. Kept apart from
 * `use-undo-notice.tsx` so that file exports components and hooks only.
 */
export const UNDO_CONFLICT = 'Este lead foi alterado por outra pessoa. Atualize o funil antes de desfazer.';

export class UndoConflictError extends Error {}
