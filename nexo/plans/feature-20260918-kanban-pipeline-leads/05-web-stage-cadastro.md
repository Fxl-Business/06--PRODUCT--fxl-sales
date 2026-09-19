---
id: 05-web-stage-cadastro
milestone: v4.1.0
status: done
depends_on: [04-web-data-layer]
files_modified:
  - apps/web/src/sales-ops/leads/LeadStagesView.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-stages-view.test.tsx
acceptance: "given an org whose lead stages include seeded system ones and org-created ones, when an admin opens cadastros/etapas, then the active stages are listed in persisted order with no rename/archive affordance on a system stage, a custom stage can be created, renamed, moved up or down with the new full order persisted and reverted on failure, and archived behind a confirmation and restored from an Etapas arquivadas section - all of it from one self-contained component outside SalesOpsApp.tsx."
goal: "The cadastros/etapas admin screen as one self-contained, prop-driven component in apps/web/src/sales-ops/leads/, with its own dialog, its own archive confirmation and a keyboard-operable reorder."
must_not_break:
  - "apps/web/src/sales-ops/SalesOpsApp.tsx must be byte-unchanged by this slice (acceptance 18)."
  - "apps/web/package.json must be byte-unchanged by this slice - the drag dependency belongs to 06 and the two slices share wave 5."
  - "No Kanban board component, no lead card, no routing/navigation change, no conversion flow."
  - "No native <select>/<option>/<datalist> anywhere in the new file (eslint no-restricted-syntax)."
  - "No raw entity id rendered in user-facing copy (CLAUDE.md, UI Identifiers)."
  - "No DELETE verb reached, ever: archiving is a status write and restore is the same write with 'active'."
  - "apps/web/src/sales-ops/types.ts, hooks.ts, api.ts, optimistic.ts, navigation.ts are READ-ONLY here; they belong to slice 04 / slice 07."
rules:
  - "Local copies of the SalesOpsApp.tsx style constants, exactly as CadastroHistoryPanel.tsx and ProfessionalSplitPanel.tsx already do - SalesOpsApp.tsx will import this module in slice 07, so an import the other way is a cycle."
  - "Every button carries an explicit type=\"button\" except the dialog's Salvar, which is type=\"submit\" inside its own <form> (CLAUDE.md, UI Controls: never derive the attribute from state)."
  - "JSX props alphabetical, matching the surrounding files."
  - "pt-BR copy only. Strings are pinned by tests; do not paraphrase them."
  - "No useAppMutation, no useQuery, no apiFetch in this file. Every side effect arrives as a prop."
verifier_focus: "That the system-stage branch renders the lock and NOTHING else (not a disabled shared branch), that the failed-reorder revert really restores the previous order rather than merely clearing an error, that an archived stage has a reachable restore path, and that git diff for this slice touches exactly the two files in files_modified."
---

# 05 — `cadastros/etapas`, the lead-stage cadastro screen

## What this slice is

One file, one exported view component, plus its test file. Nothing else. Slice 07 mounts it and
routes to it; slice 06 owns the board. This slice writes **no** routing, **no** navigation entry and
**no** line inside `apps/web/src/sales-ops/SalesOpsApp.tsx` (8946 lines, acceptance 18).

The component is **fully prop-driven**: it receives the stage rows and four-ish callbacks and owns
everything else (dialog state, confirmation state, optimistic order, inline error copy). That is
deliberate — slice 07's executor wires it without talking to this slice's executor, and a component
that called slice 04's hooks itself would couple two parallel-planned slices by symbol name.

## Precedents actually read (do not re-derive them)

- `apps/web/src/sales-ops/SalesOpsApp.tsx:3430-3530` — `FuncoesView`. **This is the model.** The
  system branch renders a disabled `Lock` button with `aria-label="Função predefinida do app"` and
  **nothing else**; the `Editar` and archive controls are rendered only in the non-system branch,
  never merely `disabled` inside a shared one.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3216-3300` — `AreasView`: the panel + `Table` shape, the
  `status === 'active'` list filter keyed on the FILTERED list, the `EmptyPanel` early return.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:543-640` — `useCadastroArchive` /
  `CadastroArchiveButton` / `CadastroArchiveConfirm`: the select→confirm→commit shape. **Not
  importable** (not exported, and importing from `SalesOpsApp` would be a cycle), and its copy table
  is keyed by `CadastroKind`, which cannot gain `'etapa'` without editing `SalesOpsApp.tsx`. This
  slice therefore re-implements the same three-part shape **locally**, with its own copy.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:5393-5470` — `FuncaoDialog` / `FuncaoDialogBody`: the
  `key`-on-id wrapper, the `Field` + `Input` + `Cancelar`/`Salvar` footer, the defence-in-depth
  `isSystem` guard inside the dialog.
- `apps/web/src/sales-ops/CadastroHistoryPanel.tsx:1-60` — the stand-alone panel file shape, and the
  explicit comment justifying the local copies of the style constants. Copy that comment's intent.
- `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx:1-40` — the second precedent for a stand-alone
  sales-ops component with a documented reason to live outside `SalesOpsApp.tsx`.

## The file: `apps/web/src/sales-ops/leads/LeadStagesView.tsx`

### Imports

```ts
import { Archive, ArrowDown, ArrowUp, Edit3, Loader2, Lock, Plus, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isOptimisticId } from '../optimistic';
import type { SalesOpsLeadStage } from './types';
```

**Import paths, and the one that is easy to get wrong.** `isOptimisticId` comes from
`'../optimistic'`, the PRE-EXISTING `apps/web/src/sales-ops/optimistic.ts` that slice 04 leaves
byte-unchanged. `SalesOpsLeadStage` comes from `'./types'`, a SIBLING file -
`apps/web/src/sales-ops/leads/types.ts`, which slice 04 creates. It is **not** `'../types'`:
that path resolves to the shared `apps/web/src/sales-ops/types.ts`, which slice 04 declares
byte-unchanged and which never declares `SalesOpsLeadStage`. The two `..`/`.` spellings sitting
one line apart is exactly how this gets copy-pasted wrong, so it is written out here.

**Type-name reconciliation (the one cross-slice unknown).** Slice 04 owns
`apps/web/src/sales-ops/leads/types.ts` and lands before this slice. The canonical name is
`SalesOpsLeadStage`. Before writing the import,
`grep -n 'LeadStage' apps/web/src/sales-ops/leads/types.ts`
and use whatever lead-stage row type slice 04 actually exported. This component reads **exactly five
fields** and no others:

| field | type | use |
|---|---|---|
| `id` | `string` | React key, callback argument, order vector |
| `name` | `string` | the only user-facing label |
| `isSystem` | `boolean` | the lock branch |
| `position` | `number` | the sort key |
| `status` | `'active' \| 'archived'` | the list filter and the archived section |

Those five are fixed by slice 01's columns (`id`, `name`, `is_system`, `position`, `status` —
acceptance 5) under this repo's existing camelCase web convention, so a mismatch would be a slice-04
bug, not a design question. If one field is genuinely spelled differently, adapt the read **inside
this file only**; never edit `leads/types.ts` from here.

This screen deliberately reads **no** `kind`. The three kinds are `'normal' | 'conversion' | 'lost'`
(slice 01 is the schema owner), and the only thing this screen needs to know about them is already
carried by `isSystem`, which slice 01 holds equal to `kind <> 'normal'` with a biconditional CHECK.
Asking the `kind` question here would be a second door onto one fact.

### Local style constants (copied, with the cycle comment)

```ts
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass = 'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const iconButtonBaseClass = 'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition';
const iconButtonClass = `${iconButtonBaseClass} border-[#dcdce2] bg-white text-[#57575f] hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]`;
const iconButtonPendingClass = `${iconButtonBaseClass} cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]`;
const systemBadgeClass = 'bg-[#fdf0cf] text-[#7a5a12]';
const neutralBadgeClass = 'bg-[#eeeef1] text-[#6a6a72]';
const errorTextClass = 'px-4 pb-3 text-[12.5px] font-semibold text-[#b23a22]';
```

`iconButtonPendingClass` must stay **disjoint** from `iconButtonClass` for the reason already
documented at `SalesOpsApp.tsx:198` — `hover:` and `disabled:` have equal specificity.

### Exported symbols (exactly three)

```ts
export type LeadStagesViewProps = {
  /** Every stage the org has, both statuses, in any order. The component sorts and filters. */
  stages: SalesOpsLeadStage[];
  /** Create when `id` is absent, rename when present. Resolve closes the dialog; reject keeps it open. */
  onSaveStage: (payload: { id?: string; name: string }) => Promise<void>;
  /** Archive (`'archived'`) and restore (`'active'`) are the same status write. Never a DELETE. */
  onSetStageStatus: (input: { id: string; name: string; status: 'active' | 'archived' }) => Promise<void>;
  /** The FULL ordered id vector of the active stages after the move, first to last. */
  onReorderStages: (orderedIds: string[]) => Promise<void>;
};

export function LeadStagesView(props: LeadStagesViewProps): JSX.Element;

/**
 * Pure. Moves `id` by `delta` (-1 up, +1 down) inside `ids`, returning a NEW array.
 * Returns the input array unchanged when the id is absent or the target index is out of range,
 * so the caller can compare by reference and skip the request.
 */
export function reorderStageIds(ids: string[], id: string, delta: -1 | 1): string[];
```

Nothing else is exported. `JSX.Element` may be written as the inferred return; do not add a
`React.FC` annotation (no file in this tree uses one).

### Slice 07's wiring contract (write this as a block comment at the top of the file)

```tsx
<LeadStagesView
  onReorderStages={(orderedIds) => reorderLeadStages.mutateAsync({ orderedIds }).then(() => undefined)}
  onSaveStage={(payload) => saveLeadStage.mutateAsync(payload).then(() => undefined)}
  onSetStageStatus={(input) => setLeadStageStatus.mutateAsync(input).then(() => undefined)}
  stages={leadStages}
/>
```

Three facts slice 07 must know, and they belong in that comment verbatim:
1. **Do not add a header action button for this view.** The component renders its own
   `Nova etapa` button in its own toolbar. A second one in the page chrome would be two doors to one
   dialog.
2. Every callback must return a promise that **rejects** on API failure (`mutateAsync`, not
   `mutate`). The optimistic revert and the "dialog stays open on 409" behaviour are both keyed on
   the rejection; a `mutate` wrapper that always resolves silently disarms both.
3. Pass the **raw** stage list, both statuses. Filtering here is this component's job, and the
   archived section is the only restore path that exists for a stage.

### Layout

```
<div className="flex flex-col gap-[14px]">
  toolbar                      // flex items-center justify-between, the Nova etapa button on the right
  active panel | EmptyPanel    // panelClass + Table, or the empty state
  archived section             // rendered only when at least one archived stage exists
  <StageDialog .../>           // null unless open
  archive confirmation         // AlertDialog, null target renders nothing
</div>
```

**Toolbar.** Left: a muted one-liner,
`As etapas são as colunas do quadro de prospecção, na ordem em que aparecem.`
Right: a button, `type="button"`, class
`inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60`
(the `PrimaryButton` body, copied for the same cycle reason), containing
`<Plus className="h-4 w-4" />` and the text `Nova etapa`. It opens the dialog with no stage.

No page title and no subtitle here — the page chrome belongs to slice 07.

**Active table.** Header row `className="bg-[#fafafb] hover:bg-[#fafafb]"` with four `TableHead`s:

| head | class | cell |
|---|---|---|
| `Ordem` | `` `${tableHeadClass} text-center` `` | 1-based render index, `sales-ops-num px-4 py-3 text-center text-[13.5px]` |
| `Nome` | `tableHeadClass` | `px-4 py-3 text-sm font-semibold` |
| `Tipo` | `` `${tableHeadClass} text-center` `` | `<Badge>` — `Predefinida` with `systemBadgeClass` when `isSystem`, else `Personalizada` with `neutralBadgeClass` |
| `Ações` | `` `${tableHeadClass} text-center` `` | the control cluster below |

No `Status` column: every listed stage is active by construction — the same reasoning already
written into `AreasView`. Add that comment.

`Ordem` shows the **render index + 1**, never `stage.position`: `position` is a server-owned integer
that may be sparse, and printing a sparse value as "the order" reads as a bug to the operator. Write
that as a comment.

**Control cluster.** `<div className="flex items-center justify-center gap-1.5">`, in this order:

1. `Mover ${name} para cima` — `ArrowUp`, `disabled` when `pending` or it is the first row.
2. `Mover ${name} para baixo` — `ArrowDown`, `disabled` when `pending` or it is the last row.
3. then **the system fork**:
   - `stage.isSystem` → a single disabled button, `aria-label="Etapa predefinida do app"`,
     `title="Etapa predefinida do app"`, class
     `` `${iconButtonClass} disabled:cursor-not-allowed disabled:opacity-50` ``, holding
     `<Lock className="h-[15px] w-[15px]" />`. **And nothing else.** No `Editar`, no `Arquivar`,
     not even disabled ones — the API answers `409` to a rename or a status write on a system stage
     (acceptance 5), and a control that must fail has no business existing. This mirrors
     `FuncoesView` character for character.
   - otherwise → `Editar ${name}` (`Edit3`) opening the dialog on that stage, then
     `Arquivar etapa ${name}` (`Archive`) calling the confirmation's `select`.

`pending` is `isOptimisticId(stage.id)`. A pending row's `aria-label` on the edit control is
`Salvando ${name}` and every control in the cluster is `disabled` with `iconButtonPendingClass` — a
placeholder id would fail the Postgres uuid cast on the PATCH path, exactly as documented for
áreas/funções. The reorder arrows are disabled for a pending row for the same reason: the id would
land inside the ordered vector.

**Move buttons are the reorder.** There is deliberately **no** drag here. Drag is slice 06's board
affordance and carries slice 06's pinned dependency; `apps/web/package.json` is off-limits in wave 5.
Acceptance 9's rule — "o drag é conveniência, o menu é o controle real" — is satisfied natively on
this screen because the only control is keyboard-operable.

**Empty state.** When no active stage exists, return the empty panel instead of the table (keyed on
the FILTERED list, as in `AreasView`) — but keep the toolbar and the archived section rendered, or
an org that archived everything would have no way back:

```tsx
<div className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`}>
  <div className="text-sm font-bold text-[#201f24]">Nenhuma etapa ativa</div>
  <div className="max-w-[420px] text-[13px] leading-5 text-[#8b8b92]">
    Crie etapas para montar as colunas do quadro de prospecção.
  </div>
</div>
```

**Archived section.** Rendered only when `archived.length > 0`, sorted by `name` with
`localeCompare(…, 'pt-BR')`. `panelClass`, a heading row
`<div className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">Etapas arquivadas</div>`,
then one row per stage: the name in `text-[13.5px] text-[#57575f]` and a restore button
`aria-label={`Restaurar etapa ${name}`}`, `title="Restaurar"`, `iconButtonClass`, `RotateCcw`,
calling `onSetStageStatus({ id, name, status: 'active' })` directly (no confirmation — restore is
the non-destructive direction).

**This section is deliberately in-screen and is not a deviation to be "cleaned up".** Áreas, funções
and pessoas restore from `Histórico de arquivamentos`, which is driven by `CadastroKind` and by the
`audit_log` cadastro ledger. A stage is neither: `CadastroKind` cannot gain `'etapa'` without editing
`SalesOpsApp.tsx` (banned by acceptance 18) and stage lifecycle is not in that ledger. Without this
section an archived stage would be unrecoverable. Write that reasoning as a comment above it.

### State and behaviour

```ts
const [dialog, setDialog] = useState<{ stage: SalesOpsLeadStage | null } | null>(null);
const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
const [reorderError, setReorderError] = useState<string | null>(null);
const [statusError, setStatusError] = useState<string | null>(null);
```

**Sorting.**

```ts
const active = stages
  .filter((stage) => stage.status === 'active')
  .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
```

Copy before sorting (`[...stages]` via `filter`, which already copies — `filter` returns a new array,
so the in-place `sort` is safe here; do **not** sort `props.stages` directly).

**Render order.** When `pendingOrder` is non-null, render `active` reordered to match it (map the ids
through a `Map<string, SalesOpsLeadStage>` and drop ids that no longer resolve); otherwise render
`active`.

**Move handler.**

```ts
async function move(stage, delta) {
  const current = renderedStages.map((row) => row.id);
  const next = reorderStageIds(current, stage.id, delta);
  if (next === current) return;              // out of range: no request
  setReorderError(null);
  setPendingOrder(next);
  try {
    await onReorderStages(next);
  } catch {
    setPendingOrder(null);                   // THE REVERT
    setReorderError('Não foi possível reordenar as etapas. A ordem anterior foi restaurada.');
  }
}
```

`pendingOrder` is **not** cleared on success inside the handler — clearing it before the query cache
has refreshed would flash the old order back for one frame. It is cleared by an effect once the props
agree:

```ts
useEffect(() => {
  if (pendingOrder && pendingOrder.join(',') === active.map((s) => s.id).join(',')) {
    setPendingOrder(null);
  }
});
```

(no dependency array is needed beyond the default behaviour of running every render; if lint prefers
one, use `[pendingOrder, activeIdsJoined]` with `activeIdsJoined` computed above the effect.)

**Save handler.**

```ts
async function save(payload: { id?: string; name: string }) {
  await onSaveStage(payload);   // a rejection propagates to the dialog, which keeps itself open
  setDialog(null);
}
```

**Archive.** `select` sets `confirmTarget`; `confirm` clears it and calls
`onSetStageStatus({ ...target, status: 'archived' })`, catching a rejection into `statusError`
(`Não foi possível arquivar a etapa. Tente novamente.`). `Voltar` clears the target and calls
nothing. **The status write must never happen on the row-button click** — only from the
confirmation's action.

Confirmation copy (`AlertDialog`, same structure as `CadastroArchiveConfirm`):

- title: `` `Arquivar a etapa ${target.name}?` ``
- body: `A etapa deixa de ser oferecida como coluna do quadro. Nada é excluído: para trazê-la de volta, use Etapas arquivadas nesta mesma tela.`
- cancel: `Voltar` — action: `Arquivar`

### The dialog (`StageDialog`, internal, not exported)

Split in two exactly like `FuncaoDialog` / `FuncaoDialogBody`, so the `key` remounts the body and
re-seeds the name:

```tsx
function StageDialog(props: {
  onClose: () => void;
  onSave: (payload: { id?: string; name: string }) => Promise<void>;
  stage: SalesOpsLeadStage | null;
})
```

Body:

- `const [name, setName] = useState(stage?.name ?? '');`
- `const [saving, setSaving] = useState(false);`
- `const [error, setError] = useState<string | null>(null);`
- `const isSystem = stage?.isSystem === true;` — **defence in depth**, exactly as
  `FuncaoDialogBody` documents it: `LeadStagesView` never opens this dialog for a system stage, so
  the branch is unreachable in normal use; it exists so a future mis-wire cannot produce the rename
  the API answers `409` to. Disables the `Input` and the `Salvar` button and renders
  `Etapa predefinida do app: o nome não pode ser alterado.` in `text-[12.5px] text-[#8b8b92]`.
- `submit(event: FormEvent)`: `event.preventDefault()`; return early when `isSystem` or
  `!name.trim()`; set `saving`, `await onSave({ id: stage?.id, name: name.trim() })` inside a
  `try/catch`; on rejection set `error` to
  `Não foi possível salvar a etapa. Tente novamente.` and **do not close**; `finally` clears
  `saving`.
- Markup: `<Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>`,
  `<DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">`,
  header title `Etapa`, description
  `Etapa do funil de prospecção, usada como coluna do quadro de leads.`, then a
  `<form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>` holding a local `Field`
  (`label="Nome"`, `required`) around `<Input className="bg-[#fafafb]" disabled={isSystem} … />`,
  the error paragraph when set, and a footer
  `<div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">` with `Cancelar`
  (`type="button"`, the `SecondaryButton` body copied) and `Salvar` (`type="submit"`, disabled on
  `saving || isSystem || !name.trim()`, showing `<Loader2 className="h-4 w-4 animate-spin" />` while
  saving and `<Save className="h-4 w-4" />` otherwise).

The dialog sends **`{ id, name }` and nothing else** — no `status`, no `position`. A rename must not
be able to resurrect an archived stage or renumber it as a side effect, which is the exact rule the
área and função dialogs already follow ("the PATCH body carries `status` and nothing else" in the
mirror direction). Add that comment.

Local `Field` (a copy, since `SalesOpsApp`'s is not exported):

```tsx
function Field({ children, label, required }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-xs font-semibold text-[#8b8b92]">
        {label}
        {required ? <span className="text-[#b23a22]"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
```

### `reorderStageIds`

```ts
export function reorderStageIds(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = from + delta;
  if (to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next[from] = ids[to];
  next[to] = ids[from];
  return next;
}
```

A swap, not a splice: this screen moves one position at a time and a swap is trivially
length-preserving and set-preserving. Returning the **same reference** when nothing moves is what
lets `move()` skip the request with `next === current`.

## Pickers: there are none, deliberately

No `Combobox` appears on this screen, because the screen has no single-select question: a stage is a
name, and its order is expressed by two arrow buttons. That satisfies the CLAUDE.md "UI Controls"
rules **vacuously** — no native `<select>`/`<option>`/`<datalist>`, and therefore no
`formSelectClass` / `comboboxTriggerClass` call site either. A UI-contract test below pins the
absence so a later "quick" native picker cannot slip in behind a green suite. If a picker is ever
added here it is `Combobox` with `formSelectClass` (44px, dialog/form geometry), never
`comboboxTriggerClass`, which belongs to the compact `Filtros` bar only.

## Tests: `apps/web/src/sales-ops/leads/__tests__/lead-stages-view.test.tsx`

`vitest.config.ts` includes `src/**/__tests__/**/*.test.tsx`, so the nested directory is picked up
with no config change.

Header, copied from `areas-view.test.tsx`: `// @vitest-environment happy-dom`, the
`@/components/ui/dialog` `vi.mock` (the real `DialogContent` needs a portal happy-dom will not give
it), `createRoot` + `React.act`, the `IS_REACT_ACT_ENVIRONMENT` beforeEach/afterEach pair, and the
`change` / `click` / `submit` helpers verbatim. Add `buttonByAriaLabel(label)` from
`pessoas-funcoes-view.test.tsx`.

Fixture:

```ts
const stage = (patch: Partial<SalesOpsLeadStage> = {}): SalesOpsLeadStage => ({
  id: 'e0000001-0000-4000-8000-000000000001',
  orgId: '99999999-9999-4999-8999-999999999999',
  name: 'Novo',
  isSystem: true,
  position: 1,
  status: 'active',
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});
```

(If slice 04's type carries extra required fields, add them to the fixture; never widen the
component's reads to match.)

Four stages: `novo` (system, pos 1), `contato` (custom, pos 2), `proposta` (custom, pos 3),
`perdido` (system, pos 9). Render with `resolved = () => Promise.resolve()` callbacks by default.

### Named oracles (this is the list Verify runs)

Command:

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-stages-view.test.tsx
```

`describe('etapas cadastro')`:

1. **`offers no rename and no archive affordance for a system etapa`** — asserts
   `buttonByAriaLabel('Editar Contato')` is non-null and enabled, `buttonByAriaLabel('Editar Novo')`
   and `buttonByAriaLabel('Arquivar etapa Novo')` are **null**, and the disabled
   `Etapa predefinida do app` lock exists; clicking the lock opens no dialog.
   *Decisive against:* collapsing the fork into one shared branch with `disabled={stage.isSystem}`
   — the controls would then exist and the `toBeNull()` assertions go red. Also decisive against
   deleting the `isSystem` check entirely.
2. **`persists the full ordered id list when an etapa moves down`** — clicks
   `Mover Contato para baixo`, asserts `onReorderStages` was called once with
   `[novo.id, proposta.id, contato.id, perdido.id]`, and asserts the rendered `Nome` cells are in
   that order **before** the promise settles (optimistic).
   *Decisive against:* not calling the callback at all; sending only the moved id; sending the
   unchanged order; rendering from props only (the optimistic row order assertion goes red).
3. **`reverts the row order when the reorder request fails`** — `onReorderStages` returns
   `Promise.reject(new Error('boom'))`; after the rejection settles the rendered name order is the
   original one and the text contains
   `Não foi possível reordenar as etapas. A ordem anterior foi restaurada.`
   *Decisive against:* an optimistic update with no `catch`, and against a `catch` that only sets the
   message without clearing `pendingOrder` (the order assertion is what catches that one — the
   message assertion alone would pass).
4. **`does not move the first etapa up or the last one down`** — asserts the up arrow on the first
   row and the down arrow on the last row are `disabled`, and that a dispatched click on either
   calls `onReorderStages` zero times.
   *Decisive against:* unguarded index arithmetic that emits a same-order request (a wasted PATCH
   that would renumber every row server-side) or an `undefined` in the vector.
5. **`restores an archived etapa from the Etapas arquivadas section`** — an archived custom stage is
   absent from `tbody` of the active table, present under `Etapas arquivadas`, and clicking
   `Restaurar etapa Descartado` calls `onSetStageStatus` with `{ id, name, status: 'active' }`.
   *Decisive against:* deleting the archived section (the dead-end this screen exists to avoid) and
   against a restore that sends `'archived'` or reaches a DELETE.
6. **`archives only after the confirmation is accepted`** — clicking `Arquivar etapa Contato` calls
   `onSetStageStatus` zero times and shows `Arquivar a etapa Contato?`; clicking `Voltar` still calls
   it zero times; reopening and clicking `Arquivar` calls it once with `status: 'archived'`.
   *Decisive against:* wiring the row button straight to the mutation.
7. **`creates an etapa with no id and a trimmed name`** — open via `Nova etapa`, type `'  Contato  '`,
   submit; expects `onSaveStage` called with `{ id: undefined, name: 'Contato' }` and **not**
   with any `status` or `position` key (`expect(call).not.toHaveProperty('status')`).
   *Decisive against:* sending an untrimmed name, sending `status`/`position` (which would let a
   rename resurrect or renumber a row), or sending a fabricated id.
8. **`renames a custom etapa keeping its id`** — `Editar Contato`, retype, submit, expect
   `{ id: contato.id, name: 'Primeiro contato' }`.
   *Decisive against:* dropping the id (turning every rename into a create).
9. **`keeps the dialog open when the save is rejected`** — `onSaveStage` rejects; after settling the
   name `Input` is still in the DOM and the text contains
   `Não foi possível salvar a etapa. Tente novamente.`
   *Decisive against:* `onSave(...).then(close)` written as an unconditional close, which would
   swallow the `409` on a system stage and read to the operator as a successful save.
10. **`refuses to save an etapa without a name`** — submit with an empty field: `onSaveStage` not
    called and the `Salvar` button `disabled`.
    *Decisive against:* dropping the `!name.trim()` guard.
11. **`disables every control on an optimistic row`** — a stage whose id is
    `optimistic:leadStages:novo` (the prefix is `OPTIMISTIC_ID_PREFIX = 'optimistic:'`, exported
    from `apps/web/src/sales-ops/optimistic.ts`): its edit control carries
    `aria-label="Salvando …"`, and edit / archive / both arrows are `disabled`.
    *Decisive against:* removing the `isOptimisticId` guard, which would send a placeholder id into
    a PATCH and fail the Postgres uuid cast.
12. **`lists no archived etapa in the active table`** — the `tbody` row count equals the active
    count and the archived name is absent from the table's own `textContent`.
    *Decisive against:* deleting the `status === 'active'` filter.

`describe('reorderStageIds')`:

13. **`swaps neighbours and preserves the id set`** — up and down cases, plus
    `expect(next).toHaveLength(ids.length)` and `expect([...next].sort()).toEqual([...ids].sort())`.
    *Decisive against:* a splice bug that drops or duplicates an id — which would silently delete a
    column from the board.
14. **`returns the same array reference when the move is out of range`** —
    `expect(reorderStageIds(ids, ids[0], -1)).toBe(ids)` and the last-element `+1` twin, plus an
    unknown id.
    *Decisive against:* returning a fresh equal array, which makes `move()`'s `next === current`
    guard always false and emits a no-op PATCH on every clamped click.

`describe('etapas cadastro UI contract')`:

15. **`uses no native picker and no drag dependency`** — reads `../LeadStagesView.tsx` with
    `readFileSync` (resolved through `node:path` + `fileURLToPath`, **not** `new URL(...)` — this
    file is `@vitest-environment happy-dom` and happy-dom's global `URL` resolves against the
    document origin; the comment at the top of `pessoas-funcoes-view.test.tsx` says so) and asserts
    the source contains none of `'<select'`, `'<option'`, `'<datalist'`, and does not import from
    `'@dnd-kit'` or `'react-beautiful-dnd'` or `'@hello-pangea/dnd'`.
    *Decisive against:* a native picker added here later (which lint would also catch) and against
    this slice accidentally reaching for slice 06's dependency, which would put
    `apps/web/package.json` in two wave-5 diffs.

Verify's named-oracle shortlist, if it runs a subset: **1, 3, 5, 7, 14**.

## Also run for this slice

```bash
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
git diff --name-only <base>   # must list exactly the two files in files_modified
```

## Deliberately out of scope

- **Routing, navigation, the shell mount.** Slice 07. This slice adds no entry to
  `navigation.ts`, `resolveSalesOpsRoute` or `buildSalesOpsPath`, and does not touch
  `SalesOpsApp.tsx`.
- **The board, the card, drag-and-drop, `apps/web/package.json`.** Slice 06 shares this wave; a
  shared path would break the parallel-safety signal.
- **The conversion flow, `isConversion` / `isLost` semantics, the "motivo obrigatório" rule.** Those
  are board and API behaviour (acceptance 6, 11, 12, 13). This screen shows `Predefinida` vs
  `Personalizada` and nothing about what a system stage *means*, because the only stage facts it is
  allowed to depend on are the five fields listed above — and a terminal-stage badge would need
  slice 01's discriminator, which this slice cannot verify.
- **`Histórico de arquivamentos` integration.** Reasoned above: `CadastroKind` lives in
  `SalesOpsApp.tsx`. The in-screen `Etapas arquivadas` section is the restore path.
- **Any query, mutation or fetch.** Every side effect is a prop, so this component is fully
  testable with four `vi.fn()`s and no MSW, no `QueryClientProvider` and no token.
- **A per-row "Mover para posição N" picker.** The two arrows cover the operator's real motion on a
  list this short, and a picker would add the only native-picker-shaped control on the screen for no
  new capability.
