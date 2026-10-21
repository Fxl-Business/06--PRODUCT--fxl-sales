# Part 09b - Shared undo notice

Part of slice `09-web-lead-resumo`.

## Context

- `LeadsBoardContainer.tsx` owns the undo machinery inline: `UNDO_CONFLICT` and `class UndoConflictError` (lines 44-48), state `undoNotice`, `undoError`, `undoBusy`, refs `undoSequence`, `undoInFlight` (lines 163-170), the 5 s expiry effect (lines 172-178), `publishUndo`, `publishDeleteUndo`, `runUndo` (lines 180-208), and the JSX tail (lines 436-443: `RestoreUndoNotice` / `UndoNotice` / the alert paragraph).
- The lead summary page (09c) needs the same behaviour for its `Editar` undo. Duplicating ~60 lines would leave two copies to keep in step, so this slice extracts them first. The behaviour is pinned by `lead-undo.test.tsx` (move, edit, delete-restore, double click lock, slow rejected inverse, stale inverse, 5 s expiry, timer cleared on unmount) and `lead-delete.test.tsx`.

## Design

Create `apps/web/src/sales-ops/leads/use-undo-notice.tsx` (the only new product file):

```tsx
import * as React from 'react';
import { RestoreUndoNotice, UndoNotice } from './UndoNotice';

export const UNDO_CONFLICT = 'Este lead foi alterado por outra pessoa. Atualize o funil antes de desfazer.';
export class UndoConflictError extends Error {}

export type UndoNoticeState = { id: number; label: string; undo?: () => Promise<unknown>; restoreLeadId?: string } | null;

export function useUndoNotice() {
  // move lines 163-208 of LeadsBoardContainer.tsx here verbatim:
  const [notice, setNotice] = React.useState<UndoNoticeState>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sequence = React.useRef(0);
  const inFlight = React.useRef(false);
  // expiry effect: identical body, with notice/busy/error in place of undoNotice/undoBusy/undoError
  // publish(label, undo) == publishUndo; publishRestore(leadId) == publishDeleteUndo
  // run(restore?) == runUndo, catching UndoConflictError -> UNDO_CONFLICT, anything else -> 'Não foi possível desfazer. Tente novamente.'
  return { notice, error, busy, publish, publishRestore, run };
}
export type UndoNoticeApi = ReturnType<typeof useUndoNotice>;

/** The JSX tail: restore notice, plain notice, and the alert. */
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
```

`LeadsBoardContainer.tsx` edits:
1. delete lines 44-48 (`UNDO_CONFLICT`, `UndoConflictError`) and import `{ UndoConflictError, UndoLayer, useUndoNotice } from './use-undo-notice'`; drop the now-unused `RestoreUndoNotice, UndoNotice` import (line 22).
2. delete the state/effect/functions of lines 163-208 and add `const undo = useUndoNotice();`.
3. replace calls: `publishUndo(` -> `undo.publish(`, `publishDeleteUndo(` -> `undo.publishRestore(`.
4. replace the JSX tail (lines 436-443) by `<UndoLayer undo={undo} />`.
5. `requireUnchangedLead` keeps throwing `new UndoConflictError(UNDO_CONFLICT)`; import `UNDO_CONFLICT` too.

Nothing else changes.

## Steps (TDD)

1. Write `use-undo-notice.test.tsx` (Tests); run: fails (module missing).
2. Create `use-undo-notice.tsx`; run it green.
3. Apply the container edits; run `lead-undo.test.tsx` and `lead-delete.test.tsx` UNMODIFIED: they must stay green. If one fails the extraction changed behaviour; fix the extraction, never the test.

## Tests (`use-undo-notice.test.tsx`, happy-dom; a tiny harness component renders `<UndoLayer undo={api} />` and exposes `api` through a ref)

- `publish shows a notice with the label and an enabled Desfazer`.
- `run calls the undo once, clears the notice on success` (a second synchronous `run` while busy is ignored: undo called once).
- `a rejected undo keeps the notice, re-enables the button and shows Não foi possível desfazer. Tente novamente.`
- `an UndoConflictError shows UNDO_CONFLICT`.
- `the notice expires after about five seconds and the timer is cleared on unmount` (fake timers; at 4900 ms still present, at 5100 ms gone).
- `publishRestore renders the restore notice and run(restore) awaits the given restore`.

## Affected tests search

Searched `apps/web/src` for `UndoNotice`, `RestoreUndoNotice`, `undoNotice`, `data-undo-action`: consumers are `LeadsBoardContainer.tsx` (edited), `lead-undo.test.tsx` and `lead-delete.test.tsx` (drive the real container through the DOM; unchanged and must stay green). Nothing is edited.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-undo.test.tsx src/sales-ops/leads/__tests__/lead-delete.test.tsx src/sales-ops/leads/__tests__/use-undo-notice.test.tsx`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- Moving effects between components can change effect order; the 5 s timer test and the unmount test are the guards.
- `use-undo-notice.tsx` imports `UndoNotice.tsx`, which imports `deleted-leads.ts` (a hook module). That already is the case for the container; no new edge in the write-surface scan (the new file is not in `OWNED_FILES`).
