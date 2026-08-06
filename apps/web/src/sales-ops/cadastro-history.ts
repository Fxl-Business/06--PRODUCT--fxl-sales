import { isServiceProduct } from './calculations';
import { isOptimisticId } from './optimistic';
import type { CadastroResource, SetCadastroStatusPayload } from './api';
import type { SalesOpsBootstrap } from './types';

/**
 * The `Histórico de arquivamentos` panel's whole decision surface, as pure
 * functions - the `calculations.ts` idiom: every judgement this screen makes is
 * callable directly from a test, and the component holds only state and JSX.
 *
 * This module must NEVER import `SalesOpsApp.tsx` (that file imports the panel,
 * so the edge would be a cycle) and must never re-declare `CadastroResource` or
 * `SetCadastroStatusPayload` - slice 03 owns both, in `./api`, and a second
 * declaration is a second door to one fact.
 */

/** How many events the panel asks for and renders. There is no pager, on purpose. */
export const CADASTRO_HISTORY_LIMIT = 50;

/**
 * The ledger actions this panel shows, sent to the history endpoint as a
 * comma-separated `action` set. These MUST stay identical to
 * `CADASTRO_LIFECYCLE_ACTIONS` in `apps/api/src/domains/audit/service.ts` -
 * nothing type-checks the pair, and a fourth action added there is invisible here
 * until it is added here too.
 */
export const CADASTRO_HISTORY_ACTIONS = [
  'cadastro.archived',
  'cadastro.restored',
  'cadastro.purged',
] as const;

/** The wire shape of one `GET /api/v1/sales-ops/history` entry. */
export type CadastroHistoryEntryWire = {
  id: string;
  ts: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  actorUserId: string;
  actorDisplayName: string | null;
};

export type CadastroHistoryResponse = {
  entries: CadastroHistoryEntryWire[];
  nextCursor: string | null;
};

/**
 * The ledger's entity vocabulary, which is the API's pt-BR `entity_type` verbatim.
 * DELIBERATELY not named `CadastroKind`: `SalesOpsApp.tsx` exports a DIFFERENT type
 * by that name (`'produto' | 'servico' | 'area' | 'funcao' | 'pessoa'`), which splits
 * produto from serviço for the confirmation copy. A ledger row cannot make that
 * split - `entity_type` is `produto` for both - so the two vocabularies are genuinely
 * different and must not share a name.
 */
export type HistoryEntityKind = 'produto' | 'pessoa' | 'funcao' | 'area';

export type CadastroHistoryVerb = 'archive' | 'restore' | 'purge';

export type CadastroHistoryRow = {
  id: string;
  ts: string;
  rawAction: string;
  kind: HistoryEntityKind | null;
  verb: CadastroHistoryVerb | null;
  entityId: string;
  snapshotLabel: string | null;
  actorUserId: string;
  actorDisplayName: string | null;
};

export type RestoreState =
  | { state: 'available'; target: SetCadastroStatusPayload }
  | { state: 'already-active' }
  /** The nightly purge hard-deleted the row. Terminal: nothing can bring it back. */
  | { state: 'purged' }
  | { state: 'missing' }
  | { state: 'none' };

export type ResolvedHistoryRow = CadastroHistoryRow & {
  kindLabel: string;
  /** `Arquivou` | `Restaurou`, or the raw action when this build does not know it. */
  eventLabel: string;
  eventIsKnown: boolean;
  entityLabel: string;
  entityLabelIsId: boolean;
  previousLabel: string | null;
  /** `''` when `actorDisplayName` named the actor; otherwise the muted-mono id. */
  actorLabel: string;
  actorLabelIsId: boolean;
  restore: RestoreState;
};

export type CadastroHistoryPage = { rows: CadastroHistoryRow[]; hasMore: boolean };

const ENTITY_KINDS: readonly HistoryEntityKind[] = ['produto', 'pessoa', 'funcao', 'area'];

/** The one place the ledger's pt-BR kind meets slice 03's endpoint vocabulary. */
const RESTORE_RESOURCE: Record<HistoryEntityKind, CadastroResource> = {
  produto: 'products',
  pessoa: 'people',
  funcao: 'funcoes',
  area: 'areas',
};

const KIND_LABEL: Record<HistoryEntityKind, string> = {
  produto: 'Produto',
  pessoa: 'Pessoa',
  funcao: 'Função',
  area: 'Área',
};

/**
 * Matches the four pt-BR literals EXACTLY, after a trim and a lowercase. Every
 * other value - `product`, `products`, `sales_ops_products`, `cliente`, `área`
 * with its diacritic - is `null` and renders read-only. There is exactly one
 * writer of these values and it is this same feature's API slice, so tolerance
 * here would not absorb a variant, it would hide a genuine contract break.
 */
export function normalizeHistoryEntityKind(
  value: string | null | undefined,
): HistoryEntityKind | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return ENTITY_KINDS.find((kind) => kind === candidate) ?? null;
}

/**
 * Matches the three action literals exactly. Deliberately NOT a split on `.` with
 * a look at the last segment: the action never encodes the entity (that is what
 * `entityType` is for), and `commission.approve` must resolve to `null` rather
 * than to a verb.
 */
export function normalizeHistoryVerb(action: string): CadastroHistoryVerb | null {
  if (action === 'cadastro.archived') return 'archive';
  if (action === 'cadastro.restored') return 'restore';
  if (action === 'cadastro.purged') return 'purge';
  return null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Maps the wire page onto rows, dropping any entry with no `id` or no `ts` -
 * both are the row's identity on screen and a blank one would key a React list
 * on `''`. It does NOT sort: the endpoint returns `id DESC`, which is the hash
 * chain's own order, and a client re-sort would silently disagree with it.
 *
 * `hasMore` comes from `nextCursor`, never from `entries.length`: the endpoint
 * fetches `limit + 1` rows precisely so the cursor is exact, whereas the length
 * heuristic claims truncation on an org whose history is exactly 50 events long
 * and complete.
 */
export function normalizeCadastroHistory(
  response: CadastroHistoryResponse | undefined,
): CadastroHistoryPage {
  const entries = Array.isArray(response?.entries) ? response.entries : [];
  const rows: CadastroHistoryRow[] = [];
  for (const entry of entries) {
    const id = nonEmpty(entry?.id);
    const ts = nonEmpty(entry?.ts);
    if (!id || !ts) continue;
    rows.push({
      id,
      ts,
      rawAction: entry.action ?? '',
      kind: normalizeHistoryEntityKind(entry.entityType),
      verb: normalizeHistoryVerb(entry.action ?? ''),
      entityId: entry.entityId ?? '',
      snapshotLabel: nonEmpty(entry.entityLabel),
      actorUserId: entry.actorUserId ?? '',
      actorDisplayName: nonEmpty(entry.actorDisplayName),
    });
  }
  return { rows, hasMore: (response?.nextCursor ?? null) !== null };
}

/**
 * `dd/mm/aaaa hh:mm` in the operator's own timezone.
 *
 * `formatIsoDateBr` is deliberately not reused: it takes a date-only business
 * date and slices the string, so it cannot express a time and would print the
 * UTC day. A ledger entry is a real instant, and an audit trail that shifts an
 * event to the wrong day is worse than one with no clock at all.
 */
export function formatLedgerTimestampBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

/** What the live cadastro row says about itself, or `null` when it is gone. */
type LiveCadastro = { name: string; archived: boolean; isSystem: boolean; isService: boolean };

function findLiveCadastro(
  kind: HistoryEntityKind,
  entityId: string,
  bootstrap: SalesOpsBootstrap,
): LiveCadastro | null {
  if (kind === 'produto') {
    const row = bootstrap.products.find((candidate) => candidate.id === entityId);
    return row
      ? {
          name: row.name,
          archived: row.status !== 'active',
          isSystem: false,
          // The single sanctioned place any branch on the Produto/Serviço
          // discriminator happens. Never re-derived from `openPrice` or `kind`.
          isService: isServiceProduct(row),
        }
      : null;
  }
  if (kind === 'area') {
    const row = bootstrap.areas.find((candidate) => candidate.id === entityId);
    return row
      ? { name: row.name, archived: row.status !== 'active', isSystem: false, isService: false }
      : null;
  }
  if (kind === 'funcao') {
    const row = bootstrap.funcoes.find((candidate) => candidate.id === entityId);
    return row
      ? {
          name: row.name,
          archived: row.status !== 'active',
          isSystem: row.isSystem,
          isService: false,
        }
      : null;
  }
  const row = bootstrap.people.find((candidate) => candidate.id === entityId);
  return row
    ? {
        // A pessoa stores `inactive`, not `archived`.
        name: row.displayName,
        archived: row.status !== 'active',
        isSystem: false,
        isService: false,
      }
    : null;
}

const NO_PURGES: ReadonlySet<string> = new Set();

/**
 * The entity ids the page reports as hard-deleted by the nightly purge.
 *
 * Derived from the rendered page rather than from a separate read, because the
 * purge entry is the only surviving evidence the row ever existed: the row is
 * gone from `bootstrap`, and `missing` alone cannot tell "purged" apart from
 * "not in this cache". One pass, so the panel computes it once for the table.
 */
export function purgedEntityIds(rows: readonly CadastroHistoryRow[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.verb === 'purge' && row.entityId) ids.add(row.entityId);
  }
  return ids;
}

/**
 * Restore is offered ONLY where it can actually succeed: an archive event whose
 * entity is still archived and still restorable. Everything else says so in
 * words instead of offering a disabled button, which would read as "temporarily
 * unavailable, try again" rather than "there is nothing to do here".
 */
export function restoreStateFor(
  row: CadastroHistoryRow,
  bootstrap: SalesOpsBootstrap,
  purged: ReadonlySet<string> = NO_PURGES,
): RestoreState {
  // 0. The purge is terminal and outranks every other reading, including a live
  //    row still sitting in a stale bootstrap cache: the PATCH would 404. It
  //    applies to the purge entry itself AND to the earlier archive entry for the
  //    same entity, which is the row an operator would actually click.
  if (row.verb === 'purge' || (row.entityId && purged.has(row.entityId))) {
    return { state: 'purged' };
  }
  // 1. A restore entry never offers a restore.
  if (row.verb !== 'archive') return { state: 'none' };
  // 2. An entity kind this build does not recognize renders read-only.
  if (!row.kind) return { state: 'none' };
  // 3. An `optimistic:` placeholder id would fail the uuid cast on the PATCH path.
  if (!row.entityId || isOptimisticId(row.entityId)) return { state: 'none' };

  const live = findLiveCadastro(row.kind, row.entityId, bootstrap);
  if (!live) return { state: 'missing' };

  // 5. `vendedor` and `finder` answer `409 funcao_is_system` to any write, so a
  //    button here would be a guaranteed failure. Unreachable today - the API
  //    guard returns before the ledger write - but one backfill away from real.
  if (row.kind === 'funcao' && live.isSystem) return { state: 'none' };

  // 4. Already active: the affordance is simply not there, and the row says why.
  if (!live.archived) return { state: 'already-active' };

  return {
    state: 'available',
    target: { resource: RESTORE_RESOURCE[row.kind], id: row.entityId, status: 'active' },
  };
}

/**
 * The live row's CURRENT name is the primary label, the ledger snapshot is
 * disclosed underneath when it differs, and the raw id is the last resort.
 *
 * A snapshot-only label would be the purist reading of "a ledger records the
 * past", and it is rejected because it makes the restore button unusable: after
 * a rename the operator would restore a name that exists nowhere in the app and
 * then be unable to find it. `antes:` is what keeps the record honest.
 */
export function resolveHistoryRow(
  row: CadastroHistoryRow,
  bootstrap: SalesOpsBootstrap,
  purged: ReadonlySet<string> = NO_PURGES,
): ResolvedHistoryRow {
  /*
    After a purge there is no live row by construction, so `entityLabel` below falls
    through to `snapshotLabel` - the `label` the purge wrote into `after_jsonb`,
    which is the only thing left that can name the deleted cadastro.
  */
  const live = row.kind ? findLiveCadastro(row.kind, row.entityId, bootstrap) : null;

  const entityLabel = live?.name ?? row.snapshotLabel ?? row.entityId;
  const entityLabelIsId = !live?.name && !row.snapshotLabel;
  const previousLabel =
    live?.name && row.snapshotLabel && row.snapshotLabel !== live.name ? row.snapshotLabel : null;

  const kindLabel = row.kind
    ? row.kind === 'produto' && live?.isService
      ? 'Serviço'
      : KIND_LABEL[row.kind]
    : 'Cadastro';

  const eventLabel =
    row.verb === 'archive'
      ? 'Arquivou'
      : row.verb === 'restore'
        ? 'Restaurou'
        : // Spelled out rather than a bare `Excluiu`: this is the one irreversible
          // event in the ledger, and the actor beside it is `Sistema`.
          row.verb === 'purge'
          ? 'Excluiu definitivamente'
          : row.rawAction;

  return {
    ...row,
    kindLabel,
    eventLabel,
    eventIsKnown: row.verb !== null,
    entityLabel,
    entityLabelIsId,
    previousLabel,
    // The account id is DATA. It reaches the cell only when no name exists, and
    // even then it is secondary text under a pt-BR primary label.
    actorLabel: row.actorDisplayName ? '' : row.actorUserId,
    actorLabelIsId: !row.actorDisplayName,
    restore: restoreStateFor(row, bootstrap, purged),
  };
}
