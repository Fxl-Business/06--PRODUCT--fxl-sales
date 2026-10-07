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
