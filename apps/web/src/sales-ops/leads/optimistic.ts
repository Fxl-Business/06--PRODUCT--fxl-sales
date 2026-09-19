import type { MoveLeadPayload } from './api';
import { leadsInStage } from './calculations';
import type { LeadsInfiniteData, SalesOpsLead } from './types';

/**
 * Pure optimistic patches over the board's raw infinite-query snapshot.
 *
 * This file EXTENDS the pattern in `apps/web/src/sales-ops/optimistic.ts` - a
 * pure function that takes the raw cache snapshot plus a payload and returns
 * `{next, previous, …}`, with the hook writing `next` in `onMutate`, writing
 * `previous` back in `onError` and reconciling the server row in `onSuccess`.
 * Same contract, different snapshot type. There is deliberately no second
 * pattern.
 */

export type OptimisticLeadPatch = {
  /** the snapshot to write into the cache during onMutate */
  next: LeadsInfiniteData;
  /** the untouched snapshot, for onError rollback */
  previous: LeadsInfiniteData;
  /** the id of the lead that moved */
  leadId: string;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Re-densify one column to `0 … n-1`, replacing ONLY the rows whose position
 * actually changed. Every other row comes out as the exact object that went in,
 * so a downstream `useMemo` over an untouched column does not churn.
 */
function densify(column: readonly SalesOpsLead[], into: Map<string, SalesOpsLead>): void {
  column.forEach((row, index) => {
    if (row.position === index) return;
    into.set(row.id, { ...(into.get(row.id) ?? row), position: index });
  });
}

/**
 * The pure core, over a FLAT list of every visible card.
 *
 * `now` is an ARGUMENT and never `new Date()` inside the function: the function
 * stays pure, and the `stageChangedAt` oracle asserts an exact string rather than
 * fighting a clock.
 *
 * This function deliberately does NOT refuse a converted card. The board refuses
 * it (via `leadIsConverted`) and the API answers `409 lead_already_converted`. A
 * third copy of one policy is a third thing that can drift; this function's job
 * is the patch, not the permission.
 */
export function moveLeadInList(
  leads: readonly SalesOpsLead[],
  payload: MoveLeadPayload,
  now: string,
): SalesOpsLead[] {
  const moving = leads.find((row) => row.id === payload.leadId);
  // Unknown lead: hand back the identical array, the same early-return discipline
  // `withoutOptimisticRows` uses. A card filtered out between render and drop must
  // not crash on `undefined.stageId`.
  if (!moving) return leads as SalesOpsLead[];

  const sameStage = moving.stageId === payload.toStageId;
  const replacements = new Map<string, SalesOpsLead>();

  const movedRow: SalesOpsLead = {
    ...moving,
    stageId: payload.toStageId,
    // ONLY on a real stage change. On a pure reorder the stamp comes out
    // byte-identical, which is what keeps the "days parked" counter honest.
    stageChangedAt: sameStage ? moving.stageChangedAt : now,
    // A reorder never touches the reason either.
    lostReason: sameStage ? moving.lostReason : (payload.reason ?? null),
  };
  replacements.set(movedRow.id, movedRow);

  const destination = leadsInStage(leads, payload.toStageId).filter(
    (row) => row.id !== moving.id,
  );
  destination.splice(clamp(payload.toIndex, 0, destination.length), 0, movedRow);
  densify(destination, replacements);

  if (!sameStage) {
    const source = leadsInStage(leads, moving.stageId).filter((row) => row.id !== moving.id);
    densify(source, replacements);
  }

  // Same array ORDER as the input, rows replaced in place by id. Page membership
  // and list order are irrelevant to rendering because every reader sorts through
  // `leadsInStage`, and keeping the order stable is what lets the snapshot patch
  // below map the result back over the pages without moving a row between pages.
  return leads.map((row) => replacements.get(row.id) ?? row);
}

export function flattenLeadPages(data: LeadsInfiniteData | undefined): SalesOpsLead[] {
  return data ? data.pages.flatMap((page) => page.leads) : [];
}

/** Board-wide: the last page still names a cursor, so some column has more to give. */
export function leadsHasMore(data: LeadsInfiniteData | undefined): boolean {
  const last = data?.pages.at(-1);
  return last ? last.nextCursor !== null : false;
}

/**
 * The snapshot patch.
 *
 * Deliberately does NOT write `saleId` into the optimistic snapshot, even when
 * the payload carries one: `saleId` arrives from the server row through
 * `reconcileLeadRow` or the invalidated refetch. Writing it optimistically would
 * make the card read-only for a beat before the server has agreed, and a failed
 * move would then have to un-read-only it.
 */
export function optimisticLeadMove(
  previous: LeadsInfiniteData,
  payload: MoveLeadPayload,
  now: string = new Date().toISOString(),
): OptimisticLeadPatch {
  const flat = flattenLeadPages(previous);
  const moved = moveLeadInList(flat, payload, now);
  if (moved === flat) return { next: previous, previous, leadId: payload.leadId };

  const byId = new Map(moved.map((row) => [row.id, row]));
  return {
    next: {
      pages: previous.pages.map((page) => ({
        ...page,
        leads: page.leads.map((row) => byId.get(row.id) ?? row),
      })),
      pageParams: previous.pageParams,
    },
    previous,
    leadId: payload.leadId,
  };
}

/**
 * Swap the row the server returned for whatever sits under its id, leaving every
 * other row and every page boundary alone. Mirrors `reconcileOptimisticRow`, for
 * the same reason: the server's `position` integers land before the invalidated
 * refetch arrives, so the card does not visibly hop.
 *
 * A row no page holds is a lead that was just created, and it is prepended to the
 * FIRST page.
 */
export function reconcileLeadRow(
  snapshot: LeadsInfiniteData,
  persisted: SalesOpsLead,
): LeadsInfiniteData {
  const held = snapshot.pages.some((page) => page.leads.some((row) => row.id === persisted.id));
  if (held) {
    return {
      pages: snapshot.pages.map((page) => ({
        ...page,
        leads: page.leads.map((row) => (row.id === persisted.id ? persisted : row)),
      })),
      pageParams: snapshot.pageParams,
    };
  }
  const [first, ...rest] = snapshot.pages;
  if (!first) {
    return {
      pages: [{ leads: [persisted], nextCursor: null }],
      pageParams: snapshot.pageParams,
    };
  }
  return {
    pages: [{ ...first, leads: [persisted, ...first.leads] }, ...rest],
    pageParams: snapshot.pageParams,
  };
}
