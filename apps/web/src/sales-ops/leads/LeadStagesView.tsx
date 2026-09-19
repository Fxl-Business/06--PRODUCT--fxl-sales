/*
  `reorderStageIds` is a pure helper exported beside the view, exactly as the plan
  specifies, so the same function the component compares by reference is the one the
  oracle pins. Fast refresh for this one module is the whole cost, and `router.tsx`
  and `auth/react.tsx` already take the same trade.
*/
/* eslint-disable react-refresh/only-export-components */
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Edit3,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isOptimisticId } from '../optimistic';
import type { SalesOpsLeadStage } from './types';

/*
  The `cadastros/etapas` screen: the lead pipeline's stage cadastro.

  It is FULLY PROP-DRIVEN on purpose. No query, no mutation, no `apiFetch` and no
  token live here, so the whole screen is testable with three `vi.fn()`s. The shell
  wires it like this:

    <LeadStagesView
      onReorderStages={(orderedIds) =>
        reorderLeadStages.mutateAsync({ stageIds: orderedIds }).then(() => undefined)}
      onSaveStage={(payload) => saveLeadStage.mutateAsync(payload).then(() => undefined)}
      onSetStageStatus={({ id, status }) =>
        setLeadStageStatus.mutateAsync({ id, status }).then(() => undefined)}
      stages={leadStages}
    />

  Three facts the wiring slice must know:

  1. Do NOT add a header action button for this view. The component renders its own
     `Nova etapa` button in its own toolbar, and a second one in the page chrome
     would be two doors onto one dialog.
  2. Every callback must return a promise that REJECTS on API failure
     (`mutateAsync`, never `mutate`). The optimistic reorder revert and the
     "dialog stays open on a 409 stage_name_taken" behaviour are both keyed on the
     rejection; a `mutate` wrapper that always resolves silently disarms both.
  3. Pass the RAW stage list, both statuses. Filtering is this component's job, and
     the `Etapas arquivadas` section is the only restore path a stage has.

  Two shapes reconciled against the SHIPPED data layer rather than against the plan:
  `ReorderLeadStagesPayload` is `{stageIds}` (not `{orderedIds}`), and
  `SetLeadStageStatusPayload` is `{id, status}` with no `name`. `onSetStageStatus`
  keeps `name` here because it is this screen's own callback and the name is what
  the confirmation copy reads; the wiring drops it on the way to the mutation.
*/

/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants, exactly as
  `CadastroHistoryPanel.tsx` and `ProfessionalSplitPanel.tsx` re-declare what they
  cannot import: `SalesOpsApp.tsx` imports this module, so an import the other way
  would be a cycle.
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const iconButtonBaseClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition';
const iconButtonClass = `${iconButtonBaseClass} border-[#dcdce2] bg-white text-[#57575f] hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]`;
/**
 * Disjoint from `iconButtonClass` on purpose: `hover:` and `disabled:` have equal
 * specificity, so a `disabled:` variant on the enabled class would light the control
 * up on hover depending on Tailwind's generated source order.
 */
const iconButtonPendingClass = `${iconButtonBaseClass} cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]`;
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60';
const systemBadgeClass = 'bg-[#fdf0cf] text-[#7a5a12]';
const neutralBadgeClass = 'bg-[#eeeef1] text-[#6a6a72]';
const errorTextClass = 'px-4 pb-3 text-[12.5px] font-semibold text-[#b23a22]';

const REORDER_ERROR = 'Não foi possível reordenar as etapas. A ordem anterior foi restaurada.';
const ARCHIVE_ERROR = 'Não foi possível arquivar a etapa. Tente novamente.';
const SAVE_ERROR = 'Não foi possível salvar a etapa. Tente novamente.';

export type LeadStagesViewProps = {
  /** Every stage the org has, both statuses, in any order. The component sorts and filters. */
  stages: SalesOpsLeadStage[];
  /** Create when `id` is absent, rename when present. Resolve closes the dialog; reject keeps it open. */
  onSaveStage: (payload: { id?: string; name: string }) => Promise<void>;
  /** Archive (`'archived'`) and restore (`'active'`) are the same status write. Never a DELETE. */
  onSetStageStatus: (input: {
    id: string;
    name: string;
    status: 'active' | 'archived';
  }) => Promise<void>;
  /** The FULL ordered id vector of the active stages after the move, first to last. */
  onReorderStages: (orderedIds: string[]) => Promise<void>;
};

/**
 * Pure. Moves `id` by `delta` (-1 up, +1 down) inside `ids`, returning a NEW array.
 * Returns the INPUT array unchanged when the id is absent or the target index is out
 * of range, so the caller can compare by reference and skip the request.
 *
 * A swap, not a splice: this screen moves one position at a time, and a swap is
 * trivially length-preserving and set-preserving, so no click can ever drop a column.
 */
export function reorderStageIds(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = from + delta;
  if (to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next[from] = ids[to]!;
  next[to] = ids[from]!;
  return next;
}

export function LeadStagesView({
  onReorderStages,
  onSaveStage,
  onSetStageStatus,
  stages,
}: LeadStagesViewProps) {
  const [dialog, setDialog] = useState<{ stage: SalesOpsLeadStage | null } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // `filter` already returns a new array, so the in-place `sort` never touches props.
  const active = stages
    .filter((stage) => stage.status === 'active')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
  const archived = stages
    .filter((stage) => stage.status === 'archived')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const activeIdsJoined = active.map((stage) => stage.id).join(',');

  /*
    `pendingOrder` is deliberately NOT cleared when the request resolves: clearing it
    before the query cache has refreshed would flash the old order back for one frame.
    It is cleared HERE, once the props themselves agree with it.

    A RENDER-PHASE guard and not a `useEffect`, matching the five render-phase guards
    `SalesOpsApp.tsx` already runs and keeping `react-hooks/set-state-in-effect`
    satisfied: an effect would paint the settled order once before clearing. It
    terminates by construction, because the write makes its own condition false on the
    very next render.
  */
  if (pendingOrder !== null && pendingOrder.join(',') === activeIdsJoined) setPendingOrder(null);

  const byId = new Map(active.map((stage) => [stage.id, stage]));
  const rendered = pendingOrder
    ? pendingOrder
        .map((id) => byId.get(id))
        .filter((stage): stage is SalesOpsLeadStage => stage !== undefined)
    : active;

  async function move(stage: SalesOpsLeadStage, delta: -1 | 1) {
    const current = rendered.map((row) => row.id);
    const next = reorderStageIds(current, stage.id, delta);
    // Out of range: the same reference comes back, so no request is made.
    if (next === current) return;
    setReorderError(null);
    setPendingOrder(next);
    try {
      await onReorderStages(next);
    } catch {
      setPendingOrder(null);
      setReorderError(REORDER_ERROR);
    }
  }

  async function save(payload: { id?: string; name: string }) {
    // A rejection propagates to the dialog, which keeps itself open and says so.
    await onSaveStage(payload);
    setDialog(null);
  }

  async function confirmArchive() {
    const target = confirmTarget;
    if (!target) return;
    setConfirmTarget(null);
    setStatusError(null);
    try {
      await onSetStageStatus({ ...target, status: 'archived' });
    } catch {
      setStatusError(ARCHIVE_ERROR);
    }
  }

  async function restore(stage: SalesOpsLeadStage) {
    setStatusError(null);
    try {
      await onSetStageStatus({ id: stage.id, name: stage.name, status: 'active' });
    } catch {
      setStatusError('Não foi possível restaurar a etapa. Tente novamente.');
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-[#8b8b92]">
          As etapas são as colunas do quadro de prospecção, na ordem em que aparecem.
        </p>
        <button
          className={primaryButtonClass}
          onClick={() => setDialog({ stage: null })}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Nova etapa
        </button>
      </div>

      {rendered.length === 0 ? (
        <div
          className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`}
        >
          <div className="text-sm font-bold text-[#201f24]">Nenhuma etapa ativa</div>
          <div className="max-w-[420px] text-[13px] leading-5 text-[#8b8b92]">
            Crie etapas para montar as colunas do quadro de prospecção.
          </div>
        </div>
      ) : (
        <div className={`${panelClass} overflow-hidden`}>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                <TableHead className={`${tableHeadClass} text-center`}>Ordem</TableHead>
                <TableHead className={tableHeadClass}>Nome</TableHead>
                <TableHead className={`${tableHeadClass} text-center`}>Tipo</TableHead>
                {/* No `Status` column: every listed etapa is active by construction. */}
                <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rendered.map((stage, index) => {
                const pending = isOptimisticId(stage.id);
                return (
                  <TableRow key={stage.id}>
                    {/*
                      The RENDER INDEX, never `stage.position`: `position` is a
                      server-owned integer that may be sparse, and printing a sparse
                      value as "the order" reads to the operator as a bug.
                    */}
                    <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px]">
                      {index + 1}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm font-semibold">{stage.name}</TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <Badge className={stage.isSystem ? systemBadgeClass : neutralBadgeClass}>
                        {stage.isSystem ? 'Predefinida' : 'Personalizada'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/*
                          The move buttons ARE the reorder on this screen, and they are
                          keyboard-operable natively. Drag belongs to the board.
                          An optimistic row cannot move: its placeholder id would land
                          inside the ordered vector and fail the Postgres uuid cast.
                        */}
                        <button
                          aria-label={`Mover ${stage.name} para cima`}
                          className={
                            pending || index === 0 ? iconButtonPendingClass : iconButtonClass
                          }
                          disabled={pending || index === 0}
                          onClick={() => void move(stage, -1)}
                          title="Mover para cima"
                          type="button"
                        >
                          <ArrowUp className="h-[15px] w-[15px]" />
                        </button>
                        <button
                          aria-label={`Mover ${stage.name} para baixo`}
                          className={
                            pending || index === rendered.length - 1
                              ? iconButtonPendingClass
                              : iconButtonClass
                          }
                          disabled={pending || index === rendered.length - 1}
                          onClick={() => void move(stage, 1)}
                          title="Mover para baixo"
                          type="button"
                        >
                          <ArrowDown className="h-[15px] w-[15px]" />
                        </button>
                        {/*
                          The system branch keeps the lock and NOTHING else. The rename
                          and archive controls are rendered only in the non-system
                          branch, never merely disabled inside a shared one: the API
                          answers `409` to any rename or status write on a predefined
                          etapa, so a control that must fail has no business existing.
                          This mirrors `FuncoesView`.
                        */}
                        {stage.isSystem ? (
                          <button
                            aria-label="Etapa predefinida do app"
                            className={`${iconButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
                            disabled
                            title="Etapa predefinida do app"
                            type="button"
                          >
                            <Lock className="h-[15px] w-[15px]" />
                          </button>
                        ) : (
                          <>
                            <button
                              aria-label={
                                pending ? `Salvando ${stage.name}` : `Editar ${stage.name}`
                              }
                              className={pending ? iconButtonPendingClass : iconButtonClass}
                              disabled={pending}
                              onClick={() => setDialog({ stage })}
                              title={pending ? 'Salvando...' : 'Editar'}
                              type="button"
                            >
                              <Edit3 className="h-[15px] w-[15px]" />
                            </button>
                            <button
                              aria-label={`Arquivar etapa ${stage.name}`}
                              className={pending ? iconButtonPendingClass : iconButtonClass}
                              disabled={pending}
                              onClick={() => setConfirmTarget({ id: stage.id, name: stage.name })}
                              title="Arquivar"
                              type="button"
                            >
                              <Archive className="h-[15px] w-[15px]" />
                            </button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {reorderError ? <p className={errorTextClass}>{reorderError}</p> : null}
          {statusError ? <p className={errorTextClass}>{statusError}</p> : null}
        </div>
      )}

      {/*
        The restore path lives IN THIS SCREEN, and that is not a deviation to be
        "cleaned up" into `Histórico de arquivamentos`. That panel is driven by
        `CadastroKind` and by the `audit_log` cadastro ledger; a stage is in neither,
        and `CadastroKind` cannot gain an etapa member without editing
        `SalesOpsApp.tsx`. Without this section an archived etapa would be
        unrecoverable, since a stage is never deleted, only archived.
      */}
      {archived.length > 0 ? (
        <div className={`${panelClass} overflow-hidden`}>
          <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">
            Etapas arquivadas
          </div>
          {archived.map((stage) => (
            <div
              className="flex items-center justify-between gap-3 border-t border-[#f0f0f3] px-4 py-3"
              key={stage.id}
            >
              <span className="text-[13.5px] text-[#57575f]">{stage.name}</span>
              <button
                aria-label={`Restaurar etapa ${stage.name}`}
                className={iconButtonClass}
                onClick={() => void restore(stage)}
                title="Restaurar"
                type="button"
              >
                <RotateCcw className="h-[15px] w-[15px]" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <StageDialog
        onClose={() => setDialog(null)}
        onSave={save}
        stage={dialog ? dialog.stage : null}
        open={dialog !== null}
      />

      {/*
        The confirmation, shaped exactly like `CadastroArchiveConfirm`. It holds no
        `Combobox` and no `InfoHint` and is not nested inside a `Dialog`, so there is
        no inline layer to register with `useInlineLayer`. A null target renders
        nothing, and the status write happens ONLY from the action here, never from
        the row button.
      */}
      <AlertDialog
        onOpenChange={(open) => (!open ? setConfirmTarget(null) : undefined)}
        open={confirmTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget ? `Arquivar a etapa ${confirmTarget.name}?` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              A etapa deixa de ser oferecida como coluna do quadro. Nada é excluído: para trazê-la
              de volta, use Etapas arquivadas nesta mesma tela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()}>Arquivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The `key` remounts the body so the name field re-seeds from the stage it opens on. */
function StageDialog(props: {
  onClose: () => void;
  onSave: (payload: { id?: string; name: string }) => Promise<void>;
  open: boolean;
  stage: SalesOpsLeadStage | null;
}) {
  if (!props.open) return null;
  return (
    <StageDialogBody
      key={props.stage?.id ?? 'new-stage'}
      onClose={props.onClose}
      onSave={props.onSave}
      stage={props.stage}
    />
  );
}

function StageDialogBody({
  onClose,
  onSave,
  stage,
}: {
  onClose: () => void;
  onSave: (payload: { id?: string; name: string }) => Promise<void>;
  stage: SalesOpsLeadStage | null;
}) {
  const [name, setName] = useState(stage?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Defence in depth. `LeadStagesView` never opens this dialog for a predefined
   * etapa, so this branch is unreachable in normal use; it exists so a future
   * mis-wire cannot produce the rename the API answers `409` to.
   */
  const isSystem = stage?.isSystem === true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSystem || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      /*
        `{id, name}` and NOTHING else: no `status`, no `position`. A rename must not
        be able to resurrect an archived etapa or renumber it as a side effect.
      */
      await onSave({ id: stage?.id, name: name.trim() });
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Etapa</DialogTitle>
          <DialogDescription>
            Etapa do funil de prospecção, usada como coluna do quadro de leads.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={(event) => void submit(event)}>
          <Field label="Nome" required>
            <Input
              className="bg-[#fafafb]"
              disabled={isSystem}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          {isSystem ? (
            <p className="text-[12.5px] text-[#8b8b92]">
              Etapa predefinida do app: o nome não pode ser alterado.
            </p>
          ) : null}
          {error ? <p className="text-[12.5px] font-semibold text-[#b23a22]">{error}</p> : null}
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <button className={secondaryButtonClass} onClick={onClose} type="button">
              Cancelar
            </button>
            <button
              className={primaryButtonClass}
              disabled={saving || isSystem || !name.trim()}
              type="submit"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A local copy: `SalesOpsApp`'s `Field` is not exported, and importing it would be a cycle. */
function Field({
  children,
  label,
  required,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
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
