import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { SalesOpsFuncao } from '../types';
import { mutedStateClass } from './board-ui';
import { usePipelines, useSavePipeline } from './crm-hooks';
import { pickPipeline } from './crm-pipeline';
import {
  useLeadStages,
  useReorderLeadStages,
  useSaveLeadStage,
  useSetLeadStageStatus,
} from './hooks';
import { LeadStagesView } from './LeadStagesView';
import { PIPELINE_SETTINGS_COPY } from './pipeline-settings';
import { PipelinesPanel } from './PipelinesPanel';

/**
 * The `cadastros/etapas` mounting point, `Funis e etapas` (vários funis). It exists so the
 * pipeline and stage queries run only while that view is on screen: `SalesOpsApp.tsx` mounts this
 * conditionally, and a hook called from the shell itself would fire a lead request from the
 * dashboard.
 *
 * It holds ONE piece of state, the chosen pipeline (component state, like the board's selector),
 * and no other logic. The pipeline list is the admin read with the archived pipelines (the restore
 * list); the etapas are the SELECTED pipeline's, and every etapa write carries its `pipelineId`
 * (the API puts a new etapa in that pipeline and reorders that pipeline's set).
 *
 * Every callback is `mutateAsync` and never `mutate`, because `LeadStagesView`'s optimistic revert,
 * its "dialog stays open on 409" behaviour and the pipeline dialog's inline error are all keyed on
 * the REJECTION; a `mutate` wrapper always resolves and silently disarms them.
 *
 * `stages` is passed RAW, both statuses: filtering is the view's job and the archived section is
 * the only restore path a stage has.
 */
export function LeadStagesContainer({
  funcoes,
  onCreateFuncao,
}: {
  /** The org's função catalogue (the bootstrap's), both statuses. */
  funcoes: readonly SalesOpsFuncao[];
  /** Inline função create from the access picker; owned by the shell's one função-create seam. */
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
}) {
  const pipelinesQuery = usePipelines({ includeArchived: true });
  const pipelines = pipelinesQuery.data ?? [];
  const [choice, setChoice] = useState<string | null>(null);
  const selected = pickPipeline(pipelines, choice);
  const stagesQuery = useLeadStages(selected?.id, selected !== undefined);
  const savePipeline = useSavePipeline();
  const saveLeadStage = useSaveLeadStage();
  const setLeadStageStatus = useSetLeadStageStatus();
  const reorderLeadStages = useReorderLeadStages();

  if (pipelinesQuery.isPending) return <Skeleton className="h-[320px] w-full" />;
  if (pipelinesQuery.isError) return <p className={mutedStateClass}>Não foi possível carregar os funis.</p>;

  return (
    <div className="flex flex-col gap-[14px]">
      <PipelinesPanel
        funcoes={funcoes}
        onCreateFuncao={onCreateFuncao}
        onSavePipeline={(payload) => savePipeline.mutateAsync(payload).then((result) => result.pipeline)}
        onSelect={setChoice}
        pipelines={pipelines}
        selectedId={selected?.id ?? null}
      />
      {selected ? (
        <section aria-label={PIPELINE_SETTINGS_COPY.stagesOf(selected.name)} data-pipeline-stages={selected.id}>
          {stagesQuery.isPending ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <LeadStagesView
              key={selected.id}
              onReorderStages={(orderedIds) =>
                reorderLeadStages.mutateAsync({ stageIds: orderedIds, pipelineId: selected.id }).then(() => undefined)
              }
              onSaveStage={(payload) =>
                saveLeadStage
                  .mutateAsync(payload.id ? payload : { ...payload, pipelineId: selected.id })
                  .then(() => undefined)
              }
              onSetStageStatus={({ id, status }) =>
                setLeadStageStatus.mutateAsync({ id, status }).then(() => undefined)
              }
              stages={stagesQuery.data ?? []}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
