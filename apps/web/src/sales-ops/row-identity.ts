/** A persisted row id, or `null` for a row the API has never seen. */
export type RowId = string | null;

/**
 * Carries persisted ids onto a regenerated plan BY ROW INDEX: row `i` of `next`
 * takes `previous[i].id`, rows past the end of `previous` get `null`, and ids of
 * `previous` rows past the end of `next` are dropped (the API voids them).
 * Never matches by label (`N/M` renumbers) or by due date (a moved anchor moves
 * every date). The amount is never read, so a zero-amount row keeps its id.
 */
export function carryRowIdsPositionally<T extends object>(
  previous: ReadonlyArray<{ readonly id: RowId }>,
  next: ReadonlyArray<T>,
): Array<T & { id: RowId }> {
  return next.map((row, index) => ({ ...row, id: previous[index]?.id ?? null }));
}

/** `null`, `undefined` and blank become `undefined`, so JSON omits the key. */
export function payloadRowId(id: RowId | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The first `cycles` non-blank ids in the given (cycle) order, or `undefined` when
 * none remain. The API binds cycle i+1 to index i, refuses more ids than cycles
 * (`recurring_ids_exceed_cycles`), and voids every live `M` row not listed, so a
 * shrunk recorrência simply sends fewer ids. `cycles` null (indefinite) sends none.
 */
export function payloadReceivableIds(
  ids: ReadonlyArray<string> | undefined,
  cycles: number | null | undefined,
): string[] | undefined {
  const limit = typeof cycles === 'number' && cycles > 0 ? Math.floor(cycles) : 0;
  const kept = (ids ?? []).map((id) => id.trim()).filter((id) => id !== '').slice(0, limit);
  return kept.length > 0 ? kept : undefined;
}
