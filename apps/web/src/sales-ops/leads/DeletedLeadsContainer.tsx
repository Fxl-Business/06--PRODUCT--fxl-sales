import { useNavigate } from 'react-router-dom';
import { buildSalesOpsPath } from '../navigation';
import { useDeletedLeads, useRestoreLead } from './deleted-leads';
import { DeletedLeadsView } from './DeletedLeadsView';

/**
 * The `cadastros/leads-excluidos` mounting point (the `LeadStagesContainer`
 * convention): `SalesOpsApp.tsx` mounts it conditionally so the trash is read only
 * while the screen is on, and it holds no state and no logic. `onRestore` is
 * `mutateAsync`, because the view keys every notice on the REJECTION.
 */
export function DeletedLeadsContainer() {
  const navigate = useNavigate();
  const deleted = useDeletedLeads();
  const restore = useRestoreLead();
  return (
    <DeletedLeadsView
      error={deleted.error}
      hasMore={deleted.hasNextPage}
      isError={deleted.isError}
      isLoading={deleted.isPending}
      items={deleted.data ?? []}
      loadMoreFailed={deleted.isFetchNextPageError}
      loadingMore={deleted.isFetchingNextPage}
      onGoToStages={() => navigate(buildSalesOpsPath({ workspace: 'cadastros', view: 'etapas' }))}
      onLoadMore={() => {
        void deleted.fetchNextPage();
      }}
      onRestore={(id) => restore.mutateAsync(id).then(() => undefined)}
    />
  );
}
