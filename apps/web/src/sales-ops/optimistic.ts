import type {
  SaveAreaPayload,
  SaveClientPayload,
  SaveFuncaoPayload,
  SavePersonPayload,
} from './api';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsPersonFuncao,
} from './types';

/**
 * Pure optimistic patches over a raw sales-ops bootstrap snapshot. These cover the
 * four cadastros whose row the client can compute in full (áreas, clientes, funções,
 * pessoas); every other sales-ops write is server-derived and waits for the refetch.
 * A função's `slug` is the one value the server derives rather than accepts, and
 * `provisionalFuncaoSlug` below mirrors that derivation for a value nothing renders.
 *
 * Ordering caveat: JS `localeCompare(other, 'pt-BR')` is not bit-identical to the
 * Postgres collation behind `ORDER BY name`, so an optimistic row can sit one
 * position off for a single round trip. The invalidated refetch replaces it with
 * server truth immediately afterwards, so this never persists.
 */

export const OPTIMISTIC_ID_PREFIX = 'optimistic:';

export type OptimisticCollection = 'areas' | 'clients' | 'funcoes' | 'people';

export type CollectionRow<K extends OptimisticCollection> = SalesOpsBootstrap[K][number];

export type OptimisticPatch = {
  /** the snapshot to write into the cache during onMutate */
  next: SalesOpsBootstrap;
  /** the untouched snapshot, for onError rollback */
  previous: SalesOpsBootstrap;
  /** the id of the row that was inserted or edited */
  rowId: string;
};

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

export function optimisticId(collection: string, seed: string): string {
  return `${OPTIMISTIC_ID_PREFIX}${collection}:${seed}`;
}

type Comparator<T> = (a: T, b: T) => number;

/** pt-BR collation so the optimistic order matches the server `ORDER BY name`. */
function byPtBrName(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR');
}

const areaOrder: Comparator<SalesOpsArea> = (a, b) => byPtBrName(a.name, b.name);
const clientOrder: Comparator<SalesOpsClient> = (a, b) => byPtBrName(a.name, b.name);
const personOrder: Comparator<SalesOpsPerson> = (a, b) =>
  byPtBrName(a.displayName, b.displayName);
/**
 * Mirrors the API's `ORDER BY is_system DESC, name ASC` (service.ts listFuncoes and the
 * bootstrap query). Plain name ordering would float a new função above Finder/Vendedor
 * and make it visibly hop down when the refetch lands.
 */
const funcaoOrder: Comparator<SalesOpsFuncao> = (a, b) =>
  Number(b.isSystem) - Number(a.isSystem) || byPtBrName(a.name, b.name);

/**
 * orgId is never rendered in the UI (CLAUDE.md, UI Identifiers), so borrowing it
 * from a sibling row - or leaving it empty for a first row - is correct.
 */
function borrowedOrgId(rows: readonly { orgId: string }[]): string {
  return rows[0]?.orgId ?? '';
}

function upsert<T extends { id: string }>(
  rows: readonly T[],
  rowId: string,
  nextRow: T,
  compare: Comparator<T>,
): T[] {
  const replaced = rows.some((row) => row.id === rowId)
    ? rows.map((row) => (row.id === rowId ? nextRow : row))
    : [...rows, nextRow];
  return [...replaced].sort(compare);
}

export function optimisticArea(
  previous: SalesOpsBootstrap,
  payload: SaveAreaPayload,
): OptimisticPatch {
  const existing = payload.id
    ? previous.areas.find((row) => row.id === payload.id)
    : undefined;
  const rowId = existing?.id ?? payload.id ?? optimisticId('areas', payload.name);
  const nextRow: SalesOpsArea = existing
    ? {
        ...existing,
        ...payload,
        id: existing.id,
        orgId: existing.orgId,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        id: rowId,
        orgId: borrowedOrgId(previous.areas),
        name: payload.name,
        status: payload.status ?? 'active',
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: { ...previous, areas: upsert(previous.areas, rowId, nextRow, areaOrder) },
    previous,
    rowId,
  };
}

export function optimisticClient(
  previous: SalesOpsBootstrap,
  payload: SaveClientPayload,
): OptimisticPatch {
  const existing = payload.id
    ? previous.clients.find((row) => row.id === payload.id)
    : undefined;
  const rowId = existing?.id ?? payload.id ?? optimisticId('clients', payload.name);
  const nextRow: SalesOpsClient = existing
    ? {
        ...existing,
        ...payload,
        id: existing.id,
        orgId: existing.orgId,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        id: rowId,
        orgId: borrowedOrgId(previous.clients),
        name: payload.name,
        contact: payload.contact ?? null,
        legalName: payload.legalName ?? null,
        document: payload.document ?? null,
        address: payload.address ?? null,
        legalRepName: payload.legalRepName ?? null,
        legalRepDocument: payload.legalRepDocument ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: { ...previous, clients: upsert(previous.clients, rowId, nextRow, clientOrder) },
    previous,
    rowId,
  };
}

/**
 * Mirrors `slugifyFuncao` in apps/api/src/domains/sales-ops/service.ts. It is a
 * PROVISIONAL value: the onSuccess reconcile in useOptimisticBootstrapWrite swaps the
 * whole row for the persisted one, so any drift from the server's derivation self-heals
 * inside a single round trip. Nothing renders a slug in FuncoesView (the columns are
 * Nome / Tipo / Status / Nº pessoas), and PersonDialog reads the PERSISTED snapshot, so
 * this value never reaches a screen or a request either.
 */
function provisionalFuncaoSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export function optimisticFuncao(
  previous: SalesOpsBootstrap,
  payload: SaveFuncaoPayload,
): OptimisticPatch {
  const existing = payload.id
    ? previous.funcoes.find((row) => row.id === payload.id)
    : undefined;
  const rowId = existing?.id ?? payload.id ?? optimisticId('funcoes', payload.name);
  const nextRow: SalesOpsFuncao = existing
    ? {
        ...existing,
        ...payload,
        id: existing.id,
        orgId: existing.orgId,
        slug: provisionalFuncaoSlug(payload.name),
        // Never taken from the payload: only a migration may flag a função as one of the
        // two predefined app roles, and the API answers 409 funcao_is_system to any write
        // that targets one at all.
        isSystem: existing.isSystem,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        id: rowId,
        orgId: borrowedOrgId(previous.funcoes),
        name: payload.name,
        slug: provisionalFuncaoSlug(payload.name),
        isSystem: false,
        status: payload.status ?? 'active',
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: { ...previous, funcoes: upsert(previous.funcoes, rowId, nextRow, funcaoOrder) },
    previous,
    rowId,
  };
}

export function optimisticPerson(
  previous: SalesOpsBootstrap,
  payload: SavePersonPayload,
): OptimisticPatch {
  const existing = payload.id
    ? previous.people.find((row) => row.id === payload.id)
    : undefined;
  const rowId = existing?.id ?? payload.id ?? optimisticId('people', payload.displayName);
  /**
   * `funcaoIds` is a full set replacement, and the payload carries only ids, so the
   * nested `funcoes` the badges render from is resolved against the cached
   * catalogue. An id the cache does not know is dropped from `funcoes` but kept in
   * `funcaoIds`, so a stale snapshot degrades to a missing badge rather than a
   * render crash, and the invalidated refetch repairs it.
   */
  const funcaoIds = payload.funcaoIds;
  const funcoes: SalesOpsPersonFuncao[] = funcaoIds.flatMap((id) => {
    const funcao = previous.funcoes.find((candidate) => candidate.id === id);
    return funcao
      ? [{ id: funcao.id, name: funcao.name, slug: funcao.slug, isSystem: funcao.isSystem }]
      : [];
  });
  const nextRow: SalesOpsPerson = existing
    ? {
        ...existing,
        ...payload,
        id: existing.id,
        orgId: existing.orgId,
        funcaoIds,
        funcoes,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        id: rowId,
        orgId: borrowedOrgId(previous.people),
        displayName: payload.displayName,
        contactEmail: payload.contactEmail ?? null,
        status: payload.status ?? 'active',
        funcaoIds,
        funcoes,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: {
      ...previous,
      people: upsert(previous.people, rowId, nextRow, personOrder),
    },
    previous,
    rowId,
  };
}

/** Swap the optimistic row for the row the server returned. */
export function reconcileOptimisticRow<K extends OptimisticCollection>(
  snapshot: SalesOpsBootstrap,
  collection: K,
  rowId: string,
  persisted: CollectionRow<K>,
): SalesOpsBootstrap {
  if (collection === 'areas') {
    return {
      ...snapshot,
      areas: upsert(snapshot.areas, rowId, persisted as SalesOpsArea, areaOrder),
    };
  }
  if (collection === 'clients') {
    return {
      ...snapshot,
      clients: upsert(snapshot.clients, rowId, persisted as SalesOpsClient, clientOrder),
    };
  }
  if (collection === 'funcoes') {
    return {
      ...snapshot,
      funcoes: upsert(snapshot.funcoes, rowId, persisted as SalesOpsFuncao, funcaoOrder),
    };
  }
  return {
    ...snapshot,
    people: upsert(snapshot.people, rowId, persisted as SalesOpsPerson, personOrder),
  };
}

/**
 * The invariant this slice enforces: an optimistic row is visible in the cadastro
 * that created it and nowhere else. Its id is a client-side placeholder, so it must
 * never reach a request body or a request path - a `POST /sales-ops/sales` carrying
 * one fails the Postgres uuid cast and costs the operator a whole wizard of typing.
 *
 * A `funcaoId` in particular reaches a request body through three distinct paths -
 * `savePerson.funcaoIds`, `saveProduct.productFuncaoCosts[].funcaoId` and
 * `createSale`/`updateSale.professionals[].funcaoId` - plus the PATCH path of
 * `saveFuncao` itself, so the `funcoes` filter below is what keeps all four safe.
 *
 * Every surface other than the four cadastros lists reads this snapshot. The early
 * return hands back the identical object in the normal case (nothing optimistic in
 * flight), so no downstream `useMemo` or prop identity changes.
 */
export function withoutOptimisticRows(snapshot: SalesOpsBootstrap): SalesOpsBootstrap {
  const areas = snapshot.areas.filter((row) => !isOptimisticId(row.id));
  const clients = snapshot.clients.filter((row) => !isOptimisticId(row.id));
  const funcoes = snapshot.funcoes.filter((row) => !isOptimisticId(row.id));
  const people = snapshot.people.filter((row) => !isOptimisticId(row.id));
  if (
    areas.length === snapshot.areas.length &&
    clients.length === snapshot.clients.length &&
    funcoes.length === snapshot.funcoes.length &&
    people.length === snapshot.people.length
  ) {
    return snapshot;
  }
  return { ...snapshot, areas, clients, funcoes, people };
}
