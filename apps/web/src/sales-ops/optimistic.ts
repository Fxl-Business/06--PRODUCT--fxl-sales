import type { SaveAreaPayload, SaveClientPayload, SavePersonPayload } from './api';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
} from './types';

/**
 * Pure optimistic patches over a raw sales-ops bootstrap snapshot. These cover the
 * three cadastros whose row the client can compute in full (áreas, clientes,
 * pessoas); every other sales-ops write is server-derived and waits for the refetch.
 *
 * Ordering caveat: JS `localeCompare(other, 'pt-BR')` is not bit-identical to the
 * Postgres collation behind `ORDER BY name`, so an optimistic row can sit one
 * position off for a single round trip. The invalidated refetch replaces it with
 * server truth immediately afterwards, so this never persists.
 */

export const OPTIMISTIC_ID_PREFIX = 'optimistic:';

export type OptimisticCollection = 'areas' | 'clients' | 'people';

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

/** pt-BR collation so the optimistic order matches the server `ORDER BY name`. */
function sortRows<T>(rows: readonly T[], label: (row: T) => string): T[] {
  return [...rows].sort((a, b) => label(a).localeCompare(label(b), 'pt-BR'));
}

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
  label: (row: T) => string,
): T[] {
  const replaced = rows.some((row) => row.id === rowId)
    ? rows.map((row) => (row.id === rowId ? nextRow : row))
    : [...rows, nextRow];
  return sortRows(replaced, label);
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
    next: { ...previous, areas: upsert(previous.areas, rowId, nextRow, (row) => row.name) },
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
    next: { ...previous, clients: upsert(previous.clients, rowId, nextRow, (row) => row.name) },
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
  const nextRow: SalesOpsPerson = existing
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
        orgId: borrowedOrgId(previous.people),
        displayName: payload.displayName,
        contactEmail: payload.contactEmail ?? null,
        status: payload.status ?? 'active',
        isSeller: payload.isSeller ?? false,
        isFinder: payload.isFinder ?? false,
        isCollaborator: payload.isCollaborator ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: {
      ...previous,
      people: upsert(previous.people, rowId, nextRow, (row) => row.displayName),
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
  label: (row: CollectionRow<K>) => string,
): SalesOpsBootstrap {
  if (collection === 'areas') {
    const row = persisted as SalesOpsArea;
    const areaLabel = label as (candidate: SalesOpsArea) => string;
    return { ...snapshot, areas: upsert(snapshot.areas, rowId, row, areaLabel) };
  }
  if (collection === 'clients') {
    const row = persisted as SalesOpsClient;
    const clientLabel = label as (candidate: SalesOpsClient) => string;
    return { ...snapshot, clients: upsert(snapshot.clients, rowId, row, clientLabel) };
  }
  const row = persisted as SalesOpsPerson;
  const personLabel = label as (candidate: SalesOpsPerson) => string;
  return { ...snapshot, people: upsert(snapshot.people, rowId, row, personLabel) };
}

/**
 * The invariant this slice enforces: an optimistic row is visible in the cadastro
 * that created it and nowhere else. Its id is a client-side placeholder, so it must
 * never reach a request body or a request path - a `POST /sales-ops/sales` carrying
 * one fails the Postgres uuid cast and costs the operator a whole wizard of typing.
 *
 * Every surface other than the three cadastros lists reads this snapshot. The early
 * return hands back the identical object in the normal case (nothing optimistic in
 * flight), so no downstream `useMemo` or prop identity changes.
 */
export function withoutOptimisticRows(snapshot: SalesOpsBootstrap): SalesOpsBootstrap {
  const areas = snapshot.areas.filter((row) => !isOptimisticId(row.id));
  const clients = snapshot.clients.filter((row) => !isOptimisticId(row.id));
  const people = snapshot.people.filter((row) => !isOptimisticId(row.id));
  if (
    areas.length === snapshot.areas.length &&
    clients.length === snapshot.clients.length &&
    people.length === snapshot.people.length
  ) {
    return snapshot;
  }
  return { ...snapshot, areas, clients, people };
}
