import { Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isAuthFailure, isForbiddenFailure } from '@/lib/require-token';
import { ForbiddenPanel } from '../ForbiddenPanel';
import { MutationErrorBanner } from '../MutationErrorBanner';
import { formatRecordedAt } from '../settlements/settlement-format';
import { blockedNoticeClass, noticeClass } from './board-ui';
import {
  DELETED_LEADS_COPY,
  restoreFailureKind,
  type DeletedLeadView,
} from './deleted-leads';

/*
  Intentional local copies of the SalesOpsApp.tsx style constants, as in
  VendedoresView.tsx and CadastroHistoryPanel.tsx: the shell imports this module
  (through the container), so reading them back from it would be a cycle.
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
const mutedTextClass = 'text-[#9b9ba3]';
const restoreButtonClass =
  'inline-flex items-center gap-1.5 rounded-[9px] border border-[#dcdce2] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';
const successNoticeClass =
  'rounded-[10px] border border-[#cfe6d5] bg-[#eef8f0] px-3 py-2 text-[13px] text-[#1f7d43]';

type RestoreNotice =
  | { kind: 'restored'; name: string }
  | { kind: 'no_open_stage' }
  | { kind: 'gone' };

export type DeletedLeadsViewProps = {
  items: readonly DeletedLeadView[];
  /** The first page is in flight. */
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  /** A `Carregar mais` request failed; the loaded rows stay on screen. */
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  /**
   * MUST reject on an API failure (`mutateAsync`, never `mutate`): every notice
   * and the banner below are keyed on the rejection.
   */
  onRestore: (id: string) => Promise<void>;
  onGoToStages: () => void;
};

function MutedBlock({
  title,
  text,
  marker,
}: {
  title: string;
  text: string;
  marker: 'data-deleted-leads-empty' | 'data-deleted-leads-error';
}) {
  return (
    <div
      className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`}
      {...{ [marker]: '' }}
    >
      <div className="text-sm font-bold text-[#201f24]">{title}</div>
      <div className="max-w-[460px] text-[13px] leading-5 text-[#8b8b92]">{text}</div>
    </div>
  );
}

function present(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `Cadastros > Leads excluídos`: one row per deleted lead, newest first, with
 * `Restaurar`. Pure props in, callbacks out. It never renders an id: `lead.id` is
 * only the React key and the argument of `onRestore`.
 *
 * No confirmation before a restore: it loses nothing (the lead can be deleted
 * again), the same reasoning as `Reativar` on the Vendedores screen.
 */
export function DeletedLeadsView({
  items,
  isLoading,
  isError,
  error,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  onRestore,
  onGoToStages,
}: DeletedLeadsViewProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RestoreNotice | null>(null);
  const [bannerError, setBannerError] = useState<unknown>(null);

  async function restore(lead: DeletedLeadView) {
    if (pendingId !== null) return;
    setPendingId(lead.id);
    setNotice(null);
    setBannerError(null);
    try {
      await onRestore(lead.id);
      setNotice({ kind: 'restored', name: lead.contactName });
    } catch (failure) {
      const kind = restoreFailureKind(failure);
      if (kind === 'no_open_stage') setNotice({ kind: 'no_open_stage' });
      else if (kind === 'gone') setNotice({ kind: 'gone' });
      else setBannerError(failure);
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-[260px] w-full" data-deleted-leads-loading />;
  }

  if (isError && items.length === 0) {
    // The CadastroHistoryPanel split: a READ refused by `requireAdmin` is the
    // ForbiddenPanel, a dead session is never "the server is broken".
    if (isForbiddenFailure(error)) return <ForbiddenPanel />;
    if (isAuthFailure(error)) {
      return (
        <MutedBlock
          marker="data-deleted-leads-error"
          text={DELETED_LEADS_COPY.sessionExpired}
          title={DELETED_LEADS_COPY.sessionExpiredTitle}
        />
      );
    }
    return (
      <MutedBlock
        marker="data-deleted-leads-error"
        text={DELETED_LEADS_COPY.loadFailed}
        title={DELETED_LEADS_COPY.loadFailedTitle}
      />
    );
  }

  return (
    <div data-deleted-leads>
      <MutationErrorBanner error={bannerError} onDismiss={() => setBannerError(null)} />
      {notice?.kind === 'restored' ? (
        <p className={`${successNoticeClass} mb-4`} data-restore-success role="status">
          {DELETED_LEADS_COPY.restored(notice.name)}
        </p>
      ) : null}
      {notice?.kind === 'gone' ? (
        <p className={`${noticeClass} mb-4`} data-restore-gone role="status">
          {DELETED_LEADS_COPY.gone}
        </p>
      ) : null}
      {notice?.kind === 'no_open_stage' ? (
        <div
          className={`${noticeClass} mb-4 flex flex-wrap items-center justify-between gap-3`}
          data-restore-no-stage
          role="alert"
        >
          <span>{DELETED_LEADS_COPY.noOpenStage}</span>
          <button
            className={restoreButtonClass}
            data-go-to-stages
            onClick={onGoToStages}
            type="button"
          >
            {DELETED_LEADS_COPY.goToStages}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <MutedBlock
          marker="data-deleted-leads-empty"
          text={DELETED_LEADS_COPY.emptyText}
          title={DELETED_LEADS_COPY.emptyTitle}
        />
      ) : (
        <section className={`${panelClass} overflow-hidden`} data-deleted-leads-table>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                <TableHead className={tableHeadClass}>{DELETED_LEADS_COPY.columns.lead}</TableHead>
                <TableHead className={tableHeadClass}>
                  {DELETED_LEADS_COPY.columns.client}
                </TableHead>
                <TableHead className={tableHeadClass}>{DELETED_LEADS_COPY.columns.stage}</TableHead>
                <TableHead className={tableHeadClass}>
                  {DELETED_LEADS_COPY.columns.seller}
                </TableHead>
                <TableHead className={tableHeadClass}>
                  {DELETED_LEADS_COPY.columns.deletedBy}
                </TableHead>
                <TableHead className={tableHeadClass}>
                  {DELETED_LEADS_COPY.columns.deletedAt}
                </TableHead>
                <TableHead className={`${tableHeadClass} w-[150px] text-center`}>
                  {DELETED_LEADS_COPY.columns.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((lead) => {
                const pending = pendingId === lead.id;
                const client = present(lead.clientName);
                const stage = present(lead.stageName);
                const seller = present(lead.sellerName);
                const author = present(lead.deletedByName);
                return (
                  <TableRow data-deleted-lead-row key={lead.id}>
                    <TableCell className="px-4 py-3 text-sm font-semibold text-[#201f24]">
                      {lead.contactName}
                    </TableCell>
                    <TableCell className={tableCellClass}>
                      {client ?? <span className={mutedTextClass}>{DELETED_LEADS_COPY.noValue}</span>}
                    </TableCell>
                    <TableCell className={tableCellClass}>
                      {stage ?? <span className={mutedTextClass}>{DELETED_LEADS_COPY.noValue}</span>}
                    </TableCell>
                    <TableCell className={tableCellClass}>
                      {seller ?? (
                        <span className={mutedTextClass}>{DELETED_LEADS_COPY.noSeller}</span>
                      )}
                    </TableCell>
                    <TableCell className={tableCellClass}>
                      {author ?? (
                        <span className={mutedTextClass}>{DELETED_LEADS_COPY.unknownAuthor}</span>
                      )}
                    </TableCell>
                    <TableCell className={`sales-ops-num whitespace-nowrap ${tableCellClass}`}>
                      {formatRecordedAt(lead.deletedAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <button
                        aria-busy={pending || undefined}
                        aria-label={DELETED_LEADS_COPY.restoreLabel(lead.contactName)}
                        className={restoreButtonClass}
                        data-restore-lead
                        disabled={pendingId !== null}
                        onClick={() => {
                          void restore(lead);
                        }}
                        type="button"
                      >
                        {pending ? (
                          <Loader2 className="h-[14px] w-[14px] animate-spin" />
                        ) : (
                          <RotateCcw className="h-[14px] w-[14px]" />
                        )}
                        {pending ? DELETED_LEADS_COPY.restoring : DELETED_LEADS_COPY.restore}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hasMore || loadMoreFailed ? (
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-[#ececf1] px-[22px] py-3">
              {loadMoreFailed ? (
                <span className={blockedNoticeClass} data-deleted-leads-more-failed>
                  {DELETED_LEADS_COPY.loadMoreFailed}
                </span>
              ) : null}
              {hasMore ? (
                <button
                  className={restoreButtonClass}
                  data-deleted-leads-more
                  disabled={loadingMore}
                  onClick={onLoadMore}
                  type="button"
                >
                  {loadingMore ? DELETED_LEADS_COPY.loadingMore : DELETED_LEADS_COPY.loadMore}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
