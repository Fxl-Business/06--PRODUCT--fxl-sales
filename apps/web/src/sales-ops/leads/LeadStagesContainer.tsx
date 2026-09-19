import {
  useLeadStages,
  useReorderLeadStages,
  useSaveLeadStage,
  useSetLeadStageStatus,
} from './hooks';
import { LeadStagesView } from './LeadStagesView';

/**
 * The `cadastros/etapas` mounting point. It exists so `useLeadStages()` runs only
 * while that view is on screen: `SalesOpsApp.tsx` mounts this conditionally, and a
 * hook called from the shell itself would fire a lead request from the dashboard.
 *
 * It holds NO state and NO logic. Every callback is `mutateAsync` and never
 * `mutate`, because `LeadStagesView`'s optimistic revert and its "dialog stays open
 * on 409" behaviour are both keyed on the REJECTION; a `mutate` wrapper always
 * resolves and silently disarms both.
 *
 * Two shapes reconciled against the SHIPPED data layer rather than against the
 * plan: `ReorderLeadStagesPayload` is `{stageIds}` (not `{orderedIds}`), and
 * `SetLeadStageStatusPayload` is `{id, status}` with no `name` - the view keeps
 * `name` on its own callback because its confirmation copy reads it, and the
 * wiring drops it here on the way to the mutation.
 *
 * `stages` is passed RAW, both statuses: filtering is the view's job and the
 * archived section is the only restore path a stage has.
 */
export function LeadStagesContainer() {
  const stagesQuery = useLeadStages();
  const saveLeadStage = useSaveLeadStage();
  const setLeadStageStatus = useSetLeadStageStatus();
  const reorderLeadStages = useReorderLeadStages();

  return (
    <LeadStagesView
      onReorderStages={(orderedIds) =>
        reorderLeadStages.mutateAsync({ stageIds: orderedIds }).then(() => undefined)
      }
      onSaveStage={(payload) => saveLeadStage.mutateAsync(payload).then(() => undefined)}
      onSetStageStatus={({ id, status }) =>
        setLeadStageStatus.mutateAsync({ id, status }).then(() => undefined)
      }
      stages={stagesQuery.data ?? []}
    />
  );
}
