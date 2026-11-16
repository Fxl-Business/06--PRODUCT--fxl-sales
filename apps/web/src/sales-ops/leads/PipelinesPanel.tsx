import { Archive, Edit3, Loader2, Plus, RotateCcw, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SalesOpsFuncao } from '../types';
import { formSelectClass } from './board-ui';
import type { CrmPipeline, SavePipelinePayload } from './crm-types';
import { FuncaoMultiPicker } from './FuncaoMultiPicker';
import {
  PIPELINE_SETTINGS_COPY as COPY,
  pipelineAccessSummary,
  pipelineSaveErrorCopy,
  splitPipelines,
} from './pipeline-settings';

/*
  The pipeline half of `Cadastros > Funis e etapas`. Fully prop-driven, like `LeadStagesView`
  below it: no query, no mutation, no token. `LeadStagesContainer` wires it.

  `onSavePipeline` must REJECT on an API failure (`mutateAsync`): the dialog stays open with the
  typed values and the mapped error, and the archive and restore show their error inline.
  Local copies of the shell's style constants, for the same cycle reason `LeadStagesView` gives.
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const iconButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#dcdce2] bg-white text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]';
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60';
const errorTextClass = 'text-[12.5px] font-semibold text-[#b23a22]';

export type PipelinesPanelProps = {
  /** Every pipeline of the org, both statuses (the admin read with `includeArchived`). */
  pipelines: readonly CrmPipeline[];
  /** The active pipeline whose etapas are listed below. */
  selectedId: string | null;
  onSelect: (pipelineId: string) => void;
  /** The org's função catalogue, both statuses. */
  funcoes: readonly SalesOpsFuncao[];
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  /** Create (no id) or patch. Resolves with the saved pipeline; rejects on an API failure. */
  onSavePipeline: (payload: SavePipelinePayload) => Promise<CrmPipeline>;
};

export function PipelinesPanel({
  pipelines,
  selectedId,
  onSelect,
  funcoes,
  onCreateFuncao,
  onSavePipeline,
}: PipelinesPanelProps) {
  const [dialog, setDialog] = useState<{ pipeline: CrmPipeline | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CrmPipeline | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const { active, archived } = splitPipelines(pipelines);
  const selected = active.find((pipeline) => pipeline.id === selectedId) ?? null;

  async function setStatus(pipeline: CrmPipeline, status: 'active' | 'archived') {
    setStatusError(null);
    try {
      await onSavePipeline({ id: pipeline.id, status });
      if (status === 'active') onSelect(pipeline.id);
    } catch {
      setStatusError(status === 'archived' ? COPY.archiveFailed : COPY.restoreFailed);
    }
  }

  return (
    <div className={`${panelClass} flex flex-col gap-3 p-4`} data-pipelines-panel="">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[260px] flex-1 flex-col gap-[6px]">
          <span className="text-xs font-semibold text-[#8b8b92]">{COPY.selectorLabel}</span>
          <Combobox
            aria-label={COPY.selectorLabel}
            className={formSelectClass}
            onChange={onSelect}
            options={active.map((pipeline) => ({
              value: pipeline.id,
              label: pipeline.name,
              ...(pipeline.isDefault ? { description: COPY.defaultBadge } : {}),
            }))}
            placeholder={COPY.selectorPlaceholder}
            searchPlaceholder="Buscar funil..."
            value={selected?.id ?? null}
          />
        </label>
        <div className="flex items-center gap-2">
          {selected ? (
            <>
              <button
                aria-label={COPY.editAction}
                className={iconButtonClass}
                onClick={() => setDialog({ pipeline: selected })}
                title={COPY.editAction}
                type="button"
              >
                <Edit3 className="h-[15px] w-[15px]" />
              </button>
              {/* The default pipeline cannot be archived (the API answers 409), so it has no control. */}
              {selected.isDefault ? null : (
                <button
                  aria-label={COPY.archiveAction}
                  className={iconButtonClass}
                  onClick={() => setArchiveTarget(selected)}
                  title={COPY.archiveAction}
                  type="button"
                >
                  <Archive className="h-[15px] w-[15px]" />
                </button>
              )}
            </>
          ) : null}
          <button className={primaryButtonClass} onClick={() => setDialog({ pipeline: null })} type="button">
            <Plus className="h-4 w-4" />
            {COPY.newAction}
          </button>
        </div>
      </div>
      {selected ? (
        <p className="text-[12.5px] text-[#8b8b92]" data-pipeline-access="">
          {selected.isDefault ? <span className="mr-2 font-semibold text-[#7a5a12]">{COPY.defaultBadge}.</span> : null}
          {pipelineAccessSummary(selected, funcoes)}
        </p>
      ) : null}
      {statusError ? <p className={errorTextClass}>{statusError}</p> : null}

      {archived.length > 0 ? (
        <div className="border-t border-[#f0f0f3] pt-3" data-archived-pipelines="">
          <div className="pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">{COPY.archivedTitle}</div>
          {archived.map((pipeline) => (
            <div className="flex items-center justify-between gap-3 py-1.5" key={pipeline.id}>
              <span className="text-[13.5px] text-[#57575f]">{pipeline.name}</span>
              <button
                aria-label={COPY.restoreLabel(pipeline.name)}
                className={iconButtonClass}
                onClick={() => void setStatus(pipeline, 'active')}
                title="Restaurar"
                type="button"
              >
                <RotateCcw className="h-[15px] w-[15px]" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {dialog ? (
        <PipelineDialog
          funcoes={funcoes}
          key={dialog.pipeline?.id ?? 'new-pipeline'}
          onClose={() => setDialog(null)}
          onCreateFuncao={onCreateFuncao}
          onSave={async (payload) => {
            const saved = await onSavePipeline(payload);
            setDialog(null);
            onSelect(saved.id);
          }}
          pipeline={dialog.pipeline}
        />
      ) : null}

      <AlertDialog onOpenChange={(open) => (!open ? setArchiveTarget(null) : undefined)} open={archiveTarget !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archiveTarget ? COPY.archiveTitle(archiveTarget.name) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{COPY.archiveBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{COPY.archiveBack}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = archiveTarget;
                setArchiveTarget(null);
                if (target) void setStatus(target, 'archived');
              }}
            >
              {COPY.archiveConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Remounted per pipeline (the `key` above), so the fields re-seed from the pipeline it opens on. */
function PipelineDialog({
  pipeline,
  funcoes,
  onCreateFuncao,
  onClose,
  onSave,
}: {
  pipeline: CrmPipeline | null;
  funcoes: readonly SalesOpsFuncao[];
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  onClose: () => void;
  onSave: (payload: SavePipelinePayload) => Promise<void>;
}) {
  const [name, setName] = useState(pipeline?.name ?? '');
  const [funcaoIds, setFuncaoIds] = useState<string[]>(() => [...(pipeline?.funcaoIds ?? [])]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // The full funções set every time: the API replaces it, never merges.
      await onSave({ ...(pipeline ? { id: pipeline.id } : {}), name: name.trim(), funcaoIds });
    } catch (caught) {
      setError(pipelineSaveErrorCopy(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[560px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">
            {pipeline ? COPY.dialogTitleEdit : COPY.dialogTitleNew}
          </DialogTitle>
          <DialogDescription>{COPY.dialogDescription}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" data-pipeline-form="" onSubmit={(event) => void submit(event)}>
          <label className="flex flex-col gap-[6px]">
            <span className="text-xs font-semibold text-[#8b8b92]">
              {COPY.nameLabel}
              <span className="text-[#b23a22]"> *</span>
            </span>
            <Input className="bg-[#fafafb]" name="pipelineName" onChange={(event) => setName(event.target.value)} value={name} />
          </label>
          <div className="flex flex-col gap-[6px]">
            <span className="text-xs font-semibold text-[#8b8b92]">{COPY.funcoesLabel}</span>
            <FuncaoMultiPicker
              aria-label={COPY.funcoesLabel}
              emptyHint={COPY.funcoesEmpty}
              funcoes={funcoes}
              onChange={setFuncaoIds}
              onCreateFuncao={onCreateFuncao}
              placeholder={COPY.funcoesPlaceholder}
              value={funcaoIds}
            />
          </div>
          {error ? <p className={errorTextClass}>{error}</p> : null}
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <button className={secondaryButtonClass} onClick={onClose} type="button">
              {COPY.cancel}
            </button>
            <button className={primaryButtonClass} disabled={saving || !name.trim()} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {COPY.save}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
