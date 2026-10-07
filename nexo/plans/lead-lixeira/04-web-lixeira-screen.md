---
id: 04-web-lixeira-screen
milestone: v4.6.0
status: done
depends_on: [01-api-lixeira]
files_modified: [apps/web/src/lib/query-keys.ts, apps/web/src/sales-ops/leads/deleted-leads.ts, apps/web/src/sales-ops/leads/DeletedLeadsView.tsx, apps/web/src/sales-ops/leads/DeletedLeadsContainer.tsx, apps/web/src/sales-ops/navigation.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/leads/__tests__/deleted-leads-view.test.tsx, apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, apps/web/src/sales-ops/__tests__/navigation.test.ts, apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/deleted-leads-view.test.tsx, apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, apps/web/src/sales-ops/__tests__/navigation.test.ts, apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx, apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts]
acceptance: ["An admin sees the Cadastros entry Leads excluídos (view id leads-excluidos, route /cadastros/leads-excluidos) in BOTH editions: right after Importação and before Geral in the full edition, appended last in the leads edition", "A seller (any non-admin) never sees the entry in any edition, and /cadastros/leads-excluidos redirects such an operator to the role default", "/cadastros/leads-excluidos mounts DeletedLeadsContainer under the page title Leads excluídos with no header create action, and no other route mounts it", "The screen reads GET /api/v1/sales-ops/leads/deleted?limit=50 with the Hub bearer token and renders one row per item under the columns Lead, Empresa, Etapa, Vendedor, Excluído por, Excluído em plus a Restaurar action", "Excluído em is the São Paulo wall clock dd/mm/aaaa às HH:MM through formatRecordedAt, never the raw ISO and never the UTC day", "A null or blank deletedByName renders Autor não identificado, a blank sellerName renders Sem vendedor, and a blank empresa or etapa renders a muted dash", "No lead id and no keyset cursor appears anywhere in the rendered DOM, attributes included", "Restaurar POSTs /api/v1/sales-ops/leads/:id/restore with no body; while it is in flight that row reads Restaurando… and every Restaurar is disabled; on 200 the row leaves the list and a success notice names the lead", "A 400 with reason no_open_stage keeps the row and shows an inline notice telling the gestor to create an etapa, with an Ir para Etapas do funil action that navigates to /cadastros/etapas", "A 403 on restore renders the inline MutationErrorBanner with the adminRequired copy and never ForbiddenPanel; a 404 renders the gone notice", "useRestoreLead removes the restored row from every cached trash page on success and invalidates queryKeys.leads.all (trash, board, stages) on settle", "Carregar mais requests the next page with cursor=<nextCursor>&limit=50, appends its rows in order, and disappears once nextCursor is null", "An empty trash renders the empty state, the first page in flight renders a Skeleton, and a refused read (403) renders ForbiddenPanel", "pnpm run lint, pnpm run type-check and the full apps/web vitest suite pass"]
---

# 04 Cadastros > Leads excluídos (the lixeira screen, with Restaurar)

## Goal

AC9 and AC10 in the UI.
The gestor (admin) gets a new Cadastros screen, `Leads excluídos`, in both editions.
It lists every soft-deleted lead newest first (lead, empresa, etapa, vendedor, who deleted it, when) with a `Restaurar` button per row, keyset pagination behind `Carregar mais`, an empty state, a loading skeleton, and inline handling of every refusal.
It never renders an id.

The API is slice 01 (already merged when this slice runs, wave 1):
- `GET /api/v1/sales-ops/leads/deleted?cursor=&limit=` behind `requireAdmin` answers `200 { items: DeletedLeadView[], nextCursor: string | null }`.
- `POST /api/v1/sales-ops/leads/:id/restore` (no body) behind `requireAdmin` answers `200 { lead }`, `403` for a non-admin, `404` when there is no such deleted lead, `400 { reason: 'no_open_stage' }` when no active normal etapa exists.

Every design decision below is already made and was prototyped end to end in this worktree (17 oracle cases green, full web suite 124 files / 1629 tests green, lint and type-check clean), then reverted.
Copy the code blocks verbatim.

## Hard constraints

- Names come from `nexo/plans/lead-lixeira/SEAM-CONTRACT.md` and are fixed: `listDeletedLeads(token, cursor?)`, `restoreLead(token, id)`, `useDeletedLeads()`, `useRestoreLead()`, `DELETED_LEADS_COPY` in `apps/web/src/sales-ops/leads/deleted-leads.ts`; `DeletedLeadsView.tsx` mounted through `DeletedLeadsContainer`; view id `leads-excluidos`, label `Leads excluídos`, route `cadastros/leads-excluidos`.
- Do NOT edit `LeadCard.tsx`, `LeadsBoard.tsx`, `ContactLeadDialog.tsx`, `LeadDialog.tsx`, `leads/api.ts`, `leads/hooks.ts`, `leads/types.ts`, `leads/board-ui.ts` or `board-write-surface.test.ts`.
  Slice 03 owns the first six in this same wave.
  You only IMPORT `LEADS_PATH` from `./api`, `LeadResponse` from `./types` and `noticeClass` / `blockedNoticeClass` from `./board-ui`; all four already exist on master.
- Do NOT edit inside the `BOARD-WRITE-FENCE:START/END` regions of `SalesOpsApp.tsx` (around lines 369-386 and 1532-1639); every edit below is outside them.
- Never use the em dash character anywhere (code, comments, copy, tests).
- Run-once commands only; kill every process you start (see Verification).

## Step 1 - query key (`apps/web/src/lib/query-keys.ts`)

In `queryKeys.leads`, add one line after `stages`:

```ts
    stages: () => ['leads', 'stages'] as const,
    deleted: () => ['leads', 'deleted'] as const,
  },
```

It nests under `['leads']` on purpose: every lead write that invalidates `queryKeys.leads.all` (slice 03's delete included) then refreshes the trash, and the restore's single `queryKeys.leads.all` invalidation refreshes the trash, the board and the stage list.

## Step 2 - new `apps/web/src/sales-ops/leads/deleted-leads.ts`

Wire types, HTTP client, hooks, copy and the pure decisions, in one module (a `.ts` file, so no `react-refresh` concern).

```ts
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { apiFetch } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import { LEADS_PATH } from './api';
import type { LeadResponse } from './types';

/**
 * `Cadastros > Leads excluídos`: the lead trash's wire types, HTTP client, hooks,
 * copy and the pure decisions the screen makes. `DeletedLeadsView` is pure props;
 * `DeletedLeadsContainer` is the only place that calls the hooks below.
 *
 * The two HTTP functions take the token FIRST, as the seam contract names them.
 */

/** The page size the screen asks for. The API defaults to 50 and caps at 200. */
export const DELETED_LEADS_PAGE_SIZE = 50;

export const DELETED_LEADS_PATH = `${LEADS_PATH}/deleted`;

/**
 * One row of `GET /leads/deleted`, mirroring the API's `DeletedLeadView`.
 * `id` is the restore key ONLY: it is never rendered, not even in an attribute.
 * `deletedByName` is the actor name snapshotted from the token; the actor's account
 * id is never projected to the client at all.
 */
export type DeletedLeadView = {
  id: string;
  contactName: string;
  clientName: string;
  stageName: string;
  sellerName: string;
  /** Integer cents. Carried by the wire, not shown by this screen. */
  estimatedValueBrl: number;
  /** ISO instant of the deletion. */
  deletedAt: string;
  deletedByName: string | null;
};

export type DeletedLeadsPage = { items: DeletedLeadView[]; nextCursor: string | null };

/** The raw infinite-query cache entry, shaped like `LeadsInfiniteData`. */
export type DeletedLeadsInfiniteData = { pages: DeletedLeadsPage[]; pageParams: unknown[] };

export const DELETED_LEADS_COPY = {
  title: 'Leads excluídos',
  subtitle:
    'Quem excluiu cada lead do quadro de prospecção, e quando. Restaurar devolve o lead ao fim da etapa em que estava.',
  columns: {
    lead: 'Lead',
    client: 'Empresa',
    stage: 'Etapa',
    seller: 'Vendedor',
    deletedBy: 'Excluído por',
    deletedAt: 'Excluído em',
    actions: 'Ações',
  },
  restore: 'Restaurar',
  restoring: 'Restaurando…',
  restoreLabel: (name: string) => `Restaurar o lead ${name}`,
  unknownAuthor: 'Autor não identificado',
  noSeller: 'Sem vendedor',
  noValue: '-',
  emptyTitle: 'Nenhum lead excluído',
  emptyText:
    'Quando alguém excluir um lead do quadro de prospecção, ele aparece aqui com quem excluiu e quando, e pode ser restaurado.',
  loadMore: 'Carregar mais',
  loadingMore: 'Carregando…',
  loadMoreFailed: 'Não foi possível carregar mais leads excluídos. Tente novamente.',
  loadFailedTitle: 'Não foi possível carregar',
  loadFailed: 'Não foi possível carregar os leads excluídos.',
  sessionExpiredTitle: 'Sessão expirada',
  sessionExpired:
    'Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente.',
  restored: (name: string) => `O lead "${name}" voltou para o quadro de prospecção.`,
  noOpenStage:
    'Não há etapa aberta para receber este lead. Crie uma etapa em Cadastros > Etapas do funil e restaure de novo.',
  goToStages: 'Ir para Etapas do funil',
  gone: 'Este lead já não está entre os excluídos. A lista foi atualizada.',
} as const;

/** Built with URLSearchParams and never by hand: the keyset cursor is opaque. */
export function listDeletedLeads(token: string, cursor?: string | null): Promise<DeletedLeadsPage> {
  const search = new URLSearchParams();
  search.set('limit', String(DELETED_LEADS_PAGE_SIZE));
  if (cursor) search.set('cursor', cursor);
  return apiFetch<DeletedLeadsPage>(`${DELETED_LEADS_PATH}?${search.toString()}`, {
    method: 'GET',
    token,
  });
}

/** `POST /leads/:id/restore` with NO body, like `/move`'s sibling actions. */
export function restoreLead(token: string, id: string): Promise<LeadResponse> {
  return apiFetch<LeadResponse>(`${LEADS_PATH}/${id}/restore`, { method: 'POST', token });
}

/** Every loaded page, in order. Tolerates a malformed page (AGENTS rule 10). */
export function flattenDeletedLeads(data: DeletedLeadsInfiniteData | undefined): DeletedLeadView[] {
  if (!data) return [];
  return data.pages.flatMap((page) => (Array.isArray(page.items) ? page.items : []));
}

/** The cache entry without one restored lead, on every page; `undefined` stays `undefined`. */
export function withoutDeletedLead(
  data: DeletedLeadsInfiniteData | undefined,
  id: string,
): DeletedLeadsInfiniteData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: (Array.isArray(page.items) ? page.items : []).filter((item) => item.id !== id),
    })),
  };
}

/**
 * What a refused restore means for the screen. Keys on the STATUS (plus
 * `ApiError.reason` for the one 400 the gestor can fix), never on the body `error`.
 * - `no_open_stage`: 400 with that reason; the lead stays and the gestor is sent to Etapas.
 * - `gone`: 404; someone else restored it, the list refetch drops the row.
 * - `banner`: everything else, the 403 included, goes to `MutationErrorBanner`.
 */
export type RestoreFailureKind = 'no_open_stage' | 'gone' | 'banner';

export function restoreFailureKind(error: unknown): RestoreFailureKind {
  if (typeof error !== 'object' || error === null) return 'banner';
  const { status, reason } = error as { status?: unknown; reason?: unknown };
  if (status === 400 && reason === 'no_open_stage') return 'no_open_stage';
  if (status === 404) return 'gone';
  return 'banner';
}

/** Hoisted so its identity is stable across renders (see `selectLeadBoardModel`). */
function selectDeletedLeads(data: DeletedLeadsInfiniteData): DeletedLeadView[] {
  return flattenDeletedLeads(data);
}

/**
 * Keyset-paginated: the cursor is the `pageParam`, so it stays OUT of the query key.
 * The key nests under `['leads']`, so every lead write that invalidates
 * `queryKeys.leads.all` (a delete from the board included) refreshes this list too.
 */
export function useDeletedLeads() {
  const { getToken } = useAccessToken();
  return useInfiniteQuery({
    queryKey: queryKeys.leads.deleted(),
    queryFn: async ({ pageParam }): Promise<DeletedLeadsPage> =>
      listDeletedLeads(await requireToken(getToken), pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: DeletedLeadsPage) => lastPage.nextCursor,
    select: selectDeletedLeads,
  });
}

/**
 * No optimistic write: the row leaves the list only once the server answered 200,
 * removed from every cached page in `onSuccess`. `queryKeys.leads.all` then refetches
 * the trash, the board (the lead is back in a column) and the stage list on settle.
 */
export function useRestoreLead() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useAppMutation<LeadResponse, Error, string>({
    mutationFn: async (id) => restoreLead(await requireToken(getToken), id),
    invalidates: [queryKeys.leads.all],
    onSuccess: (_response, id) => {
      queryClient.setQueryData<DeletedLeadsInfiniteData>(queryKeys.leads.deleted(), (current) =>
        withoutDeletedLead(current, id),
      );
    },
  });
}
```

## Step 3 - new `apps/web/src/sales-ops/leads/DeletedLeadsView.tsx`

Pure props in, callbacks out (the `LeadStagesView` convention).
Design decisions already taken, do not revisit:
- No confirmation dialog before a restore: it loses nothing (the lead can be deleted again), the same reasoning as `Reativar` on `VendedoresView`.
- One restore at a time: while one is in flight every `Restaurar` is disabled and only the pending row shows the spinner and `Restaurando…`.
- `Excluído em` uses `formatRecordedAt` from `../settlements/settlement-format` (the repo's one São Paulo wall-clock formatter, `dd/mm/aaaa às HH:MM`), never `formatLedgerTimestampBr`, which uses the browser timezone.
- A refused restore: 400 `no_open_stage` is an amber inline notice with an `Ir para Etapas do funil` button; 404 is an amber `gone` notice; everything else (403 included) is the shared `MutationErrorBanner`, which renders `MUTATION_ERROR_COPY.adminRequired` for a 403 (CLAUDE.md Auth Model: a 403 on a mutation is never `ForbiddenPanel`).
- A refused READ (first page) follows `CadastroHistoryPanel`: 403 is `ForbiddenPanel`, 401 is `Sessão expirada`, anything else a muted `Não foi possível carregar` block.
  A failed `Carregar mais` keeps the loaded rows and shows a red line beside the button.

```tsx
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
```

## Step 4 - new `apps/web/src/sales-ops/leads/DeletedLeadsContainer.tsx`

Its own file, like `LeadStagesContainer.tsx`, so the shell mount oracle can mock it alone.

```tsx
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
```

## Step 5 - `apps/web/src/sales-ops/navigation.ts`

1. Add `Trash2,` to the `lucide-react` import, between `Tags,` and `UsersRound,`.
2. Extend the view union: `| 'importacao'` becomes `| 'importacao'` plus a new last member `| 'leads-excluidos';`.
3. Full edition `cadastros`: the tail of the array (from the ordering comment to the end) becomes exactly this (`geral` stays last, `produtos` stays `[0]`):
   ```ts
     /*
       Before `geral`, which is the settings-and-history catch-all and stays last.
       `produtos` remains `[0]`, so the Cadastros landing route does not move.
       `importacao` goes before `geral` too, and so does `leads-excluidos` (the lead
       lixeira), appended after it.
     */
     { id: 'etapas', label: 'Etapas do funil', icon: ListChecks },
     { id: 'importacao', label: 'Importação', icon: FileSpreadsheet },
     { id: 'leads-excluidos', label: 'Leads excluídos', icon: Trash2 },
     { id: 'geral', label: 'Geral', icon: Cog },
   ];
   ```
4. Leads edition `leadsEditionCadastros`: append after the `importacao` entry
   ```ts
     // The lead lixeira (AC9): the gestor restores a deleted lead here. Appended.
     { id: 'leads-excluidos', label: 'Leads excluídos', icon: Trash2 },
   ```
   (`pessoas` stays `[0]`, the landing route).

Nothing else changes: `getVisibleWorkspaces` already gives `cadastros` to `admin` only in both editions, so a seller never sees the entry and `resolveSalesOpsRoute` redirects one.

## Step 6 - `apps/web/src/sales-ops/SalesOpsApp.tsx` (all edits outside the fences)

1. Imports, right after `import { LeadStagesContainer } from './leads/LeadStagesContainer';`:
   ```ts
   import { DeletedLeadsContainer } from './leads/DeletedLeadsContainer';
   import { DELETED_LEADS_COPY } from './leads/deleted-leads';
   ```
2. `titleForView`: the map is `Record<SalesOpsView, ...>`, so type-check fails until this entry exists. Add after the `importacao` entry:
   ```ts
       'leads-excluidos': {
         title: DELETED_LEADS_COPY.title,
         subtitle: DELETED_LEADS_COPY.subtitle,
       },
   ```
3. `headerAction`: the comment line `` `importacao` has no create action at all. `` becomes `` `importacao` and `leads-excluidos` have no create action at all. `` and the condition becomes
   ```ts
     const headerAction =
       view === 'geral' ||
       view === 'leads' ||
       view === 'etapas' ||
       view === 'importacao' ||
       view === 'leads-excluidos'
         ? null
   ```
   (without it the chain falls through to `Nova proposta`).
4. Mount, right after `{view === 'importacao' ? <ImportContainer /> : null}`:
   ```tsx
                   {view === 'leads-excluidos' ? <DeletedLeadsContainer /> : null}
   ```

## Step 7 - NEW oracle `apps/web/src/sales-ops/leads/__tests__/deleted-leads-view.test.tsx`

It drives the REAL container, hooks, `apiFetch` and view inside a real `QueryClientProvider` and `MemoryRouter`, against a stubbed `fetch` that behaves like the API (a successful restore removes the lead from the server's trash).
Only `@/auth/react` is mocked, and the mock MUST export `useSalesEdition` (`auth-mock-edition-export.test.ts` scans for it).

```tsx
// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { DeletedLeadsContainer } from '../DeletedLeadsContainer';
import {
  DELETED_LEADS_COPY,
  restoreFailureKind,
  withoutDeletedLead,
  type DeletedLeadView,
  type DeletedLeadsPage,
} from '../deleted-leads';

/**
 * THE ORACLE of slice 04 (lead-lixeira): `Cadastros > Leads excluídos`.
 *
 * It drives the REAL container, hooks, HTTP client and view against a stubbed
 * `fetch` that behaves like the API (a restored lead leaves the server's trash),
 * so "restore calls the API and removes the row" is proven end to end.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'hub-access-token' }),
  useSalesEdition: () => 'full',
}));

const ID_A = 'a1a1a1a1-0000-4000-8000-000000000001';
const ID_B = 'b2b2b2b2-0000-4000-8000-000000000002';
const ID_C = 'c3c3c3c3-0000-4000-8000-000000000003';
const CURSOR = 'MjAyNi0xMC0wNlQwMjoxNTowMC4wMDBafGIyYjI';

const ROW_A: DeletedLeadView = {
  id: ID_A,
  contactName: 'Ana Souza',
  clientName: 'Construbom',
  stageName: 'Primeiro contato',
  sellerName: 'Alex Silva',
  estimatedValueBrl: 150000,
  deletedAt: '2026-10-07T18:30:00.000Z',
  deletedByName: 'Gestora Paula',
};
/** No empresa, no vendedor, unknown author, and a UTC day ahead of São Paulo. */
const ROW_B: DeletedLeadView = {
  id: ID_B,
  contactName: 'Bruno Lima',
  clientName: '',
  stageName: 'Negociação',
  sellerName: '',
  estimatedValueBrl: 0,
  deletedAt: '2026-10-06T02:15:00.000Z',
  deletedByName: null,
};
const ROW_C: DeletedLeadView = {
  id: ID_C,
  contactName: 'Carla Dias',
  clientName: 'Obra Leste',
  stageName: 'Proposta',
  sellerName: 'Alex Silva',
  estimatedValueBrl: 990000,
  deletedAt: '2026-10-01T12:00:00.000Z',
  deletedByName: 'Gestora Paula',
};

type Responder = { status: number; body: unknown };

const server = {
  /** The trash as the API holds it, newest first. */
  rows: [] as DeletedLeadView[],
  /** Page size the stub serves before handing back `CURSOR`. */
  firstPageSize: 2,
  restoreAnswer: { status: 200, body: { lead: {} } } as Responder,
  /** When set, the first page GET waits for it. */
  holdList: null as Promise<void> | null,
  /** When set, the restore POST waits for it. */
  holdRestore: null as Promise<void> | null,
  listAnswer: null as Responder | null,
};

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  server.rows = [ROW_A, ROW_B, ROW_C];
  server.firstPageSize = 2;
  server.restoreAnswer = { status: 200, body: { lead: {} } };
  server.holdList = null;
  server.holdRestore = null;
  server.listAnswer = null;
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/api/v1/sales-ops/leads/deleted') {
      if (server.holdList) await server.holdList;
      if (server.listAnswer) return respond(server.listAnswer.status, server.listAnswer.body);
      const cursor = url.searchParams.get('cursor');
      const page: DeletedLeadsPage =
        cursor === null
          ? {
              items: server.rows.slice(0, server.firstPageSize),
              nextCursor: server.rows.length > server.firstPageSize ? CURSOR : null,
            }
          : { items: server.rows.slice(server.firstPageSize), nextCursor: null };
      return respond(200, page);
    }
    const restore = /^\/api\/v1\/sales-ops\/leads\/([^/]+)\/restore$/.exec(url.pathname);
    if (method === 'POST' && restore) {
      if (server.holdRestore) await server.holdRestore;
      if (server.restoreAnswer.status === 200) {
        server.rows = server.rows.filter((row) => row.id !== restore[1]);
      }
      return respond(server.restoreAnswer.status, server.restoreAnswer.body);
    }
    return respond(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location-path">{pathname}</output>;
}

async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderScreen() {
  container = document.createElement('div');
  document.body.append(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={['/cadastros/leads-excluidos']}
        >
          <Routes>
            <Route element={<DeletedLeadsContainer />} path="/cadastros/leads-excluidos" />
            <Route element={<div data-etapas-screen />} path="/cadastros/etapas" />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
}

const rows = () => [...container.querySelectorAll('[data-deleted-lead-row]')];
const rowText = (name: string) =>
  rows().find((row) => row.textContent?.includes(name))?.textContent ?? null;
function restoreButtonFor(name: string): HTMLButtonElement {
  const row = rows().find((candidate) => candidate.textContent?.includes(name));
  const button = row?.querySelector<HTMLButtonElement>('[data-restore-lead]');
  if (!button) throw new Error(`no Restaurar for ${name}`);
  return button;
}
const callsTo = (method: string, pathname: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      new URL(String(url)).pathname === pathname &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );

describe('Leads excluídos: data layer', () => {
  it('pins the trash query key under the leads root', () => {
    expect(queryKeys.leads.deleted()).toEqual(['leads', 'deleted']);
  });

  it('classifies a refused restore by status, plus the no_open_stage reason', () => {
    expect(restoreFailureKind({ status: 400, reason: 'no_open_stage' })).toBe('no_open_stage');
    expect(restoreFailureKind({ status: 400, reason: 'validation_error' })).toBe('banner');
    expect(restoreFailureKind({ status: 404 })).toBe('gone');
    expect(restoreFailureKind({ status: 403, reason: 'admin_role_required' })).toBe('banner');
    expect(restoreFailureKind(new Error('network'))).toBe('banner');
    expect(restoreFailureKind(null)).toBe('banner');
  });

  it('drops a restored lead from every cached page', () => {
    const data = {
      pages: [
        { items: [ROW_A, ROW_B], nextCursor: CURSOR },
        { items: [ROW_C], nextCursor: null },
      ],
      pageParams: [null, CURSOR],
    };
    expect(withoutDeletedLead(data, ID_C)?.pages.map((page) => page.items)).toEqual([
      [ROW_A, ROW_B],
      [],
    ]);
    expect(withoutDeletedLead(undefined, ID_A)).toBeUndefined();
  });
});

describe('Leads excluídos: the screen', () => {
  it('renders a loading skeleton while the first page is in flight', async () => {
    const gate = deferred();
    server.holdList = gate.promise;
    await renderScreen();
    expect(container.querySelector('[data-deleted-leads-loading]')).not.toBeNull();
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
    gate.resolve();
    await flush();
    expect(container.querySelector('[data-deleted-leads-loading]')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('asks for the first page with the bearer token and limit 50', async () => {
    await renderScreen();
    const [first] = callsTo('GET', '/api/v1/sales-ops/leads/deleted');
    if (!first) throw new Error('no list request');
    const url = new URL(String(first[0]));
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(((first[1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer hub-access-token',
    );
  });

  it('renders the six columns and one row per deleted lead', async () => {
    await renderScreen();
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      'Lead',
      'Empresa',
      'Etapa',
      'Vendedor',
      'Excluído por',
      'Excluído em',
      'Ações',
    ]);
    expect(rows()).toHaveLength(2);
    const a = rowText('Ana Souza') ?? '';
    for (const part of ['Construbom', 'Primeiro contato', 'Alex Silva', 'Gestora Paula']) {
      expect(a).toContain(part);
    }
  });

  it('formats Excluído em as the São Paulo wall clock, never the raw ISO', async () => {
    await renderScreen();
    expect(rowText('Ana Souza')).toContain('07/10/2026 às 15:30');
    // 02:15Z on the 6th is still the 5th in São Paulo.
    expect(rowText('Bruno Lima')).toContain('05/10/2026 às 23:15');
    expect(container.textContent).not.toContain('2026-10-06T02:15');
  });

  it('falls back to Autor não identificado, Sem vendedor and a dash', async () => {
    await renderScreen();
    const b = rowText('Bruno Lima') ?? '';
    expect(b).toContain(DELETED_LEADS_COPY.unknownAuthor);
    expect(b).toContain(DELETED_LEADS_COPY.noSeller);
    expect(b).toContain(DELETED_LEADS_COPY.noValue);
  });

  it('never renders an id or a cursor anywhere in the DOM', async () => {
    await renderScreen();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-deleted-leads-more]')?.click();
    });
    await flush();
    expect(rows()).toHaveLength(3);
    for (const secret of [ID_A, ID_B, ID_C, CURSOR]) {
      expect(container.innerHTML).not.toContain(secret);
    }
  });

  it('restore posts to the restore action and removes the row', async () => {
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    const posts = callsTo('POST', `/api/v1/sales-ops/leads/${ID_A}/restore`);
    expect(posts).toHaveLength(1);
    expect((posts[0]?.[1] as RequestInit).body).toBeUndefined();
    expect(rowText('Ana Souza')).toBeNull();
    expect(rowText('Bruno Lima')).not.toBeNull();
    expect(container.querySelector('[data-restore-success]')?.textContent).toBe(
      DELETED_LEADS_COPY.restored('Ana Souza'),
    );
  });

  it('shows the pending state on the row and blocks a second restore while one is in flight', async () => {
    const gate = deferred();
    server.holdRestore = gate.promise;
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    expect(restoreButtonFor('Ana Souza').textContent).toContain(DELETED_LEADS_COPY.restoring);
    expect(restoreButtonFor('Ana Souza').disabled).toBe(true);
    expect(restoreButtonFor('Bruno Lima').disabled).toBe(true);
    expect(restoreButtonFor('Bruno Lima').textContent).toContain(DELETED_LEADS_COPY.restore);
    gate.resolve();
    await flush();
    expect(rowText('Ana Souza')).toBeNull();
    expect(restoreButtonFor('Bruno Lima').disabled).toBe(false);
  });

  it('400 no_open_stage keeps the row and sends the gestor to Etapas do funil', async () => {
    server.restoreAnswer = {
      status: 400,
      body: { error: 'validation_error', reason: 'no_open_stage' },
    };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    const notice = container.querySelector('[data-restore-no-stage]');
    expect(notice?.textContent).toContain(DELETED_LEADS_COPY.noOpenStage);
    expect(rowText('Ana Souza')).not.toBeNull();
    expect(container.querySelector('[data-mutation-error]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-go-to-stages]')?.click(),
    );
    await flush();
    expect(container.querySelector('[data-testid="location-path"]')?.textContent).toBe(
      '/cadastros/etapas',
    );
  });

  it('403 renders the inline MutationErrorBanner, never the ForbiddenPanel', async () => {
    server.restoreAnswer = {
      status: 403,
      body: { error: 'forbidden', reason: 'admin_role_required' },
    };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    expect(container.querySelector('[data-mutation-error]')?.textContent).toContain(
      MUTATION_ERROR_COPY.adminRequired,
    );
    expect(container.querySelector('[data-forbidden]')).toBeNull();
    expect(rowText('Ana Souza')).not.toBeNull();
  });

  it('404 says the lead already left the trash', async () => {
    server.restoreAnswer = { status: 404, body: { error: 'not_found' } };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    expect(container.querySelector('[data-restore-gone]')?.textContent).toBe(
      DELETED_LEADS_COPY.gone,
    );
    expect(container.querySelector('[data-mutation-error]')).toBeNull();
  });

  it('renders the empty state when nothing was deleted', async () => {
    server.rows = [];
    await renderScreen();
    expect(container.querySelector('[data-deleted-leads-empty]')?.textContent).toContain(
      DELETED_LEADS_COPY.emptyTitle,
    );
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
    expect(container.querySelector('[data-deleted-leads-more]')).toBeNull();
  });

  it('Carregar mais fetches the next keyset page with the cursor and appends it', async () => {
    await renderScreen();
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ana Souza',
      'Bruno Lima',
    ]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-deleted-leads-more]')?.click(),
    );
    await flush();
    const lists = callsTo('GET', '/api/v1/sales-ops/leads/deleted');
    const last = new URL(String(lists.at(-1)?.[0]));
    expect(last.searchParams.get('cursor')).toBe(CURSOR);
    expect(last.searchParams.get('limit')).toBe('50');
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ana Souza',
      'Bruno Lima',
      'Carla Dias',
    ]);
    expect(container.querySelector('[data-deleted-leads-more]')).toBeNull();
  });

  it('a refused READ renders the ForbiddenPanel', async () => {
    server.listAnswer = { status: 403, body: { error: 'forbidden' } };
    await renderScreen();
    expect(container.querySelector('[data-forbidden]')).not.toBeNull();
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
  });
});
```

## Step 8 - existing oracles that enumerate the Cadastros views

These are the ONLY existing tests the nav change breaks (measured: 26 failures in exactly these three files, plus the mount additions in the fourth).

### 8a `apps/web/src/sales-ops/__tests__/navigation-edition.test.ts` (hand-written literals, never derived)

1. `URLS`: replace the line `'/cadastros/importacao', '/cadastros/geral', '/meus-dados/vendedores', '/meus-dados/comissoes',` with
   ```ts
     '/cadastros/importacao', '/cadastros/leads-excluidos', '/cadastros/geral',
     '/meus-dados/vendedores', '/meus-dados/comissoes',
   ```
2. `TEAM_NAV_FULL.cadastros`: insert `['leads-excluidos', 'Leads excluídos'], ` between `['importacao', 'Importação'], ` and `['geral', 'Geral']`.
3. `TEAM_NAV_LEADS.cadastros`: append `['leads-excluidos', 'Leads excluídos'],` after `['importacao', 'Importação'],`.
4. `RESOLVE_FULL` and `RESOLVE_LEADS`: in every combo, insert right after the `'/cadastros/importacao': [...]` line a `'/cadastros/leads-excluidos'` line (16 lines in total):

   | combo | RESOLVE_FULL value | RESOLVE_LEADS value |
   | --- | --- | --- |
   | none | `['/tatico/dashboard', true]` | `['/tatico/dashboard', true]` |
   | admin | `['/cadastros/leads-excluidos', false]` | `['/cadastros/leads-excluidos', false]` |
   | seller | `['/meus-dados/vendedores', true]` | `['/meus-dados/leads', true]` |
   | finder | `['/meus-dados/finders', true]` | `['/tatico/dashboard', true]` |
   | adminSeller | `['/cadastros/leads-excluidos', false]` | `['/cadastros/leads-excluidos', false]` |
   | adminFinder | `['/cadastros/leads-excluidos', false]` | `['/cadastros/leads-excluidos', false]` |
   | sellerFinder | `['/meus-dados/vendedores', true]` | `['/meus-dados/leads', true]` |
   | everything | `['/cadastros/leads-excluidos', false]` | `['/cadastros/leads-excluidos', false]` |

5. `WORKSPACE_FOR_VIEW_FULL` and `WORKSPACE_FOR_VIEW_LEADS`: on each of the 16 combo lines insert `'leads-excluidos': <same value as that line's etapas>,` right after the `etapas: '...',` pair (full: none `tatico`, admin `cadastros`, seller `meus-dados`, finder `meus-dados`, adminSeller `cadastros`, adminFinder `cadastros`, sellerFinder `meus-dados`, everything `cadastros`; leads: none `tatico`, admin `cadastros`, seller `meus-dados`, finder `tatico`, adminSeller `cadastros`, adminFinder `cadastros`, sellerFinder `meus-dados`, everything `cadastros`).
6. Insert this block immediately before `describe('leads edition labels', () => {`:
   ```ts
   describe('Leads excluídos (lead lixeira, AC9)', () => {
     it.each(['full', 'leads'] as const)(
       'is offered to the admin in cadastros in the %s edition, after Importação',
       (edition) => {
         const ids = getSalesOpsNavigation('cadastros', ['admin'], edition).map((item) => item.id);
         const at = ids.indexOf('leads-excluidos');
         expect(at).toBeGreaterThan(-1);
         expect(ids[at - 1]).toBe('importacao');
         expect(
           resolveSalesOpsRoute({ workspace: 'cadastros', view: 'leads-excluidos' }, ['admin'], edition),
         ).toEqual({
           route: { workspace: 'cadastros', view: 'leads-excluidos' },
           path: '/cadastros/leads-excluidos',
           redirect: false,
         });
       },
     );

     it.each(['full', 'leads'] as const)('is never offered to a seller in the %s edition', (edition) => {
       for (const workspace of WORKSPACES) {
         const ids = getSalesOpsNavigation(workspace, ['seller'], edition).map((item) => item.id);
         if (getVisibleWorkspaces(['seller'], edition).includes(workspace)) {
           expect(ids).not.toContain('leads-excluidos');
         }
       }
       const resolution = resolveSalesOpsRoute(
         { workspace: 'cadastros', view: 'leads-excluidos' },
         ['seller'],
         edition,
       );
       expect(resolution.redirect).toBe(true);
       expect(resolution.route.view).not.toBe('leads-excluidos');
     });
   });
   ```

### 8b `apps/web/src/sales-ops/__tests__/navigation.test.ts`

1. In `renders fixed team navigation for the team workspaces`, insert `'leads-excluidos',` between `'importacao',` and `'geral',` in the cadastros ids array, and `'Leads excluídos',` between `'Importação',` and `'Geral',` in the labels array.
2. Insert before `it('hands the full edition the very same workspace catalogue', () => {`:
   ```ts
     it('resolves cadastros/leads-excluidos for an admin only', () => {
       expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'leads-excluidos' }, team)).toEqual({
         route: { workspace: 'cadastros', view: 'leads-excluidos' },
         path: '/cadastros/leads-excluidos',
         redirect: false,
       });
       const asSeller = resolveSalesOpsRoute({ workspace: 'cadastros', view: 'leads-excluidos' }, seller);
       expect(asSeller.redirect).toBe(true);
       expect(asSeller.route.view).not.toBe('leads-excluidos');
     });
   ```

### 8c `apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx`

The full-edition sidebar now reads `... Importação, Leads excluídos, Geral`.
Rename `it('lists Importação in the Cadastros sidebar right before Geral', ...)` to `it('lists Importação in the Cadastros sidebar right before Leads excluídos, with Geral last', ...)` and replace `expect(labels[index + 1]).toContain('Geral');` with
```ts
    expect(labels[index + 1]).toContain('Leads excluídos');
    expect(labels[index + 2]).toContain('Geral');
```

### 8d `apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` (the shell mount oracle)

This file renders `SalesOpsApp` with NO `QueryClientProvider`, so the new container must be mocked here.
1. After the `vi.mock('../leads/LeadStagesContainer', ...)` block add:
   ```tsx
   vi.mock('../leads/DeletedLeadsContainer', () => ({
     DeletedLeadsContainer: () => <div data-deleted-leads-container />,
   }));
   ```
2. Rename `it('shows Vendedores, Clientes, Etapas do funil and Importação in cadastros', ...)` to `it('shows Vendedores, Clientes, Etapas do funil, Importação and Leads excluídos in cadastros', ...)` and add `'Leads excluídos'` as the last element of its first label array.
3. Append at the end of the file:
   ```tsx
   describe('Leads excluídos inside the Sales Ops shell', () => {
     it.each(['full', 'leads'] as const)(
       'mounts the lixeira at cadastros/leads-excluidos for an admin in the %s edition',
       async (edition) => {
         await renderRoute('/cadastros/leads-excluidos', ['admin', 'seller', 'finder'], edition);
         expect(locationPath()).toBe('/cadastros/leads-excluidos');
         expect(container.querySelector('[data-deleted-leads-container]')).not.toBeNull();
         expect(container.querySelector('h1')?.textContent?.trim()).toBe('Leads excluídos');
         expect(navLabel('Leads excluídos')).not.toBeNull();
         expect(headerText()).not.toContain('Nova proposta');
       },
     );

     it('mounts it nowhere else', async () => {
       for (const path of ['/cadastros/etapas', '/cadastros/pessoas', '/operacional/leads']) {
         await renderRoute(path, ['admin']);
         expect(container.querySelector('[data-deleted-leads-container]'), path).toBeNull();
       }
     });

     it.each([
       ['full', '/meus-dados/vendedores'],
       ['leads', '/meus-dados/leads'],
     ] as const)('a seller in the %s edition never reaches it', async (edition, landing) => {
       await renderRoute('/cadastros/leads-excluidos', ['seller'], edition);
       expect(locationPath()).toBe(landing);
       expect(container.querySelector('[data-deleted-leads-container]')).toBeNull();
       expect(navLabel('Leads excluídos')).toBeNull();
     });
   });
   ```
   Do NOT put `/cadastros/importacao` in the `nowhere else` list: this file does not mock `ImportContainer`, whose hooks need `useAccessToken`, which this file's auth mock does not export.

## Verification (all run-once, from the worktree root)

```bash
pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/leads/__tests__/deleted-leads-view.test.tsx \
  src/sales-ops/__tests__/navigation-edition.test.ts \
  src/sales-ops/__tests__/navigation.test.ts \
  src/sales-ops/__tests__/leads-routing.test.tsx \
  src/sales-ops/import/__tests__/import-routing.test.tsx \
  src/auth/__tests__/auth-mock-edition-export.test.ts
pnpm --filter @fxl-sales/web exec eslint \
  src/lib/query-keys.ts src/sales-ops/navigation.ts src/sales-ops/SalesOpsApp.tsx \
  src/sales-ops/leads/deleted-leads.ts src/sales-ops/leads/DeletedLeadsView.tsx \
  src/sales-ops/leads/DeletedLeadsContainer.tsx \
  src/sales-ops/leads/__tests__/deleted-leads-view.test.tsx \
  src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/__tests__/navigation.test.ts \
  src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/import/__tests__/import-routing.test.tsx
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web exec vitest run
```

Expected: 17 cases in the new oracle, all green; zero lint output; `tsc --noEmit` silent; the whole apps/web suite green (prototype baseline: 124 files, 1629 tests, before slice 03's own additions).
`auth-mock-edition-export.test.ts` picks up the new oracle's `@/auth/react` mock and passes only because that mock exports `useSalesEdition`.

Browser check (do it when the host has a browser tool, else write "not run" in the exec notes): `make dev-fake` (note the PID and kill its whole process group when done), sign in as `team-owner` and then as `leads-owner` through the dev identity switcher, open `Cadastros > Leads excluídos`, confirm the nav entry position (full: after Importação, before Geral; leads: last), the empty state, the table look against `Vendedores` / `Histórico de arquivamentos`, and no horizontal scroll at 1280px.
The full delete-then-restore round trip needs slice 03's delete UI and is the wave-2 integrated verification's job.

## Out of scope

- The board, the card menu, the forms and the delete dialog (slice 03).
- The per-stage summary and its key (slice 05).
  `useRestoreLead` invalidates `queryKeys.leads.all`, so a summary key nested under `['leads', ...]` is refreshed by a restore with no change here; if slice 05 puts it elsewhere, slice 05 adds it to `useRestoreLead`'s `invalidates`.
- `CLAUDE.md` and `nexo/knowledge/reference/*` (the capture step, AC12): the route list in "Sales Ops Routing" and the leads-edition cadastros list gain `leads-excluidos` there.
- Showing the estimated value, bulk restore, purging the trash, any seller view of the trash.

## Seam notes

- `queryKeys.leads.deleted()` (`['leads', 'deleted']`) is a new key the seam contract left unnamed; nothing else uses it.
- `listDeletedLeads` and `restoreLead` take the token FIRST, as the seam names them, unlike `leadsApi` (token last); this matches slice 03's `deleteLead(token, id)`.
- The container lives in its own `DeletedLeadsContainer.tsx`, the convention of `LeadStagesContainer.tsx` / `LeadsBoardContainer.tsx`.
